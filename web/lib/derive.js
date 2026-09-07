/* Everything the views read that is not literally in the payload.

   Keeping these here means a view never recomputes "what is waiting on me"
   its own way, and the palette, the lede and the roster can never disagree
   about it. */

import { firstLine, until } from './format.js';

/** Everything currently sitting on the human, strongest intent first. */
export function pendingItems(s) {
  if (!s) return [];
  const out = [];
  for (const a of s.asks) {
    out.push({ kind: 'question', project: a.projectName, projectId: a.projectId,
      text: a.question, link: a.link, askId: a.id });
  }
  for (const p of s.projects) {
    for (const x of p.sessions.filter((v) => v.needsInput)) {
      // the assistant's last words are what it is waiting on you about
      const waiting = firstLine(x.lastAssistant?.text || x.title, 150) || x.title;
      out.push({ kind: 'session', project: p.name, projectId: p.id, text: waiting, link: x.link });
    }
  }
  for (const p of s.projects) {
    const r = p.runs?.[0];
    if (p.state === 'failed' && r) {
      out.push({ kind: 'failure', project: p.name, projectId: p.id,
        text: firstLine(r.error || 'run failed', 130), link: p.links.open });
    }
  }
  return out;
}

export const pendingFor = (s, id) => pendingItems(s).filter((x) => x.projectId === id);

/**
 * The middle column of a roster row: what this project is doing or waiting on.
 *
 * The old layout let the name column absorb every spare pixel, so a row was a
 * name, ~560px of nothing, then a state word. This fills that span with the
 * most specific true thing we know, in descending order of urgency.
 */
export function rowContext(p, s) {
  const mine = pendingFor(s, p.id);
  if (mine.length) {
    return { text: mine[0].text, cls: mine[0].kind === 'failure' ? 'err' : 'ask',
      pre: mine[0].kind === 'failure' ? 'error' : 'asks', count: mine.length };
  }
  const live = p.sessions?.find((x) => x.live);
  if (live) return { text: firstLine(live.title, 150) || 'session open', cls: '', pre: 'live' };

  const running = (p.runs || []).find((r) => r.state === 'running');
  if (running) return { text: running.taskTitle || 'headless run', cls: '', pre: 'running' };

  const next = (p.agenda || [])
    .filter((a) => a.nextAt)
    .sort((a, b) => a.nextAt - b.nextAt)[0];
  if (next) return { text: `${next.title} · ${next.human}`, cls: '', pre: 'next' };

  const last = (p.runs || [])[0];
  if (last?.summary) return { text: firstLine(last.summary, 150), cls: '', pre: 'last' };

  const recent = p.sessions?.[0];
  if (recent?.title) return { text: firstLine(recent.title, 150), cls: '', pre: 'last' };
  return { text: '—', cls: 'dim', pre: '' };
}

/**
 * Mark a failed run whose project has since had a successful one. The server
 * already applies this rule to the auth banner; the runs list did not, so
 * three settled failures sat in red under an all-clear headline.
 */
export function markSuperseded(runs) {
  const okSince = new Map();
  // runs arrive newest first, so walk backwards accumulating the latest success
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i];
    const at = r.endedAt || r.startedAt || 0;
    if (r.ok) okSince.set(r.projectId, at);
  }
  return runs.map((r) => ({
    ...r,
    superseded: !r.ok && (okSince.get(r.projectId) || 0) > (r.endedAt || r.startedAt || 0)
  }));
}

/** A one-sentence answer to "what needs me right now". */
export function headline(s) {
  const pending = pendingItems(s);
  if (!s.projects.length) return { text: 'No projects tracked yet', calm: true, count: 0 };
  if (!pending.length) {
    const running = s.projects.filter((p) => p.state === 'running').length + (s.activeRuns || 0);
    if (running) return { text: `Nothing needs you · ${running} running`, calm: true, count: 0 };
    const next = s.projects.map((p) => p.nextAt).filter(Boolean).sort((a, b) => a - b)[0];
    return { text: next ? `Nothing needs you · next run in ${until(next)}` : 'Nothing needs you',
      calm: true, count: 0 };
  }
  const projects = new Set(pending.map((x) => x.projectId)).size;
  return { text: `${projects === 1 ? '1 project needs' : `${projects} projects need`} you`,
    calm: false, count: projects };
}
