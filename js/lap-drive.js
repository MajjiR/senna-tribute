// "Hold to drive the lap" — an interactive circuit replay.
//
// Original, unofficial fan-tribute component. Hold the button, hold the map,
// or hold Space / Enter while focused to apply throttle; release to brake.
// Speed is limited by the curvature of the circuit outline, so the lap reads
// like a lap: quick on the straights, patient through the hairpins. The lap
// timer is a scaled, fictional "replay" clock, not a real lap time.
//
//   import { createLapDrive } from './lap-drive.js';
//   const lap = createLapDrive(el, { circuitId: 'estoril', wet: true, finish: {...} });
//   lap.setActive(false); lap.reset(); lap.destroy();

import { CIRCUITS } from './circuits.js';

const NS = 'http://www.w3.org/2000/svg';
const N = 600;                 // samples along the path
const TARGET_LAP = 7.4;        // seconds of held throttle for one lap
const REPLAY_SCALE = 10.6;     // replay clock = held seconds x this
const KMH_TOP = 318;           // fictional readout at top speed

// Simulation units: path units (viewBox px) and "sim seconds". The whole sim is
// rescaled after calibration so a held lap lasts TARGET_LAP real seconds.
const VTOP = 900;
const VMIN = 140;
const ALAT = 1650;             // lateral grip: v = sqrt(ALAT * radius)
const ABRAKE = 2600;           // braking used for the look-ahead profile
const ACC = 1500;              // throttle acceleration (falls off with speed)
const COAST = 1900;            // deceleration when released

