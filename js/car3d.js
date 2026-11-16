// car3d.js
// Procedural late-1980s "low-line" turbo-era Formula 1 car (unofficial tribute).
// Everything is generated in code: lofted monocoque/engine cover, lofted
// sidepods, ExtrudeGeometry wings with bevels, lathed slick tyres and rims,
// thin carbon suspension members. No external models, textures or HDRIs.
// HARD RULES honoured: no text, logos, numbers, chevrons, sponsor-like stripes
// or sticker panels; plain two-tone paint; plain helmet; no person visible.
//
// Exports
//   createCarModel(THREE, opts)  -> { group, wheels, roll(dist), dispose() }
//     reusable builder (takes the THREE namespace; never touches renderer/env).
//     group: nose along -Z, wheels resting on y = 0, length ~4.5 units.
//   createCar3D(canvas, opts)    -> scroll-driven studio scene (see bottom).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

/* ------------------------------------------------------------------ */
/* Math helpers (no THREE dependency)                                  */
/* ------------------------------------------------------------------ */
const PI = Math.PI;
const TAU = PI * 2;
const DEG = PI / 180;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInOut = (t) => {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const sgnPow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

// Monotone cubic (Fritsch-Carlson) interpolation through [x, y] keys.
function mono(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d = [];
  const m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/* ------------------------------------------------------------------ */
/* Car dimensions (metres). Internal frame: nose +X, up +Y, right +Z.  */
/* Proportions taken from assets/car-1988-side.svg / -top.svg.         */
/* ------------------------------------------------------------------ */
const FW = { R: 0.323, W: 0.3, rim: 0.166, x: 1.42, z: 0.87, disc: 0.125, dish: 0.05 };
const RW = { R: 0.352, W: 0.45, rim: 0.166, x: -1.42, z: 0.83, disc: 0.125, dish: 0.1 };
const NOSE_X = 2.15;
const TAIL_X = -2.0;

// Monocoque + engine cover loft
const TUB_TOP = mono([
  [2.15, 0.15], [2.12, 0.168], [2.05, 0.19], [1.9, 0.218], [1.7, 0.252], [1.42, 0.296], [1.1, 0.345],
  [0.8, 0.39], [0.55, 0.425], [0.35, 0.448], [0.1, 0.458], [0.0, 0.468], [-0.07, 0.522], [-0.13, 0.545],
  [-0.3, 0.533], [-0.6, 0.494], [-0.9, 0.446], [-1.2, 0.388], [-1.5, 0.33], [-1.75, 0.285], [-2.0, 0.24],
]);
const TUB_BOT = mono([
  [2.15, 0.132], [2.12, 0.112], [2.0, 0.092], [1.7, 0.08], [1.2, 0.066], [0.6, 0.05], [-1.2, 0.05],
  [-1.5, 0.068], [-1.75, 0.1], [-2.0, 0.12],
]);
const TUB_W = mono([
  [2.15, 0.012], [2.13, 0.045], [2.08, 0.075], [1.95, 0.1], [1.7, 0.135], [1.42, 0.168], [1.1, 0.205],
  [0.8, 0.236], [0.5, 0.268], [0.3, 0.284], [0.0, 0.29], [-0.3, 0.276], [-0.6, 0.255], [-0.9, 0.226],
  [-1.2, 0.192], [-1.5, 0.16], [-1.75, 0.135], [-2.0, 0.11],
]);
const TUB_TAPER = mono([[-2.0, 0.5], [-0.25, 0.46], [0.05, 0.3], [2.2, 0.24]]);
// Red/white split line height along the car
const SPLIT_Y = mono([[2.2, 0.148], [1.4, 0.17], [0.4, 0.2], [-0.9, 0.2], [-1.4, 0.172], [-2.0, 0.13]]);
// Sidepods
const SP_ZO = mono([
  [0.425, 0.62], [0.34, 0.72], [0.15, 0.755], [-0.3, 0.755], [-0.7, 0.74], [-0.92, 0.66],
  [-1.1, 0.55], [-1.35, 0.43], [-1.62, 0.32],
]);
const SP_TOP = mono([
  [0.425, 0.33], [0.34, 0.345], [0.0, 0.352], [-0.5, 0.348], [-0.8, 0.322], [-1.0, 0.27],
  [-1.2, 0.19], [-1.42, 0.115], [-1.62, 0.07],
]);
const SP_BOT = 0.045;
// Cockpit opening: superellipse (n = 4) in the XZ plane
const CK = { xc: 0.19, a: 0.245, b: 0.2, depth: 0.26 };
const ckF = (x, z) => 1 - Math.pow((x - CK.xc) / CK.a, 4) - Math.pow(z / CK.b, 4);

function tubSec(x) {
  const top = TUB_TOP(x);
  const bot = TUB_BOT(x);
  return { top, bot, w: TUB_W(x), yS: bot + (top - bot) * 0.36, taper: TUB_TAPER(x) };
}
function tubPoint(sec, t) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  const upper = s >= 0;
  const n = upper ? 2.7 : 5.5;
  const ez = sgnPow(c, 2 / n);
  const ey = sgnPow(s, 2 / n);
  const h = upper ? sec.top - sec.yS : sec.yS - sec.bot;
  const k = upper ? 1 - sec.taper * ey * ey : 1 - 0.1 * ey * ey;
  return [sec.w * ez * k, sec.yS + ey * h];
}
// Height of the (un-cut) upper tub surface at (x, z)
function tubSurfaceY(x, z) {
  const sec = tubSec(x);
  let pz = null;
  let py = 0;
  for (let j = 0; j <= 128; j++) {
    const [zz, yy] = tubPoint(sec, (j / 128) * PI);
    if (pz !== null && (zz - z) * (pz - z) <= 0) {
      const f = (z - pz) / (zz - pz || 1e-6);
      return lerp(py, yy, f);
    }
    pz = zz;
    py = yy;
  }
  return sec.yS;
}

/* ------------------------------------------------------------------ */
/* Geometry helpers (THREE passed in)                                  */
/* ------------------------------------------------------------------ */
function signedVolume(pos, idx) {
  let v = 0;
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
    v += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
       - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
       + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  return v;
}

// rings: [[ [x,y,z], ... ], ...]; zones parallel arrays of [a,b,c]
function gridGeo(T, rings, zones, { closed = true, capStart = null, capEnd = null, orient = true } = {}) {
  const L = rings.length;
  const M = rings[0].length;
  const pos = [];
  const zon = [];
  const uv = [];
  const idx = [];
  let vAcc = 0;
  let prevC = null;
  for (let i = 0; i < L; i++) {
    const r = rings[i];
    let cx = 0, cy = 0, cz = 0;
    for (const p of r) { cx += p[0]; cy += p[1]; cz += p[2]; }
    cx /= M; cy /= M; cz /= M;
    if (prevC) vAcc += Math.hypot(cx - prevC[0], cy - prevC[1], cz - prevC[2]);
    prevC = [cx, cy, cz];
    let acc = 0;
    for (let j = 0; j < M; j++) {
      const p = r[j];
      if (j > 0) acc += Math.hypot(p[0] - r[j - 1][0], p[1] - r[j - 1][1], p[2] - r[j - 1][2]);
      pos.push(p[0], p[1], p[2]);
      uv.push(acc, vAcc);
      const z = zones ? zones[i][j] : [1, -1, -1];
      zon.push(z[0], z[1], z[2]);
    }
  }
  const jMax = closed ? M : M - 1;
  for (let i = 0; i < L - 1; i++) {
    for (let j = 0; j < jMax; j++) {
      const j2 = (j + 1) % M;
      const a = i * M + j, b = i * M + j2, c = (i + 1) * M + j, d = (i + 1) * M + j2;
      idx.push(a, b, c, b, d, c);
    }
  }
  const cap = (ring, spec, end) => {
    let base = ring * M;
    if (spec.dup) {
      base = pos.length / 3;
      for (let j = 0; j < M; j++) {
        const p = rings[ring][j];
        pos.push(p[0], p[1], p[2]);
        uv.push(p[2], p[1]);
        zon.push(...spec.zone);
      }
    }
    const ci = pos.length / 3;
    pos.push(...spec.center);
    uv.push(spec.center[2], spec.center[1]);
    zon.push(...(spec.zone || zones[ring][0]));
    for (let j = 0; j < M; j++) {
      const j2 = (j + 1) % M;
      if (end) idx.push(ci, base + j, base + j2);
      else idx.push(ci, base + j2, base + j);
    }
  };
  if (capStart) cap(0, capStart, false);
  if (capEnd) cap(L - 1, capEnd, true);
  if (orient && signedVolume(pos, idx) < 0) {
    for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setAttribute('aZone', new T.Float32BufferAttribute(zon, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function mirrorZ(T, geo) {
  const g = geo.clone();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, -p.getZ(i));
  if (g.index) {
    const a = g.index.array;
    for (let k = 0; k < a.length; k += 3) { const t = a[k + 1]; a[k + 1] = a[k + 2]; a[k + 2] = t; }
    g.index.needsUpdate = true;
  }
  g.computeVertexNormals();
  return g;
}

// Smooth normals across coincident vertices with a crease angle (for Extrude).
function smoothNormals(T, geo, creaseDeg = 55) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position.array;
  const nTri = p.length / 9;
  const fn = new Float32Array(nTri * 3);
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2];
    const vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2];
    fn[t * 3] = uy * vz - uz * vy;
    fn[t * 3 + 1] = uz * vx - ux * vz;
    fn[t * 3 + 2] = ux * vy - uy * vx;
  }
  const map = new Map();
  const key = (i) => `${Math.round(p[i] * 2e4)},${Math.round(p[i + 1] * 2e4)},${Math.round(p[i + 2] * 2e4)}`;
  for (let v = 0; v < nTri * 3; v++) {
    const k = key(v * 3);
    let arr = map.get(k);
    if (!arr) { arr = []; map.set(k, arr); }
    arr.push((v / 3) | 0);
  }
  const cosC = Math.cos(creaseDeg * DEG);
  const nrm = new Float32Array(p.length);
  for (let v = 0; v < nTri * 3; v++) {
    const t = (v / 3) | 0;
    const ax = fn[t * 3], ay = fn[t * 3 + 1], az = fn[t * 3 + 2];
    const al = Math.hypot(ax, ay, az) || 1;
    let sx = 0, sy = 0, sz = 0;
    for (const u of map.get(key(v * 3))) {
      const bx = fn[u * 3], by = fn[u * 3 + 1], bz = fn[u * 3 + 2];
      const bl = Math.hypot(bx, by, bz) || 1;
      if ((ax * bx + ay * by + az * bz) / (al * bl) >= cosC) { sx += bx; sy += by; sz += bz; }
    }
    const l = Math.hypot(sx, sy, sz) || 1;
    nrm[v * 3] = sx / l; nrm[v * 3 + 1] = sy / l; nrm[v * 3 + 2] = sz / l;
  }
  g.setAttribute('normal', new T.BufferAttribute(nrm, 3));
  return g;
}

