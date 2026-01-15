// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { safeValidateQueueAndDeliverable, validateQueueAndDeliverable } from '../queue-validation.js';

const createDeliverablesDir = async (sourceDir: string): Promise<string> => {
  const deliverablesDir = path.join(sourceDir, 'deliverables');
  await fs.mkdir(deliverablesDir, { recursive: true });
  return deliverablesDir;
};

const writeDeliverable = async (deliverablesDir: string, filename: string): Promise<void> => {
  await fs.writeFile(path.join(deliverablesDir, filename), '# deliverable', 'utf8');
};

const writeQueue = async (deliverablesDir: string, filename: string, payload: unknown): Promise<void> => {
  await fs.writeFile(path.join(deliverablesDir, filename), JSON.stringify(payload), 'utf8');
};

describe('Queue Validation', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shannon-queue-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('fails when neither deliverable nor queue exists', async () => {
    const result = await safeValidateQueueAndDeliverable('injection', tempDir);

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/Neither deliverable nor queue file exists/);
  });

  it('fails when deliverable exists but queue missing', async () => {
    const deliverablesDir = await createDeliverablesDir(tempDir);
    await writeDeliverable(deliverablesDir, 'xss_analysis_deliverable.md');

    const result = await safeValidateQueueAndDeliverable('xss', tempDir);

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/queue file missing/i);
  });

  it('fails when queue exists but deliverable missing', async () => {
    const deliverablesDir = await createDeliverablesDir(tempDir);
    await writeQueue(deliverablesDir, 'auth_exploitation_queue.json', { vulnerabilities: [] });

    const result = await safeValidateQueueAndDeliverable('auth', tempDir);

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/deliverable file missing/i);
  });

  it('fails when queue JSON is malformed', async () => {
    const deliverablesDir = await createDeliverablesDir(tempDir);
    await writeDeliverable(deliverablesDir, 'ssrf_analysis_deliverable.md');
    await fs.writeFile(path.join(deliverablesDir, 'ssrf_exploitation_queue.json'), '{bad json', 'utf8');

    const result = await safeValidateQueueAndDeliverable('ssrf', tempDir);

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/Invalid JSON structure/i);
  });

  it('fails when queue JSON is missing vulnerabilities array', async () => {
    const deliverablesDir = await createDeliverablesDir(tempDir);
    await writeDeliverable(deliverablesDir, 'authz_analysis_deliverable.md');
    await writeQueue(deliverablesDir, 'authz_exploitation_queue.json', { issues: [] });

    const result = await safeValidateQueueAndDeliverable('authz', tempDir);

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/Missing or invalid 'vulnerabilities' array/i);
  });

  it('returns shouldExploit=false when queue is valid but empty', async () => {
    const deliverablesDir = await createDeliverablesDir(tempDir);
    await writeDeliverable(deliverablesDir, 'injection_analysis_deliverable.md');
    await writeQueue(deliverablesDir, 'injection_exploitation_queue.json', { vulnerabilities: [] });

    const result = await validateQueueAndDeliverable('injection', tempDir);

    expect(result.shouldExploit).toBe(false);
    expect(result.vulnerabilityCount).toBe(0);
  });

  it('returns shouldExploit=true when queue has vulnerabilities', async () => {
    const deliverablesDir = await createDeliverablesDir(tempDir);
    await writeDeliverable(deliverablesDir, 'xss_analysis_deliverable.md');
    await writeQueue(deliverablesDir, 'xss_exploitation_queue.json', {
      vulnerabilities: [{ id: 1 }, { id: 2 }],
    });

    const result = await validateQueueAndDeliverable('xss', tempDir);

    expect(result.shouldExploit).toBe(true);
    expect(result.vulnerabilityCount).toBe(2);
  });
});
