// "The story" — a scroll-driven life sequence for the unofficial Senna tribute.
//
// Original procedural visuals only: no photographs, likenesses, liveries or
// logos. One pinned section, one ScrollTrigger (scrubbed) drives a master
// progress; a single 2D canvas renders the scene for the current chapter and
// composites cinematic transitions between neighbours. Chapter text is real
// DOM, revealed line by line.
//
//   initStory(section, { gsap, ScrollTrigger, reducedMotion, getVelocity }) -> { destroy() }

import { CIRCUITS } from './circuits.js';

/* ───────────────────────── Content ───────────────────────── */

const CHAPTERS = [
  { year: '1960', meta: 'São Paulo, Brazil', title: 'A city wakes',
    copy: 'Ayrton Senna da Silva was born in São Paulo on 21 March 1960 — a vast, restless city he would always call home.',
    scene: 'dawn', tr: 'wipe', still: 0.75 },
  { year: 'Age 4', meta: 'The family garage', title: 'The first kart',
    copy: 'His father, Milton, built him a tiny kart with a one-horsepower engine. Ayrton was about four years old.',
    scene: 'blueprint', tr: 'zoom', still: 0.85 },
  { year: '1973', meta: 'Interlagos · Age 13', title: 'The first race',
    copy: 'At thirteen he lined up for his first official kart race, at Interlagos in São Paulo. He won it.',
    scene: 'arc', tr: 'fade', trColor: [11, 31, 75], still: 0.55 },
  { year: '1970s', meta: 'Karting · The wet', title: 'Learning the rain',
    copy: 'His first race in the rain went badly. So whenever it rained, he went to the kart track and practised — until the wet became his greatest strength.',
    scene: 'rain', tr: 'wipe', still: 0.5 },
  { year: '1979 · 80', meta: 'Karting World Championship', title: 'So close, twice', long: true,
    copy: 'South American karting champion in 1977, he finished runner-up at the Karting World Championship in 1979 and again in 1980. It was the one title that got away.',
    scene: 'bands', tr: 'iris', still: 0.7 },
  { year: '1981', meta: 'São Paulo → England', title: 'Crossing the Atlantic',
    copy: 'In 1981 he moved to England to race single-seaters, on the long road that leads to Formula 1.',
    scene: 'globe', tr: 'fade', trColor: [0, 90, 50], still: 0.8 },
  { year: '81—83', meta: 'Junior single-seaters', title: 'Five titles, three seasons',
    copy: 'Two Formula Ford 1600 titles in 1981. The British and European Formula Ford 2000 crowns in 1982. The British Formula 3 championship in 1983.',
    scene: 'titles', tr: 'zoom', still: 0.8 },
  { year: '1984', meta: 'Formula 1 debut · Toleman', title: 'Lights out',
    copy: 'He reached Formula 1 with Toleman. At a rain-soaked Monaco he climbed to second and was closing on the leader when the race was stopped.',
    scene: 'lights', tr: 'fade', trColor: [7, 17, 13], still: 0.4 },
  { year: '1985', meta: 'Estoril, Portugal', title: 'The first win',
    copy: 'Driving for Lotus through torrential rain at Estoril, he won his first Grand Prix.',
    scene: 'estoril', tr: 'zoom', still: 0.6 },
  { year: '1988', meta: 'Monaco · Qualifying', title: 'The tunnel', weight: 1.3,
    copy: 'He took pole by 1.427 seconds from his own team-mate. He later said the lap felt like driving in a tunnel, beyond conscious thought.',
    scene: 'tunnel', tr: 'fade', trColor: [255, 223, 0], still: 0.82 },
  { year: '88·90·91', meta: 'World Champion', title: 'Three crowns', long: true,
    copy: 'World champion in 1988, 1990 and 1991 — and every one of those titles was decided at Suzuka, in Japan.',
    scene: 'crowns', tr: 'iris', still: 0.8 },
  { year: '1991', meta: 'Interlagos, São Paulo', title: 'Winning at home',
    copy: 'At last, a home win in Brazil. His gearbox failed in the closing laps and left him with only sixth gear — and he held on.',
    scene: 'home', tr: 'wipe', still: 0.8 },
  { year: '1993', meta: 'Donington Park · Rain', title: 'The opening lap',
    copy: 'In the rain at Donington he fell to fifth at the start, then passed four cars to lead by the end of the first lap. He won by more than a minute.',
    scene: 'donington', tr: 'fade', trColor: [7, 17, 13], still: 0.8 },
  { year: '1994', meta: 'Imola · San Marino Grand Prix', title: 'A new team', weight: 3.2, finale: true,
    copy: 'He joined Williams for 1994. On 1 May at Imola he started from pole, and led.',
    scene: 'imola', still: 0 },
];

const CODA = [
  { cls: 'st-coda__date', text: '1 May 1994.' },
  { cls: 'st-coda__miss', text: 'We miss you, Ayrton.' },
  { cls: 'st-coda__rem', text: 'We remember.' },
  { cls: 'st-coda__also', text: 'Remembering, too, Roland Ratzenberger, who died the day before.' },
];

// finale timing (local progress of the last chapter)
const F = { carStart: 0.04, freeze: 0.5, drainEnd: 0.62, black0: 0.7, black1: 0.8, coda: [0.81, 0.86, 0.905, 0.95] };
const TW = 0.14; // transition window at the end of each chapter

/* ───────────────────────── Helpers ───────────────────────── */

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const range = (t, a, b) => clamp((t - a) / (b - a));
const smooth = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const fract = (x) => x - Math.floor(x);
const hash = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453123);
const TAU = Math.PI * 2;

const COL = {
  ink: [7, 17, 13], cream: [243, 239, 228], yellow: [255, 223, 0], green: [0, 166, 81],
  blue: [27, 79, 216], navy: [11, 31, 75], red: [255, 43, 28],
};
const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const FONT_D = '"Big Shoulders Display", "Arial Narrow", Impact, sans-serif';
const FONT_M = '"JetBrains Mono", ui-monospace, Menlo, monospace';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function vgrad(ctx, y0, y1, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}