let uid = 0;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapAng = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};
const h = (tag, cls, parent, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
};
const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(2)}`;
};
function luminance(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return 0.5;
  let s = m[1];
  if (s.length === 3) s = s.replace(/./g, (c) => c + c);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function createLapDrive(container, {
  circuitId,
  wet = false,
  accent = '#ffdf00',
  theme = 'light',
  finish = {},
  reducedMotion = false,
} = {}) {
  const C = CIRCUITS[circuitId];
  if (!container || !C) throw new Error(`createLapDrive: unknown circuit "${circuitId}"`);
  const id = `ld${++uid}`;
  const fin = { kicker: '', title: '', result: '', note: '', ...finish };

  // ---------- DOM ----------
  const root = h('div', `ld ld--${theme === 'dark' ? 'dark' : 'light'}`);
  if (wet) root.classList.add('ld--wet');
  if (reducedMotion) root.classList.add('ld--reduced');
  if (theme !== 'dark' && luminance(accent) > 0.6) root.classList.add('ld--accent-pale');
  root.style.setProperty('--ld-accent', accent);
  root.tabIndex = 0;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-roledescription', 'interactive lap');
  root.setAttribute(
    'aria-label',
    reducedMotion
      ? `Lap of ${C.name}. Press Space to show the finish.`
      : `Interactive lap of ${C.name}. Hold Space to drive.`,
  );

  const stage = h('div', 'ld-stage', root);
  const shake = h('div', 'ld-shake', stage);

  const svg = el('svg', {
    class: 'ld-svg', viewBox: C.viewBox, 'aria-hidden': 'true', focusable: 'false',
    preserveAspectRatio: 'xMidYMid meet',
  }, shake);
  const defs = el('defs', {}, svg);
  const fGlow = el('filter', { id: `${id}-glow`, x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
  el('feGaussianBlur', { stdDeviation: '7' }, fGlow);
  const fBlur = el('filter', { id: `${id}-blur`, x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
  el('feGaussianBlur', { stdDeviation: '2.4' }, fBlur);
  const fCar = el('filter', { id: `${id}-car`, x: '-200%', y: '-200%', width: '500%', height: '500%' }, defs);
  el('feGaussianBlur', { stdDeviation: '6' }, fCar);

  const P = (cls, extra = {}) => el('path', { d: C.d, class: cls, fill: 'none', ...extra }, svg);
  const ghost = P('ld-ghost');
  const ghostHi = P('ld-ghost-hi');
  const driveUnder = P('ld-drive-under');
  const driveGlow = P('ld-drive-glow', { filter: `url(#${id}-glow)` });
  const drive = P('ld-drive');
  const trailG = el('g', { class: 'ld-trail', filter: `url(#${id}-blur)` }, svg);
  const trails = [0.28, 0.5, 0.9].map((o, i) =>
    el('path', { d: C.d, fill: 'none', class: `ld-trail-${i}`, 'stroke-opacity': o }, trailG));

  const L = ghost.getTotalLength();
  const ds = L / N;

  // start line + sector ticks
  const trackTick = (s, cls, half) => {
    const p0 = ghost.getPointAtLength(((s % L) + L) % L);
    const p1 = ghost.getPointAtLength(Math.min(L, s + 2));
    const a = Math.atan2(p1.y - p0.y, p1.x - p0.x) + Math.PI / 2;
    const dx = Math.cos(a) * half;
    const dy = Math.sin(a) * half;
    el('line', {
      class: cls, x1: p0.x - dx, y1: p0.y - dy, x2: p0.x + dx, y2: p0.y + dy,
    }, svg);
  };
  trackTick(L / 3, 'ld-sector-tick', 9);
  trackTick((2 * L) / 3, 'ld-sector-tick', 9);
  trackTick(0, 'ld-start', 16);

  // corner labels
  const labelG = el('g', { class: 'ld-corners' }, svg);
  const corners = (C.corners || []).map((k) => {
    const t = el('text', {
      x: k.x, y: k.y, 'text-anchor': k.anchor || 'middle', class: 'ld-corner',
    }, labelG);
    t.textContent = k.name;
    return { node: t, x: k.x, y: k.y, s: 0, shown: false };
  });

  // car
  const car = el('g', { class: 'ld-car' }, svg);
  el('ellipse', { cx: 0, cy: 0, rx: 22, ry: 11, class: 'ld-car-glow', filter: `url(#${id}-car)` }, car);
  el('rect', { x: -13, y: -5, width: 26, height: 10, rx: 5, class: 'ld-car-body' }, car);
  el('rect', { x: 2, y: -2, width: 7, height: 4, rx: 2, class: 'ld-car-core' }, car);

  // rain / spray canvas
  let canvas = null;
  let ctx = null;
  if (wet) {
    canvas = h('canvas', 'ld-rain', shake);
    canvas.setAttribute('aria-hidden', 'true');
    ctx = canvas.getContext('2d');
  }

  // HUD
  const hud = h('div', 'ld-hud', stage);
  hud.setAttribute('aria-hidden', 'true');
  const hudRow1 = h('div', 'ld-hud-row', hud);
  h('span', 'ld-hud-label', hudRow1, 'Replay');
  const hudTime = h('span', 'ld-hud-time', hudRow1, '0:00.00');
  const hudRow2 = h('div', 'ld-hud-row', hud);
  const speedBar = h('span', 'ld-speed', hudRow2);
  const speedFill = h('span', 'ld-speed-fill', speedBar);
  const hudKmh = h('span', 'ld-hud-kmh', hudRow2, '000');
  const hudRow3 = h('div', 'ld-hud-row ld-sectors', hud);
  const sectors = [1, 2, 3].map((n) => h('span', 'ld-sector', hudRow3, `S${n}`));
  h('div', 'ld-hud-note', hud, wet ? 'Scaled replay · wet' : 'Scaled replay');

  const tag = h('div', 'ld-tag', stage);
  tag.setAttribute('aria-hidden', 'true');
  tag.textContent = C.name;

  // flag wipe + flash + finish card
  const flag = h('div', 'ld-flag', stage);
  flag.setAttribute('aria-hidden', 'true');
  const flash = h('div', 'ld-flash', stage);
  flash.setAttribute('aria-hidden', 'true');

  const card = h('div', 'ld-card', stage);
  card.hidden = true;
  const cardIn = h('div', 'ld-card-in', card);
  if (fin.kicker) h('p', 'ld-card-kicker', cardIn, fin.kicker);
  if (fin.title) h('p', 'ld-card-title', cardIn, fin.title);
  if (fin.result) h('p', 'ld-card-result', cardIn, fin.result);
  if (fin.note) h('p', 'ld-card-note', cardIn, fin.note);
  const again = h('button', 'ld-again', cardIn, reducedMotion ? 'Back to the track' : 'Drive again');
  again.type = 'button';

  const btn = h('button', 'ld-btn', stage);
  btn.type = 'button';
  const btnDot = h('span', 'ld-btn-dot', btn);
  btnDot.setAttribute('aria-hidden', 'true');
  const btnLabel = h('span', 'ld-btn-label', btn, reducedMotion ? 'Show the finish' : 'Hold to drive');
  if (reducedMotion) btn.setAttribute('aria-pressed', 'false');

  const live = h('div', 'ld-live', root);
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');

  container.appendChild(root);

  // ---------- precompute samples / curvature / speed profile ----------
  const px = new Float32Array(N);
  const py = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const p = ghost.getPointAtLength(i * ds);
    px[i] = p.x;
    py[i] = p.y;
  }
  const head = new Float32Array(N); // heading of segment i -> i+1
  const ang = new Float32Array(N);  // central tangent at sample i
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const k = (i - 1 + N) % N;
    head[i] = Math.atan2(py[j] - py[i], px[j] - px[i]);
    ang[i] = Math.atan2(py[j] - py[k], px[j] - px[k]);
  }
  const kRaw = new Float32Array(N);
  for (let i = 0; i < N; i++) kRaw[i] = Math.abs(wrapAng(head[i] - head[(i - 1 + N) % N])) / ds;
  const W = 4;
  const vlim = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let o = -W; o <= W; o++) s += kRaw[(i + o + N) % N];
    const k = s / (2 * W + 1);
    vlim[i] = clamp(k > 1e-6 ? Math.sqrt(ALAT / k) : VTOP, VMIN, VTOP);
  }
  // braking look-ahead (circular, two passes)
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const j = (i + 1) % N;
      const v = Math.sqrt(vlim[j] * vlim[j] + 2 * ABRAKE * ds);
      if (v < vlim[i]) vlim[i] = v;
    }
  }
  const limAt = (d) => {
    const f = (((d % L) + L) % L) / ds;
    const i = Math.floor(f) % N;
    const t = f - Math.floor(f);
    return vlim[i] + (vlim[(i + 1) % N] - vlim[i]) * t;
  };
  for (const c of corners) {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < N; i++) {
      const dd = (px[i] - c.x) ** 2 + (py[i] - c.y) ** 2;
      if (dd < bd) { bd = dd; best = i; }
    }
    c.s = best * ds;
  }

  function simStep(st, dt, throttle) {
    if (throttle) st.v += ACC * (1 - 0.6 * (st.v / VTOP)) * dt;
    else st.v -= COAST * dt;
    if (st.v < 0) st.v = 0;
    const lim = limAt(st.d);
    if (st.v > lim) st.v = lim;
    st.d += st.v * dt;
  }
  // calibrate: how long a fully-held lap takes in sim seconds
  const cal = { d: 0, v: 0 };
  let simT = 0;
  while (cal.d < L && simT < 120) { simStep(cal, 1 / 240, true); simT += 1 / 240; }
  const timeScale = simT / TARGET_LAP; // sim seconds per real second

  // ---------- state ----------
  let d = 0;            // distance driven (unwrapped)
  let v = 0;
  let held = 0;         // real seconds of motion (replay clock)
  let throttle = false;
  let source = null;    // 'btn' | 'map' | 'key'
  let finished = false;
  let cardOpen = false; // reduced-motion toggle
  let active = true;
  let raf = 0;
  let last = 0;
  let pending = null;   // touch long-press on map
  let focusTimer = 0;
  let particles = [];
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };

  // rain drops (normalised coordinates)
  const drops = wet ? Array.from({ length: 110 }, () => ({
    x: Math.random() * 1.3 - 0.15, y: Math.random(), l: 0.03 + Math.random() * 0.05, s: 0.9 + Math.random() * 0.8,
  })) : [];
  let cw = 0;
  let chh = 0;
  let dpr = 1;
  let ro = null;
  const map = { k: 1, ox: 0, oy: 0 }; // viewBox -> canvas css px
  if (wet) {
    const size = () => {
      const r = stage.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cw = Math.max(1, Math.round(r.width));
      chh = Math.max(1, Math.round(r.height));
      canvas.width = cw * dpr;
      canvas.height = chh * dpr;
      const sr = svg.getBoundingClientRect();
      const bw = sr.width / (r.width || 1) * cw;
      const bh = sr.height / (r.height || 1) * chh;
      map.k = Math.min(bw / 1000, bh / 700);
      map.ox = (sr.left - r.left) / (r.width || 1) * cw + (bw - 1000 * map.k) / 2;
      map.oy = (sr.top - r.top) / (r.height || 1) * chh + (bh - 700 * map.k) / 2;
      drawWet(0, 0);
    };
    ro = new ResizeObserver(size);
    ro.observe(stage);
  }

  // ---------- render ----------
  const posAt = (dd) => {
    const f = (((dd % L) + L) % L) / ds;
    const i = Math.floor(f) % N;
    const j = (i + 1) % N;
    const t = f - Math.floor(f);
    return {
      x: px[i] + (px[j] - px[i]) * t,
      y: py[i] + (py[j] - py[i]) * t,
      a: ang[i] + wrapAng(ang[j] - ang[i]) * t,
    };
  };

  function render() {
    const s = ((d % L) + L) % L;
    const p = posAt(d);
    const f = v / VTOP;
    car.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${(p.a * 180 / Math.PI).toFixed(2)})`);

    const done = finished || reducedMotion ? L : Math.min(d, L);
    const dash = `${done.toFixed(1)} ${(L + 20).toFixed(1)}`;
    drive.setAttribute('stroke-dasharray', dash);
    driveGlow.setAttribute('stroke-dasharray', dash);
    driveUnder.setAttribute('stroke-dasharray', dash);

    const w = 34;
    ghostHi.setAttribute('stroke-dasharray', `${2 * w} ${L}`);
    ghostHi.setAttribute('stroke-dashoffset', (w - s).toFixed(1));
    ghostHi.style.opacity = reducedMotion ? 0 : (0.35 + 0.65 * f).toFixed(3);

    const tl = [150, 85, 36];
    trails.forEach((t, i) => {
      const len = Math.max(0.01, tl[i] * f);
      t.setAttribute('stroke-dasharray', `${len.toFixed(1)} ${L}`);
      t.setAttribute('stroke-dashoffset', (len - s).toFixed(1));
    });

    hudTime.textContent = fmtTime(held * REPLAY_SCALE);
    speedFill.style.transform = `scaleX(${f.toFixed(3)})`;
    hudKmh.textContent = String(Math.round(f * KMH_TOP)).padStart(3, '0');
    const sec = finished || reducedMotion ? 3 : Math.floor(Math.min(d, L - 1e-3) / (L / 3));
    sectors.forEach((n, i) => {
      n.classList.toggle('is-done', i < sec);
      n.classList.toggle('is-live', i === sec && d > 0 && !finished);
    });

    if (!reducedMotion && !finished) {
      for (const c of corners) {
        if (!c.shown && d >= c.s - 70 && d < c.s + 200) {
          c.shown = true;
          c.node.classList.add('is-on');
        }
      }
    }

    if (!reducedMotion && f > 0.62) {
      const k = (f - 0.62) / 0.38;
      const amp = k * k * 1.4;
      const sc = 1 + 0.014 * k;
      shake.style.transform = `translate3d(${((Math.random() - 0.5) * amp).toFixed(2)}px, ${((Math.random() - 0.5) * amp).toFixed(2)}px, 0) scale(${sc.toFixed(4)})`;
    } else if (shake.style.transform) {
      shake.style.transform = '';
    }
  }

  function drawWet(dt, f) {
    if (!ctx) return;
    const dark = theme === 'dark';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, chh);
    const inten = 0.3 + 0.7 * f;
    const n = Math.round(drops.length * (0.45 + 0.55 * f));
    const slant = 0.28 + 0.25 * f;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1;
    ctx.strokeStyle = dark ? `rgba(243,239,228,${(0.16 + 0.22 * inten).toFixed(3)})` : `rgba(11,31,75,${(0.12 + 0.2 * inten).toFixed(3)})`;
    ctx.beginPath();
    for (let i = 0; i < drops.length; i++) {
      const r = drops[i];
      if (dt) {
        r.y += r.s * dt * (0.9 + 1.6 * f);
        r.x -= r.s * dt * slant * (0.9 + 1.6 * f) * (chh / cw);
        if (r.y > 1.05 || r.x < -0.2) { r.y = -0.08 - Math.random() * 0.1; r.x = Math.random() * 1.35 - 0.1; }
      }
      if (i >= n) continue;
      const x = r.x * cw;
      const y = r.y * chh;
      const len = r.l * chh * (0.8 + 0.8 * f);
      ctx.moveTo(x, y);
      ctx.lineTo(x - len * slant, y + len);
    }
    ctx.stroke();

    // spray
    if (particles.length) {
      const k = map.k;
      ctx.fillStyle = dark ? 'rgb(243,239,228)' : 'rgb(11,31,75)';
      for (const q of particles) {
        ctx.globalAlpha = Math.max(0, q.life / q.max) * 0.42;
        ctx.beginPath();
        ctx.arc(map.ox + q.x * k, map.oy + q.y * k, q.r * k * (1.6 - q.life / q.max), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function updateSpray(dt, f) {
    if (!wet) return;
    for (const q of particles) {
      q.life -= dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= 0.94;
      q.vy *= 0.94;
    }
    particles = particles.filter((q) => q.life > 0);
    if (f > 0.12) {
      const p = posAt(d);
      const cx = Math.cos(p.a);
      const cy = Math.sin(p.a);
      const nEmit = Math.min(6, Math.round(f * 3 + Math.random() * f * 3));
      for (let i = 0; i < nEmit; i++) {
        const side = Math.random() - 0.5;
        const sp = 60 + Math.random() * 140 * f;
        particles.push({
          x: p.x - cx * 14 - cy * side * 10,
          y: p.y - cy * 14 + cx * side * 10,
          vx: -cx * sp + (Math.random() - 0.5) * 70,
          vy: -cy * sp + (Math.random() - 0.5) * 70,
          r: 1.5 + Math.random() * 2.5,
          life: 0.35 + Math.random() * 0.35,
          max: 0.7,
        });
      }
      if (particles.length > 240) particles.splice(0, particles.length - 240);
    }
  }

  // ---------- loop ----------
  function tick(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const sub = (dt * timeScale) / steps;
    const st = { d, v };
    for (let i = 0; i < steps; i++) simStep(st, sub, throttle && !finished);
    d = st.d;
    v = st.v;
    if (v > 0.5 && !finished) held += dt;
    if (!finished && d >= L) crossLine();
    const f = v / VTOP;
    updateSpray(dt, f);
    render();
    drawWet(dt, f);
    if (active && (throttle || v > 0.5 || particles.length)) {
      raf = requestAnimationFrame(tick);
    } else {
      v = v > 0.5 ? v : 0;
      if (!v) { root.classList.remove('is-moving'); shake.style.transform = ''; }
    }
  }
  function kick() {
    if (raf || !active || reducedMotion) return;
    last = performance.now();
    root.classList.add('is-moving');
    raf = requestAnimationFrame(tick);
  }
  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function setThrottle(on, src) {
    if (reducedMotion) return;
    if (on) {
      if (finished) return;
      throttle = true;
      source = src;
      root.classList.add('is-driving');
      kick();
    } else {
      if (src && source && src !== source) return;
      throttle = false;
      source = null;
      root.classList.remove('is-driving');
    }
  }

  // ---------- finish ----------
  function buildFlag() {
    flag.textContent = '';
    const cols = 20;
    for (let i = 0; i < cols; i++) {
      const c = h('span', 'ld-flag-col', flag);
      c.style.setProperty('--i', i);
    }
  }
  function announce() {
    live.textContent = '';
    later(() => {
      live.textContent = [`${C.name}: lap complete.`, fin.title, fin.kicker, fin.result, fin.note]
        .filter(Boolean).join('. ').replace(/\.\./g, '.');
    }, 60);
  }
  function crossLine() {
    finished = true;
    throttle = false;
    source = null;
    root.classList.remove('is-driving');
    root.classList.add('is-finished');
    buildFlag();
    card.hidden = false;
    btn.hidden = true;
    announce();
    clearTimeout(focusTimer);
    focusTimer = later(() => {
      if (root.contains(document.activeElement)) again.focus({ preventScroll: true });
    }, 1100);
  }
  function toggleCard(open = !cardOpen) {
    cardOpen = open;
    card.hidden = !open;
    root.classList.toggle('is-finished', open);
    btn.setAttribute('aria-pressed', String(open));
    btnLabel.textContent = open ? 'Hide the finish' : 'Show the finish';
    if (open) announce();
    else live.textContent = '';
  }

  function reset() {
    stopLoop();
    for (const t of timers) clearTimeout(t);
    timers.clear();
    d = 0; v = 0; held = 0;
    throttle = false; source = null; finished = false;
    particles = [];
    if (pending) { clearTimeout(pending.timer); pending = null; }
    root.classList.remove('is-driving', 'is-finished', 'is-moving');
    flag.textContent = '';
    card.hidden = true;
    btn.hidden = false;
    live.textContent = '';
    corners.forEach((c) => { c.shown = false; c.node.classList.remove('is-on'); });
    if (reducedMotion) toggleCard(false);
    render();
    drawWet(0, 0);
  }

  // ---------- input ----------
  const isKey = (e) => e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter';
  function onKeyDown(e) {
    if (!isKey(e) || e.target === again) return;
    e.preventDefault();
    if (e.repeat) return;
    if (reducedMotion) toggleCard();
    else setThrottle(true, 'key');
  }
  function onKeyUp(e) {
    if (!isKey(e) || e.target === again) return;
    e.preventDefault();
    setThrottle(false, 'key');
  }
  function onFocusOut(e) {
    if (!root.contains(e.relatedTarget)) setThrottle(false, 'key');
  }

  function onBtnDown(e) {
    if (reducedMotion || e.button !== 0) return;
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    setThrottle(true, 'btn');
  }
  function onBtnUp() { setThrottle(false, 'btn'); }
  function onBtnClick() { if (reducedMotion) toggleCard(); }

  function onStageDown(e) {
    if (reducedMotion || finished || e.button !== 0) return;
    if (btn.contains(e.target) || card.contains(e.target)) return;
    if (e.pointerType === 'touch') {
      if (pending) clearTimeout(pending.timer);
      const pid = e.pointerId;
      pending = {
        id: pid, x: e.clientX, y: e.clientY,
        timer: setTimeout(() => {
          pending = null;
          try { stage.setPointerCapture(pid); } catch (_) { /* noop */ }
          setThrottle(true, 'map');
        }, 180),
      };
    } else {
      e.preventDefault();
      try { stage.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
      setThrottle(true, 'map');
    }
  }
  function onStageMove(e) {
    if (pending && pending.id === e.pointerId && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 10) {
      clearTimeout(pending.timer);
      pending = null;
    }
  }
  function onStageUp(e) {
    if (pending && pending.id === e.pointerId) { clearTimeout(pending.timer); pending = null; }
    setThrottle(false, 'map');
  }
  function onTouchMove(e) {
    if (source === 'map' && e.cancelable) e.preventDefault();
  }
  const prevent = (e) => e.preventDefault();
  function onWinBlur() { setThrottle(false); }
  function onAgain() {
    reset();
    if (!reducedMotion) root.focus({ preventScroll: true });
    else btn.focus({ preventScroll: true });
  }

  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('keyup', onKeyUp);
  root.addEventListener('focusout', onFocusOut);
  root.addEventListener('contextmenu', prevent);
  root.addEventListener('selectstart', prevent);
  btn.addEventListener('pointerdown', onBtnDown);
  btn.addEventListener('pointerup', onBtnUp);
  btn.addEventListener('pointercancel', onBtnUp);
  btn.addEventListener('lostpointercapture', onBtnUp);
  btn.addEventListener('click', onBtnClick);
  stage.addEventListener('pointerdown', onStageDown);
  stage.addEventListener('pointermove', onStageMove);
  stage.addEventListener('pointerup', onStageUp);
  stage.addEventListener('pointercancel', onStageUp);
  stage.addEventListener('lostpointercapture', onStageUp);
  stage.addEventListener('touchmove', onTouchMove, { passive: false });
  again.addEventListener('click', onAgain);
  window.addEventListener('blur', onWinBlur);

  render();

  return {
    reset,
    setActive(on) {
      active = !!on;
      if (!active) {
        setThrottle(false);
        stopLoop();
      } else if (v > 0.5 || particles.length) {
        kick();
      }
    },
    destroy() {
      stopLoop();
      for (const t of timers) clearTimeout(t);
      if (pending) clearTimeout(pending.timer);
      if (ro) ro.disconnect();
      window.removeEventListener('blur', onWinBlur);
      root.remove();
    },
  };
}
