import fs from 'node:fs';
import path from 'node:path';
import { HOME } from './config.js';

/**
 * Plan usage, straight from the desktop app's own record.
 *
 * The app polls its usage endpoint every ~15 minutes and appends a sample to
 * plan-usage-history.json. Those are the same percentages /usage shows. We only
 * read the file — nothing here calls an API or touches a credential.
 *
 * Each sample is { t: epoch_ms, org, u: { <constraint>: percent } }.
 */
const HISTORY = path.join(HOME, 'Library', 'Application Support', 'Claude', 'plan-usage-history.json');

// Known constraints. Anything new the app starts reporting still shows up,
// using the fallback label, so a future limit appears without a code change.
const LABELS = {
  fh: { label: '5-hour', order: 0, hint: 'Rolling 5-hour window' },
  sd: { label: 'Weekly · all models', order: 1, hint: 'Seven-day window across every model' },
  sdo: { label: 'Weekly · Opus', order: 2, hint: 'Seven-day window, Opus only' },
  sdf: { label: 'Weekly · Fable', order: 3, hint: 'Seven-day window, Fable only' }
};
const labelFor = (k) => LABELS[k] || { label: k.toUpperCase(), order: 9, hint: 'Reported by Claude Code' };

const SPARK_POINTS = 48;

export function readUsage() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(HISTORY, 'utf8')); }
  catch { return { available: false, reason: 'no local usage history yet', constraints: [] }; }

  const samples = (raw.samples || [])
    .filter((s) => s && s.t && s.u)
    .sort((a, b) => a.t - b.t);
  if (!samples.length) return { available: false, reason: 'usage history is empty', constraints: [] };

  const latest = samples[samples.length - 1];
  const keys = [...new Set(samples.flatMap((s) => Object.keys(s.u)))];

  const constraints = keys.map((k) => {
    const meta = labelFor(k);
    const series = samples.map((s) => ({ t: s.t, v: s.u[k] })).filter((p) => typeof p.v === 'number');
    const now = latest.u[k] ?? 0;
    const peak = series.reduce((m, p) => Math.max(m, p.v), 0);

    // The most recent point where the number fell — that is the window rolling
    // over. Shown as an observation, not a predicted schedule.
    let lastReset = null;
    for (let i = 1; i < series.length; i++) {
      if (series[i].v < series[i - 1].v) lastReset = series[i].t;
    }

    // even-ish downsample for the sparkline
    const step = Math.max(1, Math.ceil(series.length / SPARK_POINTS));
    const spark = series.filter((_, i) => i % step === 0 || i === series.length - 1).map((p) => p.v);

    return { key: k, label: meta.label, hint: meta.hint, order: meta.order, percent: now, peak, lastReset, spark };
  }).sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

  return {
    available: true,
    sampledAt: latest.t,
    stale: Date.now() - latest.t > 45 * 60 * 1000,
    windowStart: samples[0].t,
    sampleCount: samples.length,
    constraints
  };
}
