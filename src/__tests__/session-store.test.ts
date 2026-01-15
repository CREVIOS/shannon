// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createSession,
  updateSessionStatus,
  listSessions,
  loadSessionStore,
} from '../session-store.js';

describe('Session Store', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shannon-session-store-'));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates and lists sessions with outputPath', async () => {
    const repoPath = path.join(tempDir, 'repo');
    const outputPath = path.join(tempDir, 'audit-logs');
    await fs.mkdir(repoPath, { recursive: true });

    const session = await createSession('https://example.com', repoPath, outputPath);
    const sessions = await listSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe(session.id);
    expect(sessions[0]!.status).toBe('in-progress');
    expect(sessions[0]!.outputPath).toBe(outputPath);
  });

  it('prevents duplicate in-progress sessions for same repo', async () => {
    const repoPath = path.join(tempDir, 'repo');
    await fs.mkdir(repoPath, { recursive: true });

    await createSession('https://example.com', repoPath);
    await expect(createSession('https://example.com', repoPath)).rejects.toThrow(
      /Session already in progress/
    );
  });

  it('updates session status in the store', async () => {
    const repoPath = path.join(tempDir, 'repo');
    await fs.mkdir(repoPath, { recursive: true });

    const session = await createSession('https://example.com', repoPath);
    await updateSessionStatus(session.id, 'completed');

    const sessions = await listSessions();
    expect(sessions[0]!.status).toBe('completed');
  });

  it('returns empty store on corrupted file', async () => {
    await fs.writeFile(path.join(tempDir, '.shannon-store.json'), '{bad json');

    const store = await loadSessionStore();
    expect(store.sessions).toEqual([]);
  });
});
