// hero-scene.js
// Procedural particle form of a generic late-1980s-style open-wheel single-seater,
// plus abstract speed streaks. No external assets, no logos, no livery.
// Two draw calls (Points + LineSegments), no post-processing.

import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Palette (sRGB, written raw to the framebuffer)                      */
/* ------------------------------------------------------------------ */
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const YELLOW = hex(0xffdf00);
const GREEN = hex(0x00a651);
const BLUE = hex(0x1b4fd8);
const NAVY = hex(0x0b1f4b);
const WHITE = hex(0xf3efe4);

const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Car geometry: x = length (nose at +x), y = up (ground 0), z = width */
/* ------------------------------------------------------------------ */
const TAG_BODY = 0;
const TAG_WHEEL = 1;
const TAG_WING = 2;
const TAG_PLATE = 3;
const TAG_DETAIL = 4;
const Y_CENTRE = 0.46; // subtracted so the car is centred on the origin

// Superellipse loft through sections {x, hw, y0, y1, zc?}
function loft(sections, exp, reject) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i];
    const b = sections[i + 1];
    const per = a.hw * 2 + (a.y1 - a.y0) + b.hw * 2 + (b.y1 - b.y0);
    total += Math.abs(a.x - b.x) * per;
    segs.push(total);
  }
  const pw = 2 / exp;
  return (r, out) => {
    for (let tries = 0; tries < 10; tries++) {
      const u = r() * total;
      let k = 0;
      while (k < segs.length - 1 && segs[k] < u) k++;
      const a = sections[k];
      const b = sections[k + 1];
      const t = r();
      const hw = a.hw + (b.hw - a.hw) * t;
      const y0 = a.y0 + (b.y0 - a.y0) * t;
      const y1 = a.y1 + (b.y1 - a.y1) * t;
      const zc = (a.zc || 0) + ((b.zc || 0) - (a.zc || 0)) * t;
      const th = r() * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      out[0] = a.x + (b.x - a.x) * t;
      out[1] = (y0 + y1) * 0.5 + (y1 - y0) * 0.5 * Math.sign(s) * Math.pow(Math.abs(s), pw);
      out[2] = zc + hw * Math.sign(c) * Math.pow(Math.abs(c), pw);
      if (!reject || !reject(out[0], out[1], out[2], (y0 + y1) * 0.5)) return;
    }
  };
}

function box(x0, x1, y0, y1, z0, z1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const axy = dx * dy;
  const axz = dx * dz;
  const ayz = dy * dz;
  const total = axy + axz + ayz;
  return (r, out) => {
    const u = r() * total;
    const side = r() < 0.5 ? 0 : 1;
    const a = r();
    const b = r();
    if (u < axy) {
      out[0] = x0 + dx * a; out[1] = y0 + dy * b; out[2] = z0 + dz * side;
    } else if (u < axy + axz) {
      out[0] = x0 + dx * a; out[1] = y0 + dy * side; out[2] = z0 + dz * b;
    } else {
      out[0] = x0 + dx * side; out[1] = y0 + dy * a; out[2] = z0 + dz * b;
    }
  };
}

// Wheel: cylinder with axis along z. Tread, side walls, recessed rim.
function wheel(cx, cz, R, w) {
  const cy = R;
  const ri = R * 0.48;
  const aTread = 2 * Math.PI * R * w;
  const aSides = 2 * Math.PI * (R * R - ri * ri);
  const aRim = aSides * 0.35;
  const total = aTread + aSides + aRim;
  return (r, out) => {
    const u = r() * total;
    const th = r() * Math.PI * 2;
    let rad;
    let z;
    if (u < aTread) {
      const t = r() - 0.5;
      const shoulder = Math.max(0, Math.abs(t) - 0.38) / 0.12;
      rad = R * (1 - 0.07 * shoulder * shoulder);
      z = cz + t * w;
    } else if (u < aTread + aSides) {
      rad = Math.sqrt(r() * (R * R - ri * ri) + ri * ri);
      z = cz + (r() < 0.5 ? -0.5 : 0.5) * w;
    } else {
      const v = r();
      if (v < 0.5) {
        rad = ri; // rim barrel
        z = cz + (r() - 0.5) * w * 0.9;
      } else {
        rad = ri * Math.sqrt(r()); // hub face, slightly recessed on the outside
        z = cz + Math.sign(cz) * w * 0.3;
      }
    }
    out[0] = cx + Math.cos(th) * rad;
    out[1] = cy + Math.sin(th) * rad;
    out[2] = z;
  };
}

