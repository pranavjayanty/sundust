// Deep links understood by the Claude desktop app.
//   claude://code/new?folder=<abs path>&prompt=<text>[&file=<abs path>]
//   claude://code/continue?session=local_<uuid> | last
//   claude://code/needs-input[?session=local_<uuid>]
// The desktop app truncates the prompt at 14336 characters.

export const PROMPT_LIMIT = 14336;

const q = (s) => encodeURIComponent(String(s));

export function newSession({ folder, prompt, files = [] } = {}) {
  const parts = [];
  if (prompt) parts.push(`prompt=${q(String(prompt).slice(0, PROMPT_LIMIT))}`);
  if (folder) parts.push(`folder=${q(folder)}`);
  for (const f of files) parts.push(`file=${q(f)}`);
  parts.push('source=orrery');
  return `claude://code/new?${parts.join('&')}`;
}

// Session ids on disk are bare uuids; the desktop app expects a `local_` prefix.
export function sessionRef(id) {
  if (!id) return 'last';
  return String(id).startsWith('local_') ? String(id) : `local_${id}`;
}

export function continueSession(id) {
  return `claude://code/continue?session=${q(sessionRef(id))}&source=orrery`;
}

export function needsInput(id) {
  const s = id ? `session=${q(sessionRef(id))}&` : '';
  return `claude://code/needs-input?${s}source=orrery`;
}
