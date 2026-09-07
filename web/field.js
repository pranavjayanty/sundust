/* Full-viewport background field: fine streamlines that bend around the pointer
   like light through a lens. One colour, no fill, very low opacity — texture the
   content floats on, never something that competes with it.

   The bend is a smooth falloff toward the cursor rather than a hard displacement,
   so lines curve instead of kinking. */

const LINES = 38;
const STEP = 16;          // px between samples along a line
const RADIUS = 380;       // influence radius of the pointer
const PULL = 40;          // px of maximum displacement
const EASE = 0.085;       // pointer follow, so motion feels weighted

export function startField(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  let w = 0, h = 0, dpr = 1;
  let rows = [];

  // target and eased pointer; start off-screen so the field rests flat
  let tx = -9999, ty = -9999, px = -9999, py = -9999, present = 0, targetPresent = 0;
  let raf = 0, running = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* The stroke colour used to be read from computed style on every frame, for
     every frame of the page's life. It only changes when the theme does. */
  let inkCache = 'rgba(255,255,255,.07)';
  const readInk = () => {
    inkCache = getComputedStyle(document.documentElement)
      .getPropertyValue('--field-ink').trim() || inkCache;
  };
  readInk();
  new MutationObserver(() => { readInk(); wake(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { readInk(); wake(); });

  function build() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = r.width; h = r.height;
    canvas.width = Math.max(1, w * dpr);
    canvas.height = Math.max(1, h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    rows = [];
    const gap = h / (LINES - 1);
    for (let i = 0; i < LINES; i++) {
      const base = i * gap;
      const pts = [];
      for (let x = -STEP; x <= w + STEP; x += STEP) {
        // a slow standing wave keeps the resting state from looking ruled
        pts.push({ x, y: base + Math.sin(x * 0.004 + i * 0.55) * gap * 0.28 });
      }
      rows.push({ pts, i });
    }
  }

  function frame() {
    px += (tx - px) * EASE;
    py += (ty - py) * EASE;
    present += (targetPresent - present) * EASE;

    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = inkCache;
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const r2 = RADIUS * RADIUS;
    for (const row of rows) {
      ctx.beginPath();
      for (let n = 0; n < row.pts.length; n++) {
        const p = row.pts[n];
        let x = p.x, y = p.y;

        if (present > 0.01) {
          const dx = px - x, dy = py - y;
          const d2 = dx * dx + dy * dy;
          // inverse-square falloff, clamped near the centre so it bends not snaps
          const f = (PULL * present) / (1 + d2 / r2);
          const d = Math.sqrt(d2) || 1;
          x += (dx / d) * f;
          y += (dy / d) * f;
        }

        if (n === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // once the field has settled flat and the pointer has left, there is
    // nothing left to animate — stop until something wakes it
    const settled = present < 0.005 && Math.abs(tx - px) < 0.5 && Math.abs(ty - py) < 0.5;
    if (settled && targetPresent === 0) { running = false; return; }
    raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (running) return;
    // hidden or reduced-motion still gets the resting field; only the loop stops
    if (reduced || document.hidden) return drawStill();
    running = true;
    raf = requestAnimationFrame(frame);
  }

  let seen = false;
  const move = (x, y) => {
    if (!reduced) wake();
    tx = x; ty = y; targetPresent = 1;
    // first contact snaps: easing in from off-screen would drag the well
    // across the whole page before it settled under the cursor
    if (!seen) { seen = true; px = x; py = y; }
  };
  // pointer events cover mouse, pen and touch; mousemove is the fallback for
  // environments that only synthesise the legacy event
  addEventListener('pointermove', (e) => move(e.clientX, e.clientY), { passive: true });
  addEventListener('pointerdown', (e) => move(e.clientX, e.clientY), { passive: true });
  addEventListener('mousemove', (e) => move(e.clientX, e.clientY), { passive: true });
  addEventListener('pointerleave', () => { targetPresent = 0; });
  addEventListener('blur', () => { targetPresent = 0; });
  addEventListener('resize', () => { build(); wake(); });
  // nothing should animate behind a tab nobody is looking at
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); running = false; } else wake();
  });

  build();
  wake();

  /** One flat pass, for reduced-motion. */
  function drawStill() {
    present = 0; targetPresent = 0;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = inkCache; ctx.lineWidth = 1;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const row of rows) {
      ctx.beginPath();
      row.pts.forEach((p, n) => (n === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
  }

  return { rebuild: () => { build(); wake(); } };
}
