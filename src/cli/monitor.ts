// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import chalk from 'chalk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { formatDuration, generateSessionJsonPath } from '../audit/utils.js';
import { loadSessionStore, type Session } from '../session-store.js';

interface MonitorOptions {
  sessionId: string | undefined;
  repoPath: string | undefined;
  latest: boolean;
  json: boolean;
  follow: boolean;
  intervalMs: number;
  clear: boolean;
}

interface AttemptData {
  attempt_number: number;
  duration_ms: number;
  cost_usd: number;
  success: boolean;
  timestamp: string;
  error?: string;
}

interface AgentMetrics {
  status: 'in-progress' | 'success' | 'failed';
  attempts: AttemptData[];
  final_duration_ms: number;
  total_cost_usd: number;
  checkpoint?: string;
  current_attempt?: {
    attempt_number: number;
    started_at: string;
  };
}

interface PhaseMetrics {
  duration_ms: number;
  duration_percentage: number;
  cost_usd: number;
  agent_count: number;
}

interface SessionJson {
  session: {
    id: string;
    webUrl: string;
    repoPath?: string;
    status: 'in-progress' | 'completed' | 'failed';
    createdAt: string;
    completedAt?: string;
  };
  metrics: {
    total_duration_ms: number;
    total_cost_usd: number;
    phases: Record<string, PhaseMetrics>;
    agents: Record<string, AgentMetrics>;
  };
}

const DEFAULT_INTERVAL_MS = 1500;

function showMonitorHelp(): void {
  console.log(chalk.cyan.bold('Shannon Monitor'));
  console.log(chalk.gray('Follow session metrics in real time.\n'));
  console.log(chalk.yellow.bold('USAGE:'));
  console.log('  shannon monitor [options]');
  console.log('  shannon status [options]\n');
  console.log(chalk.yellow.bold('OPTIONS:'));
  console.log('  --session, --id <id>    Monitor a specific session id (prefix allowed)');
  console.log('  --repo <path>           Monitor latest session for a repo path');
  console.log('  --latest                Monitor the most recent session');
  console.log('  --once                  Print a single snapshot and exit');
  console.log('  --follow                Follow updates (default for monitor)');
  console.log('  --json                  Emit JSON (single snapshot unless --follow)');
  console.log(`  --interval <ms>         Refresh interval (default: ${DEFAULT_INTERVAL_MS})`);
  console.log('  --no-clear              Do not clear the screen between updates');
  console.log('  --help                  Show this help message');
}

function showSessionsHelp(): void {
  console.log(chalk.cyan.bold('Shannon Sessions'));
  console.log(chalk.gray('List locally stored sessions.\n'));
  console.log(chalk.yellow.bold('USAGE:'));
  console.log('  shannon sessions [--json]');
}

function parseMonitorArgs(args: string[]): { options: MonitorOptions; showHelp: boolean } {
  let sessionId: string | undefined;
  let repoPath: string | undefined;
  let latest = false;
  let json = false;
  let follow = true;
  let clear = true;
  let intervalMs = DEFAULT_INTERVAL_MS;
  let showHelp = false;
  let followFlagSeen = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === '--session' || arg === '--id') {
      const value = args[i + 1];
      if (!value) {
        throw new Error('Missing value for --session');
      }
      sessionId = value;
      i++;
    } else if (arg === '--repo') {
      const value = args[i + 1];
      if (!value) {
        throw new Error('Missing value for --repo');
      }
      repoPath = value;
      i++;
    } else if (arg === '--latest') {
      latest = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--follow') {
      follow = true;
      followFlagSeen = true;
    } else if (arg === '--once') {
      follow = false;
    } else if (arg === '--interval') {
      const value = args[i + 1];
      if (!value) {
        throw new Error('Missing value for --interval');
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 250) {
        throw new Error('Interval must be a number of milliseconds >= 250');
      }
      intervalMs = parsed;
      i++;
    } else if (arg === '--no-clear') {
      clear = false;
    } else if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (!arg.startsWith('-') && !sessionId) {
      sessionId = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (json && !followFlagSeen) {
    follow = false;
  }
  if (json && follow) {
    clear = false;
  }

  return {
    options: { sessionId, repoPath, latest, json, follow, intervalMs, clear },
    showHelp,
  };
}

