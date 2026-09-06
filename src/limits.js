/**
 * Harness limits, for quick lookup.
 *
 * Vendors publish context and output windows but mostly do NOT publish the token
 * counts behind subscription rate limits, so those rows are community estimates.
 * Every row carries `confidence` — trust `official` rows, treat `estimate` rows
 * as a rough sense of scale. `asOf` is when the row was last checked.
 */

export const LIMITS_AS_OF = '2026-09';

const row = (o) => ({ confidence: 'official', asOf: LIMITS_AS_OF, ...o });

export const LIMITS = [
  // ---------------------------------------------------------------- Claude Code
  row({ harness: 'claude-code', group: 'Context', key: 'Context window',
    value: '1M tokens', detail: 'Fable 5, Opus 5, Sonnet 5', tags: 'context window tokens 1m million' }),
  row({ harness: 'claude-code', group: 'Context', key: 'Context window',
    value: '200K tokens', detail: 'Haiku 4.5', tags: 'context window haiku 200k' }),
  row({ harness: 'claude-code', group: 'Context', key: 'Max output',
    value: '128K tokens', detail: 'Fable 5, Opus 5, Sonnet 5', tags: 'output response max tokens' }),
  row({ harness: 'claude-code', group: 'Context', key: 'Max output',
    value: '64K tokens', detail: 'Haiku 4.5', tags: 'output response haiku' }),
  row({ harness: 'claude-code', group: 'Windows', key: 'Rate limit shape',
    value: '5-hour rolling + weekly cap', detail: 'Both must be under to keep working',
    tags: 'rate limit session weekly window reset rolling' }),
  row({ harness: 'claude-code', group: 'Windows', key: 'Shared pool',
    value: 'Code + claude.ai + Cowork', detail: 'Spend in one reduces the others',
    tags: 'shared pool quota bucket cowork chat' }),
  row({ harness: 'claude-code', group: 'Windows', key: 'May 2026 change',
    value: '5-hour limits doubled', detail: 'Pro, Max, Team, seat-based Enterprise. Weekly caps unchanged.',
    tags: 'change increase doubled 2026 update' }),
  row({ harness: 'claude-code', group: 'Plans', key: 'Pro', value: '~10–45 prompts / 5h',
    detail: 'Anthropic publishes no token figure for plan limits', confidence: 'estimate',
    tags: 'pro plan prompts messages quota subscription' }),
  row({ harness: 'claude-code', group: 'Plans', key: 'Max 5×', value: '~50–225 prompts / 5h',
    detail: 'Scales roughly 5× Pro', confidence: 'estimate', tags: 'max 5x plan prompts quota' }),
  row({ harness: 'claude-code', group: 'Plans', key: 'Max 20×', value: 'up to ~900 prompts / 5h',
    detail: 'Community-reported ceiling', confidence: 'estimate', tags: 'max 20x plan prompts quota' }),

  // ---------------------------------------------------------------- Codex
  row({ harness: 'codex', group: 'Plans', key: 'Free', value: '~10 tasks / day',
    detail: 'Resets on a 24h cycle', confidence: 'estimate', tags: 'free tier tasks daily codex' }),
  row({ harness: 'codex', group: 'Plans', key: 'GPT-5.6 Sol', value: '10–100 msgs / 5h',
    detail: 'Local messages; cloud chats and reviews metered separately', confidence: 'estimate',
    tags: 'sol local messages window codex' }),
  row({ harness: 'codex', group: 'Plans', key: 'Terra', value: '25–200 msgs / 5h',
    confidence: 'estimate', tags: 'terra messages window codex' }),
  row({ harness: 'codex', group: 'Plans', key: 'Luna', value: '250–2,000 msgs / 5h',
    confidence: 'estimate', tags: 'luna messages window codex' }),
  row({ harness: 'codex', group: 'Plans', key: 'Pro', value: 'effectively uncapped',
    detail: 'Reported price points vary between sources — check OpenAI before relying on it',
    confidence: 'unverified', tags: 'pro uncapped unlimited price codex' }),
  row({ harness: 'codex', group: 'Behaviour', key: 'Write gating', value: 'sandbox modes',
    detail: '--sandbox read-only | workspace-write, rather than per-tool permissions',
    tags: 'sandbox permissions write read-only workspace' }),

  // ---------------------------------------------------------------- Gemini
  row({ harness: 'gemini', group: 'Plans', key: 'Free tier', value: '1,000 requests / day',
    detail: 'Gemini 2.5 Pro / Flash routing, no expiry', tags: 'free tier requests daily gemini generous' }),
  row({ harness: 'gemini', group: 'Behaviour', key: 'Write gating', value: '--yolo bypasses prompts',
    detail: 'No granular per-tool permission model', tags: 'yolo permissions approval auto' }),

  // ---------------------------------------------------------------- OpenCode
  row({ harness: 'opencode', group: 'Plans', key: 'Depends on provider',
    value: 'BYO key or subscription', detail: 'Limits are whatever the routed provider enforces',
    confidence: 'official', tags: 'byok provider model routing opencode limits' })
];

export const SOURCES = [
  { label: 'Claude Code limits explained', url: 'https://www.truefoundry.com/blog/claude-code-limits-explained' },
  { label: 'Claude Code usage limits', url: 'https://www.morphllm.com/claude-code-usage-limits' },
  { label: 'Codex pricing & limits', url: 'https://www.morphllm.com/codex-pricing' },
  { label: 'Codex subscription options', url: 'https://inventivehq.com/blog/codex-subscription-options-guide' },
  { label: 'Free AI CLI tools ranked', url: 'https://www.termdock.com/en/blog/free-ai-cli-tools-ranked' }
];

/** Substring search across every field, for the ⌘K palette and the limits panel. */
export function searchLimits(q) {
  const s = String(q || '').toLowerCase().trim();
  if (!s) return LIMITS;
  return LIMITS.filter((r) =>
    `${r.harness} ${r.group} ${r.key} ${r.value} ${r.detail || ''} ${r.tags || ''}`.toLowerCase().includes(s)
  );
}
