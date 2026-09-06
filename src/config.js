import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const HOME = os.homedir();
export const CLAUDE_DIR = path.join(HOME, '.claude');
export const CLAUDE_PROJECTS = path.join(CLAUDE_DIR, 'projects');
export const CLAUDE_SESSIONS = path.join(CLAUDE_DIR, 'sessions');

export const SUNDUST_DIR = process.env.SUNDUST_HOME || path.join(HOME, '.sundust');
export const REGISTRY = path.join(SUNDUST_DIR, 'projects.json');
export const INDEX_CACHE = path.join(SUNDUST_DIR, 'index.json');
export const RUNS_DIR = path.join(SUNDUST_DIR, 'runs');
export const ASKS = path.join(SUNDUST_DIR, 'asks.json');
export const SETTINGS = path.join(SUNDUST_DIR, 'settings.json');

export const DEFAULT_SETTINGS = {
  port: 4173,
  // Where `sundust new` creates project folders.
  workspaceRoot: path.join(HOME, 'Documents', 'code'),
  // Override a harness binary path here, keyed by harness id, when it is not on PATH.
  // e.g. { "claude-code": "/opt/homebrew/bin/claude" }
  bins: {},
  // Daemon refuses to auto-run in a project that has a live interactive session.
  respectLiveSessions: true,
  // Global kill switch for all autonomous runs.
  autonomyEnabled: true,
  // Max concurrent headless runs.
  maxConcurrentRuns: 2,
  // Per-run wall clock cap.
  runTimeoutMs: 20 * 60 * 1000
};

export function ensureDirs() {
  for (const d of [SUNDUST_DIR, RUNS_DIR]) fs.mkdirSync(d, { recursive: true });
}

export function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJSON(SETTINGS, {}) };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJSON(SETTINGS, next);
  return next;
}