function planarUV(T, g, axes = 'xz') {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const ga = (i, c) => (c === 'x' ? p.getX(i) : c === 'y' ? p.getY(i) : p.getZ(i));
  for (let i = 0; i < p.count; i++) { uv[i * 2] = ga(i, axes[0]); uv[i * 2 + 1] = ga(i, axes[1]); }
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  return g;
}

function setSeam(T, g, v = 1) {
  g.setAttribute('aSeam', new T.BufferAttribute(new Float32Array(g.attributes.position.count).fill(v), 1));
  return g;
}

function setZone(T, g, fn) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const z = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const r = fn(p.getX(i), p.getY(i), p.getZ(i), n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0);
    z[i * 3] = r[0]; z[i * 3 + 1] = r[1]; z[i * 3 + 2] = r[2];
  }
  g.setAttribute('aZone', new T.BufferAttribute(z, 3));
  return g;
}

// Merge indexed geometries that share position/normal/uv.
function mergeSimple(T, list) {
  const pos = [], nrm = [], uv = [], idx = [];
  let off = 0;
  for (let g of list) {
    if (!g.index) g = g; // all inputs here are indexed primitives
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
    }
    const a = g.index.array;
    for (let k = 0; k < a.length; k++) idx.push(a[k] + off);
    off += p.count;
    g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

function rod(T, a, b, r, seg = 10, sx = 1) {
  const A = new T.Vector3(...a);
  const B = new T.Vector3(...b);
  const dir = B.clone().sub(A);
  const len = dir.length();
  const g = new T.CylinderGeometry(r, r, len, seg, 1, false);
  if (sx !== 1) g.scale(sx, 1, 1);
  const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
  const m = new T.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new T.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

function airfoilShape(T, c, th, camber, n) {
  const up = [];
  const lo = [];
  for (let i = 0; i <= n; i++) {
    const t = (1 - Math.cos((i / n) * PI)) / 2;
    const yt = 5 * th * c * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t * t * t - 0.1036 * t * t * t * t);
    const yc = -camber * c * 4 * t * (1 - t);
    up.push([-t * c, yc + yt]);
    lo.push([-t * c, yc - yt]);
  }
  const s = new T.Shape();
  s.moveTo(up[n][0], up[n][1]);
  for (let i = n - 1; i >= 0; i--) s.lineTo(up[i][0], up[i][1]);
  for (let i = 1; i <= n; i++) s.lineTo(lo[i][0], lo[i][1]);
  return s;
}

/* ------------------------------------------------------------------ */
/* Procedural textures                                                 */
/* ------------------------------------------------------------------ */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function buildCarTextures(T, hi) {
  // Paint flake normal map: tiny random tilts.
  const FS = hi ? 256 : 128;
  const fc = makeCanvas(FS, FS);
  const fx = fc.getContext('2d');
  const fd = fx.createImageData(FS, FS);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < FS * FS; i++) {
    const a = rnd() * TAU;
    const r = Math.pow(rnd(), 2) * 0.55;
    fd.data[i * 4] = 128 + Math.cos(a) * r * 127;
    fd.data[i * 4 + 1] = 128 + Math.sin(a) * r * 127;
    fd.data[i * 4 + 2] = 255;
    fd.data[i * 4 + 3] = 255;
  }
  fx.putImageData(fd, 0, 0);
  const flake = new T.CanvasTexture(fc);
  flake.wrapS = flake.wrapT = T.RepeatWrapping;
  flake.repeat.set(30, 30);

  // Carbon 2x2 twill: colour + normal.
  const S = 256;
  const cell = 16;
  const hgt = new Float32Array(S * S);
  const over = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      const u = (x % cell + 0.5) / cell, v = (y % cell + 0.5) / cell;
      const warp = ((cx + cy) & 3) < 2;
      const fib = 0.06 * Math.sin((warp ? v : u) * PI * 14);
      hgt[y * S + x] = (warp ? Math.sin(PI * v) : Math.sin(PI * u)) * 0.9 + fib;
      over[y * S + x] = warp ? 1 : 0;
    }
  }
  const cc = makeCanvas(S, S);
  const cn = makeCanvas(S, S);
  const cxc = cc.getContext('2d');
  const cxn = cn.getContext('2d');
  const cd = cxc.createImageData(S, S);
  const nd = cxn.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const hL = hgt[y * S + ((x + S - 1) % S)], hR = hgt[y * S + ((x + 1) % S)];
      const hD = hgt[((y + S - 1) % S) * S + x], hU = hgt[((y + 1) % S) * S + x];
      let nx = (hL - hR) * 2.2, ny = (hD - hU) * 2.2, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nd.data[i * 4] = 128 + (nx / l) * 127;
      nd.data[i * 4 + 1] = 128 + (ny / l) * 127;
      nd.data[i * 4 + 2] = 128 + (nz / l) * 127;
      nd.data[i * 4 + 3] = 255;
      const b = (over[i] ? 30 : 17) + hgt[i] * 12;
      cd.data[i * 4] = b; cd.data[i * 4 + 1] = b; cd.data[i * 4 + 2] = b + 2; cd.data[i * 4 + 3] = 255;
    }
  }
  cxc.putImageData(cd, 0, 0);
  cxn.putImageData(nd, 0, 0);
  const carbonMap = new T.CanvasTexture(cc);
  carbonMap.colorSpace = T.SRGBColorSpace;
  const carbonNormal = new T.CanvasTexture(cn);
  for (const t of [carbonMap, carbonNormal]) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(7, 7); }
  // Tyre: colour + roughness with circumferential wear streaks on the tread band.
  const TW = hi ? 512 : 256, TH = 128;
  const tc = makeCanvas(TW, TH);
  const tr = makeCanvas(TW, TH);
  const tcx = tc.getContext('2d');
  const trx = tr.getContext('2d');
  tcx.fillStyle = '#161616';
  tcx.fillRect(0, 0, TW, TH);
  trx.fillStyle = 'rgb(0,205,0)';
  trx.fillRect(0, 0, TW, TH);
  // tread band sits in the middle of the lathe profile (v ~ 0.33..0.67)
  const t0 = TH * 0.31, t1 = TH * 0.69;
  tcx.fillStyle = '#1c1c1c';
  tcx.fillRect(0, t0, TW, t1 - t0);
  for (let i = 0; i < 260; i++) {
    const y = lerp(t0, t1, rnd());
    const g = 170 + rnd() * 50;
    trx.fillStyle = `rgba(0,${g | 0},0,${0.15 + rnd() * 0.25})`;
    trx.fillRect(0, y, TW, 0.5 + rnd() * 1.5);
    tcx.fillStyle = `rgba(36,36,36,${0.03 + rnd() * 0.04})`;
    tcx.fillRect(0, y, TW, 0.5 + rnd());
  }
  for (let i = 0; i < 40; i++) {
    // small rubber pick-up blobs (rougher, darker)
    const x = rnd() * TW, y = lerp(t0, t1, rnd()), r = 0.6 + rnd() * 1.8;
    trx.fillStyle = 'rgba(0,240,0,0.8)';
    trx.beginPath(); trx.ellipse(x, y, r * 3, r, 0, 0, TAU); trx.fill();
    tcx.fillStyle = 'rgba(12,12,12,0.35)';
    tcx.beginPath(); tcx.ellipse(x, y, r * 3, r, 0, 0, TAU); tcx.fill();
  }
  // shoulders slightly shinier where the tyre rolls over
  for (const [a, b] of [[TH * 0.27, t0], [t1, TH * 0.73]]) {
    trx.fillStyle = 'rgba(0,170,0,0.5)';
    trx.fillRect(0, a, TW, b - a);
  }
  const tyreMap = new T.CanvasTexture(tc);
  tyreMap.colorSpace = T.SRGBColorSpace;
  const tyreRough = new T.CanvasTexture(tr);
  for (const t of [tyreMap, tyreRough]) { t.wrapS = T.RepeatWrapping; t.repeat.set(3, 1); }

  // Inlet mesh grille (alpha): woven square mesh.
  const GS = 64;
  const gc = makeCanvas(GS, GS);
  const gx = gc.getContext('2d');
  gx.fillStyle = '#000';
  gx.fillRect(0, 0, GS, GS);
  gx.fillStyle = '#fff';
  for (let k = 0; k < 4; k++) {
    gx.fillRect(k * 16, 0, 4, GS);
    gx.fillRect(0, k * 16, GS, 4);
  }
  const grille = new T.CanvasTexture(gc);
  grille.wrapS = grille.wrapT = T.RepeatWrapping;
  grille.repeat.set(30, 30);
  return { flake, carbonMap, carbonNormal, tyreMap, tyreRough, grille };
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */
function addPatch(mat, key, fn) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.call(mat) : '';
  mat.onBeforeCompile = (sh, r) => { if (prev) prev.call(mat, sh, r); fn(sh); };
  mat.customProgramCacheKey = () => prevKey + '|' + key;
}

