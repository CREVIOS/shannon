// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('zx', () => ({
  $: vi.fn(),
}));

import { checkToolAvailability, handleMissingTools } from '../tool-checker.js';
import { $ } from 'zx';

describe('Tool Checker', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('detects available and missing tools', async () => {
    const mock$ = $ as unknown as ReturnType<typeof vi.fn>;
    mock$.mockImplementation((strings: TemplateStringsArray, tool: string) => {
      const command = `${strings[0]}${tool}${strings[1] ?? ''}`;
      if (command.includes('nmap') || command.includes('whatweb')) {
        return Promise.resolve({ stdout: '' });
      }
      return Promise.reject(new Error('not found'));
    });

    const availability = await checkToolAvailability();

    expect(availability.nmap).toBe(true);
    expect(availability.whatweb).toBe(true);
    expect(availability.subfinder).toBe(false);
    expect(availability.schemathesis).toBe(false);
  });

  it('returns missing tools from availability map', () => {
    const missing = handleMissingTools({
      nmap: true,
      subfinder: false,
      whatweb: false,
      schemathesis: true,
    });

    expect(missing).toEqual(['subfinder', 'whatweb']);
  });
});