function formatStatus(status: Session['status']): string {
  if (status === 'completed') return chalk.green(status);
  if (status === 'failed') return chalk.red(status);
  return chalk.yellow(status);
}

function formatAgentStatus(status: AgentMetrics['status']): string {
  if (status === 'success') return chalk.green('OK');
  if (status === 'failed') return chalk.red('FAIL');
  return chalk.yellow('RUN');
}

function resolveTargetSession(sessions: Session[], options: MonitorOptions): Session | null {
  if (sessions.length === 0) return null;

  if (options.sessionId) {
    const matches = sessions.filter(
      (session) => session.id === options.sessionId || session.id.startsWith(options.sessionId!)
    );
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      const ids = matches.map((session) => session.id.substring(0, 8)).join(', ');
      throw new Error(`Multiple sessions match "${options.sessionId}": ${ids}`);
    }
    throw new Error(`No session found with id "${options.sessionId}"`);
  }

  if (options.repoPath) {
    const resolved = path.resolve(options.repoPath);
    const matches = sessions.filter(
      (session) => path.resolve(session.repoPath) === resolved
    );
    if (matches.length === 0) {
      throw new Error(`No sessions found for repo path "${resolved}"`);
    }
    matches.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return matches[0]!;
  }

  if (options.latest) {
    const sorted = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return sorted[0]!;
  }

  const inProgress = sessions.filter((session) => session.status === 'in-progress');
  if (inProgress.length > 0) {
    inProgress.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return inProgress[0]!;
  }

  const sorted = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return sorted[0]!;
}

async function readSessionJson(sessionJsonPath: string): Promise<SessionJson | null> {
  try {
    const raw = await fs.readFile(sessionJsonPath, 'utf8');
    return JSON.parse(raw) as SessionJson;
  } catch {
    return null;
  }
}

function renderSnapshot(
  sessionStoreEntry: Session,
  sessionJson: SessionJson | null,
  sessionJsonPath: string,
  lastUpdated?: Date,
  options?: MonitorOptions
): void {
  if (options?.clear) {
    process.stdout.write('\x1Bc');
  }

  console.log(chalk.cyan.bold('Shannon Monitor'));
  console.log(chalk.gray(`Session: ${sessionStoreEntry.id}`));
  console.log(chalk.gray(`Web URL: ${sessionStoreEntry.webUrl}`));
  console.log(chalk.gray(`Repo: ${sessionStoreEntry.repoPath}`));
  if (sessionStoreEntry.outputPath) {
    console.log(chalk.gray(`Output: ${sessionStoreEntry.outputPath}`));
  }
  if (lastUpdated) {
    console.log(chalk.gray(`Last update: ${lastUpdated.toISOString()}`));
  }
  console.log('');

  if (!sessionJson) {
    console.log(chalk.yellow('Metrics file not available yet.'));
    console.log(chalk.gray(`Waiting for: ${sessionJsonPath}`));
    return;
  }

  console.log(chalk.white(`Status: ${formatStatus(sessionJson.session.status)}`));
  console.log(chalk.white(`Started: ${sessionJson.session.createdAt}`));
  if (sessionJson.session.completedAt) {
    console.log(chalk.white(`Completed: ${sessionJson.session.completedAt}`));
  }

  console.log('');
  console.log(chalk.white('Totals:'));
  console.log(
    chalk.gray(
      `  Duration: ${formatDuration(sessionJson.metrics.total_duration_ms)} | Cost: $${sessionJson.metrics.total_cost_usd.toFixed(4)}`
    )
  );

  const phases = Object.entries(sessionJson.metrics.phases || {});
  if (phases.length > 0) {
    console.log('');
    console.log(chalk.white('Phases:'));
    for (const [phaseName, phase] of phases) {
      console.log(
        chalk.gray(
          `  ${phaseName.padEnd(24)} ${formatDuration(phase.duration_ms).padStart(8)} ` +
            `(${phase.duration_percentage.toFixed(1)}%)  $${phase.cost_usd.toFixed(4)}`
        )
      );
    }
  }

  const agents = Object.entries(sessionJson.metrics.agents || {});
  if (agents.length > 0) {
    console.log('');
    console.log(chalk.white('Agents:'));
    agents.sort(([a], [b]) => a.localeCompare(b));
    for (const [agentName, agent] of agents) {
      const attempts = agent.attempts.length + (agent.current_attempt ? 1 : 0);
      let duration = '';
      if (agent.status === 'success') {
        duration = formatDuration(agent.final_duration_ms);
      } else if (agent.current_attempt) {
        const startedAt = Date.parse(agent.current_attempt.started_at);
        if (!Number.isNaN(startedAt)) {
          duration = formatDuration(Date.now() - startedAt);
        }
      }
      const durationLabel = duration ? ` | ${duration}` : '';
      console.log(
        chalk.gray(
          `  [${formatAgentStatus(agent.status)}] ${agentName.padEnd(20)} ` +
            `attempts: ${String(attempts).padStart(2)}${durationLabel} ` +
            `cost: $${agent.total_cost_usd.toFixed(4)}`
        )
      );
    }
  } else {
    console.log('');
    console.log(chalk.gray('No agent metrics recorded yet.'));
  }
}