function patchPaint(mat, U) {
  addPatch(mat, 'car-paint', (sh) => {
    Object.assign(sh.uniforms, {
      uUpper: U.uUpper, uLower: U.uLower, uCarbonC: U.uCarbonC, uDarkC: U.uDarkC, uAccent: U.uAccent,
      uAccentOn: U.uAccentOn, uSweepX: U.uSweepX, uSweepAmt: U.uSweepAmt, uCarX: U.uCarX,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aZone; attribute float aSeam; varying vec3 vZone; varying vec3 vPW; varying float vSeam; varying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvZone = aZone; vSeam = aSeam; vObj = position; vPW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vZone; varying vec3 vPW; varying float vSeam; varying vec3 vObj;
        float pzHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float pzNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(pzHash(i), pzHash(i + vec2(1, 0)), f.x), mix(pzHash(i + vec2(0, 1)), pzHash(i + vec2(1, 1)), f.x), f.y);
        }
        float pzGroove(float v, float at, float w) { return 1.0 - smoothstep(0.0, w, abs(v - at)); }
        uniform vec3 uUpper; uniform vec3 uLower; uniform vec3 uCarbonC; uniform vec3 uDarkC; uniform vec3 uAccent;
        uniform float uAccentOn; uniform float uSweepX; uniform float uSweepAmt; uniform float uCarX;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float pzW = max(fwidth(vZone.x) * 0.8, 1e-4);
        float pzS = smoothstep(-pzW, pzW, vZone.x);
        vec3 pc = mix(uLower, uUpper, pzS);
        float pzA = uAccentOn * (1.0 - smoothstep(0.004 - pzW, 0.004 + pzW, abs(vZone.x)));
        pc = mix(pc, uAccent, pzA);
        float pzCw = max(fwidth(vZone.y) * 0.8, 1e-4);
        float pzCarb = smoothstep(-pzCw, pzCw, vZone.y);
        pc = mix(pc, uCarbonC, pzCarb);
        float pzDw = max(fwidth(vZone.z) * 0.8, 1e-4);
        float pzDark = smoothstep(-pzDw, pzDw, vZone.z);
        pc = mix(pc, uDarkC, pzDark);
        // Panel gaps (thin dark grooves) on seamed panels.
        float gw = fwidth(vObj.x) * 0.9 + 0.0011;
        float pzGap = 0.0;
        pzGap = max(pzGap, pzGroove(vObj.x, 1.22, gw));
        pzGap = max(pzGap, pzGroove(vObj.x, -0.245, gw));
        pzGap = max(pzGap, pzGroove(vObj.x, -1.6, gw));
        pzGap = max(pzGap, pzGroove(vObj.x, -0.96, gw) * step(0.6, abs(vObj.z) / 0.76));
        pzGap *= vSeam * (1.0 - pzDark);
        pc *= 1.0 - 0.82 * pzGap;
        // Road grime / rubber marks low on the bodywork.
        float dn = pzNoise(vObj.xz * vec2(9.0, 22.0)) * 0.6 + pzNoise(vObj.xy * vec2(38.0, 70.0)) * 0.4;
        float pzDirt = (1.0 - smoothstep(0.045, 0.16, vObj.y)) * smoothstep(0.38, 0.85, dn) * 0.75 * (1.0 - pzDark);
        pc = mix(pc, pc * 0.5 + vec3(0.018, 0.016, 0.013), pzDirt);
        diffuseColor.rgb = pc;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.42, pzCarb);
        roughnessFactor = mix(roughnessFactor, 0.85, pzDark);
        roughnessFactor = mix(roughnessFactor, 0.22, pzA);
        roughnessFactor = mix(roughnessFactor, 0.8, max(pzGap, pzDirt * 0.6));`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat *= (1.0 - 0.92 * pzDark - 0.35 * pzCarb) * (1.0 - 0.9 * pzGap) * (1.0 - 0.5 * pzDirt);
        #endif
`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.85, pzA);`)
      .replace('#include <opaque_fragment>', `{
          float sd = (vPW.x - uCarX) - uSweepX;
          float band = exp(-sd * sd * 16.0) + 0.25 * exp(-sd * sd * 2.0);
          vec3 upv = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float up = clamp(dot(normal, upv), 0.0, 1.0);
          outgoingLight += vec3(1.0, 0.96, 0.9) * band * (0.25 + 0.75 * up) * uSweepAmt * 0.22 * (1.0 - pzDark);
        }
        #include <opaque_fragment>`);
  });
}

function patchMirror(mat, U) {
  addPatch(mat, 'car-mirror', (sh) => {
    sh.uniforms.uMirrorAmt = U.uMirrorAmt;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMW; uniform float uMirrorAmt;')
      .replace('#include <opaque_fragment>', `{
          float below = -vMW.y;
          if (below < 0.0) discard;
          diffuseColor.a *= uMirrorAmt * smoothstep(0.6, 0.0, below);
          outgoingLight *= 0.8;
        }
        #include <opaque_fragment>`);
  });
  mat.transparent = true;
  mat.depthWrite = false;
}

function makeCarMaterials(T, tex, U, cfg, mirror) {
  const P = (o) => new T.MeshPhysicalMaterial(o);
  const M = {
    paint: P({ color: 0xffffff, roughness: 0.36, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.04, normalMap: tex.flake, normalScale: new T.Vector2(0.1, 0.1), envMapIntensity: 0.4 }),
    carbon: P({ color: 0xffffff, map: tex.carbonMap, normalMap: tex.carbonNormal, normalScale: new T.Vector2(0.35, 0.35), roughness: 0.4, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.1, envMapIntensity: 0.8 }),
    carbonDS: P({ color: 0xffffff, map: tex.carbonMap, normalMap: tex.carbonNormal, normalScale: new T.Vector2(0.35, 0.35), roughness: 0.42, metalness: 0.15, clearcoat: 0.7, clearcoatRoughness: 0.12, envMapIntensity: 0.8, side: T.DoubleSide }),
    susp: P({ color: 0x0b0c0e, roughness: 0.32, metalness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.12, envMapIntensity: 0.9 }),
    rubber: P({ color: 0xffffff, map: tex.tyreMap, roughnessMap: tex.tyreRough, roughness: 1.0, metalness: 0, sheen: 0.4, sheenRoughness: 0.7, sheenColor: new T.Color(0x2a2a2a), envMapIntensity: 0.55 }),
    rim: P({ color: new T.Color(cfg.rim), metalness: 1, roughness: 0.26, envMapIntensity: 1.1, side: T.DoubleSide }),
    darkMetal: P({ color: 0x2b2e33, metalness: 0.85, roughness: 0.42, envMapIntensity: 0.9 }),
    disc: P({ color: 0x1c1c1e, metalness: 0.35, roughness: 0.62, envMapIntensity: 0.7 }),
    helmet: P({ color: new T.Color(cfg.helmet), roughness: 0.28, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.0 }),
    visor: P({ color: 0x040506, metalness: 0.5, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4 }),
    black: P({ color: 0x0a0a0a, roughness: 0.85, metalness: 0, envMapIntensity: 0.3 }),
    glass: P({ color: 0x1a252d, roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.0, transparent: true, opacity: 0.3, side: T.DoubleSide, depthWrite: false, envMapIntensity: 1.8 }),
    chrome: P({ color: 0xdde3ea, metalness: 1, roughness: 0.04, envMapIntensity: 1.3 }),
    grille: P({ color: 0x15161a, metalness: 0.7, roughness: 0.45, alphaMap: tex.grille, alphaTest: 0.5, side: T.DoubleSide, envMapIntensity: 0.8 }),
    exhaust: P({ color: 0x6b5a48, metalness: 0.9, roughness: 0.35, envMapIntensity: 1.0, side: T.DoubleSide }),
  };
  patchPaint(M.paint, U);
  if (mirror) for (const k in M) patchMirror(M[k], U);
  return M;
}

