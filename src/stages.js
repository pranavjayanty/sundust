/**
 * Every project is a star, and its stage is its state.
 *
 * The metaphor does real work: a star's colour is its temperature, and here
 * temperature is recency. Fresh work burns white-gold; as a project cools it
 * reddens and swells, and long-dormant projects end as dim ash. A project that
 * needs you flares — the one event on a star's surface you cannot miss.
 */

export const STAGES = {
  flare: {
    id: 'flare', label: 'Flare', order: 0,
    blurb: 'Waiting on you',
    detail: 'A run stopped on a question, or a live session is sitting at the prompt.',
    colour: '#FFD24A', glow: 1, needsHuman: true
  },
  supernova: {
    id: 'supernova', label: 'Supernova', order: 1,
    blurb: 'Last run failed',
    detail: 'The most recent unattended run ended badly. Worth a look.',
    colour: '#FF5136', glow: .8, needsHuman: true
  },
  'main-sequence': {
    id: 'main-sequence', label: 'Main sequence', order: 2,
    blurb: 'Burning steadily',
    detail: 'Live session or a run in flight. Nothing needed from you.',
    colour: '#FFB627', glow: .7, needsHuman: false
  },
  protostar: {
    id: 'protostar', label: 'Protostar', order: 3,
    blurb: 'Not yet ignited',
    detail: 'Registered, but nothing has run here yet.',
    colour: '#FF9351', glow: .45, needsHuman: false
  },
  'red-giant': {
    id: 'red-giant', label: 'Red giant', order: 4,
    blurb: 'Cooling',
    detail: 'Plenty of history, but quiet for a while now.',
    colour: '#FF6B3D', glow: .3, needsHuman: false
  },
  'white-dwarf': {
    id: 'white-dwarf', label: 'White dwarf', order: 5,
    blurb: 'Dormant',
    detail: 'Untouched for over a month. Still here when you want it.',
    colour: '#9A7768', glow: .15, needsHuman: false
  }
};

const DAY = 86400000;

/** Map a project's computed status and history onto a stellar stage. */
export function stageOf({ status, lastActivity, sessionCount = 0, runCount = 0 }) {
  if (status === 'blocked' || status === 'waiting') return STAGES.flare;
  if (status === 'failed') return STAGES.supernova;
  if (status === 'working') return STAGES['main-sequence'];
  if (sessionCount === 0 && runCount === 0) return STAGES.protostar;

  const age = Date.now() - (lastActivity || 0);
  if (age > 30 * DAY) return STAGES['white-dwarf'];
  if (age > 2 * DAY) return STAGES['red-giant'];
  return STAGES['main-sequence'];
}

export const stageList = () => Object.values(STAGES).sort((a, b) => a.order - b.order);
