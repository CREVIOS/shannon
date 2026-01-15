// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MetricsTracker } from '../metrics-tracker.js';
import { initializeAuditStructure, generateSessionJsonPath, readJson } from '../utils.js';

describe('MetricsTracker', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shannon-metrics-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('records current_attempt on start and clears on end', async () => {
    const sessionMetadata = {
      id: 'session-test-1',
      webUrl: 'https://example.com',
      outputPath: tempDir,
    };

    await initializeAuditStructure(sessionMetadata);

    const tracker = new MetricsTracker(sessionMetadata);
    await tracker.initialize();
    await tracker.startAgent('recon', 1);

    const sessionJsonPath = generateSessionJsonPath(sessionMetadata);
    const initial = await readJson<any>(sessionJsonPath);

    expect(initial.metrics.agents.recon.current_attempt?.attempt_number).toBe(1);

    await tracker.endAgent('recon', {
      attemptNumber: 1,
      duration_ms: 1500,
      cost_usd: 0.25,
      success: true,
      isFinalAttempt: true,
    });

    const updated = await readJson<any>(sessionJsonPath);
    expect(updated.metrics.agents.recon.current_attempt).toBeUndefined();
    expect(updated.metrics.agents.recon.status).toBe('success');
    expect(updated.metrics.total_duration_ms).toBe(1500);
    expect(updated.metrics.total_cost_usd).toBe(0.25);
  });
});