/* ------------------------------------------------------------------ */
/* Reusable car builder                                                */
/* ------------------------------------------------------------------ */
export function createCarModel(T, {
  upper = '#c8102e', lower = '#ffffff', helmet = '#FFDF00', detail = 'high', accent = null, rim = '#a9aeb4',
} = {}) {
  const hi = detail !== 'low';
  const geoms = [];
  const keep = (g) => { geoms.push(g); return g; };
  const tex = buildCarTextures(T, hi);
  const U = {
    uUpper: { value: new T.Color(upper) },
    uLower: { value: new T.Color(lower) },
    uCarbonC: { value: new T.Color(0x0d0e10) },
    uDarkC: { value: new T.Color(0x050606) },
    uAccent: { value: new T.Color(accent || '#c9a24a') },
    uAccentOn: { value: accent ? 1 : 0 },
    uSweepX: { value: 0 },
    uSweepAmt: { value: 0 },
    uCarX: { value: 0 },
    uMirrorAmt: { value: 0.3 },
  };
  const cfg = { helmet, rim };
  const mats = makeCarMaterials(T, tex, U, cfg, false);

  const inner = new T.Group(); // nose +X
  const add = (geo, matKey, parent = inner, opts = {}) => {
    const m = new T.Mesh(keep(geo), mats[matKey]);
    m.userData.mat = matKey;
    m.castShadow = opts.cast !== false;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  /* ---- monocoque + engine cover ---- */
  {
    const NS = hi ? 260 : 110;
    const NR = hi ? 160 : 64;
    const rings = [];
    const zones = [];
    for (let i = 0; i < NS; i++) {
      const u = i / (NS - 1);
      const x = lerp(NOSE_X, TAIL_X, u);
      const sec = tubSec(x);
      const ring = [];
      const zr = [];
      for (let j = 0; j < NR; j++) {
        const t = -PI / 2 + (j / NR) * TAU;
        let [z, y] = tubPoint(sec, t);
        let dark = -1;
        if (Math.sin(t) > 0) {
          const f = ckF(x, z);
          if (f > -0.05) y = Math.max(sec.bot + 0.11, y - CK.depth * sstep(0.0, 0.12, f));
          dark = f - 0.02;
        }
        ring.push([x, y, z]);
        zr.push([y - SPLIT_Y(x), -1, dark]);
      }
      rings.push(ring);
      zones.push(zr);
    }
    const s0 = tubSec(NOSE_X);
    const s1 = tubSec(TAIL_X);
    const g = gridGeo(T, rings, zones, {
      capStart: { center: [NOSE_X + 0.008, (s0.top + s0.bot) / 2, 0], zone: null },
      capEnd: { center: [TAIL_X - 0.004, (s1.top + s1.bot) / 2, 0], zone: [-1, 1, -1], dup: true },
    });
    setSeam(T, g);
    add(g, 'paint');
  }

  /* ---- sidepods ---- */
  {
    const NS = hi ? 120 : 48;
    const NR = hi ? 96 : 40;
    const X0 = 0.425;
    const X1 = -1.62;
    const rings = [];
    const zones = [];
    for (let i = 0; i < NS; i++) {
      const x = lerp(X0, X1, i / (NS - 1));
      const zo = SP_ZO(x);
      const top = SP_TOP(x);
      const zi = Math.min(0.18, TUB_W(x) - 0.05);
      const zc = (zi + zo) / 2, hw = (zo - zi) / 2, yc = (top + SP_BOT) / 2, hh = (top - SP_BOT) / 2;
      const sL = x > 0.395 ? lerp(0.86, 1, (X0 - x) / 0.03) : 1;
      const ring = [];
      const zr = [];
      for (let j = 0; j < NR; j++) {
        const t = -PI / 2 + (j / NR) * TAU;
        const ez = sgnPow(Math.cos(t), 2 / 4.5);
        const ey = sgnPow(Math.sin(t), 2 / 4.5);
        const z = zc + hw * ez * sL;
        let y = yc + hh * ey * sL;
        if (ey > 0) y -= 0.022 * Math.max(0, ez) * ey;
        const nz = clamp01((z - zi) / (zo - zi));
        const xx = x - 0.13 * nz * sstep(-0.3, 0.36, x);
        ring.push([xx, y, z]);
        zr.push([y - SPLIT_Y(xx), -1, -1]);
      }
      rings.push(ring);
      zones.push(zr);
    }
    const zo0 = SP_ZO(X0), zi0 = 0.18;
    const zo1 = SP_ZO(X1), zi1 = Math.min(0.18, TUB_W(X1) - 0.05);
    const g = gridGeo(T, rings, zones, {
      capStart: { center: [X0 - 0.2, (SP_TOP(X0) + SP_BOT) / 2, (zi0 + zo0) / 2], zone: [-1, -1, 1], dup: true },
      capEnd: { center: [X1 - 0.01, (SP_TOP(X1) + SP_BOT) / 2, (zi1 + zo1) / 2], zone: [-1, -1, -1], dup: true },
    });
    setSeam(T, g);
    add(g, 'paint');
    add(mirrorZ(T, g), 'paint');
    // Mesh grille just inside the radiator inlet lip.
    {
      const r0 = rings[0];
      let cy = 0, cz = 0, cx = 0;
      for (const q of r0) { cx += q[0]; cy += q[1]; cz += q[2]; }
      cx /= r0.length; cy /= r0.length; cz /= r0.length;
      const pos = [cx - 0.03, cy, cz];
      const idx = [];
      for (let j = 0; j < r0.length; j++) {
        const q = r0[j];
        pos.push(q[0] - 0.03, cy + (q[1] - cy) * 0.94, cz + (q[2] - cz) * 0.94);
        idx.push(0, 1 + j, 1 + ((j + 1) % r0.length));
      }
      const gg = new T.BufferGeometry();
      gg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      gg.setIndex(idx);
      gg.computeVertexNormals();
      planarUV(T, gg, 'zy');
      add(gg, 'grille', inner, { cast: false });
      add(mirrorZ(T, gg), 'grille', inner, { cast: false });
    }
  }

  /* ---- cockpit rim, helmet, windscreen, steering wheel ---- */
  const ckPoint = (s, grow = 0) => {
    const x = CK.xc + (CK.a + grow) * sgnPow(Math.cos(s), 0.5);
    const z = (CK.b + grow * 0.8) * sgnPow(Math.sin(s), 0.5);
    return [x, z];
  };
  {
    const pts = [];
    const N = 96;
    for (let k = 0; k < N; k++) {
      const s = (k / N) * TAU;
      const [x, z] = ckPoint(s, 0.004);
      pts.push(new T.Vector3(x, tubSurfaceY(x, z) - 0.004, z));
    }
    const curve = new T.CatmullRomCurve3(pts, true, 'centripetal');
    add(new T.TubeGeometry(curve, hi ? 200 : 80, 0.018, hi ? 10 : 6, true), 'black');
  }
  {
    const hg = new T.Group();
    hg.position.set(0.135, 0.468, 0);
    hg.rotation.z = 0.3;
    const sc = [1.08, 1, 0.94];
    const shell = new T.SphereGeometry(0.122, hi ? 64 : 28, hi ? 48 : 18);
    shell.scale(...sc);
    add(shell, 'helmet', hg);
    const visor = new T.SphereGeometry(0.1238, hi ? 48 : 20, hi ? 12 : 6, PI - 0.98, 1.96, 1.3, 0.4);
    visor.scale(...sc);
    add(visor, 'visor', hg);
    const collar = new T.SphereGeometry(0.11, 24, 12);
    collar.scale(1.3, 0.6, 1.25);
    collar.translate(-0.02, -0.1, 0);
    add(collar, 'black', hg);
    inner.add(hg);
    const sw = new T.TorusGeometry(0.115, 0.013, 8, hi ? 40 : 20);
    sw.rotateY(PI / 2);
    sw.rotateZ(0.45);
    sw.translate(0.36, 0.385, 0);
    add(sw, 'black');
  }
  {
    // Short wrap-around screen hugging the front of the cockpit opening.
    const NC = hi ? 48 : 20;
    const K = hi ? 8 : 4;
    const rings = [];
    for (let k = 0; k <= K; k++) rings.push([]);
    for (let c = 0; c <= NC; c++) {
      const s = lerp(-1.15, 1.15, c / NC);
      const [x, z] = ckPoint(s, 0.035);
      const yb = tubSurfaceY(x, z) - 0.006;
      const hf = Math.pow(Math.max(0, Math.cos(s * 0.95)), 0.6);
      for (let k = 0; k <= K; k++) {
        const t = k / K;
        const h = 0.092 * hf * t;
        const bulge = Math.sin(t * PI) * 0.012;
        rings[k].push([x - 0.07 * hf * t + bulge, yb + h, z * (1 - 0.06 * t)]);
      }
    }
    const g = gridGeo(T, rings, null, { closed: false, orient: false });
    g.deleteAttribute('aZone');
    add(g, 'glass', inner, { cast: false }).renderOrder = 2;
  }

  /* ---- roll hoop (small, no airbox) ---- */
  {
    const s = new T.Shape();
    s.moveTo(-0.065, 0);
    s.lineTo(-0.065, 0.04);
    s.quadraticCurveTo(-0.065, 0.088, 0, 0.088);
    s.quadraticCurveTo(0.065, 0.088, 0.065, 0.04);
    s.lineTo(0.065, 0);
    s.lineTo(-0.065, 0);
    const h = new T.Path();
    h.moveTo(-0.036, 0.028);
    h.lineTo(-0.036, 0.045);
    h.quadraticCurveTo(-0.036, 0.068, 0, 0.068);
    h.quadraticCurveTo(0.036, 0.068, 0.036, 0.045);
    h.lineTo(0.036, 0.028);
    h.lineTo(-0.036, 0.028);
    s.holes.push(h);
    let g = new T.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: hi ? 3 : 1, curveSegments: hi ? 12 : 5 });
    g.rotateY(PI / 2);
    g.translate(-0.165, TUB_TOP(-0.13) - 0.03, 0);
    g = smoothNormals(T, g, 50);
    planarUV(T, g, 'xy');
    setZone(T, g, () => [1, -1, -1]);
    add(g, 'paint');
    const back = new T.PlaneGeometry(0.08, 0.045);
    back.rotateY(PI / 2);
    back.translate(-0.13, TUB_TOP(-0.13) + 0.027, 0);
    add(back, 'black', inner, { cast: false });
  }

  /* ---- mirrors on stalks ---- */
  for (const sd of [1, -1]) {
    const hous = new T.SphereGeometry(1, hi ? 32 : 14, hi ? 16 : 8, PI / 2, PI);
    hous.scale(0.055, 0.034, 0.082);
    hous.translate(0.45, 0.508, sd * 0.4);
    setZone(T, hous, () => [1, -1, -1]);
    add(hous, 'paint');
    const gl = new T.CircleGeometry(1, hi ? 32 : 14);
    gl.rotateY(-PI / 2);
    gl.scale(1, 0.031, 0.078);
    gl.translate(0.449, 0.508, sd * 0.4);
    add(gl, 'chrome', inner, { cast: false });
    add(rod(T, [0.47, 0.42, sd * 0.255], [0.47, 0.5, sd * 0.36], 0.008, 8, 1.6), 'susp');
  }

  /* ---- wings ---- */
  const wing = (c, th, camber, span, le, rot, zc = 0) => {
    const shape = airfoilShape(T, c, th, camber, hi ? 22 : 10);
    let g = new T.ExtrudeGeometry(shape, {
      depth: span, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.0022, bevelSegments: hi ? 2 : 1, curveSegments: 1, steps: 1,
    });
    g.translate(0, 0, -span / 2 - 0.002 + zc);
    g.rotateZ(rot);
    g.translate(le[0], le[1], 0);
    g = smoothNormals(T, g, 50);
    planarUV(T, g, 'xz');
    setZone(T, g, (x, y, z, nx, ny) => [1, -ny - 0.2, -1]);
    return add(g, 'paint');
  };
  const rivetParts = [];
  const rivets = (shape, zc, thick, n) => {
    if (!hi) return;
    const pts = shape.getSpacedPoints(n);
    let mx = 0, my = 0;
    for (const q of pts) { mx += q.x; my += q.y; }
    mx /= pts.length; my /= pts.length;
    for (let i = 0; i < pts.length - 1; i++) {
      const q = pts[i];
      const dx = mx - q.x, dy = my - q.y, l = Math.hypot(dx, dy) || 1;
      const x = q.x + (dx / l) * 0.016, y = q.y + (dy / l) * 0.016;
      for (const f of [1, -1]) {
        const d = new T.SphereGeometry(0.0042, 8, 3, 0, TAU, 0, PI / 2);
        d.scale(1, 0.45, 1);
        d.rotateX(f * PI / 2);
        d.translate(x, y, zc + f * (thick / 2 + 0.0025));
        rivetParts.push(d);
      }
    }
  };
  const plate = (shape, zc, thick = 0.012, carbonFace = false) => {
    let g = new T.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: hi ? 2 : 1, curveSegments: hi ? 10 : 4 });
    g.translate(0, 0, zc - thick / 2);
    g = smoothNormals(T, g, 50);
    planarUV(T, g, 'xy');
    setZone(T, g, () => [1, carbonFace ? 1 : -1, -1]);
    return add(g, 'paint');
  };
  // Front wing: full-span main plane under the nose + outboard flaps.
  wing(0.3, 0.09, 0.05, 1.54, [2.17, 0.06], -0.05);
  for (const sd of [1, -1]) {
    wing(0.17, 0.1, 0.07, 0.6, [1.95, 0.088], -0.34, sd * 0.47);
    const ep = new T.Shape();
    ep.moveTo(2.19, 0.025);
    ep.quadraticCurveTo(2.2, 0.06, 2.15, 0.12);
    ep.quadraticCurveTo(2.1, 0.168, 2.0, 0.168);
    ep.lineTo(1.82, 0.168);
    ep.quadraticCurveTo(1.74, 0.165, 1.72, 0.11);
    ep.lineTo(1.72, 0.04);
    ep.quadraticCurveTo(1.72, 0.022, 1.75, 0.022);
    ep.lineTo(2.19, 0.025);
    plate(ep, sd * 0.776);
    rivets(ep, sd * 0.776, 0.012, 22);
  }
  // Rear wing: main plane + steep flap between flat endplates, plus beam wing.
  wing(0.5, 0.12, 0.06, 1.0, [-1.84, 0.735], -0.2);
  wing(0.22, 0.1, 0.08, 1.0, [-2.16, 0.825], -0.7);
  wing(0.36, 0.12, 0.05, 0.86, [-1.86, 0.275], -0.12);
  for (const sd of [1, -1]) {
    const ep = new T.Shape();
    ep.moveTo(-1.83, 0.95);
    ep.quadraticCurveTo(-1.83, 0.975, -1.86, 0.975);
    ep.lineTo(-2.36, 0.975);
    ep.quadraticCurveTo(-2.39, 0.975, -2.39, 0.945);
    ep.lineTo(-2.39, 0.29);
    ep.quadraticCurveTo(-2.39, 0.25, -2.35, 0.25);
    ep.lineTo(-2.02, 0.25);
    ep.quadraticCurveTo(-1.96, 0.25, -1.93, 0.31);
    ep.lineTo(-1.86, 0.45);
    ep.quadraticCurveTo(-1.835, 0.5, -1.835, 0.56);
    ep.lineTo(-1.83, 0.95);
    plate(ep, sd * 0.508, 0.012);
    rivets(ep, sd * 0.508, 0.012, 40);
    // central wing pillars
    const pl = new T.Shape();
    pl.moveTo(-1.86, 0.2);
    pl.lineTo(-1.95, 0.2);
    pl.lineTo(-2.09, 0.76);
    pl.lineTo(-2.02, 0.76);
    pl.lineTo(-1.86, 0.2);
    let pg = new T.ExtrudeGeometry(pl, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
    pg.translate(0, 0, sd * 0.07 - 0.006);
    pg = smoothNormals(T, pg, 40);
    planarUV(T, pg, 'xy');
    add(pg, 'carbon');
  }

  if (rivetParts.length) add(mergeSimple(T, rivetParts), 'darkMetal', inner, { cast: false });

  /* ---- floor, diffuser, exhausts ---- */
  {
    const s = new T.Shape();
    s.moveTo(0.56, -0.42);
    s.quadraticCurveTo(0.5, -0.725, 0.3, -0.725);
    s.lineTo(-0.95, -0.725);
    s.quadraticCurveTo(-1.12, -0.725, -1.14, -0.5);
    s.lineTo(-1.34, -0.45);
    s.lineTo(-1.34, 0.45);
    s.lineTo(-1.14, 0.5);
    s.quadraticCurveTo(-1.12, 0.725, -0.95, 0.725);
    s.lineTo(0.3, 0.725);
    s.quadraticCurveTo(0.5, 0.725, 0.56, 0.42);
    s.lineTo(0.56, -0.42);
    let g = new T.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.003, bevelSegments: 1, curveSegments: hi ? 12 : 4 });
    g.rotateX(PI / 2);
    g.translate(0, 0.046, 0);
    g = smoothNormals(T, g, 40);
    planarUV(T, g, 'xz');
    add(g, 'carbon');
  }
  {
    const rampY = (x) => 0.035 + 0.17 * Math.pow(sstep(-1.3, -1.99, x), 1.2);
    const NX = hi ? 28 : 10;
    const rings = [];
    for (let i = 0; i <= NX; i++) {
      const x = lerp(-1.3, -1.99, i / NX);
      const r = [];
      for (let k = 0; k <= 8; k++) r.push([x, rampY(x), lerp(-0.45, 0.45, k / 8)]);
      rings.push(r);
    }
    const g = gridGeo(T, rings, null, { closed: false, orient: false });
    g.deleteAttribute('aZone');
    planarUV(T, g, 'xz');
    add(g, 'carbonDS');
    for (const zf of [-0.45, -0.16, 0.16, 0.45]) {
      const s = new T.Shape();
      s.moveTo(-1.3, 0.035);
      for (let i = 0; i <= 12; i++) { const x = lerp(-1.3, -1.99, i / 12); s.lineTo(x, rampY(x)); }
      s.lineTo(-1.99, 0.035);
      s.lineTo(-1.3, 0.035);
      let fg = new T.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false });
      fg.translate(0, 0, zf - 0.004);
      fg = smoothNormals(T, fg, 40);
      planarUV(T, fg, 'xy');
      add(fg, 'carbon');
    }
    for (const sd of [1, -1]) {
      const ex = new T.CylinderGeometry(0.034, 0.038, 0.24, hi ? 24 : 10, 1, true);
      ex.rotateZ(PI / 2);
      ex.translate(-1.86, 0.215, sd * 0.24);
      add(ex, 'exhaust');
      const exIn = new T.CircleGeometry(0.033, 16);
      exIn.rotateY(-PI / 2);
      exIn.translate(-1.92, 0.215, sd * 0.24);
      add(exIn, 'black', inner, { cast: false });
    }
  }

  /* ---- suspension (thin carbon members) ---- */
  {
    const parts = [];
    const R = 0.0115;
    const seg = hi ? 12 : 6;
    for (const sd of [1, -1]) {
      const P = (x, y, z) => [x, y, z * sd];
      // front
      parts.push(rod(T, P(1.64, 0.31, 0.19), P(1.42, 0.44, 0.76), R, seg, 1.5));
      parts.push(rod(T, P(1.24, 0.31, 0.21), P(1.42, 0.44, 0.76), R, seg, 1.5));
      parts.push(rod(T, P(1.68, 0.12, 0.15), P(1.42, 0.19, 0.78), R, seg, 1.5));
      parts.push(rod(T, P(1.2, 0.12, 0.17), P(1.42, 0.19, 0.78), R, seg, 1.5));
      parts.push(rod(T, P(1.4, 0.2, 0.74), P(1.36, 0.4, 0.19), R * 0.9, seg));
      parts.push(rod(T, P(1.3, 0.17, 0.16), P(1.31, 0.2, 0.76), R * 0.75, seg));
      // rear
      parts.push(rod(T, P(-1.22, 0.4, 0.14), P(-1.42, 0.5, 0.66), R, seg, 1.5));
      parts.push(rod(T, P(-1.64, 0.38, 0.12), P(-1.42, 0.5, 0.66), R, seg, 1.5));
      parts.push(rod(T, P(-1.16, 0.12, 0.15), P(-1.42, 0.19, 0.68), R, seg, 1.5));
      parts.push(rod(T, P(-1.68, 0.13, 0.12), P(-1.42, 0.19, 0.68), R, seg, 1.5));
      parts.push(rod(T, P(-1.42, 0.21, 0.64), P(-1.39, 0.45, 0.14), R * 0.9, seg));
      parts.push(rod(T, P(-1.64, 0.19, 0.12), P(-1.6, 0.21, 0.66), R * 0.75, seg));
    }
    add(mergeSimple(T, parts), 'susp');
    const shafts = [];
    for (const sd of [1, -1]) shafts.push(rod(T, [-1.42, 0.33, sd * 0.1], [-1.42, 0.352, sd * 0.66], 0.022, seg));
    add(mergeSimple(T, shafts), 'darkMetal');
  }

  /* ---- wheels ---- */
  const tyreGeo = (spec) => {
    const { R, W, rim } = spec;
    const hw = W / 2 * 0.95;
    const rc = Math.min(0.065, W * 0.2);
    const pts = [];
    const NSW = hi ? 14 : 6;
    const NA = hi ? 10 : 4;
    const NT = hi ? 12 : 4;
    pts.push(new T.Vector2(rim - 0.004, -hw + 0.012));
    for (let i = 0; i <= NSW; i++) {
      const t = i / NSW;
      pts.push(new T.Vector2(lerp(rim, R - rc, t), -hw - 0.016 * Math.sin(PI * Math.pow(t, 0.8))));
    }
    for (let i = 1; i <= NA; i++) {
      const a = -PI / 2 + (i / NA) * (PI / 2);
      pts.push(new T.Vector2(R - rc + Math.cos(a) * rc, -hw + rc + Math.sin(a) * rc));
    }
    for (let i = 1; i < NT; i++) {
      const y = lerp(-hw + rc, hw - rc, i / NT);
      pts.push(new T.Vector2(R + 0.003 * (1 - Math.pow(y / hw, 2)), y));
    }
    for (let i = 0; i <= NA; i++) {
      const a = (i / NA) * (PI / 2);
      pts.push(new T.Vector2(R - rc + Math.cos(a) * rc, hw - rc + Math.sin(a) * rc));
    }
    for (let i = 1; i <= NSW; i++) {
      const t = 1 - i / NSW;
      pts.push(new T.Vector2(lerp(rim, R - rc, t), hw + 0.016 * Math.sin(PI * Math.pow(t, 0.8))));
    }
    pts.push(new T.Vector2(rim - 0.004, hw - 0.012));
    const g = new T.LatheGeometry(pts, hi ? 128 : 48);
    g.rotateX(PI / 2);
    return g;
  };
  const barrelGeo = (spec) => {
    const { W, rim } = spec;
    const hw = W / 2;
    const pts = [
      new T.Vector2(rim - 0.006, -hw * 0.9),
      new T.Vector2(rim - 0.006, hw * 0.86),
      new T.Vector2(rim + 0.004, hw * 0.9),
      new T.Vector2(rim + 0.012, hw * 0.93),
      new T.Vector2(rim + 0.008, hw * 0.95),
    ];
    const g = new T.LatheGeometry(pts, hi ? 96 : 40);
    g.rotateX(PI / 2);
    return g;
  };
  const spokeGeo = (spec) => {
    const rOut = spec.rim - 0.008;
    const N = 10;
    const sh = new T.Shape();
    sh.absarc(0, 0, rOut, 0, TAU, false);
    const r1 = 0.06;
    const r2 = rOut - 0.02;
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * TAU, a1 = ((k + 1) / N) * TAU;
      const d2 = 0.011 / r2, d1 = 0.016 / r1;
      const h = new T.Path();
      h.absarc(0, 0, r2, a0 + d2, a1 - d2, false);
      h.absarc(0, 0, r1, a1 - d1, a0 + d1, true);
      sh.holes.push(h);
    }
    let g = new T.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.0025, bevelSegments: hi ? 2 : 1, curveSegments: hi ? 10 : 4 });
    g = smoothNormals(T, g, 45);
    planarUV(T, g, 'xy');
    return g;
  };
  const gF = { tyre: keep(tyreGeo(FW)), barrel: keep(barrelGeo(FW)), spokes: keep(spokeGeo(FW)) };
  const gR = { tyre: keep(tyreGeo(RW)), barrel: keep(barrelGeo(RW)), spokes: keep(spokeGeo(RW)) };
  const hubGeo = keep(new T.CylinderGeometry(0.05, 0.055, 0.05, hi ? 32 : 12).rotateX(PI / 2));
  const nutGeo = keep(new T.CylinderGeometry(0.03, 0.03, 0.04, 6).rotateX(PI / 2));
  const discGeo = keep((() => {
    if (!hi) return new T.CylinderGeometry(FW.disc, FW.disc, 0.028, 20).rotateX(PI / 2);
    const parts = [];
    for (const zz of [-0.0095, 0.0095]) {
      const pl = new T.CylinderGeometry(FW.disc, FW.disc, 0.009, 64, 1, false);
      pl.rotateX(PI / 2);
      pl.translate(0, 0, zz);
      parts.push(pl);
    }
    const NV = 40;
    for (let k = 0; k < NV; k++) {
      const a = (k / NV) * TAU;
      const v = new T.BoxGeometry(0.05, 0.005, 0.011);
      v.translate(FW.disc - 0.026, 0, 0);
      v.rotateZ(a + 0.25);
      parts.push(v);
    }
    return mergeSimple(T, parts);
  })());
  const hatGeo = keep(new T.CylinderGeometry(0.075, 0.085, 0.05, hi ? 32 : 12, 1, true).rotateX(PI / 2));
  const calGeo = keep(new T.BoxGeometry(0.06, 0.1, 0.05));
  const uprGeo = keep(new T.BoxGeometry(0.06, 0.26, 0.05));
  const addShared = (geo, matKey, parent) => {
    const m = new T.Mesh(geo, mats[matKey]);
    m.userData.mat = matKey;
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const wheels = [];
  const wheelSpec = [[FW, gF, 1], [FW, gF, -1], [RW, gR, 1], [RW, gR, -1]];
  for (const [spec, gg, sd] of wheelSpec) {
    const wg = new T.Group();
    wg.position.set(spec.x, spec.R, sd * spec.z);
    if (sd < 0) wg.rotation.y = PI;
    const spin = new T.Group();
    spin.userData.radius = spec.R;
    spin.userData.side = sd;
    wg.add(spin);
    addShared(gg.tyre, 'rubber', spin);
    addShared(gg.barrel, 'rim', spin);
    const faceZ = spec.W / 2 * 0.9 - spec.dish;
    const sp = addShared(gg.spokes, 'rim', spin);
    sp.position.z = faceZ - 0.012;
    const hub = addShared(hubGeo, 'rim', spin);
    hub.position.z = faceZ + 0.01;
    const nut = addShared(nutGeo, 'darkMetal', spin);
    nut.position.z = faceZ + 0.035;
    const disc = addShared(discGeo, 'disc', spin);
    disc.position.z = faceZ - 0.07;
    const hat = addShared(hatGeo, 'darkMetal', spin);
    hat.position.z = faceZ - 0.04;
    const cal = addShared(calGeo, 'darkMetal', wg);
    cal.position.set(-Math.cos(0.7) * 0.11 * (spec.x > 0 ? 1 : -1), Math.sin(0.7) * 0.11, faceZ - 0.07);
    cal.rotation.z = (spec.x > 0 ? -1 : 1) * 0.7;
    const up = addShared(uprGeo, 'susp', wg);
    up.position.z = faceZ - 0.12;
    inner.add(wg);
    wheels.push(spin);
  }

  const group = new T.Group();
  inner.rotation.y = PI / 2; // nose +X -> -Z
  group.add(inner);

  let rolled = 0;
  const roll = (dist) => {
    rolled += dist;
    for (const w of wheels) w.rotation.z = -(rolled / w.userData.radius) * w.userData.side;
  };

  let tris = 0;
  inner.traverse((o) => {
    if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });

  const textures = Object.values(tex);
  return {
    group,
    wheels,
    roll,
    triangles: Math.round(tris),
    materials: mats,
    dispose() {
      geoms.forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
    _internal: { inner, U, makeMirrorMaterials: () => makeCarMaterials(T, tex, U, cfg, true) },
  };
}

/* ------------------------------------------------------------------ */
/* Studio textures                                                     */
/* ------------------------------------------------------------------ */
function buildContactShadow() {
  // Plane covers x in [-2.8, 2.8] (canvas width), z in [-1.5, 1.5] (height).
  const W = 1024, H = 512;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const X = (x) => ((x + 2.8) / 5.6) * W;
  const Z = (z) => ((z + 1.5) / 3.0) * H;
  g.filter = 'blur(26px)';
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.ellipse(X(-0.1), Z(0), (2.35 / 5.6) * W, (0.95 / 3) * H, 0, 0, TAU);
  g.fill();
  g.filter = 'blur(12px)';
  g.fillStyle = 'rgba(0,0,0,0.65)';
  g.fillRect(X(-1.6), Z(-0.68), X(0.5) - X(-1.6), Z(0.68) - Z(-0.68));
  g.fillRect(X(-0.2), Z(-0.25), X(2.1) - X(-0.2), Z(0.25) - Z(-0.25));
  g.filter = 'blur(7px)';
  g.fillStyle = 'rgba(0,0,0,0.95)';
  for (const [x, z, w, l] of [[FW.x, FW.z, FW.W, 0.2], [FW.x, -FW.z, FW.W, 0.2], [RW.x, RW.z, RW.W, 0.24], [RW.x, -RW.z, RW.W, 0.24]]) {
    g.beginPath();
    g.ellipse(X(x), Z(z), (l / 5.6) * W, (w * 0.55 / 3) * H, 0, 0, TAU);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildFloorAlpha() {
  const S = 512;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, '#fff');
  gr.addColorStop(0.3, '#eee');
  gr.addColorStop(0.62, '#555');
  gr.addColorStop(1, '#000');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */
function noopCar() {
  const n = () => {};
  return { failed: true, hotspots: [], setProgress: n, setPointer: n, setVelocity: n, resize: n, start: n, stop: n, renderOnce: n, dispose: n };
}

// Camera choreography keys: azimuth th (deg, 0 = in front, 90 = right side),
// elevation ph (deg), distance d, look target (tx, ty).
const KEYS = [
  { p: 0.0, th: 26, ph: 3.5, d: 7.6, tx: 0.15, ty: 0.26 },
  { p: 0.12, th: 34, ph: 9, d: 6.5, tx: 0.05, ty: 0.3 },
  { p: 0.2, th: 40, ph: 10, d: 6.3, tx: 0.0, ty: 0.3 },
  { p: 0.31, th: 90, ph: 3, d: 7.7, tx: -0.1, ty: 0.36 },
  { p: 0.42, th: 92, ph: 4.5, d: 7.5, tx: -0.1, ty: 0.36 },
  { p: 0.53, th: 90, ph: 86, d: 7.8, tx: -0.12, ty: 0.0 },
  { p: 0.63, th: 90, ph: 86, d: 7.5, tx: -0.12, ty: 0.0 },
  { p: 0.74, th: 152, ph: 7, d: 5.3, tx: -1.25, ty: 0.42 },
  { p: 0.85, th: 146, ph: 9, d: 5.6, tx: -1.05, ty: 0.42 },
  { p: 1.0, th: 122, ph: 16, d: 10.5, tx: 0.6, ty: 0.3 },
];
function poseAt(p) {
  let i = 0;
  while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const e = easeInOut((p - a.p) / (b.p - a.p));
  return { th: lerp(a.th, b.th, e), ph: lerp(a.ph, b.ph, e), d: lerp(a.d, b.d, e), tx: lerp(a.tx, b.tx, e), ty: lerp(a.ty, b.ty, e) };
}

export function createCar3D(canvas, { reducedMotion = false, dpr = Math.min(window.devicePixelRatio || 1, 2) } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    if (!renderer.getContext()) throw new Error('no ctx');
  } catch (e) {
    return noopCar();
  }

  let model;
  try {
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    RectAreaLightUniformsLib.init();
    model = createCarModel(THREE, { detail: 'high' });
  } catch (e) {
    try { renderer.dispose(); } catch (_) { /* ignore */ }
    return noopCar();
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 80);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment(renderer);
  const envRT = pmrem.fromScene(roomEnv, 0.04);
  scene.environment = envRT.texture;
  roomEnv.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });

  /* ---- lights: soft area boxes, shadowed key, palette rims ---- */
  const topBox = new THREE.RectAreaLight(0xffffff, 3.2, 6, 1.8);
  topBox.position.set(0, 4.4, 0.3);
  topBox.lookAt(0, 0, 0);
  const sideBox = new THREE.RectAreaLight(0xfff3e6, 2.2, 4.5, 1.2);
  sideBox.position.set(1.8, 1.9, 4.6);
  sideBox.lookAt(0, 0.3, 0);
  const backBox = new THREE.RectAreaLight(0xe6eeff, 2.2, 4, 1);
  backBox.position.set(-2.5, 1.6, -4.2);
  backBox.lookAt(0, 0.3, 0);
  const key = new THREE.DirectionalLight(0xfff1e0, 1.1);
  key.position.set(2.2, 6.5, 2.8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -3.2, right: 3.2, top: 3.2, bottom: -3.2, near: 1, far: 16 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 3;
  const rimY = new THREE.DirectionalLight(0xffdf00, 0.28);
  rimY.position.set(-4, 1.4, -2.6);
  const rimG = new THREE.DirectionalLight(0x00a651, 0.35);
  rimG.position.set(3.5, 0.9, -3.8);
  const rimB = new THREE.DirectionalLight(0x1b4fd8, 0.6);
  rimB.position.set(-3.6, 1.0, 3.4);
  scene.add(topBox, sideBox, backBox, key, key.target, rimY, rimG, rimB, new THREE.AmbientLight(0x1a2620, 0.25));

  /* ---- car ---- */
  const carRoot = new THREE.Group(); // nose +X
  model.group.rotation.y = -PI / 2;
  carRoot.add(model.group);
  scene.add(carRoot);
  const U = model._internal.U;
  const inner = model._internal.inner;

  /* ---- floor: glossy dark plane, contact shadow, mirrored fade ---- */
  const floorAlpha = buildFloorAlpha();
  const floorMat = new THREE.MeshBasicMaterial({
    color: 0x07110d, transparent: true, alphaMap: floorAlpha, opacity: 0.84, depthWrite: false, toneMapped: false,
  });
  const floorGeo = new THREE.PlaneGeometry(36, 36);
  floorGeo.rotateX(-PI / 2);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.renderOrder = -2;
  scene.add(floor);

  const shadowTex = buildContactShadow();
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.9 });
  const shadowGeo = new THREE.PlaneGeometry(5.6, 3.0);
  shadowGeo.rotateX(-PI / 2);
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.position.y = 0.002;
  shadow.renderOrder = -1;
  carRoot.add(shadow);

  const mirrorMats = model._internal.makeMirrorMaterials();
  const mirrorPairs = [];
  const reflectM = new THREE.Matrix4().makeScale(1, -1, 1);
  inner.traverse((o) => {
    if (!o.isMesh || !o.userData.mat) return;
    const mm = new THREE.Mesh(o.geometry, mirrorMats[o.userData.mat]);
    mm.matrixAutoUpdate = false;
    mm.renderOrder = -3;
    scene.add(mm);
    mirrorPairs.push([o, mm]);
  });

  /* ---- heat haze behind the gearbox (cheap shimmering planes) ---- */
  const hazeU = { uTime: { value: 0 }, uAmt: { value: 0 } };
  const hazeMat = new THREE.ShaderMaterial({
    uniforms: hazeU,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uAmt;
      void main(){
        float w = sin(vUv.y * 38.0 - uTime * 9.0 + sin(vUv.x * 11.0 + uTime * 2.7) * 2.2);
        float w2 = sin(vUv.y * 21.0 - uTime * 6.0 + vUv.x * 7.0);
        float n = smoothstep(0.55, 1.0, w * 0.6 + w2 * 0.4);
        float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.55, vUv.x) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
        gl_FragColor = vec4(vec3(1.0, 0.82, 0.62) * n * edge * uAmt * 0.07, 1.0);
      }`,
  });
  const hazeGeo = new THREE.PlaneGeometry(0.7, 0.5);
  const hazeGroup = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const m = new THREE.Mesh(hazeGeo, hazeMat);
    m.position.set(-2.25 - k * 0.12, 0.38, 0);
    m.rotation.y = k === 1 ? PI / 2 : (k - 1) * 0.5;
    hazeGroup.add(m);
  }
  carRoot.add(hazeGroup);

  /* ---- hotspots ---- */
  const HS = [
    { id: 'front-wing', label: 'Two-element front wing', p: 0.1, a: [1.98, 0.12, 0.55], n: [0.6, 0.6, 0.5] },
    { id: 'cockpit', label: 'Reclined driving position', p: 0.33, a: [0.14, 0.6, 0.0], n: [0, 1, 0.2] },
    { id: 'sidepod', label: 'Low sidepod & radiator inlet', p: 0.55, a: [-0.25, 0.35, 0.62], n: [0, 0.6, 1] },
    { id: 'rear-wing', label: 'Rear wing & beam wing', p: 0.75, a: [-2.12, 0.92, 0.3], n: [-0.6, 0.6, 0.3] },
    { id: 'rear-tyre', label: 'Rear slick', p: 0.8, a: [-1.42, 0.38, RW.z + RW.W / 2], n: [-0.2, 0.2, 1] },
  ];
  const _v = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const hotspots = HS.map((h) => ({
    id: h.id,
    label: h.label,
    p: h.p,
    getScreen() {
      if (disposed) return { x: 0, y: 0, visible: false };
      _v.set(...h.a).applyMatrix4(carRoot.matrixWorld);
      _n.set(...h.n).normalize();
      _c.copy(camera.position).sub(_v);
      const facing = _n.dot(_c.normalize()) > -0.15;
      _v.project(camera);
      const w = canvas.clientWidth || window.innerWidth;
      const hh = canvas.clientHeight || window.innerHeight;
      const visible = facing && _v.z < 1 && Math.abs(_v.x) < 1 && Math.abs(_v.y) < 1;
      return { x: (_v.x * 0.5 + 0.5) * w, y: (-_v.y * 0.5 + 0.5) * hh, visible };
    },
  }));

  /* ---- state ---- */
  const target = { p: 0, px: 0, py: 0, v: 0 };
  const cur = { p: 0, px: 0, py: 0, v: 0 };
  let running = false;
  let raf = 0;
  let last = 0;
  let time = 0;
  let disposed = false;
  let fit = 1;
  let rollDist = 0;
  let lastCarX = 0;
  let prevPForBlur = 0;
  let pixW = 1, pixH = 1;

  /* ---- post-processing + reflective floor (loaded async, tiered) ---- */
  // tier 2: AO + DOF + bloom + grade + reflector, tier 1: bloom + grade + reflector,
  // tier 0: plain render with the mirrored-instance floor (always available).
  const fx = { ready: false, composer: null, gtao: null, bokeh: null, bloom: null, grade: null, reflector: null };
  let tier = 2;
  let maxTier = 2;
  let fxMode = false;
  let perfAcc = 0, perfN = 0, perfWarm = 90;
  const FX_PR = () => Math.min(dpr, 1.5);

  function applyTier(t) {
    tier = Math.max(0, Math.min(t, maxTier));
    fxMode = fx.ready && tier >= 1;
    floor.visible = !fxMode;
    if (fx.reflector) fx.reflector.visible = fxMode;
    renderer.setClearColor(0x000000, fxMode ? 1 : 0);
    if (fx.gtao) fx.gtao.enabled = tier >= 2;
    if (fx.bokeh) fx.bokeh.enabled = tier >= 2;
    perfAcc = 0; perfN = 0; perfWarm = 90;
  }

  const ReflectorFloorShader = {
    uniforms: {
      color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
      uCenter: { value: new THREE.Vector2(0, 0) }, uStrength: { value: 0.34 }, uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
      uPool: { value: new THREE.Color(0x0b1814) },
    },
    vertexShader: `uniform mat4 textureMatrix; varying vec4 vUvR; varying vec3 vW;
      void main(){ vUvR = textureMatrix * vec4(position, 1.0); vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 color; uniform vec2 uCenter; uniform float uStrength; uniform vec2 uTexel; uniform vec3 uPool;
      varying vec4 vUvR; varying vec3 vW;
      void main(){
        vec2 uv = vUvR.xy / vUvR.w;
        vec2 d = (vW.xz - uCenter) * vec2(0.36, 0.62);
        float r = length(d);
        // roughness falloff: reflection softens and fades away from the car
        float blur = 1.5 + 9.0 * smoothstep(0.1, 1.4, r);
        vec3 acc = vec3(0.0); float ws = 0.0;
        float rot = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2832;
        for (int i = 0; i < 24; i++) {
          float fi = float(i);
          float rr = sqrt((fi + 0.5) / 24.0);
          float a = fi * 2.39996 + rot;
          vec2 o = vec2(cos(a), sin(a)) * rr * blur * 1.5;
          float w = 1.0 - rr * 0.6;
          acc += min(texture2D(tDiffuse, uv + o * uTexel).rgb, vec3(1.5)) * w; ws += w;
        }
        vec3 refl = acc / ws;
        float fade = 1.0 - smoothstep(0.55, 1.7, r);
        vec3 pool = uPool * (1.0 - smoothstep(0.2, 1.9, r));
        gl_FragColor = vec4(color + pool + refl * uStrength * fade, 1.0);
      }`,
  };

  const GradeShader = {
    uniforms: {
      tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uBlur: { value: 0 },
      uCA: { value: 0.0022 }, uVig: { value: 0.42 }, uGrain: { value: 0.022 }, uBg: { value: new THREE.Vector3(7 / 255, 17 / 255, 13 / 255) },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uBlur; uniform float uCA; uniform float uVig; uniform float uGrain;
      uniform vec2 uRes; uniform vec3 uBg; varying vec2 vUv;
      float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      vec3 tap(vec2 uv, vec2 c, float ca){
        return vec3(texture2D(tDiffuse, uv + c * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - c * ca).b);
      }
      void main(){
        vec2 c = vUv - 0.5;
        float ca = uCA * (0.3 + 2.4 * dot(c, c));
        vec3 col = tap(vUv, c, ca);
        if (uBlur > 0.002) {
          // radial speed blur, stronger toward the frame edges
          vec3 acc = col; float w = 1.0;
          for (int i = 1; i <= 7; i++) {
            float t = float(i) / 7.0; float ww = 1.0 - t * 0.65;
            acc += tap(vUv - c * uBlur * t * 0.07 * length(c) * 2.0, c, ca) * ww; w += ww;
          }
          col = acc / w;
        }
        // filmic grade in display space: gain / gamma, cool shadows, warm highlights
        col *= vec3(1.025, 1.0, 0.975);
        col = pow(max(col, 0.0), vec3(1.0 / 1.05));
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col += vec3(-0.008, 0.002, 0.014) * smoothstep(0.0, 0.06, l) * (1.0 - smoothstep(0.06, 0.4, l));
        col += vec3(0.03, 0.012, -0.022) * smoothstep(0.45, 1.0, l);
        col = max(mix(vec3(l), col, 1.05), 0.0);
        vec2 vc = c * vec2(uRes.x / uRes.y, 1.0);
        col *= 1.0 - uVig * smoothstep(0.32, 1.05, length(vc));
        // lift black to the page background so the frame melts into the section
        col = uBg + col * (1.0 - uBg);
        col += (hh(vUv * uRes + fract(uTime * 7.13) * 91.7) - 0.5) * uGrain;
        gl_FragColor = vec4(col, 1.0);
      }`,
  };

  async function setupFX() {
    const base = 'three/addons/';
    const [{ EffectComposer }, { RenderPass }, { ShaderPass }, { UnrealBloomPass }, { BokehPass }, { OutputPass }, { Reflector }] = await Promise.all([
      import(base + 'postprocessing/EffectComposer.js'),
      import(base + 'postprocessing/RenderPass.js'),
      import(base + 'postprocessing/ShaderPass.js'),
      import(base + 'postprocessing/UnrealBloomPass.js'),
      import(base + 'postprocessing/BokehPass.js'),
      import(base + 'postprocessing/OutputPass.js'),
      import(base + 'objects/Reflector.js'),
    ]);
    let AOPass = null;
    let aoKind = '';
    try { AOPass = (await import(base + 'postprocessing/GTAOPass.js')).GTAOPass; aoKind = 'gtao'; } catch (e) {
      try { AOPass = (await import(base + 'postprocessing/SAOPass.js')).SAOPass; aoKind = 'sao'; } catch (e2) { AOPass = null; }
    }
    if (disposed) return;

    const w = Math.max(1, canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    const pr = FX_PR();

    const rGeo = new THREE.PlaneGeometry(36, 36);
    const reflector = new Reflector(rGeo, {
      textureWidth: Math.round(w * pr * 0.5), textureHeight: Math.round(h * pr * 0.5),
      color: 0x000000, shader: ReflectorFloorShader, multisample: 0,
    });
    reflector.rotation.x = -PI / 2;
    reflector.renderOrder = -2;
    const rOBR = reflector.onBeforeRender;
    // skip the reflection pass while AO/DOF render depth or normal overrides
    reflector.onBeforeRender = function (r, sc, cam) { if (sc.overrideMaterial) return; rOBR.call(this, r, sc, cam); };
    scene.add(reflector);

    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    composer.addPass(new RenderPass(scene, camera));
    let ao = null;
    if (AOPass && aoKind === 'gtao') {
      ao = new AOPass(scene, camera, w, h);
      ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 16, distanceFallOff: 1.0 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      ao.blendIntensity = 0.9;
    } else if (AOPass) {
      ao = new AOPass(scene, camera);
      Object.assign(ao.params, { saoIntensity: 0.02, saoScale: 4, saoKernelRadius: 30, saoBlur: true });
    }
    if (ao) composer.addPass(ao);
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.1, 0.35, 1.1);
    composer.addPass(bloom);
    const bokeh = new BokehPass(scene, camera, { focus: 7, aperture: 0.0006, maxblur: 0.004 });
    composer.addPass(bokeh);
    composer.addPass(new OutputPass());
    const grade = new ShaderPass(GradeShader);
    composer.addPass(grade);

    Object.assign(fx, { ready: true, composer, gtao: ao, bokeh, bloom, grade, reflector, rGeo });
    resize();
    applyTier(maxTier);
    if (!running) { update(10); render(); }
  }

  /* ---- optional HDRI + scanned carbon textures (used only if present) ---- */
  let hdrRT = null;
  const extraTex = [];
  const exists = async (url) => {
    try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch (e) { return false; }
  };
  async function loadOptionalAssets() {
    const hdrUrl = new URL('../assets/hdr/studio.hdr', import.meta.url).href;
    if (await exists(hdrUrl)) {
      try {
        const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
        const tex = await new RGBELoader().loadAsync(hdrUrl);
        if (disposed) { tex.dispose(); return; }
        hdrRT = pmrem.fromEquirectangular(tex);
        tex.dispose();
        scene.environment = hdrRT.texture;
      } catch (e) { /* keep RoomEnvironment */ }
    }
    const cb = (n) => new URL(`../assets/tex/carbon/${n}.jpg`, import.meta.url).href;
    // No scanned carbon set ships with the site yet; flip this on after adding assets/tex/carbon/*.jpg
    // (skipping the probe keeps the console free of 404s).
    const USE_SCANNED_CARBON = false;
    if (USE_SCANNED_CARBON && await exists(cb('basecolor'))) {
      try {
        const L = new THREE.TextureLoader();
        const [bc, nm, rg] = await Promise.all(['basecolor', 'normal', 'roughness'].map((n) => L.loadAsync(cb(n)).catch(() => null)));
        if (disposed) return;
        bc && (bc.colorSpace = THREE.SRGBColorSpace);
        for (const t of [bc, nm, rg]) {
          if (!t) continue;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.repeat.set(4, 4);
          t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          extraTex.push(t);
        }
        for (const set of [model.materials, mirrorMats]) {
          for (const k of ['carbon', 'carbonDS']) {
            const m = set[k];
            if (bc) m.map = bc;
            if (nm) m.normalMap = nm;
            if (rg) { m.roughnessMap = rg; m.roughness = 1; }
            m.needsUpdate = true;
          }
        }
      } catch (e) { /* keep procedural carbon */ }
    }
    if (!running && !disposed) { update(10); render(); }
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    fit = Math.max(1, Math.pow(1.6 / camera.aspect, 0.92));
    pixW = w; pixH = h;
    const newMax = w < 720 ? 1 : 2;
    if (newMax !== maxTier) { maxTier = newMax; if (fx.ready) applyTier(Math.min(tier || newMax, newMax)); }
    if (fx.ready) {
      const pr = FX_PR();
      fx.composer.setPixelRatio(pr);
      fx.composer.setSize(w, h);
      fx.grade.uniforms.uRes.value.set(w * pr, h * pr);
      const rw = Math.round(w * pr * 0.5), rh = Math.round(h * pr * 0.5);
      fx.reflector.getRenderTarget().setSize(rw, rh);
      fx.reflector.material.uniforms.uTexel.value.set(1 / rw, 1 / rh);
    }
  }

  function update(dt) {
    const snap = reducedMotion || dt > 1;
    const k = (r) => (snap ? 1 : 1 - Math.exp(-dt * r));
    const prevP = cur.p;
    cur.p += (target.p - cur.p) * k(6);
    cur.px += (target.px - cur.px) * k(3.5);
    cur.py += (target.py - cur.py) * k(3.5);
    cur.v += (target.v - cur.v) * k(4);
    if (!snap) time += dt;

    const p = reducedMotion ? 0.16 : cur.p;
    const pose = poseAt(p);
    const th = (pose.th + cur.px * 4) * DEG;
    const ph = Math.min(86.5, Math.max(1.5, pose.ph - cur.py * 3)) * DEG;

    const carX = reducedMotion ? 0 : 2.2 * Math.pow(sstep(0.85, 1.0, p), 1.6);
    carRoot.position.x = carX;
    U.uCarX.value = carX;

    // Wheels: roll with the car + spin from scroll delta and velocity.
    if (!reducedMotion) {
      rollDist += (carX - lastCarX) + (cur.p - prevP) * 9 + cur.v * dt * 5;
    }
    lastCarX = carX;
    model.roll(rollDist - (model._rolled || 0));
    model._rolled = rollDist;

    // Rising from darkness + light sweep along the bodywork (p 0..0.2).
    const lit = reducedMotion ? 1 : lerp(0.1, 1, sstep(0.0, 0.13, p)) * (1 - 0.32 * sstep(0.88, 1.0, p));
    renderer.toneMappingExposure = lit;
    const sw = sstep(0.03, 0.21, p);
    U.uSweepX.value = lerp(2.7, -2.8, sw);
    U.uSweepAmt.value = reducedMotion ? 0 : Math.sin(PI * sw);
    U.uMirrorAmt.value = 0.32;

    hazeU.uTime.value = time;
    hazeU.uAmt.value = reducedMotion ? 0 : Math.min(1, Math.abs(cur.v) * 1.2);
    hazeGroup.visible = hazeU.uAmt.value > 0.01;

    const tx = pose.tx + carX * 0.5;
    const d = pose.d * fit;
    // subtle handheld drift (layered slow sines), scaled with distance
    const hm = reducedMotion ? 0 : 0.0022 * d;
    const n1 = Math.sin(time * 0.61) + 0.5 * Math.sin(time * 1.73 + 1.3);
    const n2 = Math.sin(time * 0.47 + 2.1) + 0.5 * Math.sin(time * 1.31 + 0.4);
    const n3 = Math.sin(time * 0.53 + 4.2) + 0.5 * Math.sin(time * 1.57 + 2.2);
    camera.position.set(
      tx + d * Math.cos(ph) * Math.cos(th) + n1 * hm,
      pose.ty + d * Math.sin(ph) + n2 * hm,
      d * Math.cos(ph) * Math.sin(th) + n3 * hm,
    );
    camera.lookAt(tx + n3 * hm * 0.4, pose.ty + n1 * hm * 0.3, 0);

    if (fx.ready) {
      // focus on the car, shallower depth of field in close-ups
      fx.bokeh.uniforms.focus.value = camera.position.distanceTo(_c.set(tx, pose.ty, 0));
      fx.bokeh.uniforms.aperture.value = lerp(0.0009, 0.00025, sstep(5, 10, d));
      const pv = snap ? 0 : Math.abs(cur.p - prevPForBlur) / Math.max(dt, 1e-3);
      const roll = sstep(0.86, 1.0, p) * 0.35;
      fx.grade.uniforms.uBlur.value = reducedMotion ? 0 : Math.min(1, Math.abs(cur.v) * 0.7 + pv * 2.5 + roll);
      fx.grade.uniforms.uTime.value = time;
      fx.reflector.material.uniforms.uCenter.value.set(carX - 0.1, 0);
    }
    prevPForBlur = cur.p;

    key.position.set(carX + 2.2, 6.5, 2.8);
    key.target.position.set(carX - 0.1, 0, 0);

    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    for (const [o, mm] of mirrorPairs) {
      mm.matrix.multiplyMatrices(reflectM, o.matrixWorld);
      mm.matrixWorld.copy(mm.matrix);
      mm.visible = o.visible && !fxMode;
    }
  }

  function render() {
    if (fxMode && fx.composer) fx.composer.render();
    else renderer.render(scene, camera);
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const raw = (now - last) / 1000 || 0.016;
    const dt = Math.min(0.1, raw);
    last = now;
    update(dt);
    render();
    // quality governor: step down when frames take longer than ~22 ms
    if (document.visibilityState === 'visible' && raw < 0.25) {
      if (perfWarm > 0) perfWarm--;
      else {
        perfAcc += raw; perfN++;
        if (perfN >= 90) {
          if (perfAcc / perfN > 0.022 && tier > 0) applyTier(tier - 1);
          perfAcc = 0; perfN = 0;
        }
      }
    }
  }

  resize();
  update(10);
  setupFX().catch(() => { /* stay on the plain renderer */ });
  loadOptionalAssets();

  return {
    failed: false,
    hotspots,
    triangles: model.triangles,
    setProgress(v) { target.p = clamp01(+v || 0); },
    setPointer(x, y) {
      if (reducedMotion) return;
      target.px = Math.max(-1, Math.min(1, +x || 0));
      target.py = Math.max(-1, Math.min(1, +y || 0));
    },
    setVelocity(v) { target.v = Math.max(-1, Math.min(1, +v || 0)); },
    resize() { resize(); if (!running) { update(10); render(); } },
    start() {
      if (disposed) return;
      if (reducedMotion) { update(10); render(); return; }
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    renderOnce() {
      if (disposed) return;
      update(10);
      render();
    },
    get quality() { return { tier, fx: fxMode }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      cancelAnimationFrame(raf);
      model.dispose();
      Object.values(mirrorMats).forEach((m) => m.dispose());
      [floorGeo, shadowGeo, hazeGeo].forEach((g) => g.dispose());
      [floorMat, shadowMat, hazeMat].forEach((m) => m.dispose());
      [floorAlpha, shadowTex].forEach((t) => t.dispose());
      if (fx.ready) {
        fx.composer.passes.forEach((ps) => ps.dispose && ps.dispose());
        fx.composer.dispose && fx.composer.dispose();
        fx.reflector.dispose && fx.reflector.dispose();
        fx.rGeo.dispose();
      }
      if (hdrRT) hdrRT.dispose();
      extraTex.forEach((t) => t.dispose());
      envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
