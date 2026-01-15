// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const spawnMock = vi.fn(() => {
  const emitter = new EventEmitter();
  return {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
  };
});

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

describe('API Server', () => {
  let tempDir: string;
  let server: http.Server;
  let baseUrl: string;
  let originalCwd: string;

  const apiKey = 'a'.repeat(32);

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shannon-api-'));
    process.chdir(tempDir);
    vi.resetModules();

    const { createRequestHandler } = await import('../server.js');
    const handler = createRequestHandler(apiKey, undefined, undefined);

    server = http.createServer(handler);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (address && typeof address !== 'string') {
      baseUrl = `http://127.0.0.1:${address.port}`;
    } else {
      throw new Error('Failed to bind server');
    }
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
    spawnMock.mockClear();
  });

  it('serves health without authentication', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    const payload = await response.json() as any;
    expect(payload.status).toBe('ok');
    expect(payload).toHaveProperty('uptime');
  });

  it('rejects unauthorized access to runs', async () => {
    const response = await fetch(`${baseUrl}/api/v1/runs`);
    expect(response.status).toBe(401);
    const payload = await response.json() as any;
    expect(payload.code).toBe('UNAUTHORIZED');
  });

  it('validates request body for create run', async () => {
    const response = await fetch(`${baseUrl}/api/v1/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: 'not-json',
    });

    expect(response.status).toBe(400);
    const payload = await response.json() as any;
    expect(payload.code).toBe('BAD_REQUEST');
  });

  it('creates a run and spawns a process', async () => {
    const response = await fetch(`${baseUrl}/api/v1/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        web_url: 'https://example.com',
        repo_path: '/tmp/repo',
      }),
    });

    expect(response.status).toBe(202);
    const payload = await response.json() as any;
    expect(payload.status).toBe('running');
    expect(payload.run_id).toBeDefined();
    expect(spawnMock).toHaveBeenCalled();
  });
});