function glow(ctx, x, y, r, c, a) {
  if (a <= 0 || r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(c, a));
  g.addColorStop(0.35, rgba(c, a * 0.35));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function mono(ctx, text, x, y, size, c, a = 1, align = 'left') {
  ctx.font = `500 ${size}px ${FONT_M}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = rgba(c, a);
  ctx.fillText(text.toUpperCase(), x, y);
}

// Deterministic rain: a pure function of time, so it can freeze and reverse.
function rain(ctx, W, H, time, { n = 260, slant = 0.2, len = 26, alpha = 0.35, speed = 1.6, width = 1, color = COL.cream, seed = 0 } = {}) {
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const span = W + Math.abs(slant) * H + 40;
  for (let i = 0; i < n; i++) {
    const h1 = hash(i + seed), h2 = hash(i * 1.7 + seed + 9.1), h3 = hash(i * 3.1 + seed + 2.3);
    const v = 0.65 + h2 * 0.7;
    const l = len * (0.5 + h3);
    const y = fract(h3 + time * speed * v * 0.5) * (H + l * 2) - l;
    const x = h1 * span - Math.max(0, slant) * H - 20 + slant * y;
    ctx.moveTo(x, y);
    ctx.lineTo(x - slant * l, y - l);
  }
  ctx.stroke();
}

function fitBox(box, k = 0.92, vw = 1000, vh = 700) {
  const sc = Math.min(box.w / vw, box.h / vh) * k;
  return { sc, ox: box.x + (box.w - vw * sc) / 2, oy: box.y + (box.h - vh * sc) / 2 };
}

/* ── circuit sampling (SVG path -> polyline in racing direction) ── */

const TRACKS = {};
function sampleTracks() {
  if (Object.keys(TRACKS).length) return;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden';
  document.body.appendChild(svg);
  for (const id of ['imola', 'monaco', 'interlagos', 'donington', 'estoril', 'suzuka']) {
    const c = CIRCUITS[id];
    if (!c) continue;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', c.d);
    svg.appendChild(p);
    const N = 720;
    const pts = new Float32Array(N * 2);
    let L = 0;
    try { L = p.getTotalLength(); } catch (e) { L = 0; }
    for (let i = 0; i < N; i++) {
      const q = L ? p.getPointAtLength((i / N) * L) : { x: 500, y: 350 };
      pts[i * 2] = q.x;
      pts[i * 2 + 1] = q.y;
    }
    const tr = { id, N, pts, corners: {} };
    (c.corners || []).forEach((k) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < N; i++) {
        const d = (pts[i * 2] - k.x) ** 2 + (pts[i * 2 + 1] - k.y) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      tr.corners[k.name] = best / N;
    });
    TRACKS[id] = tr;
  }
  svg.remove();
}

function trackPt(tr, f, fit) {
  const N = tr.N;
  const x = fract(f) * N;
  const i = Math.floor(x) % N, j = (i + 1) % N, u = x - Math.floor(x);
  const px = lerp(tr.pts[i * 2], tr.pts[j * 2], u);
  const py = lerp(tr.pts[i * 2 + 1], tr.pts[j * 2 + 1], u);
  return [fit.ox + px * fit.sc, fit.oy + py * fit.sc];
}

function trackPath(ctx, tr, fit, f0, f1) {
  const step = 1 / tr.N;
  let p = trackPt(tr, f0, fit);
  ctx.moveTo(p[0], p[1]);
  for (let f = Math.ceil(f0 / step) * step; f < f1; f += step) {
    p = trackPt(tr, f, fit);
    ctx.lineTo(p[0], p[1]);
  }
  p = trackPt(tr, f1, fit);
  ctx.lineTo(p[0], p[1]);
}

function strokeTrack(ctx, tr, fit, f0, f1, c, a, w) {
  if (!tr || f1 <= f0) return;
  ctx.beginPath();
  trackPath(ctx, tr, fit, f0, f1);
  ctx.strokeStyle = rgba(c, a);
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function trail(ctx, tr, fit, head, len, c, a, w) {
  const seg = 14;
  for (let k = 0; k < seg; k++) {
    const f0 = head - len * (1 - k / seg), f1 = head - len * (1 - (k + 1) / seg) + 0.0005;
    strokeTrack(ctx, tr, fit, f0, f1, c, a * Math.pow((k + 1) / seg, 1.6), w * (0.4 + 0.6 * (k + 1) / seg));
  }
}

/* ── partial "pen" drawing for polylines ── */

function pen(ctx, prims, map, amount, c, a, w) {
  let left = amount;
  let tip = null;
  ctx.strokeStyle = rgba(c, a);
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const pr of prims) {
    if (left <= 0) break;
    const pts = pr.pts;
    let p = map(pts[0]);
    ctx.moveTo(p[0], p[1]);
    for (let i = 1; i < pts.length && left > 0; i++) {
      const q = map(pts[i]);
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= left) { ctx.lineTo(q[0], q[1]); left -= d; tip = q; }
      else { const u = left / d; tip = [lerp(p[0], q[0], u), lerp(p[1], q[1], u)]; ctx.lineTo(tip[0], tip[1]); left = 0; }
      p = q;
    }
    pr.done = left > 0;
  }
  ctx.stroke();
  return tip;
}
function primLength(prims, map) {
  let L = 0;
  for (const pr of prims) {
    for (let i = 1; i < pr.pts.length; i++) {
      const p = map(pr.pts[i - 1]), q = map(pr.pts[i]);
      L += Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
  }
  return L;
}
const polyRect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const polyCirc = (cx, cy, rx, ry = rx, n = 36) => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * TAU) * rx, cy + Math.sin((i / n) * TAU) * ry]);

/* ── generic open-wheel kart, plan view, nose to +x ── */

function kart(ctx, x, y, ang, L, body = COL.cream, a = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.globalAlpha *= a;
  ctx.fillStyle = '#0b0f0d';
  const wheel = (cx, cy, w, h) => ctx.fillRect((cx - w / 2) * L, (cy - h / 2) * L, w * L, h * L);
  wheel(0.3, -0.26, 0.14, 0.08); wheel(0.3, 0.26, 0.14, 0.08);
  wheel(-0.32, -0.28, 0.18, 0.1); wheel(-0.32, 0.28, 0.18, 0.1);
  ctx.fillStyle = rgba(body, 1);
  ctx.beginPath();
  ctx.moveTo(-0.42 * L, -0.17 * L); ctx.lineTo(0.3 * L, -0.12 * L); ctx.lineTo(0.5 * L, -0.06 * L);
  ctx.lineTo(0.5 * L, 0.06 * L); ctx.lineTo(0.3 * L, 0.12 * L); ctx.lineTo(-0.42 * L, 0.17 * L);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(7,17,13,0.85)';
  ctx.beginPath(); ctx.ellipse(-0.12 * L, 0, 0.1 * L, 0.075 * L, 0, 0, TAU); ctx.fill();
  ctx.fillRect(-0.4 * L, -0.03 * L, 0.06 * L, 0.06 * L);
  ctx.restore();
}

/* ───────────────────────── Scenes ─────────────────────────
   Each scene: (ctx, W, H, t, S). Coordinates in CSS px. t = local chapter
   progress 0..1. S = { time, vel, fb:{x,y,w,h}, portrait, still }. */

const skyCache = { key: '', far: [], near: [] };
function skyline(W, H, portrait) {
  const key = `${W}x${H}`;
  if (skyCache.key === key) return skyCache;
  const gen = (seed, minW, maxW, maxH, minH) => {
    const out = [];
    let x = -80, i = 0;
    while (x < W + 120) {
      const w = lerp(minW, maxW, hash(seed + i * 2.13));
      const r = hash(seed + i * 5.71);
      const h = lerp(minH, maxH, r * r) * (hash(seed + i * 9.3) > 0.9 ? 1.35 : 1);
      out.push({ x, w, h, ant: hash(seed + i * 1.1) > 0.82, step: hash(seed + i * 7.7) > 0.6, i });
      x += w + (hash(seed + i * 3.3) > 0.7 ? w * 0.15 : 0);
      i++;
    }
    return out;
  };
  const u = portrait ? Math.max(W, 420) / 1400 : W / 1400;
  skyCache.key = key;
  skyCache.far = gen(11, 26 * u * 1.4, 70 * u * 1.4, H * 0.24, H * 0.06);
  skyCache.near = gen(57, 30 * u * 1.4, 90 * u * 1.4, H * 0.3, H * 0.05);
  return skyCache;
}

function sDawn(ctx, W, H, t, S) {
  const s = easeOut(clamp(t * 1.1));
  const hz = S.portrait ? H * 0.6 : H * 0.74;
  ctx.fillStyle = vgrad(ctx, 0, hz, [
    [0, rgba(mix([3, 8, 22], [26, 60, 132], s))],
    [0.55, rgba(mix([10, 26, 64], [190, 150, 150], s))],
    [1, rgba(mix([22, 40, 78], [255, 214, 120], s))],
  ]);
  ctx.fillRect(0, 0, W, hz + 2);
  ctx.fillStyle = rgba(COL.ink);
  ctx.fillRect(0, hz, W, H - hz);

  // stars fading out
  for (let i = 0; i < 90; i++) {
    const a = (1 - s) * (0.3 + 0.5 * hash(i + 4)) * (0.75 + 0.25 * Math.sin(S.time * (1 + hash(i)) + i));
    if (a < 0.02) continue;
    ctx.fillStyle = rgba(COL.cream, a);
    ctx.fillRect(hash(i) * W, hash(i + 0.5) * hz * 0.7, 1.4, 1.4);
  }
  // slow cloud streaks
  for (let i = 0; i < 7; i++) {
    const y = hz * (0.2 + 0.55 * hash(i + 20));
    const w = W * (0.2 + 0.3 * hash(i + 21));
    const x = fract(hash(i + 22) + S.time * 0.004 * (1 + hash(i)) + t * 0.05) * (W + w) - w;
    ctx.fillStyle = rgba(mix([30, 50, 100], [255, 236, 200], s), 0.05 + 0.1 * s);
    ctx.fillRect(x, y, w, 2 + 3 * hash(i + 23));
  }
  // sun
  const r = Math.min(W, H) * 0.085;
  const sx = S.portrait ? W * 0.62 : S.fb.x + S.fb.w * 0.56;
  const sy = hz + r * 1.4 - s * r * 3.6;
  glow(ctx, sx, sy, r * 9, [255, 200, 90], 0.45 * s);
  glow(ctx, sx, sy, r * 3, COL.yellow, 0.6 * s);
  ctx.fillStyle = rgba(mix([255, 170, 70], [255, 240, 190], s));
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();

  const sk = skyline(W, H, S.portrait);
  const drawLayer = (arr, base, col, shift, lit) => {
    ctx.fillStyle = col;
    for (const b of arr) {
      const x = b.x - shift;
      ctx.fillRect(x, base - b.h, b.w, b.h + 2);
      if (b.step) ctx.fillRect(x + b.w * 0.2, base - b.h - b.h * 0.08, b.w * 0.6, b.h * 0.08 + 1);
      if (b.ant) ctx.fillRect(x + b.w * 0.5 - 1, base - b.h - b.h * 0.25, 2, b.h * 0.25);
    }
    if (!lit) return;
    const wa = (1 - s) * 0.85;
    if (wa < 0.02) return;
    for (const b of arr) {
      const x = b.x - shift;
      const cols = Math.max(1, Math.floor(b.w / 9)), rows = Math.floor(b.h / 12);
      for (let cx = 0; cx < cols; cx++) for (let ry = 1; ry < rows; ry++) {
        const hh = hash(b.i * 31 + cx * 7 + ry * 13);
        if (hh < 0.72) continue;
        ctx.fillStyle = rgba(hh > 0.93 ? COL.cream : COL.yellow, wa * (0.35 + 0.4 * hash(hh * 9)));
        ctx.fillRect(x + 4 + cx * 9, base - b.h + ry * 12, 3, 4);
      }
    }
  };
  drawLayer(sk.far, hz + 1, rgba(mix([14, 30, 66], [120, 100, 120], s), 1), t * 30, false);
  ctx.fillStyle = vgrad(ctx, hz - H * 0.12, hz, [[0, rgba([255, 214, 140], 0)], [1, rgba([255, 214, 140], 0.18 * s)]]);
  ctx.fillRect(0, hz - H * 0.12, W, H * 0.12);
  drawLayer(sk.near, hz + 2, rgba(COL.ink), t * 70, true);
}

const KART_PRIMS = [
  { pts: [[-0.56, 0], [0.62, 0]], dashed: true },
  { pts: [[-0.42, -0.17], [0.3, -0.12], [0.44, -0.06], [0.44, 0.06], [0.3, 0.12], [-0.42, 0.17], [-0.42, -0.17]], label: 'Chassis · steel tube', lx: -0.05, ly: -0.42 },
  { pts: [[-0.3, -0.165], [-0.3, 0.165]] },
  { pts: [[0.1, -0.13], [0.1, 0.13]] },
  { pts: [[0.3, -0.27], [0.3, 0.27]] },
  { pts: polyRect(0.23, -0.3, 0.37, -0.22) }, { pts: polyRect(0.23, 0.22, 0.37, 0.3) },
  { pts: [[-0.32, -0.33], [-0.32, 0.33]] },
  { pts: polyRect(-0.41, -0.33, -0.23, -0.23) }, { pts: polyRect(-0.41, 0.23, -0.23, 0.33) },
  { pts: polyCirc(-0.12, 0, 0.1, 0.075) },
  { pts: polyCirc(0.1, 0, 0.055, 0.055, 28), label: 'Steering', lx: 0.16, ly: 0.12 },
  { pts: [[0.155, 0], [0.3, 0]] },
  { pts: polyRect(-0.28, 0.18, -0.1, 0.27), label: 'Engine · 1 hp', lx: -0.19, ly: 0.41 },
  { pts: [[-0.28, 0.225], [-0.32, 0.225]] },
  { pts: [[0.44, -0.1], [0.53, -0.06], [0.53, 0.06], [0.44, 0.1]] },
  { pts: [[-0.42, -0.2], [-0.5, -0.2], [-0.5, 0.2], [-0.42, 0.2]] },
  { pts: [[-0.5, 0.5], [0.53, 0.5]], dim: true },
  { pts: [[-0.5, 0.46], [-0.5, 0.54]] }, { pts: [[0.53, 0.46], [0.53, 0.54]] },
];

function sBlueprint(ctx, W, H, t, S) {
  ctx.fillStyle = vgrad(ctx, 0, H, [[0, '#0d2c7e'], [1, '#081c55']]);
  ctx.fillRect(0, 0, W, H);
  const g = 24;
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(243,239,228,0.06)';
  ctx.beginPath();
  for (let x = (W % g) / 2; x < W; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = (H % g) / 2; y < H; y += g) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(243,239,228,0.12)';
  ctx.beginPath();
  for (let x = (W % g) / 2; x < W; x += g * 5) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = (H % g) / 2; y < H; y += g * 5) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();

  const fb = S.fb;
  const K = Math.min(fb.w * 0.78, fb.h * 1.15);
  const cx = fb.x + fb.w / 2, cy = fb.y + fb.h * 0.46;
  const map = (p) => [cx + p[0] * K, cy + p[1] * K];
  const amt = smooth(range(t, 0.04, 0.72));
  const L = primLength(KART_PRIMS, map);
  ctx.setLineDash([]);
  const tip = pen(ctx, KART_PRIMS, map, amt * L, COL.cream, 0.92, Math.max(1.2, K * 0.0035));
  // labels once their line is complete
  let acc = 0;
  for (const pr of KART_PRIMS) {
    acc += primLength([pr], map);
    if (!pr.label) continue;
    const a = range(amt * L, acc, acc + L * 0.06);
    if (a <= 0) continue;
    const p = map([pr.lx, pr.ly]);
    mono(ctx, pr.label, p[0], p[1], Math.max(10, K * 0.018), COL.yellow, a, 'center');
  }
  if (tip && amt < 0.999) {
    glow(ctx, tip[0], tip[1], 26, COL.yellow, 0.7);
    ctx.fillStyle = rgba(COL.yellow);
    ctx.beginPath(); ctx.arc(tip[0], tip[1], 2.5, 0, TAU); ctx.fill();
  }
  // title block
  const bx = fb.x + fb.w - Math.min(260, fb.w * 0.5), by = fb.y + fb.h - 46;
  const ba = range(t, 0.1, 0.25);
  ctx.strokeStyle = rgba(COL.cream, 0.4 * ba);
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, Math.min(250, fb.w * 0.48), 40);
  mono(ctx, 'Sheet 01 · Kart · plan view', bx + 10, by + 13, 10, COL.cream, 0.75 * ba);
  mono(ctx, 'São Paulo · c. 1964', bx + 10, by + 28, 10, COL.cream, 0.5 * ba);
}

function sArc(ctx, W, H, t, S) {
  const g = ctx.createRadialGradient(W * 0.6, H * 0.3, 0, W * 0.6, H * 0.3, Math.max(W, H));
  g.addColorStop(0, '#0f3a25'); g.addColorStop(1, '#050d09');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const fb = S.fb;
  const vel = Math.abs(S.vel);
  // speed lines
  ctx.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const y = hash(i + 3) * H;
    const len = (40 + 160 * hash(i + 4)) * (1 + vel * 2.5);
    const x = W + 200 - fract(hash(i + 5) + S.time * (0.35 + 0.5 * hash(i + 6)) + t * 1.5) * (W + 400 + len);
    ctx.strokeStyle = rgba(i % 9 === 0 ? COL.yellow : COL.cream, 0.05 + 0.1 * hash(i + 7));
    ctx.lineWidth = 1 + hash(i + 8) * 1.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
  }
  const R = S.portrait ? fb.w * 0.95 : Math.min(fb.w * 0.62, fb.h * 1.1);
  const acx = fb.x + fb.w / 2, acy = fb.y + fb.h * 0.42 + R * 0.72;
  const a0 = -Math.PI * 0.92, a1 = -Math.PI * 0.08;
  const band = R * 0.2;
  ctx.lineCap = 'butt';
  ctx.strokeStyle = '#18201c';
  ctx.lineWidth = band;
  ctx.beginPath(); ctx.arc(acx, acy, R, a0, a1); ctx.stroke();
  const off = -(t * 600 + S.time * 20);
  const kerb = (rad, col, o) => {
    ctx.strokeStyle = rgba(col); ctx.lineWidth = band * 0.12; ctx.setLineDash([18, 18]); ctx.lineDashOffset = off + o;
    ctx.beginPath(); ctx.arc(acx, acy, rad, a0, a1); ctx.stroke();
  };
  kerb(R - band * 0.56, COL.yellow, 0); kerb(R - band * 0.56, COL.green, 18);
  ctx.setLineDash([]);
  ctx.strokeStyle = rgba(COL.cream, 0.5); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(acx, acy, R + band * 0.5, a0, a1); ctx.stroke();
  // kart
  const u = easeInOut(range(t, 0.02, 0.98));
  const a = lerp(a0 + 0.12, a1 - 0.12, u) + Math.sin(S.time * 1.3) * 0.004;
  const kr = R - band * 0.1;
  for (let k = 0; k < 16; k++) {
    const aa = a - 0.012 * (k + 1) * (1 + vel);
    ctx.strokeStyle = rgba(COL.yellow, 0.35 * (1 - k / 16));
    ctx.lineWidth = band * 0.16 * (1 - k / 16);
    ctx.beginPath(); ctx.arc(acx, acy, kr, aa - 0.012, aa); ctx.stroke();
  }
  const kx = acx + Math.cos(a) * kr, ky = acy + Math.sin(a) * kr;
  glow(ctx, kx, ky, band * 1.4, COL.yellow, 0.25);
  kart(ctx, kx, ky, a + Math.PI / 2, band * 0.75, COL.cream);
  mono(ctx, 'Interlagos · 1973', acx, acy - R + band * 1.1, 11, COL.cream, 0.45 * range(t, 0.1, 0.3), 'center');
}

function sRain(ctx, W, H, t, S) {
  ctx.fillStyle = vgrad(ctx, 0, H, [[0, '#0b1820'], [1, '#04090c']]);
  ctx.fillRect(0, 0, W, H);
  const fb = S.fb;
  // wet sheen: soft vertical reflections
  for (let i = 0; i < 14; i++) {
    const x = hash(i + 40) * W;
    const g = ctx.createLinearGradient(x - 30, 0, x + 30, 0);
    g.addColorStop(0, 'rgba(120,160,190,0)'); g.addColorStop(0.5, `rgba(120,160,190,${0.03 + 0.04 * hash(i)})`); g.addColorStop(1, 'rgba(120,160,190,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 30, 0, 60, H);
  }
  const path = (u) => {
    const x = fb.x + fb.w * (0.08 + 0.84 * u);
    const y = fb.y + fb.h * 0.5 + Math.sin(u * TAU * 1.1 + 0.4) * fb.h * 0.22;
    return [x, y];
  };
  const u = lerp(0.05, 0.92, easeInOut(range(t, 0, 1)));
  // tyre tracks
  ctx.strokeStyle = 'rgba(160,190,210,0.12)';
  ctx.lineWidth = 2;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    for (let k = 0; k <= 60; k++) {
      const uu = Math.max(0, u - 0.4 + (k / 60) * 0.4);
      const p = path(uu), q = path(uu + 0.001);
      const n = Math.atan2(q[1] - p[1], q[0] - p[0]) + Math.PI / 2;
      const o = side * fb.h * 0.03;
      k ? ctx.lineTo(p[0] + Math.cos(n) * o, p[1] + Math.sin(n) * o) : ctx.moveTo(p[0] + Math.cos(n) * o, p[1] + Math.sin(n) * o);
    }
    ctx.stroke();
  }
  const p = path(u), q = path(u + 0.002);
  const head = Math.atan2(q[1] - p[1], q[0] - p[0]);
  const slip = Math.cos(u * TAU * 1.1 + 0.4) * 0.55 + Math.sin(S.time * 2.1) * 0.04;
  const ang = head + slip;
  const L = Math.min(fb.w, fb.h) * 0.16;
  // spray from rear wheels — deterministic particles
  const rx = p[0] - Math.cos(ang) * L * 0.32, ry = p[1] - Math.sin(ang) * L * 0.32;
  for (let i = 0; i < 160; i++) {
    const age = fract(hash(i) + S.time * 1.6);
    const side = i % 2 ? 1 : -1;
    const dir = head + Math.PI + (hash(i + 1) - 0.5) * 0.9 + side * 0.25;
    const d = age * L * (1.2 + hash(i + 2) * 1.6);
    const ox = Math.cos(ang + Math.PI / 2) * side * L * 0.28, oy = Math.sin(ang + Math.PI / 2) * side * L * 0.28;
    const x = rx + ox + Math.cos(dir) * d, y = ry + oy + Math.sin(dir) * d;
    ctx.fillStyle = rgba(COL.cream, 0.4 * (1 - age));
    ctx.beginPath(); ctx.arc(x, y, 0.8 + age * 3.2 * hash(i + 3), 0, TAU); ctx.fill();
  }
  kart(ctx, p[0], p[1], ang, L, COL.cream);
  // ground splashes
  ctx.strokeStyle = 'rgba(200,220,235,0.2)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const age = fract(hash(i + 70) + S.time * 0.9);
    const x = hash(i + 71) * W, y = hash(i + 72) * H;
    ctx.globalAlpha = 1 - age;
    ctx.beginPath(); ctx.ellipse(x, y, age * 14, age * 5, 0, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const slant = 0.22 + S.vel * 0.45;
  rain(ctx, W, H, S.time, { n: 220, slant, len: 22 * (1 + Math.abs(S.vel)), alpha: 0.22, speed: 1.5, seed: 1 });
  rain(ctx, W, H, S.time, { n: 120, slant: slant * 1.2, len: 40 * (1 + Math.abs(S.vel)), alpha: 0.35, speed: 2.4, width: 1.4, seed: 7 });
}

function sBands(ctx, W, H, t, S) {
  ctx.fillStyle = '#06142f';
  ctx.fillRect(0, 0, W, H);
  const cols = [COL.green, COL.yellow, COL.blue, COL.cream, COL.navy, COL.green, COL.yellow, COL.blue];
  const n = cols.length;
  const bh = (H * 1.6) / n;
  const shift = (t * 1.2 + S.time * 0.02) * bh * 2;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-0.22);
  ctx.translate(-W * 0.8, -H * 0.8);
  for (let i = -2; i < n + 2; i++) {
    const c = cols[((i % n) + n) % n];
    const y0 = i * bh + (shift % (bh * n)) - bh * 2;
    ctx.fillStyle = rgba(c, 0.9);
    ctx.beginPath();
    const steps = 24, span = W * 1.6;
    for (let k = 0; k <= steps; k++) {
      const x = (k / steps) * span;
      const w = Math.sin(k * 0.5 + S.time * 1.2 + i) * bh * 0.08 + Math.sin(k * 0.21 - S.time * 0.7) * bh * 0.05;
      k ? ctx.lineTo(x, y0 + w) : ctx.moveTo(x, y0 + w);
    }
    for (let k = steps; k >= 0; k--) {
      const x = (k / steps) * span;
      const w = Math.sin(k * 0.5 + S.time * 1.2 + i + 1) * bh * 0.08 + Math.sin(k * 0.21 - S.time * 0.7) * bh * 0.05;
      ctx.lineTo(x, y0 + bh + 1 + w);
    }
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(5,12,22,0.62)';
  ctx.fillRect(0, 0, W, H);

  // podium abstraction: an empty first place between two runner-up columns
  const fb = S.fb;
  const base = fb.y + fb.h * 0.88;
  const colW = Math.min(fb.w * 0.17, 140);
  const gap = colW * 0.35;
  const cx = fb.x + fb.w / 2;
  const hMax = fb.h * 0.62;
  const bars = [
    { x: cx - colW * 1.5 - gap, h: 0.68, label: '1979', k: range(t, 0.18, 0.4), solid: true },
    { x: cx - colW / 2, h: 1, label: 'World Champion', k: range(t, 0.05, 0.3), solid: false },
    { x: cx + colW / 2 + gap, h: 0.68, label: '1980', k: range(t, 0.38, 0.6), solid: true },
  ];
  for (const b of bars) {
    const e = easeOut(b.k);
    if (e <= 0) continue;
    const h = hMax * b.h * e;
    if (b.solid) {
      ctx.fillStyle = rgba(COL.cream, 0.95);
      ctx.fillRect(b.x, base - h, colW, h);
      ctx.font = `900 ${colW * 0.9}px ${FONT_D}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = rgba(COL.ink, e);
      ctx.fillText('2', b.x + colW / 2, base - h + colW * 0.9);
      mono(ctx, b.label, b.x + colW / 2, base + 18, 11, COL.cream, e, 'center');
    } else {
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = rgba(COL.cream, 0.55 * e);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(b.x, base - h, colW, h);
      ctx.setLineDash([]);
      ctx.font = `900 ${colW * 0.9}px ${FONT_D}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.strokeStyle = rgba(COL.cream, 0.35 * e);
      ctx.strokeText('1', b.x + colW / 2, base - h + colW * 0.9);
    }
  }
  ctx.fillStyle = rgba(COL.cream, 0.4);
  ctx.fillRect(fb.x + fb.w * 0.1, base, fb.w * 0.8, 1);
}

const toVec = (lat, lon) => {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  return [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
};
function sGlobe(ctx, W, H, t, S) {
  const g0 = ctx.createRadialGradient(W * 0.6, H * 0.45, 0, W * 0.6, H * 0.45, Math.max(W, H) * 0.8);
  g0.addColorStop(0, '#0c1f45'); g0.addColorStop(1, '#040a0c');
  ctx.fillStyle = g0; ctx.fillRect(0, 0, W, H);
  const fb = S.fb;
  const R = Math.min(fb.w, fb.h) * 0.44;
  const cx = fb.x + fb.w / 2, cy = fb.y + fb.h / 2;
  const e = easeInOut(range(t, 0, 0.9));
  const lon0 = lerp(-55, -18, e) + Math.sin(S.time * 0.1) * 1.5;
  const lat0 = lerp(-12, 22, e);
  const L0 = (lon0 * Math.PI) / 180, P0 = (lat0 * Math.PI) / 180;
  const proj = (lat, lon, lift = 1) => {
    const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180 - L0;
    const x = Math.cos(la) * Math.sin(lo);
    const y = Math.cos(P0) * Math.sin(la) - Math.sin(P0) * Math.cos(la) * Math.cos(lo);
    const z = Math.sin(P0) * Math.sin(la) + Math.cos(P0) * Math.cos(la) * Math.cos(lo);
    return [cx + x * R * lift, cy - y * R * lift, z];
  };
  glow(ctx, cx, cy, R * 1.5, COL.blue, 0.18);
  ctx.fillStyle = '#081530';
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
  ctx.strokeStyle = rgba(COL.cream, 0.18); ctx.lineWidth = 1;
  ctx.stroke();
  for (let lat = -84; lat <= 84; lat += 6) {
    const n = Math.max(6, Math.round(60 * Math.cos((lat * Math.PI) / 180)));
    for (let k = 0; k < n; k++) {
      const p = proj(lat, (k / n) * 360);
      if (p[2] <= 0) continue;
      ctx.fillStyle = rgba(COL.cream, 0.08 + 0.32 * p[2]);
      ctx.fillRect(p[0] - 0.9, p[1] - 0.9, 1.8, 1.8);
    }
  }
  const A = [-23.55, -46.63], B = [52.6, -1.2];
  const va = toVec(A[0], A[1]), vb = toVec(B[0], B[1]);
  const om = Math.acos(va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]);
  const slerp = (s) => {
    const a = Math.sin((1 - s) * om) / Math.sin(om), b = Math.sin(s * om) / Math.sin(om);
    const v = [va[0] * a + vb[0] * b, va[1] * a + vb[1] * b, va[2] * a + vb[2] * b];
    return [(Math.asin(v[1]) * 180) / Math.PI, (Math.atan2(v[2], v[0]) * 180) / Math.PI];
  };
  const prog = easeInOut(range(t, 0.18, 0.75));
  const pts = [];
  for (let k = 0; k <= 80; k++) {
    const s = (k / 80) * prog;
    const ll = slerp(s);
    pts.push(proj(ll[0], ll[1], 1 + 0.22 * Math.sin(Math.PI * s)));
  }
  ctx.lineCap = 'round';
  for (let k = 1; k < pts.length; k++) {
    ctx.strokeStyle = rgba(COL.yellow, 0.25 + 0.75 * (k / pts.length));
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pts[k - 1][0], pts[k - 1][1]); ctx.lineTo(pts[k][0], pts[k][1]); ctx.stroke();
  }
  const city = (ll, label, a, right) => {
    const p = proj(ll[0], ll[1]);
    if (p[2] <= 0 || a <= 0) return;
    glow(ctx, p[0], p[1], 22, COL.yellow, 0.6 * a);
    ctx.fillStyle = rgba(COL.yellow, a);
    ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, TAU); ctx.fill();
    mono(ctx, label, p[0] + (right ? 12 : -12), p[1], 11, COL.cream, a, right ? 'left' : 'right');
  };
  city(A, 'São Paulo', range(t, 0.05, 0.2), true);
  city(B, 'England', range(t, 0.72, 0.82), false);
  if (prog > 0 && prog < 1) {
    const h = pts[pts.length - 1];
    glow(ctx, h[0], h[1], 30, COL.yellow, 0.8);
  }
}

function sTitles(ctx, W, H, t, S) {
  ctx.fillStyle = vgrad(ctx, 0, H, [[0, '#06301d'], [1, '#03120b']]);
  ctx.fillRect(0, 0, W, H);
  // English drizzle / mist
  rain(ctx, W, H, S.time, { n: 90, slant: 0.1 + S.vel * 0.3, len: 14, alpha: 0.12, speed: 0.9, seed: 3 });
  const fb = S.fb;
  const rows = [
    { y: '1981', l1: 'Formula Ford 1600', l2: 'Two titles', k: range(t, 0.1, 0.32) },
    { y: '1982', l1: 'Formula Ford 2000', l2: 'British + European', k: range(t, 0.28, 0.5) },
    { y: '1983', l1: 'British Formula 3', l2: 'Champion', k: range(t, 0.46, 0.68) },
  ];
  const rh = Math.min(fb.h / 3.4, fb.w * (S.portrait ? 0.2 : 0.15));
  const top = fb.y + (fb.h - rh * 3) / 2;
  const nx = S.portrait ? fb.x : fb.x + fb.w * 0.16;
  rows.forEach((r, i) => {
    const e = easeOut(r.k);
    if (e <= 0) return;
    const y = top + rh * (i + 1);
    ctx.fillStyle = rgba(COL.cream, 0.5);
    ctx.fillRect(nx, y, (fb.x + fb.w - nx) * e, 1);
    const dx = (1 - e) * 80;
    ctx.font = `900 ${rh * 0.95}px ${FONT_D}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = e;
    if (i === 2) { ctx.fillStyle = rgba(COL.yellow); ctx.fillText(r.y, nx + dx, y - rh * 0.08); }
    else { ctx.strokeStyle = rgba(COL.cream, 0.9); ctx.lineWidth = 1.5; ctx.strokeText(r.y, nx + dx, y - rh * 0.08); }
    ctx.globalAlpha = 1;
    const tx = fb.x + fb.w;
    mono(ctx, r.l1, tx - dx * 0.5, y - rh * 0.5, Math.max(10, rh * 0.11), COL.cream, e, 'right');
    mono(ctx, r.l2, tx - dx * 0.5, y - rh * 0.5 + Math.max(14, rh * 0.16), Math.max(10, rh * 0.11), COL.yellow, e * 0.9, 'right');
  });
}

