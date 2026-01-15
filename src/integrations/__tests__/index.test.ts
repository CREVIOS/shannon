// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FindingsReport } from '../../findings/types.js';

const mocks = vi.hoisted(() => ({
  notifySlack: vi.fn(),
  createJiraIssuesForFindings: vi.fn(),
  sendWebhookEventToAll: vi.fn(),
}));

vi.mock('../slack.js', () => ({
  notifySlack: mocks.notifySlack,
}));

vi.mock('../jira.js', () => ({
  createJiraIssuesForFindings: mocks.createJiraIssuesForFindings,
}));

vi.mock('../webhooks.js', () => ({
  sendWebhookEventToAll: mocks.sendWebhookEventToAll,
}));

import { runIntegrations } from '../index.js';

describe('Integrations Runner', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.notifySlack.mockReset();
    mocks.createJiraIssuesForFindings.mockReset();
    mocks.sendWebhookEventToAll.mockReset();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  const report: FindingsReport = {
    assessment_date: '2026-01-15',
    target: {
      web_url: 'https://example.com',
      repo_path: '/tmp/repo',
    },
    findings: [
      {
        id: 'F-1',
        title: 'XSS',
        category: 'XSS',
        summary: 'Reflected XSS',
        evidence: '<script>alert(1)</script>',
        impact: 'User session theft',
        affected_endpoints: ['/search?q='],
        status: 'unverified',
        severity: 'High',
        remediation: 'Escape output',
        compliance: {
          owasp_top10_2021: ['A03'],
          pci_dss_v4: [],
          soc2_tsc: [],
        },
      },
    ],
  };

  it('collects artifacts from Slack, Jira, and webhooks', async () => {
    mocks.notifySlack.mockResolvedValue({ success: true });
    mocks.createJiraIssuesForFindings.mockResolvedValue(
      new Map([['F-1', { success: true, issueKey: 'SEC-1' }]])
    );
    mocks.sendWebhookEventToAll.mockResolvedValue(
      new Map([['https://hooks.example.com', { success: true }]])
    );

    const artifacts = await runIntegrations(
      {
        slack: { webhook_url: 'https://hooks.slack.com/services/test' },
        jira: {
          base_url: 'https://example.atlassian.net',
          email: 'sec@example.com',
          api_token: 'token-123456789012345678901234',
          project_key: 'SEC',
          issue_type: 'Bug',
        },
        webhooks: [
          { url: 'https://hooks.example.com', secret: 'a'.repeat(32) },
        ],
      },
      report
    );

    expect(artifacts.slackSuccess).toBe(true);
    expect(artifacts.jiraIssueKeys).toEqual(['SEC-1']);
    expect(artifacts.webhookResults.size).toBe(1);
    expect(artifacts.errors).toEqual([]);
    expect(mocks.sendWebhookEventToAll).toHaveBeenCalled();
  });

  it('records integration errors for failures', async () => {
    mocks.notifySlack.mockResolvedValue({ success: false, error: 'Slack down' });
    mocks.createJiraIssuesForFindings.mockResolvedValue(
      new Map([['F-1', { success: false, error: 'Jira error' }]])
    );
    mocks.sendWebhookEventToAll.mockResolvedValue(
      new Map([['https://hooks.example.com', { success: false, error: 'timeout' }]])
    );

    const artifacts = await runIntegrations(
      {
        slack: { webhook_url: 'https://hooks.slack.com/services/test' },
        jira: {
          base_url: 'https://example.atlassian.net',
          email: 'sec@example.com',
          api_token: 'token-123456789012345678901234',
          project_key: 'SEC',
          issue_type: 'Bug',
        },
        webhooks: [
          { url: 'https://hooks.example.com', secret: 'a'.repeat(32) },
        ],
      },
      report
    );

    expect(artifacts.errors.some((err) => err.includes('Slack'))).toBe(true);
    expect(artifacts.errors.some((err) => err.includes('Jira'))).toBe(true);
    expect(artifacts.errors.some((err) => err.includes('Webhook'))).toBe(true);
  });
});
