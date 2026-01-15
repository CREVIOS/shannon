// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import { randomUUID } from 'node:crypto';
import { fs, path } from 'zx';
import { PentestError } from './error-handling.js';

export interface Session {
  id: string;
  webUrl: string;
  repoPath: string;
  status: 'in-progress' | 'completed' | 'failed';
  startedAt: string;
  outputPath?: string;
}

export interface SessionStore {
  sessions: Session[];
}

const getStorePath = (): string => path.join(process.cwd(), '.shannon-store.json');

export async function loadSessionStore(): Promise<SessionStore> {
  try {
    const storePath = getStorePath();
    if (await fs.pathExists(storePath)) {
      return await fs.readJson(storePath) as SessionStore;
    }
  } catch {
    // Corrupted file, start fresh
  }
  return { sessions: [] };
}

async function saveSessionStore(store: SessionStore): Promise<void> {
  const storePath = getStorePath();
  await fs.writeJson(storePath, store, { spaces: 2 });
}

export async function createSession(
  webUrl: string,
  repoPath: string,
  outputPath?: string
): Promise<Session> {
  const store = await loadSessionStore();

  // Check for existing in-progress session
  const existing = store.sessions.find(
    (session) => session.repoPath === repoPath && session.status === 'in-progress'
  );
  if (existing) {
    throw new PentestError(
      `Session already in progress for ${repoPath}`,
      'validation',
      false,
      { sessionId: existing.id }
    );
  }

  const session: Session = {
    id: randomUUID(),
    webUrl,
    repoPath,
    status: 'in-progress',
    startedAt: new Date().toISOString(),
    ...(outputPath && { outputPath }),
  };

  store.sessions.push(session);
  await saveSessionStore(store);
  return session;
}

export async function updateSessionStatus(
  sessionId: string,
  status: Session['status']
): Promise<void> {
  const store = await loadSessionStore();
  const session = store.sessions.find((item) => item.id === sessionId);
  if (session) {
    session.status = status;
    await saveSessionStore(store);
  }
}

export async function listSessions(): Promise<Session[]> {
  const store = await loadSessionStore();
  return store.sessions;
}