function sLights(ctx, W, H, t, S) {
  const mon = smooth(range(t, 0.52, 0.72));
  ctx.fillStyle = '#030505';
  ctx.fillRect(0, 0, W, H);
  const fb = S.fb;
  if (mon > 0) {
    ctx.globalAlpha = mon;
    ctx.fillStyle = vgrad(ctx, 0, H, [[0, '#0d1a2c'], [0.6, '#0a1420'], [1, '#05080b']]);
    ctx.fillRect(0, 0, W, H);
    // harbour lights, out of focus
    for (let i = 0; i < 46; i++) {
      const x = hash(i + 90) * W;
      const y = H * (0.35 + 0.35 * hash(i + 91));
      const r = 8 + 34 * hash(i + 92);
      const c = [COL.yellow, COL.cream, [255, 170, 80], [120, 160, 255]][i % 4];
      glow(ctx, x + Math.sin(S.time * 0.3 + i) * 3, y, r, c, 0.25 + 0.2 * hash(i + 93));
    }
    // wet reflections
    for (let i = 0; i < 30; i++) {
      const x = hash(i + 120) * W;
      const c = [COL.yellow, COL.cream, [255, 170, 80]][i % 3];
      const g = ctx.createLinearGradient(0, H * 0.72, 0, H);
      g.addColorStop(0, rgba(c, 0.12)); g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x, H * 0.72, 2 + 4 * hash(i), H * 0.28);
    }
    const slant = 0.16 + S.vel * 0.4;
    rain(ctx, W, H, S.time, { n: 260, slant, len: 26 * (1 + Math.abs(S.vel)), alpha: 0.22, speed: 1.8, seed: 2 });
    rain(ctx, W, H, S.time, { n: 110, slant: slant * 1.2, len: 46, alpha: 0.35, speed: 2.8, width: 1.4, seed: 5 });
    ctx.globalAlpha = 1;
  }
  // gantry: five pairs
  const gw = Math.min(fb.w * 0.86, 640);
  const cw = gw / 5;
  const r = cw * 0.2;
  const gx = fb.x + (fb.w - gw) / 2;
  const gy = fb.y + fb.h * 0.32 - mon * fb.h * 0.6;
  const ga = 1 - mon;
  if (ga <= 0) return;
  ctx.globalAlpha = ga;
  ctx.fillStyle = '#111413';
  ctx.fillRect(gx - cw * 0.2, gy - r * 0.3, gw + cw * 0.4, r * 0.5);
  const out = t >= 0.5;
  for (let k = 0; k < 5; k++) {
    const x = gx + cw * k + cw * 0.12;
    const w = cw * 0.76;
    ctx.fillStyle = '#0d0f0e';
    ctx.strokeStyle = 'rgba(243,239,228,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, gy, w, r * 5, r * 0.6); else ctx.rect(x, gy, w, r * 5);
    ctx.fill(); ctx.stroke();
    const on = !out && t >= 0.1 + k * 0.08;
    for (let j = 0; j < 2; j++) {
      const ly = gy + r * 1.35 + j * r * 2.3;
      const lx = x + w / 2;
      if (on) glow(ctx, lx, ly, r * 3.2, COL.red, 0.55);
      ctx.fillStyle = on ? '#ff2b1c' : '#1b1d1c';
      ctx.beginPath(); ctx.arc(lx, ly, r, 0, TAU); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function sEstoril(ctx, W, H, t, S) {
  ctx.fillStyle = vgrad(ctx, 0, H, [[0, '#0a1622'], [1, '#05090d']]);
  ctx.fillRect(0, 0, W, H);
  const fb = S.fb;
  const tr = TRACKS.estoril;
  const fit = fitBox(fb, 0.9);
  const w = Math.max(2, fit.sc * 7);
  strokeTrack(ctx, tr, fit, 0, 1, COL.cream, 0.14, w);
  const f = easeInOut(range(t, 0.04, 0.6));
  if (f > 0) {
    strokeTrack(ctx, tr, fit, 0, f, COL.yellow, 0.9, w * 0.7);
    const p = trackPt(tr, f, fit);
    glow(ctx, p[0], p[1], 40, COL.yellow, 0.8 * (f < 1 ? 1 : 0.5));
  }
  const slant = 0.2 + S.vel * 0.45;
  rain(ctx, W, H, S.time, { n: 260, slant, len: 24 * (1 + Math.abs(S.vel)), alpha: 0.25, speed: 1.9, seed: 4 });
  rain(ctx, W, H, S.time, { n: 90, slant: slant * 1.2, len: 44, alpha: 0.35, speed: 2.8, width: 1.4, seed: 8 });
  mono(ctx, 'Lap ' + Math.max(1, Math.min(67, Math.round(f * 67))), fb.x + 4, fb.y + 12, 11, COL.cream, 0.6 * range(t, 0.05, 0.15));
  // chequered wipe
  const c = range(t, 0.6, 0.9);
  if (c > 0) {
    const sq = Math.max(W, H) / 16;
    const cols = Math.ceil(W / sq) + 1, rows = Math.ceil(H / sq) + 1;
    const wave = c * (cols + rows + 6);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const k = clamp((wave - (i + (rows - j)) ) / 5);
      if (k <= 0) continue;
      const s = sq * easeOut(k);
      ctx.fillStyle = (i + j) % 2 ? rgba(COL.cream) : rgba([10, 12, 11]);
      ctx.fillRect(i * sq + (sq - s) / 2, j * sq + (sq - s) / 2, s, s);
    }
  }
}

function sTunnel(ctx, W, H, t, S) {
  ctx.fillStyle = '#020303';
  ctx.fillRect(0, 0, W, H);
  const fb = S.fb;
  const vx = fb.x + fb.w / 2, vy = S.portrait ? fb.y + fb.h * 0.5 : H * 0.46;
  const speed = 0.5 + 1.6 * range(t, 0, 0.6) + Math.abs(S.vel) * 0.6;
  const T = S.time * speed * 0.6 + t * 6;
  const D = Math.max(W, H) * 0.9;
  const asp = 1.6;
  // corner rails to vanishing point
  ctx.strokeStyle = 'rgba(255,214,140,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.moveTo(vx, vy); ctx.lineTo(vx + sx * D * asp, vy + sy * D); }
  ctx.stroke();
  const N = 26;
  for (let k = 0; k < N; k++) {
    const z = fract(k / N - T * 0.18);
    const s = Math.pow(z, 2.6);
    const hw = s * D * asp * 0.55, hh = s * D * 0.42;
    const a = Math.min(1, z * 1.4) * 0.55;
    ctx.strokeStyle = `rgba(255,214,140,${a * 0.35})`;
    ctx.lineWidth = 0.5 + s * 3;
    ctx.strokeRect(vx - hw, vy - hh, hw * 2, hh * 2);
    // ceiling lights
    const lw = hw * 0.18, lh = Math.max(1, hh * 0.03);
    ctx.fillStyle = `rgba(255,236,190,${a})`;
    ctx.fillRect(vx - lw / 2, vy - hh + lh, lw, lh);
    ctx.fillRect(vx - hw * 0.62 - lw / 2, vy - hh + lh * 1.5, lw, lh);
    ctx.fillRect(vx + hw * 0.62 - lw / 2, vy - hh + lh * 1.5, lw, lh);
  }
  // radial streaks
  ctx.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const ang = hash(i + 200) * TAU;
    const z = fract(hash(i + 201) + T * (0.3 + 0.4 * hash(i + 202)));
    const r0 = Math.pow(z, 2.2) * D, r1 = r0 * (1.15 + 0.4 * speed * z);
    ctx.strokeStyle = `rgba(255,${200 + 40 * hash(i)},150,${0.35 * z})`;
    ctx.lineWidth = 1 + z * 2;
    ctx.beginPath();
    ctx.moveTo(vx + Math.cos(ang) * r0 * asp * 0.7, vy + Math.sin(ang) * r0 * 0.6);
    ctx.lineTo(vx + Math.cos(ang) * r1 * asp * 0.7, vy + Math.sin(ang) * r1 * 0.6);
    ctx.stroke();
  }
  glow(ctx, vx, vy, D * 0.25, [255, 230, 170], 0.35);
  // tunnel vision: blur everything but the centre, then close the vignette
  const focus = easeInOut(range(t, 0.08, 0.78));
  const rIn = lerp(0.55, 0.1, focus) * Math.max(W, H);
  edgeBlur(ctx, W, H, vx, vy, rIn, 0.25 + 0.75 * focus);
  const vg = ctx.createRadialGradient(vx, vy, rIn * 0.6, vx, vy, rIn * 1.9 + 40);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, `rgba(0,0,0,${0.5 + 0.48 * focus})`);
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  // the margin
  const m = range(t, 0.32, 0.72);
  const ta = range(t, 0.25, 0.35);
  if (ta > 0) {
    const done = m >= 1;
    const val = (easeOut(m) * 1.427).toFixed(3);
    const size = Math.min(fb.w, fb.h) * (done ? 0.22 : 0.15);
    ctx.font = `900 ${size}px ${FONT_D}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (done) glow(ctx, vx, vy, size * 2.2, COL.yellow, 0.25 * ta);
    ctx.fillStyle = rgba(done ? COL.yellow : COL.cream, ta);
    ctx.fillText(`${val}s`, vx, vy + size * 0.05);
    mono(ctx, done ? 'Pole margin over his team-mate' : 'Margin', vx, vy + size * 0.75, 11, COL.cream, ta * 0.75, 'center');
  }
}

let blurCanvas = null;
function edgeBlur(ctx, W, H, cx, cy, r, amount) {
  if (amount <= 0.01 || typeof document === 'undefined') return;
  const src = ctx.canvas;
  const k = 8;
  if (!blurCanvas) blurCanvas = document.createElement('canvas');
  const bw = Math.max(2, Math.round(src.width / k)), bh = Math.max(2, Math.round(src.height / k));
  if (blurCanvas.width !== bw || blurCanvas.height !== bh) { blurCanvas.width = bw; blurCanvas.height = bh; }
  const b = blurCanvas.getContext('2d');
  b.globalCompositeOperation = 'source-over';
  b.clearRect(0, 0, bw, bh);
  b.imageSmoothingEnabled = true;
  b.drawImage(src, 0, 0, bw, bh);
  b.globalCompositeOperation = 'destination-out';
  const sx = bw / W, sy = bh / H;
  const g = b.createRadialGradient(cx * sx, cy * sy, r * sx * 0.4, cx * sx, cy * sy, r * sx * 1.4);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  b.fillStyle = g; b.fillRect(0, 0, bw, bh);
  b.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.globalAlpha = amount;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(blurCanvas, 0, 0, W, H);
  ctx.restore();
}

function crownPath(ctx, x, y, s) {
  const p = [[-0.5, 0.3], [-0.5, -0.22], [-0.25, 0.04], [0, -0.36], [0.25, 0.04], [0.5, -0.22], [0.5, 0.3]];
  ctx.beginPath();
  p.forEach(([a, b], i) => (i ? ctx.lineTo(x + a * s, y + b * s) : ctx.moveTo(x + a * s, y + b * s)));
  ctx.closePath();
}
function sCrowns(ctx, W, H, t, S) {
  const g0 = ctx.createRadialGradient(W * 0.6, H * 0.4, 0, W * 0.6, H * 0.4, Math.max(W, H));
  g0.addColorStop(0, '#13306b'); g0.addColorStop(1, '#050b1c');
  ctx.fillStyle = g0; ctx.fillRect(0, 0, W, H);
  const fb = S.fb;
  const tr = TRACKS.suzuka;
  const fit = fitBox(fb, 0.95);
  strokeTrack(ctx, tr, fit, 0, 1, COL.cream, 0.07, Math.max(2, fit.sc * 6));
  const f = range(t, 0, 0.75) * 3;
  strokeTrack(ctx, tr, fit, 0, Math.min(1, f), COL.cream, 0.22, Math.max(1.5, fit.sc * 3));
  if (f < 3) { const p = trackPt(tr, f, fit); glow(ctx, p[0], p[1], 26, COL.cream, 0.5); }
  mono(ctx, 'Suzuka', fit.ox + 4, fit.oy + 8, 11, COL.cream, 0.5);
  const years = ['1988', '1990', '1991'];
  const s = Math.min(fb.w / 4.2, fb.h * 0.32);
  years.forEach((yr, i) => {
    const k = range(t, 0.12 + i * 0.18, 0.3 + i * 0.18);
    if (k <= 0) return;
    const e = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2); // back-ish ease
    const x = fb.x + fb.w * (0.2 + 0.3 * i), y = fb.y + fb.h * 0.48;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(S.time * 0.05 + i);
    ctx.strokeStyle = rgba(COL.yellow, 0.12 * k);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = 0; r < 16; r++) { const a = (r / 16) * TAU; ctx.moveTo(Math.cos(a) * s * 0.45, Math.sin(a) * s * 0.45); ctx.lineTo(Math.cos(a) * s * 0.9, Math.sin(a) * s * 0.9); }
    ctx.stroke();
    ctx.restore();
    glow(ctx, x, y, s * 1.1, COL.yellow, 0.3 * k);
    crownPath(ctx, x, y, s * 0.7 * e);
    ctx.fillStyle = rgba(COL.yellow, k);
    ctx.fill();
    ctx.fillStyle = rgba(COL.navy, k);
    ctx.fillRect(x - s * 0.35 * e, y + s * 0.12 * e, s * 0.7 * e, Math.max(2, s * 0.03));
    ctx.font = `900 ${s * 0.34}px ${FONT_D}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = rgba(COL.cream, k);
    ctx.fillText(yr, x, y + s * 0.4);
  });
}