function line(a, b, jitter) {
  return (r, out) => {
    const t = r();
    out[0] = a[0] + (b[0] - a[0]) * t + (r() - 0.5) * jitter;
    out[1] = a[1] + (b[1] - a[1]) * t + (r() - 0.5) * jitter;
    out[2] = a[2] + (b[2] - a[2]) * t + (r() - 0.5) * jitter;
  };
}

function sphere(cx, cy, cz, rad) {
  return (r, out) => {
    const u = r() * 2 - 1;
    const th = r() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    out[0] = cx + rad * s * Math.cos(th);
    out[1] = cy + rad * u;
    out[2] = cz + rad * s * Math.sin(th);
  };
}

function ring(cx, cy, cz, ax, az, jitter) {
  return (r, out) => {
    const th = r() * Math.PI * 2;
    out[0] = cx + Math.cos(th) * ax + (r() - 0.5) * jitter;
    out[1] = cy + (r() - 0.5) * jitter;
    out[2] = cz + Math.sin(th) * az + (r() - 0.5) * jitter;
  };
}

function buildParts() {
  const parts = [];
  const add = (weight, tag, fn) => parts.push({ weight, tag, fn });

  const FRONT_AXLE = 1.36;
  const REAR_AXLE = -1.35;
  const FR = 0.32;
  const RR = 0.36;
  const FW = 0.3;
  const RW = 0.46;
  const TRACK = 0.8;

  // Monocoque + nose cone + gearbox tail, with an open cockpit
  const cockpit = (x, y, z, cy) => {
    if (y <= cy) return false;
    const ex = (x - 0.12) / 0.42;
    const ez = z / 0.19;
    return ex * ex + ez * ez < 1;
  };
  add(0.24, TAG_BODY, loft([
    { x: 2.18, hw: 0.05, y0: 0.13, y1: 0.21 },
    { x: 1.9, hw: 0.1, y0: 0.11, y1: 0.27 },
    { x: 1.45, hw: 0.17, y0: 0.1, y1: 0.36 },
    { x: 0.9, hw: 0.25, y0: 0.08, y1: 0.47 },
    { x: 0.45, hw: 0.3, y0: 0.07, y1: 0.52 },
    { x: -0.3, hw: 0.33, y0: 0.07, y1: 0.56 },
    { x: -0.9, hw: 0.3, y0: 0.07, y1: 0.5 },
    { x: -1.5, hw: 0.2, y0: 0.1, y1: 0.4 },
    { x: -1.85, hw: 0.12, y0: 0.14, y1: 0.32 },
  ], 3.4, cockpit));
  add(0.014, TAG_DETAIL, ring(0.12, 0.525, 0, 0.42, 0.19, 0.012));
  add(0.012, TAG_DETAIL, sphere(-0.05, 0.6, 0, 0.12)); // plain driver head, no design

  // Roll hoop / airbox flowing into the engine cover
  add(0.07, TAG_BODY, loft([
    { x: -0.26, hw: 0.09, y0: 0.5, y1: 0.78 },
    { x: -0.45, hw: 0.13, y0: 0.5, y1: 0.93 },
    { x: -0.8, hw: 0.14, y0: 0.48, y1: 0.84 },
    { x: -1.3, hw: 0.11, y0: 0.42, y1: 0.62 },
    { x: -1.7, hw: 0.07, y0: 0.36, y1: 0.46 },
  ], 2.4));

  for (const s of [1, -1]) {
    // Sidepods with a coke-bottle taper
    add(0.08, TAG_BODY, loft([
      { x: 0.42, hw: 0.14, y0: 0.1, y1: 0.26, zc: 0.5 * s },
      { x: 0.2, hw: 0.19, y0: 0.07, y1: 0.36, zc: 0.53 * s },
      { x: -0.6, hw: 0.2, y0: 0.07, y1: 0.37, zc: 0.53 * s },
      { x: -1.0, hw: 0.13, y0: 0.07, y1: 0.3, zc: 0.44 * s },
      { x: -1.25, hw: 0.07, y0: 0.08, y1: 0.22, zc: 0.36 * s },
    ], 4));
    // Mirrors
    add(0.003, TAG_DETAIL, box(0.47, 0.53, 0.56, 0.61, s * 0.33 - 0.04, s * 0.33 + 0.04));

    // Front wing flap + endplate
    const zi = s > 0 ? 0.14 : -0.7;
    add(0.012, TAG_WING, box(1.72, 1.84, 0.135, 0.165, zi, zi + 0.56));
    add(0.013, TAG_PLATE, box(1.7, 2.1, 0.05, 0.27, s * 0.7 - 0.006, s * 0.7 + 0.006));
    // Rear wing endplate
    add(0.026, TAG_PLATE, box(-2.15, -1.68, 0.3, 0.95, s * 0.5 - 0.006, s * 0.5 + 0.006));

    // Wheels
    add(0.065, TAG_WHEEL, wheel(FRONT_AXLE, s * TRACK, FR, FW));
    add(0.09, TAG_WHEEL, wheel(REAR_AXLE, s * TRACK, RR, RW));

    // Suspension links (front)
    const fh = TRACK - FW / 2;
    const rh = TRACK - RW / 2;
    const L = (a, b) => add(0.0032, TAG_DETAIL, line([a[0], a[1], a[2] * s], [b[0], b[1], b[2] * s], 0.01));
    L([1.58, 0.33, 0.15], [FRONT_AXLE, 0.42, fh]);
    L([1.12, 0.39, 0.21], [FRONT_AXLE, 0.42, fh]);
    L([1.62, 0.14, 0.14], [FRONT_AXLE, 0.18, fh]);
    L([1.08, 0.12, 0.21], [FRONT_AXLE, 0.18, fh]);
    L([FRONT_AXLE, 0.37, 0.18], [FRONT_AXLE, 0.2, fh]);
    // Suspension links (rear) + driveshaft
    L([-1.08, 0.42, 0.24], [REAR_AXLE, 0.48, rh]);
    L([-1.62, 0.34, 0.14], [REAR_AXLE, 0.48, rh]);
    L([-1.05, 0.14, 0.26], [REAR_AXLE, 0.2, rh]);
    L([-1.66, 0.17, 0.12], [REAR_AXLE, 0.2, rh]);
    L([REAR_AXLE, 0.3, 0.14], [REAR_AXLE, 0.36, rh]);
  }

  // Front wing main plane
  add(0.036, TAG_WING, box(1.78, 2.08, 0.09, 0.12, -0.7, 0.7));
  // Rear wing: main element, second element, lower beam
  add(0.032, TAG_WING, box(-2.1, -1.8, 0.88, 0.92, -0.5, 0.5));
  add(0.016, TAG_WING, box(-2.13, -1.96, 0.78, 0.81, -0.5, 0.5));
  add(0.012, TAG_WING, box(-2.02, -1.78, 0.36, 0.39, -0.5, 0.5));

  return parts;
}

