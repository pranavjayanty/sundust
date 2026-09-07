import path from 'node:path';
import { HOME } from './config.js';

/**
 * A harness is a coding agent CLI Sundust can watch and drive.
 *
 * Claude Code is fully wired: transcripts are parsed, sessions are matched to
 * projects, deep links open them, and headless runs are spawned. The others
 * carry enough plumbing to launch and to record runs — transcript parsing and
 * deep links are stubs, and each says so in `support`.
 */

const q = (s) => encodeURIComponent(String(s));

export const HARNESSES = {
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    vendor: 'Anthropic',
    bin: 'claude',
    support: 'full',
    // Transcript store Sundust indexes.
    transcripts: { dir: path.join(HOME, '.claude', 'projects'), format: 'claude-jsonl' },
    liveSessions: { dir: path.join(HOME, '.claude', 'sessions'), format: 'pid-json' },
    /** Headless invocation. `autonomy` is Sundust's per-project permission level. */
    headlessArgs({ prompt, sessionId, autonomy, model }) {
      const args = ['-p', prompt, '--output-format', 'json'];
      if (sessionId) args.push('--session-id', sessionId);
      if (model) args.push('--model', model);
      if (autonomy === 'edit') args.push('--permission-mode', 'acceptEdits');
      else args.push('--permission-mode', 'dontAsk', '--disallowedTools', 'Write', 'Edit', 'NotebookEdit', 'Bash');
      return args;
    },
    /** Parse the JSON a headless run prints. */
    parseResult(stdout) {
      try {
        const j = JSON.parse(stdout);
        return {
          text: j.result ?? '',
          ok: j.is_error !== true,
          costUsd: j.total_cost_usd ?? null,
          turns: j.num_turns ?? null,
          tokens: j.usage ? {
            in: j.usage.input_tokens || 0, out: j.usage.output_tokens || 0,
            cacheRead: j.usage.cache_read_input_tokens || 0,
            cacheCreate: j.usage.cache_creation_input_tokens || 0
          } : null,
          denials: j.permission_denials?.length || 0
        };
      } catch { return null; }
    },
    /**
     * Is the CLI signed in? The desktop app and the CLI authenticate separately,
     * so the app working tells you nothing about whether headless runs will.
     * Returns null when the answer cannot be determined.
     */
    authProbe: { args: ['auth', 'status'], parse(stdout) {
      try {
        const j = JSON.parse(stdout);
        return { ok: j.loggedIn === true, method: j.authMethod || 'none' };
      } catch { return null; }
    } },
    // The desktop app registers claude:// — this is what makes a session one click away.
    deeplink: {
      open: (folder, prompt) =>
        `claude://code/new?${prompt ? `prompt=${q(String(prompt).slice(0, 14336))}&` : ''}folder=${q(folder)}&source=sundust`,
      resume: (id) => `claude://code/continue?session=${q(String(id).startsWith('local_') ? id : `local_${id}`)}&source=sundust`,
      attention: () => 'claude://code/needs-input?source=sundust'
    }
  },

  codex: {
    id: 'codex',
    label: 'Codex CLI',
    vendor: 'OpenAI',
    bin: 'codex',
    support: 'launch-only',
    transcripts: { dir: path.join(HOME, '.codex', 'sessions'), format: 'unknown' },
    liveSessions: null,
    headlessArgs({ prompt, autonomy, model }) {
      const args = ['exec', prompt];
      if (model) args.push('--model', model);
      // Codex gates writes behind sandbox modes rather than tool permissions.
      args.push('--sandbox', autonomy === 'edit' ? 'workspace-write' : 'read-only');
      return args;
    },
    parseResult: (stdout) => ({ text: stdout.trim(), ok: true, costUsd: null, turns: null, tokens: null, denials: 0 }),
    deeplink: null
  },

  gemini: {
    id: 'gemini',
    label: 'Gemini CLI',
    vendor: 'Google',
    bin: 'gemini',
    support: 'launch-only',
    transcripts: { dir: path.join(HOME, '.gemini', 'tmp'), format: 'unknown' },
    liveSessions: null,
    headlessArgs({ prompt, autonomy, model }) {
      const args = ['-p', prompt];
      if (model) args.push('-m', model);
      if (autonomy === 'edit') args.push('--yolo');
      return args;
    },
    parseResult: (stdout) => ({ text: stdout.trim(), ok: true, costUsd: null, turns: null, tokens: null, denials: 0 }),
    deeplink: null
  },

  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    vendor: 'SST',
    bin: 'opencode',
    support: 'launch-only',
    transcripts: { dir: path.join(HOME, '.local', 'share', 'opencode', 'storage'), format: 'unknown' },
    liveSessions: null,
    headlessArgs({ prompt, model }) {
      const args = ['run', prompt];
      if (model) args.push('--model', model);
      return args;
    },
    parseResult: (stdout) => ({ text: stdout.trim(), ok: true, costUsd: null, turns: null, tokens: null, denials: 0 }),
    deeplink: null
  }
};

export const DEFAULT_HARNESS = 'claude-code';
export const getHarness = (id) => HARNESSES[id] || HARNESSES[DEFAULT_HARNESS];
export const harnessList = () =>
  Object.values(HARNESSES).map(({ id, label, vendor, bin, support }) => ({ id, label, vendor, bin, support }));
