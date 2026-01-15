// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateWebUrl, validateRepoPath } from '../input-validator.js';

describe('CLI Input Validator', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shannon-input-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('validates HTTP/HTTPS URLs', () => {
    expect(validateWebUrl('https://example.com').valid).toBe(true);
    expect(validateWebUrl('http://example.com').valid).toBe(true);
    expect(validateWebUrl('ftp://example.com').valid).toBe(false);
    expect(validateWebUrl('not-a-url').valid).toBe(false);
  });

  it('validates repo paths and resolves absolute path', async () => {
    const repoPath = path.join(tempDir, 'repo');
    await fs.mkdir(repoPath, { recursive: true });

    const result = await validateRepoPath(repoPath);
    expect(result.valid).toBe(true);
    expect(result.path).toBe(path.resolve(repoPath));
  });

  it('rejects file paths that are not directories', async () => {
    const filePath = path.join(tempDir, 'file.txt');
    await fs.writeFile(filePath, 'content', 'utf8');

    const result = await validateRepoPath(filePath);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/must be a directory/i);
  });

  it('rejects missing repo paths', async () => {
    const result = await validateRepoPath(path.join(tempDir, 'missing'));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/does not exist/i);
  });
});
