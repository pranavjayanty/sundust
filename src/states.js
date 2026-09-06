/**
 * A project is in exactly one state, ordered by how much it wants from you.
 *
 * A failed run is folded into "Blocked" rather than given its own state: a run
 * that errored is, in practice, another thing waiting on a human. Keeping it
 * separate split the one number that matters into two.
 */
export const STATES = {
  blocked: { id: 'blocked', label: 'Blocked', order: 0, tone: 'blocked',
    detail: 'Waiting on a decision from you — an open question, a session sitting at the prompt, or a run that errored.' },
  running: { id: 'running', label: 'Running', order: 1, tone: 'running',
    detail: 'A live session or a headless run is working right now.' },
  scheduled: { id: 'scheduled', label: 'Scheduled', order: 2, tone: 'idle',
    detail: 'Nothing running, but agenda tasks will fire on their own.' },
  idle: { id: 'idle', label: 'Idle', order: 3, tone: 'idle',
    detail: 'Nothing running and nothing scheduled.' },
  archived: { id: 'archived', label: 'Archived', order: 4, tone: 'archived',
    detail: 'Shelved. Nothing runs here and it stays out of the counts.' }
};

export function stateOf({ status, hasSchedule, archived }) {
  if (archived) return STATES.archived;
  if (status === 'blocked' || status === 'waiting' || status === 'failed') return STATES.blocked;
  if (status === 'working') return STATES.running;
  return hasSchedule ? STATES.scheduled : STATES.idle;
}

export const stateList = () => Object.values(STATES).sort((a, b) => a.order - b.order);