function sHome(ctx, W, H, t, S) {
  ctx.fillStyle = vgrad(ctx, 0, H, [[0, '#06281a'], [1, '#030c08']]);
  ctx.fillRect(0, 0, W, H);
  const fb = S.fb;
  const port = S.portrait;
  const tbox = port ? { x: fb.x, y: fb.y, w: fb.w, h: fb.h * 0.8 } : { x: fb.x, y: fb.y, w: fb.w * 0.78, h: fb.h };
  const tr = TRACKS.interlagos;
  const fit = fitBox(tbox, 0.92);
  const w = Math.max(2, fit.sc * 7);
  strokeTrack(ctx, tr, fit, 0, 1, COL.green, 0.35, w);
  const f = range(t, 0.02, 0.9) * 2.2;
  const head = f;
  trail(ctx, tr, fit, head, 0.18, COL.yellow, 0.9, w * 0.8);
  const p = trackPt(tr, head, fit);
  glow(ctx, p[0], p[1], 36, COL.yellow, 0.85);
  // gearbox: gears drop out one by one, leaving sixth
  const order = { 4: 0.3, 5: 0.4, 3: 0.5, 2: 0.58, 1: 0.64 };
  const gx = port ? fb.x + fb.w / 2 - 3 * 34 : fb.x + fb.w * 0.84;
  const gy = port ? fb.y + fb.h * 0.9 : fb.y + fb.h * 0.2;
  const ga = range(t, 0.12, 0.25);
  mono(ctx, 'Gears', port ? gx : gx, port ? gy - 26 : gy - 26, 11, COL.cream, 0.6 * ga, 'left');
  for (let g = 1; g <= 6; g++) {
    const lost = g < 6 && t >= order[g];
    const x = port ? gx + (g - 1) * 34 : gx;
    const y = port ? gy : gy + (g - 1) * 40;
    const a = ga * (lost ? 0.18 : 1);
    ctx.strokeStyle = rgba(g === 6 ? COL.yellow : COL.cream, a * 0.7);
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, 28, 32);
    if (g === 6 && t > 0.64) { glow(ctx, x + 14, y + 16, 50, COL.yellow, 0.4 * ga); ctx.fillStyle = rgba(COL.yellow, ga); ctx.fillRect(x, y, 28, 32); }
    ctx.font = `900 22px ${FONT_D}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = g === 6 && t > 0.64 ? rgba(COL.ink, ga) : rgba(COL.cream, a);
    ctx.fillText(String(g), x + 14, y + 17);
  }
  const r = range(t, 0.62, 0.85);
  if (r > 0) rain(ctx, W, H, S.time, { n: Math.round(200 * r), slant: 0.15 + S.vel * 0.4, len: 22, alpha: 0.25 * r, speed: 1.8, seed: 6 });
}

function sDonington(ctx, W, H, t, S) {
  ctx.fillStyle = vgrad(ctx, 0, H, [[0, '#101a22'], [1, '#05090c']]);
  ctx.fillRect(0, 0, W, H);
  const fb = S.fb;
  const tr = TRACKS.donington;
  const fit = fitBox(fb, 0.9);
  const w = Math.max(2, fit.sc * 7);
  strokeTrack(ctx, tr, fit, 0, 1, COL.cream, 0.16, w);
  const lap = easeInOut(range(t, 0.06, 0.78));
  const base = lap * 0.985;
  const gap = 0.014;
  // our car goes from fifth (index 4) to ahead of everyone
  const ours = lerp(4, -1.3, smooth(range(lap, 0.02, 0.9)));
  const cars = [];
  for (let k = 0; k < 7; k++) {
    const idx = k < 4 ? k : k + 1; // leave slot 4 (5th) for our car at start
    cars.push({ f: base - idx * gap, us: false, slot: idx });
  }
  const usF = base - ours * gap;
  // spray trails
  for (const c of cars) trail(ctx, tr, fit, c.f, 0.02, COL.cream, 0.35, w * 0.5);
  trail(ctx, tr, fit, usF, 0.12, COL.yellow, 0.9, w * 0.8);
  for (const c of cars) {
    const p = trackPt(tr, c.f, fit);
    ctx.fillStyle = rgba(COL.cream, 0.9);
    ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(3.5, w * 0.75), 0, TAU); ctx.fill();
  }
  const p = trackPt(tr, usF, fit);
  glow(ctx, p[0], p[1], 40, COL.yellow, 0.85);
  ctx.fillStyle = rgba(COL.yellow);
  ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(3.5, w * 0.8), 0, TAU); ctx.fill();
  const pos = 1 + cars.filter((c) => c.f > usF).length;
  const la = range(t, 0.06, 0.14);
  ctx.font = `900 ${Math.max(28, fit.sc * 70)}px ${FONT_D}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = rgba(pos === 1 ? COL.yellow : COL.cream, la);
  ctx.fillText('P' + pos, fb.x + 4, fb.y + Math.max(28, fit.sc * 70));
  mono(ctx, 'Lap 1', fb.x + 6, fb.y + Math.max(28, fit.sc * 70) + 18, 11, COL.cream, la * 0.7);
  const slant = 0.24 + S.vel * 0.45;
  rain(ctx, W, H, S.time, { n: 280, slant, len: 24 * (1 + Math.abs(S.vel)), alpha: 0.24, speed: 1.9, seed: 9 });
  rain(ctx, W, H, S.time, { n: 110, slant: slant * 1.2, len: 44, alpha: 0.33, speed: 2.9, width: 1.4, seed: 10 });
}

