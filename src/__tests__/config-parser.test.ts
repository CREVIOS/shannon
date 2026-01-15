// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseConfig, distributeConfig } from '../config-parser.js';

describe('Config Parser', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shannon-config-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('parses a valid authentication config', async () => {
    const configPath = path.join(tempDir, 'config.yaml');
    await fs.writeFile(
      configPath,
      [
        'authentication:',
        '  login_type: form',
        '  login_url: https://example.com/login',
        '  credentials:',
        '    username: user@example.com',
        '    password: "Passw0rd!"',
        '  login_flow:',
        '    - "Open login page"',
        '    - "Submit credentials"',
        '  success_condition:',
        '    type: url_contains',
        '    value: /dashboard',
      ].join('\n'),
      'utf8'
    );

    const config = await parseConfig(configPath);
    expect(config.authentication?.login_type).toBe('form');
    expect(config.authentication?.login_url).toBe('https://example.com/login');
  });

  it('rejects dangerous patterns in rules', async () => {
    const configPath = path.join(tempDir, 'config.yaml');
    await fs.writeFile(
      configPath,
      [
        'rules:',
        '  focus:',
        '    - description: "../admin traversal"',
        '      type: path',
        '      url_path: /admin',
      ].join('\n'),
      'utf8'
    );

    await expect(parseConfig(configPath)).rejects.toThrow(/dangerous pattern/i);
  });

  it('rejects conflicting rules between avoid and focus', async () => {
    const configPath = path.join(tempDir, 'config.yaml');
    await fs.writeFile(
      configPath,
      [
        'rules:',
        '  avoid:',
        '    - description: Avoid login',
        '      type: path',
        '      url_path: /login',
        '  focus:',
        '    - description: Focus login',
        '      type: path',
        '      url_path: /login',
      ].join('\n'),
      'utf8'
    );

    await expect(parseConfig(configPath)).rejects.toThrow(/Conflicting rule/i);
  });

  it('sanitizes config values when distributing', () => {
    const distributed = distributeConfig({
      authentication: {
        login_type: 'FORM' as unknown as 'form',
        login_url: ' https://example.com/login ',
        credentials: {
          username: ' user@example.com ',
          password: 'Passw0rd!',
        },
        login_flow: [' Step 1 ', 'Step 2'],
        success_condition: {
          type: 'URL' as unknown as 'url',
          value: ' /dashboard ',
        },
      },
      rules: {
        focus: [
          { description: ' Focus on /api ', type: 'PATH' as unknown as 'path', url_path: ' /api ' },
        ],
      },
    });

    expect(distributed.authentication?.login_type).toBe('form');
    expect(distributed.authentication?.login_url).toBe('https://example.com/login');
    expect(distributed.authentication?.credentials.username).toBe('user@example.com');
    expect(distributed.authentication?.success_condition.type).toBe('url');
    expect(distributed.focus[0]?.type).toBe('path');
    expect(distributed.focus[0]?.url_path).toBe('/api');
  });
});
