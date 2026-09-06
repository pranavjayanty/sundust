/* Small generative marks that answer the same pointer gravity as the background
   field, so the whole page feels like one surface. Book of Shapes idiom: many
   fine elements, one colour, no fill.

   One shared pointer listener drives every mark. Marks outside the viewport are
   skipped, and each redraws only while the pointer is near enough to matter. */

const pointer = { x: -9999, y: -9999, on: 0 };
addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.on = 1; }, { passive: true });
addEventListener('pointerleave', () => { pointer.on = 0; }, { passive: true });

const marks = [];
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

function ink() {
  return getComputedStyle(document.documentElement).getPropertyValue('--mark-ink').trim() || 'rgba(255,255,255,.4)';
}

function tick() {
  const colour = ink();
  for (const m of marks) {
    const r = m.canvas.getBoundingClientRect();
    if (r.bottom < -60 || r.top > innerHeight + 60 || !r.width) continue;
    m.draw(r, colour);
  }
  requestAnimationFrame(tick);
}

function setup(canvas) {
  const ctx = canvas.getContext('2d');
  let dpr = 1, w = 0, h = 0;
  const fit = (r) => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    if (Math.round(r.width) === w && Math.round(r.height) === h) return;
    w = Math.round(r.width); h = Math.round(r.height);
    canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  return { ctx, fit, size: () => ({ w, h }) };
}

/** Local pointer position and strength for a mark, given its screen rect. */
function local(r, radius) {
  const lx = pointer.x - r.left, ly = pointer.y - r.top;
  const near = pointer.on && pointer.x > r.left - radius && pointer.x < r.right + radius
    && pointer.y > r.top - radius && pointer.y < r.bottom + radius;
  return { lx, ly, near };
}

/** Dot lattice; dots slide toward the pointer and swell slightly as they go. */
export function attachDots(canvas, { gap = 11, radius = 130, pull = 9 } = {}) {
  const { ctx, fit, size } = setup(canvas);
  let ease = 0;
  const m = {
    canvas,
    draw(r, colour) {
      fit(r);
      const { w, h } = size();
      const { lx, ly, near } = local(r, radius);
      ease += ((near && !REDUCED ? 1 : 0) - ease) * 0.12;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = colour;
      const r2 = radius * radius;
      for (let y = gap / 2; y < h; y += gap) {
        for (let x = gap / 2; x < w; x += gap) {
          let px = x, py = y, rr = 1;
          if (ease > 0.01) {
            const dx = lx - x, dy = ly - y, d2 = dx * dx + dy * dy;
            const f = (pull * ease) / (1 + d2 / r2);
            const d = Math.sqrt(d2) || 1;
            px += (dx / d) * f; py += (dy / d) * f;
            rr = 1 + (f / pull) * 0.9;
          }
          ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  };
  marks.push(m);
  return m;
}

/** Concentric rings that lean toward the pointer — each ring lags the one inside it. */
export function attachRings(canvas, { count = 13, radius = 170, pull = 16 } = {}) {
  const { ctx, fit, size } = setup(canvas);
  let ease = 0;
  const m = {
    canvas,
    draw(r, colour) {
      fit(r);
      const { w, h } = size();
      const { lx, ly, near } = local(r, radius);
      ease += ((near && !REDUCED ? 1 : 0) - ease) * 0.1;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = colour; ctx.lineWidth = 1;
      const cx = w * 0.5, cy = h * 0.5;
      const maxR = Math.max(w, h) * 0.62;
      for (let i = 1; i <= count; i++) {
        const t = i / count;
        let ox = 0, oy = 0;
        if (ease > 0.01) {
          const dx = lx - cx, dy = ly - cy;
          const d = Math.hypot(dx, dy) || 1;
          const f = pull * ease * t * (1 / (1 + (d * d) / (radius * radius)));
          ox = (dx / d) * f; oy = (dy / d) * f;
        }
        ctx.beginPath();
        ctx.ellipse(cx + ox, cy + oy, t * maxR, t * maxR * 0.58, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  };
  marks.push(m);
  return m;
}

/** Vertical hatch that shears toward the pointer. Quiet edge texture. */
export function attachHatch(canvas, { gap = 7, radius = 150, pull = 13 } = {}) {
  const { ctx, fit, size } = setup(canvas);
  let ease = 0;
  const m = {
    canvas,
    draw(r, colour) {
      fit(r);
      const { w, h } = size();
      const { lx, ly, near } = local(r, radius);
      ease += ((near && !REDUCED ? 1 : 0) - ease) * 0.12;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = colour; ctx.lineWidth = 1; ctx.lineCap = 'round';
      const r2 = radius * radius;
      const seg = 9;
      for (let x = gap / 2; x < w; x += gap) {
        ctx.beginPath();
        for (let y = 0; y <= h; y += seg) {
          let nx = x;
          if (ease > 0.01) {
            const dx = lx - x, dy = ly - y, d2 = dx * dx + dy * dy;
            nx += (dx / (Math.sqrt(d2) || 1)) * ((pull * ease) / (1 + d2 / r2));
          }
          if (y === 0) ctx.moveTo(nx, y); else ctx.lineTo(nx, y);
        }
        ctx.stroke();
      }
    }
  };
  marks.push(m);
  return m;
}

requestAnimationFrame(tick);