export async function runMonitor(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseMonitorArgs(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    showMonitorHelp();
    return;
  }

  if (parsed.showHelp) {
    showMonitorHelp();
    return;
  }

  const store = await loadSessionStore();
  if (store.sessions.length === 0) {
    console.log(chalk.yellow('No sessions found. Run a scan first.'));
    return;
  }

  let target: Session;
  try {
    const resolved = resolveTargetSession(store.sessions, parsed.options);
    if (!resolved) {
      console.log(chalk.yellow('No sessions found.'));
      return;
    }
    target = resolved;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    return;
  }

  const sessionJsonPath = generateSessionJsonPath({
    id: target.id,
    webUrl: target.webUrl,
    ...(target.outputPath && { outputPath: target.outputPath }),
  });

  if (parsed.options.json && !parsed.options.follow) {
    const data = await readSessionJson(sessionJsonPath);
    if (!data) {
      console.log(chalk.yellow('Metrics file not available yet.'));
      return;
    }
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const render = async (): Promise<void> => {
    const data = await readSessionJson(sessionJsonPath);
    let lastUpdated: Date | undefined;
    try {
      const stat = await fs.stat(sessionJsonPath);
      lastUpdated = new Date(stat.mtimeMs);
    } catch {
      lastUpdated = undefined;
    }

    if (parsed.options.json) {
      if (data) {
        console.log(JSON.stringify(data));
      }
      return;
    }

    renderSnapshot(target, data, sessionJsonPath, lastUpdated, parsed.options);
  };

  if (!parsed.options.follow) {
    await render();
    return;
  }

  let lastMtime = 0;
  const tick = async (): Promise<void> => {
    let stat;
    try {
      stat = await fs.stat(sessionJsonPath);
    } catch {
      stat = null;
    }

    if (!stat) {
      if (lastMtime !== -1) {
        lastMtime = -1;
        await render();
      }
      return;
    }

    if (stat.mtimeMs <= lastMtime) {
      return;
    }
    lastMtime = stat.mtimeMs;
    await render();
  };

  await render();
  const interval = setInterval(() => {
    void tick();
  }, parsed.options.intervalMs);

  process.on('SIGINT', () => {
    clearInterval(interval);
    process.stdout.write('\n');
    process.exit(0);
  });
}

export async function listSessionsCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    showSessionsHelp();
    return;
  }

  const asJson = args.includes('--json');
  const store = await loadSessionStore();

  if (asJson) {
    console.log(JSON.stringify(store, null, 2));
    return;
  }

  if (store.sessions.length === 0) {
    console.log(chalk.yellow('No sessions found.'));
    return;
  }

  const sessions = [...store.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  console.log(chalk.cyan.bold('Shannon Sessions'));
  console.log(chalk.gray(`Count: ${sessions.length}\n`));
  for (const session of sessions) {
    console.log(
      `${session.id.substring(0, 8)}  ${formatStatus(session.status)}  ` +
        `${session.webUrl}  ${session.repoPath}`
    );
  }
}
