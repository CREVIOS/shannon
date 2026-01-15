// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSession } from '../../session-store.js';
import { runMonitor, listSessionsCommand } from '../monitor.js';
import { generateSessionJsonPath, initializeAuditStructure } from '../../audit/utils.js';

describe('Monitor CLI', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shannon-monitor-'));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('outputs session JSON for latest session', async () => {
    const repoPath = path.join(tempDir, 'repo');
    const outputPath = path.join(tempDir, 'audit-logs');
    await fs.mkdir(repoPath, { recursive: true });

    const session = await createSession('https://example.com', repoPath, outputPath);

    const sessionMetadata = {
      id: session.id,
      webUrl: session.webUrl,
      outputPath,
    };
    await initializeAuditStructure(sessionMetadata);

    const sessionJsonPath = generateSessionJsonPath(sessionMetadata);
    const payload = {
      session: {
        id: session.id,
        webUrl: session.webUrl,
        status: 'in-progress',
        createdAt: new Date().toISOString(),
      },
      metrics: {
        total_duration_ms: 0,
        total_cost_usd: 0,
        phases: {},
        agents: {},
      },
    };
    await fs.writeFile(sessionJsonPath, JSON.stringify(payload, null, 2), 'utf8');

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    await runMonitor(['--json', '--latest', '--once']);

    spy.mockRestore();

    const jsonLine = logs.find((line) => line.trim().startsWith('{'));
    expect(jsonLine).toBeDefined();
    const parsed = JSON.parse(jsonLine!);
    expect(parsed.session.id).toBe(session.id);
    expect(parsed.session.webUrl).toBe(session.webUrl);
  });

  it('lists sessions in JSON format', async () => {
    const repoPath = path.join(tempDir, 'repo');
    await fs.mkdir(repoPath, { recursive: true });
    await createSession('https://example.com', repoPath);

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    await listSessionsCommand(['--json']);

    spy.mockRestore();

    const jsonLine = logs.find((line) => line.trim().startsWith('{'));
    expect(jsonLine).toBeDefined();
    const parsed = JSON.parse(jsonLine!);
    expect(parsed.sessions).toHaveLength(1);
  });
});
