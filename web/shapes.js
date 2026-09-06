/* Generative SVG in the Book of Shapes idiom: many fine strokes, one colour,
   no fill. Used at low opacity as texture, never as decoration that competes
   with the data. All procedural — no assets, no dependency. */

const NS = 'http://www.w3.org/2000/svg';
const mk = (t, a = {}) => { const n = document.createElementNS(NS, t); for (const k in a) n.setAttribute(k, a[k]); return n; };

// cheap deterministic value noise — enough to give the field a drifting grain
function noise(x, y, seed = 0) {
  return (
    Math.sin(x * 0.021 + seed) * 0.5 +
    Math.sin(y * 0.017 - seed * 1.7) * 0.3 +
    Math.sin((x + y) * 0.009 + seed * 0.6) * 0.2
  );
}

/**
 * Streamlines traced through a noise field. Reads as contour or wind-map lines.
 * `sweep` biases flow to the right so it feels directional rather than swirly.
 */
export function flowField(w, h, { lines = 26, step = 6, len = 92, seed = 1, sweep = 0.55 } = {}) {
  const svg = mk('svg', {
    viewBox: `0 0 ${w} ${h}`, width: '100%', height: '100%',
    preserveAspectRatio: 'none', 'aria-hidden': 'true',
    style: 'display:block'
  });
  const g = mk('g', { fill: 'none', stroke: 'currentColor', 'stroke-width': '1', 'stroke-linecap': 'round' });

  for (let i = 0; i < lines; i++) {
    let x = -20;
    let y = (h / (lines - 1)) * i;
    const pts = [];
    for (let s = 0; s < len; s++) {
      const a = noise(x, y, seed + i * 0.05) * 0.9 + sweep;
      x += Math.cos(a) * step + step * 0.55;
      y += Math.sin(a) * step * 0.62;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      if (x > w + 30) break;
    }
    g.append(mk('polyline', {
      points: pts.join(' '),
      opacity: (0.32 + 0.5 * Math.sin(i * 0.7)).toFixed(2)
    }));
  }
  svg.append(g);
  return svg;
}

/** Dot grid whose radius falls off from one corner. Quiet fill for a calm panel. */
export function dotMatrix(w, h, { gap = 13, r = 1.25, seed = 3 } = {}) {
  const svg = mk('svg', {
    viewBox: `0 0 ${w} ${h}`, width: '100%', height: '100%',
    preserveAspectRatio: 'none', 'aria-hidden': 'true', style: 'display:block'
  });
  const g = mk('g', { fill: 'currentColor' });
  for (let y = gap / 2; y < h; y += gap) {
    for (let x = gap / 2; x < w; x += gap) {
      const n = (noise(x, y, seed) + 1) / 2;
      const rr = r * (0.35 + n * 0.95);
      if (rr < 0.4) continue;
      g.append(mk('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: rr.toFixed(2), opacity: (0.3 + n * 0.6).toFixed(2) }));
    }
  }
  svg.append(g);
  return svg;
}

/** Concentric rings pushed off-centre — a still, calm mark for the clear state. */
export function rings(w, h, { count = 16, seed = 2 } = {}) {
  const svg = mk('svg', {
    viewBox: `0 0 ${w} ${h}`, width: '100%', height: '100%',
    preserveAspectRatio: 'none', 'aria-hidden': 'true', style: 'display:block'
  });
  const g = mk('g', { fill: 'none', stroke: 'currentColor', 'stroke-width': '1' });
  const cx = w * 0.82, cy = h * 0.5;
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    g.append(mk('ellipse', {
      cx: (cx + Math.sin(i * 0.6 + seed) * 9).toFixed(1),
      cy: (cy + Math.cos(i * 0.4 + seed) * 5).toFixed(1),
      rx: (t * w * 0.42).toFixed(1),
      ry: (t * h * 0.72).toFixed(1),
      opacity: (0.5 - t * 0.34).toFixed(2)
    }));
  }
  svg.append(g);
  return svg;
}

/** Drop a generated field into a host element as a background layer. */
export function paint(host, kind, w = 900, h = 200, opts) {
  host.innerHTML = '';
  const svg = kind === 'dots' ? dotMatrix(w, h, opts)
    : kind === 'rings' ? rings(w, h, opts)
    : flowField(w, h, opts);
  host.append(svg);
  return svg;
}
