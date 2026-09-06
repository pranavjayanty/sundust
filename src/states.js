/**
 * A project is in exactly one state, ordered by how much it wants from you.
 * The console sorts, groups and colours by this and nothing else.
 */
export const STATES = {
  attention: { id: 'attention', label: 'Needs you', order: 0, tone: 'attention',
    detail: 'A run stopped on a question, or a live session is waiting at the prompt.' },
  failed: { id: 'failed', label: 'Failed', order: 1, tone: 'failed',
    detail: 'The last unattended run ended in an error.' },
  running: { id: 'running', label: 'Running', order: 2, tone: 'running',
    detail: 'A live session or a headless run is working right now.' },
  scheduled: { id: 'scheduled', label: 'Scheduled', order: 3, tone: 'idle',
    detail: 'Nothing running, but agenda tasks will fire on their own.' },
  idle: { id: 'idle', label: 'Idle', order: 4, tone: 'idle',
    detail: 'Nothing running and nothing scheduled.' }
};

export function stateOf({ status, hasSchedule }) {
  if (status === 'blocked' || status === 'waiting') return STATES.attention;
  if (status === 'failed') return STATES.failed;
  if (status === 'working') return STATES.running;
  return hasSchedule ? STATES.scheduled : STATES.idle;
}

export const stateList = () => Object.values(STATES).sort((a, b) => a.order - b.order);