function colourFor(x, y, z, tag, r) {
  // x,y,z in uncentred car space (ground y = 0)
  const u = clamp01((x + 2.2) / 4.4); // 0 tail .. 1 nose
  const h = clamp01(y / 0.95);
  const n = r();
  let c;
  if (tag === TAG_WHEEL) {
    c = mix3(NAVY, BLUE, 0.35 + 0.65 * n);
    if (r() < 0.1) c = mix3(c, WHITE, 0.7);
  } else if (tag === TAG_PLATE) {
    c = mix3(BLUE, GREEN, clamp01(h * 0.8 + (n - 0.5) * 0.4));
  } else if (tag === TAG_WING) {
    c = mix3(YELLOW, GREEN, clamp01(Math.abs(z) / 0.7 * 0.8 + (n - 0.5) * 0.3));
  } else if (tag === TAG_DETAIL) {
    c = mix3(WHITE, BLUE, n * 0.5);
    c = [c[0] * 0.75, c[1] * 0.75, c[2] * 0.75];
  } else {
    // Body: blue tail -> green middle -> yellow nose, navy low, lighter on top
    const g = clamp01(u + (n - 0.5) * 0.22);
    c = g < 0.5 ? mix3(BLUE, GREEN, g * 2) : mix3(GREEN, YELLOW, (g - 0.5) * 2);
    c = mix3(c, NAVY, clamp01(0.55 - h * 1.6) * 0.8);
    c = mix3(c, YELLOW, sstep(0.55, 1.0, h) * 0.45);
    if (r() < 0.07) c = mix3(c, WHITE, 0.8);
  }
  return c;
}

/**
 * Sample `count` points on the car surface.
 * Exported for testing only (not part of the page contract).
 */