function sImola(ctx, W, H, t, S) {
  ctx.fillStyle = vgrad(ctx, 0, H, [[0, '#0a1410'], [1, '#040806']]);
  ctx.fillRect(0, 0, W, H);
  const fb = S.fb;
  const tr = TRACKS.imola;
  const fit = fitBox(fb, 0.9);
  const w = Math.max(2, fit.sc * 6);
  strokeTrack(ctx, tr, fit, 0, 1, COL.cream, 0.2, w);
  // motes of light drifting in the air (the race was run in the dry)
  for (let i = 0; i < 70; i++) {
    const x = fract(hash(i + 300) + S.time * 0.006 * (0.5 + hash(i + 301))) * W;
    const y = fract(hash(i + 302) - S.time * 0.01 * (0.5 + hash(i + 303))) * H;
    ctx.fillStyle = rgba(COL.cream, 0.08 + 0.18 * hash(i + 304));
    ctx.beginPath(); ctx.arc(x, y, 0.8 + 1.6 * hash(i + 305), 0, TAU); ctx.fill();
  }
  if (S.still) {
    mono(ctx, 'Imola', fit.ox + 4, fit.oy + 8, 11, COL.cream, 0.5);
    return;
  }
  const fT = tr.corners.Tamburello != null ? tr.corners.Tamburello : 0.12;
  const fStop = fT - 0.035;
  const run = range(Math.min(t, F.freeze), F.carStart, F.freeze);
  const head = lerp(-0.42, fStop, run);
  if (t >= F.carStart) {
    trail(ctx, tr, fit, head, 0.14, COL.yellow, 0.9, w * 0.85);
    const p = trackPt(tr, head, fit);
    glow(ctx, p[0], p[1], 40, COL.yellow, 0.85);
    ctx.fillStyle = rgba([255, 246, 200]);
    ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(2.5, w * 0.5), 0, TAU); ctx.fill();
  }
  const la = range(t, 0.05, 0.12);
  mono(ctx, head < 0 ? 'Lap 6' : 'Lap 7', fb.x + 4, fb.y + 12, 12, COL.cream, 0.7 * la);
  // freeze: colour drains to grey, then a slow fade to black
  const drain = smooth(range(t, F.freeze, F.drainEnd));
  if (drain > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = `rgba(128,128,128,${drain})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.fillStyle = `rgba(20,20,20,${0.25 * drain})`;
    ctx.fillRect(0, 0, W, H);
  }
  const blk = smooth(range(t, F.black0, F.black1));
  if (blk > 0) { ctx.fillStyle = `rgba(0,0,0,${blk})`; ctx.fillRect(0, 0, W, H); }
}

const SCENES = {
  dawn: sDawn, blueprint: sBlueprint, arc: sArc, rain: sRain, bands: sBands, globe: sGlobe, titles: sTitles,
  lights: sLights, estoril: sEstoril, tunnel: sTunnel, crowns: sCrowns, home: sHome, donington: sDonington, imola: sImola,
};

/* ───────────────────────── Transitions ───────────────────────── */

function composite(ctx, type, A, B, m, W, H, dpr, color, fb) {
  const e = easeInOut(m);
  const cw = W * dpr, ch = H * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  const canFilter = 'filter' in ctx;
  if (type === 'wipe') {
    ctx.drawImage(A, -e * 60 * dpr, 0);
    const slant = ch * 0.3;
    const x = lerp(cw + slant, -slant, e);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(cw + slant, 0); ctx.lineTo(cw + slant, ch); ctx.lineTo(x - slant, ch); ctx.closePath();
    ctx.clip();
    ctx.drawImage(B, (1 - e) * 60 * dpr, 0);
    ctx.restore();
    ctx.strokeStyle = rgba(COL.yellow, 0.9 * Math.sin(Math.PI * e));
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - slant, ch); ctx.stroke();
  } else if (type === 'zoom') {
    const drawScaled = (img, s, a, blur) => {
      ctx.save();
      ctx.globalAlpha = a;
      if (canFilter && blur > 0.5) ctx.filter = `blur(${blur * dpr}px)`;
      ctx.translate(cw / 2, ch / 2); ctx.scale(s, s); ctx.translate(-cw / 2, -ch / 2);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    };
    drawScaled(A, 1 + 0.35 * e, 1, e * 14);
    drawScaled(B, 0.86 + 0.14 * e, e, (1 - e) * 14);
  } else if (type === 'iris') {
    ctx.drawImage(A, 0, 0);
    const cx = (fb.x + fb.w / 2) * dpr, cy = (fb.y + fb.h / 2) * dpr;
    const r = e * Math.hypot(cw, ch);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
    ctx.drawImage(B, 0, 0);
    ctx.restore();
    ctx.strokeStyle = rgba(COL.cream, 0.6 * (1 - e));
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  } else {
    ctx.drawImage(A, 0, 0);
    ctx.globalAlpha = e;
    ctx.drawImage(B, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = rgba(color || COL.ink, 0.75 * Math.sin(Math.PI * m));
    ctx.fillRect(0, 0, cw, ch);
  }
}

/* ───────────────────────── Markup ───────────────────────── */

function buildMarkup(section, staticMode) {
  const pad = (n) => String(n + 1).padStart(2, '0');
  const items = CHAPTERS.map((c, i) => `
    <li class="st-ch${c.finale ? ' st-ch--finale' : ''}${c.long ? ' st-ch--long' : ''}" data-i="${i}">
      ${staticMode ? `<canvas class="st-still" aria-hidden="true"></canvas>` : ''}
      <div class="st-text">
        <p class="st-meta"><span class="st-line"><span class="st-li"><span class="st-num">${pad(i)}</span> ${esc(c.meta)}</span></span></p>
        <p class="st-year" aria-hidden="false"><span class="st-line"><span class="st-li">${esc(c.year)}</span></span></p>
        <h3 class="st-title" data-split>${esc(c.title)}</h3>
        <p class="st-copy" data-split>${esc(c.copy)}</p>
      </div>
      ${c.finale ? `<div class="st-coda">${CODA.map((l) => `<p class="${l.cls}"><span class="st-line"><span class="st-li">${esc(l.text)}</span></span></p>`).join('')}</div>` : ''}
    </li>`).join('');
  section.innerHTML = `
    <div class="st-inner">
      ${staticMode ? '' : '<canvas class="st-gl" aria-hidden="true"></canvas><canvas class="st-canvas" aria-hidden="true"></canvas><div class="st-shade" aria-hidden="true"></div>'}
      <ol class="st-chapters">${items}</ol>
      ${staticMode ? '' : '<div class="st-rail" aria-hidden="true"><i class="st-rail__fill"></i></div>'}
    </div>`;
}

function splitLines(el) {
  const text = el.dataset.text || el.textContent;
  el.dataset.text = text;
  const words = text.split(/\s+/).filter(Boolean);
  el.innerHTML = words.map((w) => `<span class="st-wtmp">${esc(w)}</span>`).join(' ');
  const spans = [...el.querySelectorAll('.st-wtmp')];
  const lines = [];
  let top = null;
  spans.forEach((s, i) => {
    const y = s.offsetTop;
    if (top === null || Math.abs(y - top) > 3) { lines.push([]); top = y; }
    lines[lines.length - 1].push(words[i]);
  });
  el.innerHTML = lines.map((l) => `<span class="st-line"><span class="st-li">${esc(l.join(' '))}</span></span>`).join(' ');
}

/* ───────────────────────── Static (reduced motion) ───────────────────────── */

function drawStills(section) {
  sampleTracks();
  section.querySelectorAll('.st-ch').forEach((li, i) => {
    const cv = li.querySelector('.st-still');
    if (!cv) return;
    const c = CHAPTERS[i];
    const W = Math.max(200, cv.clientWidth || 600);
    const H = Math.max(120, cv.clientHeight || Math.round(W * 0.56));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const S = { time: 0, vel: 0, portrait: false, still: true, fb: { x: W * 0.06, y: H * 0.08, w: W * 0.88, h: H * 0.84 } };
    try { SCENES[c.scene](ctx, W, H, c.still, S); } catch (e) { /* a still is decorative */ }
  });
}

/* ───────────────────────── Init ───────────────────────── */

export function initStory(section, { gsap, ScrollTrigger, reducedMotion = false, getVelocity = () => 0 } = {}) {
  if (!section) return { destroy() {} };
  section.classList.add('story');
  const staticMode = reducedMotion || !gsap || !ScrollTrigger;
  section.classList.toggle('st--static', staticMode);
  buildMarkup(section, staticMode);
  const cleanup = [];

  const chapters = [...section.querySelectorAll('.st-ch')];
  const splitAll = () => section.querySelectorAll('[data-split]').forEach(splitLines);

  if (staticMode) {
    const redraw = () => drawStills(section);
    redraw();
    let to = 0;
    const onR = () => { clearTimeout(to); to = setTimeout(redraw, 150); };
    window.addEventListener('resize', onR);
    cleanup.push(() => window.removeEventListener('resize', onR));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw).catch(() => {});
    return {
      destroy() { cleanup.forEach((f) => f()); section.innerHTML = ''; section.classList.remove('st--static'); },
    };
  }

  sampleTracks();
  const inner = section.querySelector('.st-inner');
  const canvas = section.querySelector('.st-canvas');
  const ctx = canvas.getContext('2d');
  const rail = section.querySelector('.st-rail');
  const railFill = rail.querySelector('.st-rail__fill');
  const bufA = document.createElement('canvas');
  const bufB = document.createElement('canvas');
  const ctxA = bufA.getContext('2d'), ctxB = bufB.getContext('2d');

  // timeline
  const weights = CHAPTERS.map((c) => c.weight || 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const starts = [];
  weights.reduce((acc, w, i) => { starts[i] = acc; return acc + w; }, 0);

  // rail ticks
  CHAPTERS.forEach((c, i) => {
    const tk = document.createElement('span');
    tk.className = 'st-tick';
    tk.style.top = `${(starts[i] / total) * 100}%`;
    tk.innerHTML = `<b>${esc(c.year.replace(/\s+/g, ' '))}</b>`;
    rail.appendChild(tk);
  });
  const ticks = [...rail.querySelectorAll('.st-tick')];

  // lines per chapter
  let chLines = [];
  const collect = () => {
    chLines = chapters.map((li) => ({
      text: [...li.querySelectorAll('.st-text .st-li')],
      coda: [...li.querySelectorAll('.st-coda .st-li')],
    }));
  };
  splitAll();
  collect();

  const view = { W: 0, H: 0, dpr: 1 };
  // WebGL renderer (js/story3d.js) loads asynchronously; until then — or if
  // WebGL / three is unavailable — the 2D canvas scenes render instead.
  let gl3d = null;
  const glCanvas = section.querySelector('.st-gl');
  let dead = false;
  const S = { time: 0, vel: 0, fb: { x: 0, y: 0, w: 0, h: 0 }, portrait: false, still: false };
  const resize = () => {
    const W = inner.clientWidth || window.innerWidth;
    const H = inner.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.W = W; view.H = H; view.dpr = dpr;
    for (const c of [canvas, bufA, bufB]) {
      const small = gl3d && c !== canvas;
      c.width = small ? 1 : Math.round(W * dpr); c.height = small ? 1 : Math.round(H * dpr);
    }
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    if (gl3d) gl3d.resize(W, H, window.devicePixelRatio || 1);
    const mobile = W <= 820;
    S.portrait = mobile || H > W;
    S.fb = S.portrait
      ? { x: W * 0.06, y: H * 0.1, w: W * 0.88, h: H * 0.46 }
      : { x: W * 0.4, y: H * 0.12, w: W * 0.54, h: H * 0.76 };
    splitAll();
    collect();
    lastActive.clear();
  };

  const state = { p: 0 };
  const tween = gsap.to(state, {
    p: 1,
    ease: 'none',
    scrollTrigger: { trigger: section, start: 'top top', end: 'bottom bottom', scrub: true, invalidateOnRefresh: true },
  });

  const lastActive = new Set();
  const setLine = (el, y, a) => {
    el.style.transform = `translate3d(0,${y.toFixed(2)}%,0)`;
    el.style.opacity = a.toFixed(3);
  };

  function updateText(p) {
    const pos = p * total;
    const now = new Set();
    chapters.forEach((li, i) => {
      const t = (pos - starts[i]) / weights[i];
      const fin = CHAPTERS[i].finale;
      const visible = fin ? t > -0.05 : t > -0.05 && t < 1.05;
      if (!visible && !lastActive.has(i)) return;
      if (visible) now.add(i);
      const L = chLines[i];
      const a0 = i === 0 ? -0.02 : 0.04;
      const o0 = fin ? 0.44 : 0.8;
      L.text.forEach((el, k) => {
        const inn = easeOut(range(t, a0 + k * 0.028, a0 + k * 0.028 + 0.14));
        const out = smooth(range(t, o0 + k * 0.012, o0 + k * 0.012 + (fin ? 0.12 : 0.08)));
        setLine(el, (1 - inn) * 110 - out * 110, inn * (1 - out));
      });
      L.coda.forEach((el, k) => {
        const a = smooth(range(t, F.coda[k], F.coda[k] + 0.04));
        setLine(el, (1 - a) * 18, a);
      });
      li.classList.toggle('is-active', visible);
    });
    lastActive.clear();
    now.forEach((i) => lastActive.add(i));
  }

  let active = -1;
  function frame(dt) {
    const p = clamp(state.p);
    const pos = Math.min(p * total, total - 1e-6);
    let i = 0;
    while (i < CHAPTERS.length - 1 && pos >= starts[i + 1]) i++;
    const t = (pos - starts[i]) / weights[i];
    const ch = CHAPTERS[i];
    const frozen = ch.finale && t >= F.freeze;
    const targetVel = ch.finale ? 0 : clamp(getVelocity() || 0, -1, 1);
    S.vel += (targetVel - S.vel) * Math.min(1, dt * 5);
    if (ch.finale) S.vel *= 0.9;
    if (!frozen) S.time += dt;

    const { W, H, dpr } = view;
    if (gl3d) {
      const next = !ch.finale && CHAPTERS[i + 1];
      const m = next && t > 1 - TW ? (t - (1 - TW)) / TW : 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      try {
        gl3d.render({ key: ch.scene, t, nextKey: next ? next.scene : null, m, tr: ch.tr, trColor: ch.trColor, S, dt, hud: ctx });
      } catch (e) {
        console.warn('[story] webgl render failed, falling back to 2D', e);
        try { gl3d.dispose(); } catch (e2) { /* ignore */ }
        gl3d = null; section.classList.remove('st--gl'); resize();
      }
    }
    const draw = (c, sceneKey, tt) => {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      SCENES[sceneKey](c, W, H, tt, S);
    };
    if (gl3d) { /* rendered above */ } else if (!ch.finale && t > 1 - TW && CHAPTERS[i + 1]) {
      const m = (t - (1 - TW)) / TW;
      draw(ctxA, ch.scene, t);
      draw(ctxB, CHAPTERS[i + 1].scene, 0);
      composite(ctx, ch.tr, bufA, bufB, m, W, H, dpr, ch.trColor, S.fb);
    } else {
      draw(ctx, ch.scene, t);
    }

    updateText(p);
    if (active !== i) {
      ticks.forEach((tk, k) => tk.classList.toggle('is-on', k === i));
      ticks.forEach((tk, k) => tk.classList.toggle('is-past', k < i));
      active = i;
    }
    railFill.style.transform = `scaleY(${p.toFixed(4)})`;
    rail.style.opacity = ch.finale ? String(1 - range(t, 0.4, 0.55)) : '';
  }

  // loop only while on screen
  let raf = 0, last = 0, onScreen = false;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    frame(dt);
  };
  const start = () => { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
  const io = new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting);
    onScreen ? start() : stop();
  }, { rootMargin: '10% 0px' });
  io.observe(section);

  let rto = 0;
  const onResize = () => { clearTimeout(rto); rto = setTimeout(() => { resize(); frame(0); }, 120); };
  window.addEventListener('resize', onResize);
  const onVis = () => { if (document.hidden) stop(); else if (onScreen) start(); };
  document.addEventListener('visibilitychange', onVis);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { resize(); frame(0); }).catch(() => {});

  resize();
  frame(0);
  ScrollTrigger.refresh();

  import('./story3d.js')
    .then((mod) => mod.createStory3D({ canvas: glCanvas, tracks: TRACKS, mobile: window.innerWidth <= 820, finale: F }))
    .then((r) => {
      if (dead) { r.dispose(); return; }
      gl3d = r;
      section.classList.add('st--gl');
      resize();
      frame(0);
    })
    .catch((e) => { console.warn('[story] WebGL scenes unavailable, using 2D', e); if (glCanvas) glCanvas.remove(); });

  return {
    destroy() {
      dead = true;
      stop();
      if (gl3d) { try { gl3d.dispose(); } catch (e) { /* ignore */ } gl3d = null; }
      io.disconnect();
      clearTimeout(rto);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      if (tween.scrollTrigger) tween.scrollTrigger.kill();
      tween.kill();
      section.innerHTML = '';
      section.classList.remove('st--static');
    },
  };
}

export default initStory;
