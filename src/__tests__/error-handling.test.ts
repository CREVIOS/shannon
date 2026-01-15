// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  isRetryableError,
  getRetryDelay,
  handleToolError,
  logError,
} from '../error-handling.js';

describe('Error Handling', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shannon-error-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('classifies retryable and non-retryable errors', () => {
    expect(isRetryableError(new Error('network timeout'))).toBe(true);
    expect(isRetryableError(new Error('rate limit exceeded'))).toBe(true);
    expect(isRetryableError(new Error('authentication failed'))).toBe(false);
  });

  it('calculates backoff delay for rate limit errors', () => {
    const delay1 = getRetryDelay(new Error('429 rate limit'), 1);
    const delay3 = getRetryDelay(new Error('rate limit'), 3);
    expect(delay1).toBeGreaterThanOrEqual(30000);
    expect(delay3).toBeGreaterThan(delay1);
  });

  it('wraps tool errors with retryable status', () => {
    const error = new Error('connection reset') as Error & { code?: string };
    error.code = 'ECONNRESET';

    const result = handleToolError('nmap', error);

    expect(result.success).toBe(false);
    const pentestError = result.error as unknown as { retryable: boolean; type: string };
    expect(pentestError.retryable).toBe(true);
    expect(pentestError.type).toBe('tool');
  });

  it('logs errors to file when sourceDir provided', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = new Error('boom');

    await logError(err, 'Test failure', tempDir);

    consoleSpy.mockRestore();
    const content = await fs.readFile(path.join(tempDir, 'error.log'), 'utf8');
    expect(content).toMatch(/Test failure/);
    expect(content).toMatch(/boom/);
  });
});