export function _sampleCar(count, seed = 1988) {
  const r = mulberry32(seed);
  const parts = buildParts();
  let total = 0;
  const cum = parts.map((p) => (total += p.weight));
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const tags = new Uint8Array(count);
  const out = [0, 0, 0];
  let k = 0;
  for (let i = 0; i < count; i++) {
    const u = ((i + 0.5) / count) * total; // stratified -> exact proportional split
    while (k < cum.length - 1 && cum[k] < u) k++;
    const part = parts[k];
    part.fn(r, out);
    const c = colourFor(out[0], out[1], out[2], part.tag, r);
    positions[i * 3] = out[0];
    positions[i * 3 + 1] = out[1] - Y_CENTRE;
    positions[i * 3 + 2] = out[2];
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
    tags[i] = part.tag;
  }
  return { positions, colors, tags };
}

/* ------------------------------------------------------------------ */
/* Shaders                                                             */
/* ------------------------------------------------------------------ */
const CAR_VERT = /* glsl */ `
attribute vec3 aScatter;
attribute vec3 aStream;
attribute vec4 aRand;
attribute vec3 aColor;

uniform float uTime;
uniform float uIntro;
uniform float uSmear;
uniform float uDissolve;
uniform float uVel;
uniform float uVelAbs;
uniform float uSizeK;
uniform float uWorldSize;
uniform float uMinSize;
uniform float uMaxSize;
uniform float uAlpha;
uniform float uMotion;

varying vec3 vColor;
varying float vAlpha;

// Divergence-free (curl-like) trigonometric flow field
vec3 flow(vec3 q, float t) {
  return vec3(
    sin(q.y * 1.7 + t) - cos(q.z * 1.3 - t * 0.8),
    sin(q.z * 1.5 + t * 1.1) - cos(q.x * 1.1 + t * 0.7),
    sin(q.x * 1.9 - t * 0.9) - cos(q.y * 1.4 + t)
  );
}

void main() {
  float t = uTime;
  vec3 c = position;

  // idle shimmer
  c += flow(c * 3.0 + aRand.xyz * 6.2831, t * 0.6) * 0.006 * uMotion;

  // velocity: liquid stretch along the travel axis + turbulence
  float pull = aRand.x * aRand.x;
  c.x = c.x * (1.0 + 0.16 * uVelAbs) - uVel * pull * 1.1;
  c += flow(c * 1.6 + aRand.yzx * 3.0, t * 1.3) * uVelAbs * (0.05 + 0.16 * aRand.y);

  // trailing smear behind the car (-x)
  float tr = aRand.z * aRand.z * aRand.z;
  c.x -= uSmear * tr * 1.5;

  // dissolve into horizontal speed lines streaming backwards
  float d = clamp(uDissolve * 1.6 - aRand.w * 0.6, 0.0, 1.0);
  vec3 s = aStream;
  s.z += sin(s.x * 0.7 + t * 0.8 + aRand.x * 6.2831) * 0.05 * uMotion;
  c.yz = mix(c.yz, s.yz, smoothstep(0.0, 0.55, d));
  c.x = mix(c.x, s.x, d * d);

  // intro: scattered drifting field -> assembled
  float i = clamp(uIntro * 1.5 - aRand.y * 0.5, 0.0, 1.0);
  i = i * i * (3.0 - 2.0 * i);
  vec3 sc = aScatter + flow(aScatter * 0.35 + aRand.zxy * 6.2831, t * 0.25) * 0.35 * uMotion;
  vec3 p = mix(sc, c, i);
  p += flow(p * 0.9 + aRand.xyz, t * 0.5) * sin(i * 3.14159265) * 0.22;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float sz = 0.6 + 0.8 * fract(aRand.w * 13.7 + aRand.x * 5.3);
  gl_PointSize = clamp(uWorldSize * sz * uSizeK / max(0.1, -mv.z), uMinSize, uMaxSize);

  float twinkle = 1.0 - 0.25 * uMotion * (0.5 + 0.5 * sin(t * 2.0 + aRand.z * 40.0));
  float a = uAlpha * mix(0.4, 1.0, i) * (1.0 - smoothstep(0.25, 1.0, d)) * twinkle;
  vAlpha = a;
  vColor = aColor;
  if (a < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const CAR_FRAG = /* glsl */ `
