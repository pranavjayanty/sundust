import { getHarness, DEFAULT_HARNESS } from './harnesses.js';

/**
 * Links that put a session one click away. Only harnesses that register a URL
 * scheme can do this; the rest return null and the UI falls back to revealing
 * the folder. Claude Code's desktop app registers claude://.
 */
export const linksFor = (harnessId = DEFAULT_HARNESS) => {
  const h = getHarness(harnessId);
  const d = h.deeplink;
  return {
    harness: h.id,
    canDeepLink: Boolean(d),
    open: (folder, prompt) => (d ? d.open(folder, prompt) : `file://${folder}`),
    resume: (id) => (d ? d.resume(id) : null),
    attention: () => (d?.attention ? d.attention() : null)
  };
};

// Kept for the CLI, which is Claude Code only today.
const claude = linksFor('claude-code');
export const newSession = ({ folder, prompt } = {}) => claude.open(folder, prompt);
export const continueSession = (id) => claude.resume(id);
export const needsInput = () => claude.attention();