uniform float uOcclude;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float d = dot(q, q) * 4.0;
  if (d > 1.0) discard;
  float a = 1.0 - d;
  a = a * a * vAlpha;
  gl_FragColor = vec4(vColor * a, a * uOcclude);
}
`;

const STREAK_VERT = /* glsl */ `
attribute vec4 aSeed;
attribute float aEnd;
attribute vec3 aColor;

uniform float uPhase;
uniform float uLen;
uniform float uDensity;
uniform float uOpacity;
uniform float uSpan;

varying vec3 vColor;
varying float vAlpha;

void main() {
  float sp = 0.5 + floor(aSeed.y * 8.0) * 0.125;
  float hx = uSpan * 0.5 - mod(aSeed.x * uSpan + uPhase * sp, uSpan);
  float len = uLen * (0.35 + aSeed.z);
  vec3 p = vec3(hx + aEnd * len, position.y, position.z);
  float edge = smoothstep(uSpan * 0.5, uSpan * 0.5 - 3.0, abs(hx));
  float on = smoothstep(0.0, 0.08, uDensity - aSeed.w);
  vAlpha = (1.0 - aEnd) * edge * on * uOpacity * (0.35 + 0.65 * aSeed.z);
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const STREAK_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(vColor * vAlpha, vAlpha * 0.08);
}
`;

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */
const STREAK_SPAN = 30;
const FOV = 30;
const CAR_LENGTH = 4.35;

function noopScene() {
  const f = () => {};
  return {
    failed: true,
    setProgress: f, setVelocity: f, setPointer: f, setIntro: f,
    resize: f, start: f, stop: f, renderOnce: f, dispose: f,
  };
}

export function createHeroScene(
  canvas,
  { reducedMotion = false, dpr = Math.min(window.devicePixelRatio, 2) } = {}
) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    });
    if (!renderer.getContext()) throw new Error('no context');
  } catch (e) {
    return noopScene();
  }

  try {
    return build(renderer, canvas, reducedMotion, dpr);
  } catch (e) {
    try { renderer.dispose(); } catch (_) { /* ignore */ }
    return noopScene();
  }
}

function build(renderer, canvas, reducedMotion, dpr) {
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(dpr);

  const w0 = canvas.clientWidth || window.innerWidth || 1;
  const h0 = canvas.clientHeight || window.innerHeight || 1;
  const small = Math.min(w0, h0) < 700;
  const COUNT = small ? 12000 : 32000;
  const STREAKS = small ? 180 : 420;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, w0 / h0, 0.1, 100);
  const group = new THREE.Group();
  scene.add(group);

  /* ---- car particles ---- */
  const { positions, colors } = _sampleCar(COUNT);
  const rnd = mulberry32(7);
  const scatter = new Float32Array(COUNT * 3);
  const stream = new Float32Array(COUNT * 3);
  const rand = new Float32Array(COUNT * 4);
  const ROWS = 30;
  for (let i = 0; i < COUNT; i++) {
    // wide ellipsoidal field
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const rr = Math.cbrt(rnd());
    const s = Math.sqrt(1 - u * u);
    scatter[i * 3] = rr * s * Math.cos(th) * 8.0;
    scatter[i * 3 + 1] = rr * u * 4.5;
    scatter[i * 3 + 2] = rr * s * Math.sin(th) * 5.0;
    // speed-line target: far behind the car, snapped to rows across the width
    const row = Math.floor(rnd() * ROWS);
    stream[i * 3] = positions[i * 3] - (3 + 11 * rnd());
    stream[i * 3 + 1] = (rnd() - 0.5) * 0.5;
    stream[i * 3 + 2] = ((row + 0.5) / ROWS - 0.5) * 4.8 + (rnd() - 0.5) * 0.015;
    rand[i * 4] = rnd();
    rand[i * 4 + 1] = rnd();
    rand[i * 4 + 2] = rnd();
    rand[i * 4 + 3] = rnd();
  }

  const carGeo = new THREE.BufferGeometry();
  carGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  carGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  carGeo.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 3));
  carGeo.setAttribute('aStream', new THREE.BufferAttribute(stream, 3));
  carGeo.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
  carGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20);

  const blend = {
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  };

  const carU = {
    uTime: { value: 0 },
    uIntro: { value: 1 },
    uSmear: { value: 0 },
    uDissolve: { value: 0 },
    uVel: { value: 0 },
    uVelAbs: { value: 0 },
    uSizeK: { value: 1 },
    uWorldSize: { value: 0.017 * Math.sqrt(32000 / COUNT) },
    uMinSize: { value: 1.3 * dpr },
    uMaxSize: { value: 14 * dpr },
    uAlpha: { value: small ? 0.7 : 0.55 },
    uOcclude: { value: 0.5 },
    uMotion: { value: reducedMotion ? 0 : 1 },
  };
  const carMat = new THREE.ShaderMaterial({
    uniforms: carU,
    vertexShader: CAR_VERT,
    fragmentShader: CAR_FRAG,
    ...blend,
  });
  const car = new THREE.Points(carGeo, carMat);
  car.frustumCulled = false;
  group.add(car);

  /* ---- speed streaks ---- */
  const sPos = new Float32Array(STREAKS * 2 * 3);
  const sSeed = new Float32Array(STREAKS * 2 * 4);
  const sEnd = new Float32Array(STREAKS * 2);
  const sCol = new Float32Array(STREAKS * 2 * 3);
  const streakPalette = [YELLOW, GREEN, BLUE, WHITE, BLUE, GREEN, mix3(NAVY, BLUE, 0.5)];
  for (let i = 0; i < STREAKS; i++) {
    let y = rnd() * 6.5 - 3.0;
    let z = rnd() * 10 - 5;
    // keep the lane the car occupies clear
    if (Math.abs(y) < 0.9 && Math.abs(z) < 1.4) z = (z < 0 ? -1 : 1) * (1.4 + rnd() * 3.4);
    const seed = [rnd(), rnd(), rnd(), rnd()];
    const c = streakPalette[Math.floor(rnd() * streakPalette.length)];
    for (let e = 0; e < 2; e++) {
      const v = i * 2 + e;
      sPos[v * 3] = 0; sPos[v * 3 + 1] = y; sPos[v * 3 + 2] = z;
      sSeed.set(seed, v * 4);
      sEnd[v] = e;
      sCol.set(c, v * 3);
    }
  }
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  streakGeo.setAttribute('aSeed', new THREE.BufferAttribute(sSeed, 4));
  streakGeo.setAttribute('aEnd', new THREE.BufferAttribute(sEnd, 1));
  streakGeo.setAttribute('aColor', new THREE.BufferAttribute(sCol, 3));
  streakGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
  const streakU = {
    uPhase: { value: 0 },
    uLen: { value: 0.4 },
    uDensity: { value: 0.15 },
    uOpacity: { value: 0.5 },
    uSpan: { value: STREAK_SPAN },
  };
  const streakMat = new THREE.ShaderMaterial({
    uniforms: streakU,
    vertexShader: STREAK_VERT,
    fragmentShader: STREAK_FRAG,
    ...blend,
  });
  const streaks = new THREE.LineSegments(streakGeo, streakMat);
  streaks.frustumCulled = false;
  group.add(streaks);

  /* ---- poses ---- */
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const qx = (a) => new THREE.Quaternion().setFromAxisAngle(X, a);
  const qy = (a) => new THREE.Quaternion().setFromAxisAngle(Y, a);
  // nose points screen-left in every pose, so "backwards" is always screen-right
  const Q_FRONT = qx(0.22).multiply(qy(Math.PI + 0.9)); // 3/4 front, seen slightly from above
  const Q_SIDE = qx(0.03).multiply(qy(Math.PI)); // pure profile
  const Q_TOP = qx(Math.PI / 2).multiply(qy(Math.PI)); // plan view
  const qPose = new THREE.Quaternion();
  const qExtra = new THREE.Quaternion();
  const eExtra = new THREE.Euler();

  /* ---- state ---- */
  const target = { p: 0, v: 0, px: 0, py: 0, intro: 1 };
  const cur = { p: 0, v: 0, px: 0, py: 0, intro: 1 };
  let time = 0;
  let phase = 0;
  let last = 0;
  let raf = 0;
  let running = false;
  let disposed = false;
  let camDist = 8;

  function resize() {
    if (disposed) return;
    const w = canvas.clientWidth || window.innerWidth || 1;
    const h = canvas.clientHeight || window.innerHeight || 1;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    const tanH = Math.tan((FOV * Math.PI) / 360);
    // car fills ~60% of width on landscape, ~88% on portrait
    const frac = 0.88 + (0.6 - 0.88) * sstep(0.8, 1.4, aspect);
    const byWidth = CAR_LENGTH / (frac * 2 * tanH * aspect);
    const byHeight = (2.1 * 1.15) / (0.62 * 2 * tanH); // plan view must fit vertically
    camDist = Math.max(byWidth, byHeight);
    camera.far = camDist + 60;
    camera.updateProjectionMatrix();
    carU.uSizeK.value = (h * dpr) / (2 * tanH);
  }

  function update(dt, snap) {
    const k = (rate) => (snap ? 1 : 1 - Math.exp(-dt * rate));
    cur.p += (target.p - cur.p) * k(7);
    const tv = reducedMotion ? 0 : target.v;
    cur.v += (tv - cur.v) * k(Math.abs(tv) > Math.abs(cur.v) ? 9 : 3.5);
    cur.px += (target.px - cur.px) * k(3);
    cur.py += (target.py - cur.py) * k(3);
    cur.intro += (target.intro - cur.intro) * k(14);

    const p = cur.p;
    const va = Math.min(1.5, Math.abs(cur.v));
    const motion = reducedMotion ? 0 : 1;
    if (motion) {
      time += dt;
      phase = (phase + dt * (2.5 + 10 * p + 16 * va)) % (STREAK_SPAN * 8);
    }

    const toSide = sstep(0.25, 0.5, p);
    const toTop = sstep(0.5, 0.75, p);
    const dissolve = clamp01((p - 0.75) / 0.25);

    if (p < 0.5) qPose.slerpQuaternions(Q_FRONT, Q_SIDE, toSide);
    else qPose.slerpQuaternions(Q_SIDE, Q_TOP, toTop);

    const calm = motion * (1 - dissolve);
    eExtra.set(
      Math.sin(time * 0.5) * 0.02 * calm + cur.py * 0.05,
      Math.sin(time * 0.37) * 0.05 * calm + cur.px * 0.1,
      Math.sin(time * 0.43) * 0.012 * calm
    );
    qExtra.setFromEuler(eExtra);
    group.quaternion.copy(qExtra).multiply(qPose);
    group.position.set(
      -0.35 * toSide * (1 - toTop),
      Math.sin(time * 0.6) * 0.04 * calm,
      0
    );
    group.scale.setScalar(1 + 0.15 * toTop);

    camera.position.set(cur.px * 0.35, -cur.py * 0.2, camDist);
    camera.lookAt(0, 0, 0);

    carU.uTime.value = time;
    carU.uIntro.value = cur.intro;
    carU.uSmear.value = sstep(0.25, 0.45, p) * (1 - 0.5 * toTop);
    carU.uDissolve.value = dissolve;
    carU.uVel.value = cur.v;
    carU.uVelAbs.value = va;

    streakU.uPhase.value = phase;
    streakU.uLen.value = 0.3 + 1.8 * p + 3.2 * va;
    streakU.uDensity.value = clamp01(0.14 + 0.95 * sstep(0.15, 0.65, p) + 0.5 * va);
    streakU.uOpacity.value =
      (0.35 + 0.35 * sstep(0.2, 0.6, p) + 0.3 * Math.min(1, va)) *
      (1 - sstep(0.86, 1.0, p)) *
      sstep(0.3, 1.0, cur.intro);
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    update(dt, reducedMotion);
    renderer.render(scene, camera);
  }

  function start() {
    if (running || disposed) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function renderOnce() {
    if (disposed) return;
    update(0, true);
    renderer.render(scene, camera);
  }

  let wasRunning = false;
  const onLost = (e) => {
    e.preventDefault();
    wasRunning = running;
    stop();
  };
  const onRestored = () => {
    if (wasRunning) start();
    else renderOnce();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  function dispose() {
    if (disposed) return;
    stop();
    disposed = true;
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    carGeo.dispose();
    carMat.dispose();
    streakGeo.dispose();
    streakMat.dispose();
    renderer.dispose();
  }

  const num = (v, d) => (Number.isFinite(v) ? v : d);
  resize();

  return {
    failed: false,
    setProgress(p) { target.p = clamp01(num(p, 0)); },
    setVelocity(v) { target.v = Math.max(-1.5, Math.min(1.5, num(v, 0))); },
    setPointer(x, y) {
      target.px = Math.max(-1, Math.min(1, num(x, 0)));
      target.py = Math.max(-1, Math.min(1, num(y, 0)));
    },
    setIntro(t) { target.intro = clamp01(num(t, 1)); },
    resize,
    start,
    stop,
    renderOnce,
    dispose,
  };
}
