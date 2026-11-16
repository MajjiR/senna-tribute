// helmet-scene.js
// Procedural late-1980s full-face racing helmet rendered as a product shot on a
// glossy table. Everything is generated in code: no models, no image files, no
// logos, lettering, numbers or sticker panels. The paint is an original abstract
// homage to the Brazilian-flag palette: a yellow shell with ONE swept, tapered
// double ribbon (green -> blue) and a thin cream pinstripe running diagonally
// from the chin bar over the rear crown. It deliberately does not reproduce any
// real helmet livery.

import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const PI = Math.PI;
const TAU = PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
const easeInOut = (t) => {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

const COL = { green: 0x00a651, blue: 0x1b4fd8, cream: 0xf3efe4 };
let FLOOR_Y = -0.8; // recomputed from the built shell so the helmet rests on the table

/* ------------------------------------------------------------------ */
/* Shell surface                                                       */
/* Front faces +Z, up is +Y. theta = azimuth (0 = front, -X side at    */
/* negative theta), phi = polar angle from the crown.                   */
/* ------------------------------------------------------------------ */

// Bottom rim: low at the chin, rising toward the nape.
const phiMax = (theta) => {
  const f = (Math.cos(theta) + 1) / 2;
  return lerp(2.18, 2.66, f * f * (3 - 2 * f));
};

function shellBase(theta, phi, out) {
  const st = Math.sin(theta);
  const ct = Math.cos(theta);
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);

  // Full cheeks below the equator, rounded Bell-style dome above.
  const hr = phi > PI / 2 ? Math.pow(sp, 0.6) : Math.pow(sp, 0.86);

  const zr = 0.585 - 0.055 * ct; // front 0.53, rear 0.64
  const yr = 0.635 - 0.03 * cp; // tall crown 0.605, bottom 0.665
  const xr = 0.5 - 0.02 * Math.max(0, -cp) * Math.max(0, ct);

  let x = xr * hr * st;
  let y = yr * cp;
  let z = zr * hr * ct;

  // Chin bar: forward and down below the eyeport, a touch narrower.
  const fw = Math.pow(Math.max(ct, 0), 1.3);
  const chin = sstep(1.72, 2.3, phi);
  z += 0.2 * fw * chin;
  y -= 0.06 * fw * chin;
  x *= 1 - 0.08 * fw * chin;
  // Chin lip: the lower edge of the chin bar flares out into a small lip.
  const pm = phiMax(theta);
  const lip = fw * sstep(pm - 0.16, pm - 0.02, phi);
  z += 0.032 * lip;
  y -= 0.012 * lip;

  // Flatter, more upright face around the eyeport.
  const face = Math.pow(Math.max(ct, 0), 2) * sstep(0.7, 1.15, phi) * (1 - sstep(1.75, 2.0, phi));
  z -= 0.03 * face;

  // Rear sweeps slightly back low down (aero tail), with a small flare at the rim.
  const bw = Math.pow(Math.max(-ct, 0), 2);
  z -= 0.04 * sstep(1.7, 2.3, phi) * bw;
  const flare = sstep(pm - 0.12, pm, phi) * (0.4 + 0.6 * bw);
  x *= 1 + 0.03 * flare;
  z *= 1 + 0.02 * flare;

  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

const shellPoint = shellBase;

const _a = [0, 0, 0];
const _b = [0, 0, 0];
const _c = [0, 0, 0];
const _d = [0, 0, 0];
function shellNormal(theta, phi, out) {
  const e = 1e-3;
  const p0 = Math.max(phi, 0.02);
  shellPoint(theta + e, p0, _a);
  shellPoint(theta - e, p0, _b);
  shellPoint(theta, p0 + e, _c);
  shellPoint(theta, p0 - e, _d);
  const tx = _a[0] - _b[0], ty = _a[1] - _b[1], tz = _a[2] - _b[2];
  const px = _c[0] - _d[0], py = _c[1] - _d[1], pz = _c[2] - _d[2];
  const nx = py * tz - pz * ty;
  const ny = pz * tx - px * tz;
  const nz = px * ty - py * tx;
  const l = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / l;
  out[1] = ny / l;
  out[2] = nz / l;
  return out;
}

function gridGeometry(segU, segV, fn, skipFirstRowTris = false) {
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const P = [0, 0, 0];
  const N = [0, 0, 0];
  for (let j = 0; j <= segV; j++) {
    for (let i = 0; i <= segU; i++) {
      const u = fn(i / segU, j / segV, P, N);
      pos.push(P[0], P[1], P[2]);
      nor.push(N[0], N[1], N[2]);
      uv.push(u[0], u[1]);
    }
  }
  const row = segU + 1;
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a = j * row + i;
      if (!(skipFirstRowTris && j === 0)) idx.push(a, a + row, a + 1);
      idx.push(a + 1, a + row, a + row + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function buildShellGeometry(segU, segV, inset) {
  return gridGeometry(segU, segV, (u, v, P, N) => {
    const theta = (u - 0.5) * TAU;
    const phi = Math.max(v * phiMax(theta), 1e-4);
    shellPoint(theta, phi, P);
    shellNormal(theta, phi, N);
    if (v === 0) { N[0] = 0; N[1] = 1; N[2] = 0; }
    P[0] -= N[0] * inset; P[1] -= N[1] * inset; P[2] -= N[2] * inset;
    return [u, phi / PI];
  }, true);
}

/* ---- visor ---- */
const VISOR_HALF = 1.56;
function visorBounds(theta) {
  const a = Math.abs(theta);
  const w = sstep(1.02, VISOR_HALF, a);
  const top = lerp(0.98 + 0.035 * a * a, 1.36, w);
  const bot = lerp(1.88 - 0.05 * a * a, 1.64, Math.pow(w, 0.8));
  return [top, bot];
}
const visorOffset = (theta, t) => 0.024 + 0.012 * Math.pow(Math.cos(theta * 0.9), 2) * Math.sin(PI * clamp01(t));

function visorPoint(s, t, extra, P, N) {
  const theta = (s * 2 - 1) * VISOR_HALF;
  const [top, bot] = visorBounds(theta);
  const phi = lerp(top, bot, t);
  shellBase(theta, phi, P);
  shellNormal(theta, phi, N);
  const off = visorOffset(theta, t) + extra;
  P[0] += N[0] * off; P[1] += N[1] * off; P[2] += N[2] * off;
}

function buildVisorGeometry(segU, segV, t0, t1, extra) {
  const g = gridGeometry(segU, segV, (s, tt, P, N) => {
    const t = lerp(t0, t1, tt);
    visorPoint(s, t, extra, P, N);
    return [s, t];
  });
  g.computeVertexNormals();
  return g;
}

// Thickness wall around the visor perimeter so it reads as a proud, solid lens.
function buildVisorEdge(segU, segV, depth) {
  const ring = [];
  for (let i = 0; i <= segU; i++) ring.push([i / segU, 0]);
  for (let j = 1; j <= segV; j++) ring.push([1, j / segV]);
  for (let i = segU - 1; i >= 0; i--) ring.push([i / segU, 1]);
  for (let j = segV - 1; j >= 1; j--) ring.push([0, j / segV]);
  const pos = [];
  const idx = [];
  const P = [0, 0, 0];
  const N = [0, 0, 0];
  for (const [s, t] of ring) {
    visorPoint(s, t, 0, P, N);
    pos.push(P[0], P[1], P[2], P[0] - N[0] * depth, P[1] - N[1] * depth, P[2] - N[2] * depth);
  }
  const n = ring.length;
  for (let k = 0; k < n; k++) {
    const a = k * 2;
    const b = ((k + 1) % n) * 2;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tubeFromPoints(pts, segs, radius, radial) {
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  return new THREE.TubeGeometry(curve, segs, radius, radial, true);
}

// Thin rubber trim around the eyeport, just outside the visor edge.
function buildEyeportTrim() {
  const pts = [];
  const P = [0, 0, 0];
  const N = [0, 0, 0];
  const lim = VISOR_HALF - 0.03;
  const push = (theta, phi) => {
    shellBase(theta, phi, P);
    shellNormal(theta, phi, N);
    pts.push(new THREE.Vector3(P[0] + N[0] * 0.006, P[1] + N[1] * 0.006, P[2] + N[2] * 0.006));
  };
  const M = 80;
  for (let i = 0; i <= M; i++) { const th = lerp(-lim, lim, i / M); push(th, visorBounds(th)[0] - 0.035); }
  for (let i = 0; i <= M; i++) { const th = lerp(lim, -lim, i / M); push(th, visorBounds(th)[1] + 0.03); }
  return tubeFromPoints(pts, 260, 0.0085, 8);
}

// Rolled, stitched lining edge around the neck opening.
function buildNeckRoll() {
  const pts = [];
  const P = [0, 0, 0];
  const N = [0, 0, 0];
  const M = 140;
  for (let i = 0; i < M; i++) {
    const theta = (i / M - 0.5) * TAU;
    const phi = phiMax(theta);
    shellPoint(theta, phi, P);
    shellNormal(theta, phi, N);
    pts.push(new THREE.Vector3(P[0] - N[0] * 0.02, P[1] - N[1] * 0.02 - 0.006, P[2] - N[2] * 0.02));
  }
  return tubeFromPoints(pts, 240, 0.026, 10);
}

const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(0, 0, 1);
function placeOnShell(obj, theta, phi, lift = 0, axis = 'y') {
  const p = shellPoint(theta, phi, [0, 0, 0]);
  const n = shellNormal(theta, phi, [0, 0, 0]);
  obj.position.set(p[0] + n[0] * lift, p[1] + n[1] * lift, p[2] + n[2] * lift);
  obj.quaternion.setFromUnitVectors(axis === 'y' ? _up : _fwd, new THREE.Vector3(n[0], n[1], n[2]));
  return obj;
}

/* ------------------------------------------------------------------ */
/* Procedural textures                                                 */
/* ------------------------------------------------------------------ */
function buildPaintTexture(W = 1024, H = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const data = img.data;

  const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  // Ribbon plane: low on the -X side of the chin bar, back and up behind the
  // visor pivot, over the rear crown, tailing off down the +X back.
  const P1 = v3(shellBase(-1.0, 2.45, [0, 0, 0]));
  const P2 = v3(shellBase(-2.05, 1.08, [0, 0, 0]));
  const P3 = v3(shellBase(2.55, 0.6, [0, 0, 0]));
  const nrm = new THREE.Vector3().subVectors(P2, P1).cross(new THREE.Vector3().subVectors(P3, P1)).normalize();
  const dPlane = nrm.dot(P1);
  const e1 = P1.clone().addScaledVector(nrm, -dPlane).normalize();
  const e2 = new THREE.Vector3().crossVectors(nrm, e1);
  const ang = (P) => Math.atan2(P.dot(e2), P.dot(e1));
  if (ang(P2) < 0) e2.negate();
  let span = ang(P3);
  if (span < 0) span += TAU;

  // Deep yellow, pre-compensated slightly so it stays rich under ACES.
  const yel = [255, 202, 0];
  const grn = [0, 166, 81];
  const blu = [27, 79, 216];
  const crm = [243, 239, 228];
  const p = [0, 0, 0];
  const px = 0.0034;
  const band = (dist, lo, hi) => sstep(lo - px, lo + px, dist) * (1 - sstep(hi - px, hi + px, dist));

  for (let j = 0; j < H; j++) {
    const phi = ((j + 0.5) / H) * PI;
    for (let i = 0; i < W; i++) {
      const theta = ((i + 0.5) / W - 0.5) * TAU;
      shellBase(theta, phi, p);
      const dist = nrm.x * p[0] + nrm.y * p[1] + nrm.z * p[2] - dPlane;
      const t = Math.atan2(
        e2.x * p[0] + e2.y * p[1] + e2.z * p[2],
        e1.x * p[0] + e1.y * p[1] + e1.z * p[2],
      ) / span;

      let r = yel[0], g = yel[1], b = yel[2];
      const k = sstep(-0.1, 1.05, t);
      const tt = clamp01(t / 1.3);

      // Main ribbon: wide at the chin, tapering to a point past the crown.
      const liveA = sstep(-0.6, -0.4, t) * (1 - sstep(1.0, 1.32, t));
      const topA = 0.075 * (1 - 0.75 * tt) * liveA;
      let m = liveA > 0.001 ? band(dist, -0.012, topA) : 0;
      // Second, thinner ribbon below, ending earlier (tapered double ribbon).
      const liveB = sstep(-0.6, -0.4, t) * (1 - sstep(0.62, 0.95, t));
      const wB = 0.03 * (1 - 0.6 * tt) * liveB;
      if (liveB > 0.001) m = Math.max(m, band(dist, -0.034 - wB, -0.034));
      if (m > 0) {
        // the lower ribbon reads slightly bluer: a little depth to the gradient
        const kk = dist < -0.02 ? Math.min(1, k + 0.18) : k;
        r = lerp(r, lerp(grn[0], blu[0], kk), m);
        g = lerp(g, lerp(grn[1], blu[1], kk), m);
        b = lerp(b, lerp(grn[2], blu[2], kk), m);
      }
      // Cream pinstripe above the main ribbon, outliving it a little.
      const liveP = sstep(-0.55, -0.35, t) * (1 - sstep(1.1, 1.42, t));
      if (liveP > 0.001) {
        const c = topA + 0.014;
        const hw = 0.004 * liveP;
        const mp = band(dist - c, -hw, hw);
        r = lerp(r, crm[0], mp);
        g = lerp(g, crm[1], mp);
        b = lerp(b, crm[2], mp);
      }
      const o = (j * W + i) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

// Metallic-flake micro normals (random small tilts), tiled densely.
function buildFlakeTexture(S = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < S * S; i++) {
    const a = rnd() * TAU;
    const m = Math.pow(rnd(), 2) * 0.55;
    img.data[i * 4] = 128 + Math.cos(a) * m * 127;
    img.data[i * 4 + 1] = 128 + Math.sin(a) * m * 127;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(40, 20);
  return t;
}

// Dark fabric with two stitch lines for the neck roll.
function buildStitchTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#141615';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let y = 0; y < 64; y += 2) ctx.fillRect(0, y, 64, 1);
  ctx.fillStyle = '#5d625f';
  for (const y of [14, 46]) ctx.fillRect(10, y, 34, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(150, 1);
  return t;
}

function buildShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0.9)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.6)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

/* ------------------------------------------------------------------ */
/* Procedural environment: sky / horizon / dark track + studio panels  */
/* ------------------------------------------------------------------ */
function buildEnvScene() {
  const s = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(20, 64, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vD;
        void main(){
          float y = vD.y;
          vec3 zenith = vec3(0.30, 0.42, 0.55);
          vec3 horizon = vec3(1.25, 1.18, 1.05);
          vec3 track = vec3(0.025, 0.04, 0.035);
          vec3 c = y > 0.0 ? mix(horizon, zenith, pow(y, 0.45)) : mix(horizon * 0.25, track, pow(-y, 0.3));
          c += vec3(1.6, 1.55, 1.45) * exp(-pow((y - 0.03) * 30.0, 2.0));
          // faint kerb-like palette tint low on the horizon
          float az = atan(vD.z, vD.x);
          c += vec3(0.0, 0.5, 0.25) * 0.35 * smoothstep(0.6, 1.0, sin(az)) * exp(-pow((y + 0.05) * 14.0, 2.0));
          c += vec3(0.1, 0.25, 0.8) * 0.35 * smoothstep(0.6, 1.0, -sin(az)) * exp(-pow((y + 0.05) * 14.0, 2.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  s.add(sky);
  const panel = (w, h, col, k, pos, look) => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    p.position.set(...pos);
    p.lookAt(...look);
    s.add(p);
  };
  panel(8, 2.5, 0xffffff, 5, [1, 7, 4], [0, 0, 0]); // overhead softbox
  panel(1.0, 7, 0xffffff, 4, [-7, 1, 3], [0, 0, 0]); // left strip
  panel(1.0, 7, 0xfff3e0, 3, [7, 1.5, 2], [0, 0, 0]); // right strip
  panel(3, 5, COL.green, 3, [-6, 0.5, -6], [0, 0, 0]);
  panel(3, 5, COL.blue, 3.5, [6, 0.5, -6], [0, 0, 0]);
  return s;
}

/* ------------------------------------------------------------------ */
/* Shader patching                                                     */
/* ------------------------------------------------------------------ */
// Injects world position + optional extras before the final colour write.
function patch(mat, key, { uniforms = {}, fragDecl = '', fragCode = '' }) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    Object.assign(sh.uniforms, uniforms);
    if (!sh.vertexShader.includes('varying vec3 vWPos;')) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vOPos;\nvarying vec2 vUv0;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvOPos = transformed;\nvUv0 = uv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vOPos;\nvarying vec2 vUv0;');
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragDecl}`)
      .replace('#include <opaque_fragment>', `{\n${fragCode}\n}\n#include <opaque_fragment>`);
  };
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.call(mat) : '';
  mat.customProgramCacheKey = () => prevKey + '|' + key;
}

function noopScene() {
  const n = () => {};
  return {
    failed: true,
    setProgress: n, setPointer: n, setVelocity: n, setIntro: n,
    resize: n, start: n, stop: n, renderOnce: n, dispose: n,
  };
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */
export function createHelmetScene(canvas, { reducedMotion = false, dpr = Math.min(window.devicePixelRatio || 1, 2) } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    if (!renderer.getContext()) throw new Error('no ctx');
  } catch (e) {
    return noopScene();
  }

  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = buildEnvScene();
  const envRT = pmrem.fromScene(envScene, 0.02);
  scene.environment = envRT.texture;
  envScene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });

  // Lights: warm key, palette rims, plus a sweep light used during the intro.
  const key = new THREE.DirectionalLight(0xfff2dc, 1.9);
  key.position.set(2.5, 3.5, 4);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35);
  fill.position.set(-3, 1, 3);
  const rimG = new THREE.DirectionalLight(COL.green, 4.5);
  rimG.position.set(-4, 1.5, -3);
  const rimB = new THREE.DirectionalLight(COL.blue, 6.0);
  rimB.position.set(4, 0.8, -3.5);
  const sweepLight = new THREE.DirectionalLight(0xfff8ee, 0);
  scene.add(key, fill, rimG, rimB, sweepLight, new THREE.AmbientLight(0x1c2a24, 0.5));

  /* ---- materials ---- */
  const paint = buildPaintTexture();
  paint.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const flake = buildFlakeTexture();
  const stitch = buildStitchTexture();
  const shadowTex = buildShadowTexture();
  const textures = [paint, flake, stitch, shadowTex];

  const U = {
    uSweep: { value: -2 },
    uSweepAmt: { value: 0 },
    uStreak: { value: -1 },
    uStreakAmt: { value: 0 },
    uFloorY: { value: FLOOR_Y },
  };

  const shellMat = new THREE.MeshPhysicalMaterial({
    map: paint,
    metalness: 0.12,
    roughness: 0.34,
    normalMap: flake,
    normalScale: new THREE.Vector2(0.22, 0.22),
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    envMapIntensity: 0.75,
  });
  patch(shellMat, 'shell', {
    uniforms: U,
    fragDecl: 'uniform float uSweep; uniform float uSweepAmt;',
    fragCode: `
      float d = dot(vOPos, normalize(vec3(0.85, 0.5, 0.15))) - uSweep;
      float band = exp(-d * d * 110.0) + 0.3 * exp(-d * d * 14.0);
      float fres = 0.35 + 0.65 * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 1.5);
      outgoingLight += vec3(1.0, 0.97, 0.9) * band * fres * uSweepAmt * 1.4;`,
  });

  const visorMat = new THREE.MeshPhysicalMaterial({
    color: 0x020304,
    metalness: 0.3,
    roughness: 0.04,
    clearcoat: 1.0,
    clearcoatRoughness: 0.015,
    iridescence: 1.0,
    iridescenceIOR: 1.7,
    iridescenceThicknessRange: [320, 780],
    envMapIntensity: 1.35,
  });
  patch(visorMat, 'visor', {
    uniforms: U,
    fragDecl: 'uniform float uStreak; uniform float uStreakAmt;',
    fragCode: `
      float ndv = abs(dot(normal, normalize(vViewPosition)));
      float graze = pow(1.0 - ndv, 2.5);
      outgoingLight += mix(vec3(0.0, 0.55, 0.32), vec3(0.12, 0.3, 0.95), smoothstep(0.2, 0.8, vUv0.x)) * graze * 0.55;
      float x = vUv0.x + (vUv0.y - 0.5) * 0.35 - uStreak;
      float s = exp(-x * x * 900.0) + 0.5 * exp(-(x + 0.05) * (x + 0.05) * 3000.0);
      float edge = smoothstep(0.0, 0.25, vUv0.y) * smoothstep(1.0, 0.7, vUv0.y);
      outgoingLight += mix(vec3(0.55, 0.9, 0.8), vec3(0.75, 0.85, 1.0), vUv0.x) * s * edge * uStreakAmt;`,
  });

  const visorEdgeMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0d0e, metalness: 0.2, roughness: 0.2, side: THREE.DoubleSide, envMapIntensity: 1.2 });
  const stripMat = new THREE.MeshPhysicalMaterial({ color: 0x08090a, metalness: 0.0, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2 });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.7, metalness: 0, envMapIntensity: 0.6 });
  const fabricMat = new THREE.MeshStandardMaterial({ map: stitch, roughness: 0.95, metalness: 0, envMapIntensity: 0.4 });
  const linerMat = new THREE.MeshStandardMaterial({ color: 0x0d0f0e, roughness: 1, metalness: 0, side: THREE.BackSide, envMapIntensity: 0.2 });
  const plateMat = new THREE.MeshPhysicalMaterial({ color: 0x23262a, roughness: 0.28, metalness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.15, envMapIntensity: 1.1 });
  const screwMat = new THREE.MeshStandardMaterial({ color: 0xa4a9ae, roughness: 0.25, metalness: 1, envMapIntensity: 1.2 });
  const ventMat = new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.9, metalness: 0 });
  const materials = [shellMat, visorMat, visorEdgeMat, stripMat, rubberMat, fabricMat, linerMat, plateMat, screwMat, ventMat];

  /* ---- meshes ---- */
  const helmet = new THREE.Group();
  const geoms = [];
  const keep = (g) => { geoms.push(g); return g; };
  const add = (geo, mat, parent = helmet) => {
    const m = new THREE.Mesh(keep(geo), mat);
    parent.add(m);
    return m;
  };

  add(buildShellGeometry(184, 100, 0), shellMat);
  add(buildShellGeometry(88, 44, 0.03), linerMat).userData.noMirror = true;
  add(buildVisorGeometry(120, 40, 0, 1, 0), visorMat);
  add(buildVisorEdge(120, 40, 0.016), visorEdgeMat);
  // Raised plain dark strip along the visor's top edge (no text).
  add(buildVisorGeometry(120, 6, -0.015, 0.15, 0.005), stripMat);
  add(buildEyeportTrim(), rubberMat);
  add(buildNeckRoll(), fabricMat);

  // Visor pivot discs: bevelled disc, inner ring, centre screw.
  const discGeo = keep(new THREE.LatheGeometry([
    new THREE.Vector2(0.0, 0.016), new THREE.Vector2(0.056, 0.016), new THREE.Vector2(0.07, 0.012),
    new THREE.Vector2(0.078, 0.004), new THREE.Vector2(0.08, -0.012),
  ], 48));
  const ringGeo = keep(new THREE.TorusGeometry(0.05, 0.0035, 8, 48));
  const screwGeo = keep(new THREE.CylinderGeometry(0.017, 0.019, 0.01, 24));
  const screwSlotGeo = keep(new THREE.BoxGeometry(0.026, 0.004, 0.005));
  for (const side of [-1, 1]) {
    const g = new THREE.Group();
    placeOnShell(g, side * (VISOR_HALF - 0.05), 1.5, 0.03);
    const disc = new THREE.Mesh(discGeo, plateMat);
    disc.scale.set(1, 1, 1.15);
    const ring = new THREE.Mesh(ringGeo, screwMat);
    ring.rotation.x = PI / 2;
    ring.position.y = 0.017;
    const screw = new THREE.Mesh(screwGeo, screwMat);
    screw.position.y = 0.02;
    const slotM = new THREE.Mesh(screwSlotGeo, ventMat);
    slotM.position.y = 0.025;
    slotM.rotation.y = 0.6;
    g.add(disc, ring, screw, slotM);
    helmet.add(g);
  }

  // Visor lift tab (plain) at the bottom centre of the visor.
  const capGeo = (r, l) => keep(new THREE.CapsuleGeometry(r, l, 4, 12));
  {
    const P = [0, 0, 0];
    const N = [0, 0, 0];
    visorPoint(0.5, 1.0, 0.004, P, N);
    const tab = new THREE.Mesh(capGeo(0.012, 0.07), stripMat);
    tab.position.set(P[0], P[1] - 0.008, P[2]);
    tab.quaternion.setFromUnitVectors(_fwd, new THREE.Vector3(N[0], N[1], N[2]));
    tab.rotateZ(PI / 2);
    tab.scale.set(1, 1, 0.55);
    helmet.add(tab);
  }

  // Chin vent grille: graphite pad with four black slots.
  {
    const g = new THREE.Group();
    placeOnShell(g, 0, 2.1, 0.0, 'z');
    const pad = new THREE.Mesh(capGeo(0.036, 0.11), plateMat);
    pad.rotation.z = PI / 2;
    pad.scale.set(1, 1, 0.32);
    g.add(pad);
    const slotGeo = capGeo(0.0045, 0.1);
    for (let k = 0; k < 4; k++) {
      const s = new THREE.Mesh(slotGeo, ventMat);
      s.rotation.z = PI / 2;
      s.position.set(0, -0.021 + k * 0.014, 0.008);
      s.scale.set(1, 1, 0.6);
      g.add(s);
    }
    helmet.add(g);
  }

  // Two small top intake vents above the visor.
  for (const th of [-0.24, 0.24]) {
    const g = new THREE.Group();
    placeOnShell(g, th, 0.74, 0.004, 'z');
    g.rotateZ(-th * 0.6);
    const scoop = new THREE.Mesh(capGeo(0.017, 0.05), plateMat);
    scoop.rotation.z = PI / 2;
    scoop.scale.set(1, 1, 0.55);
    const mouth = new THREE.Mesh(capGeo(0.006, 0.045), ventMat);
    mouth.rotation.z = PI / 2;
    mouth.position.set(0, -0.004, 0.008);
    mouth.scale.set(1, 1, 0.6);
    g.add(scoop, mouth);
    helmet.add(g);
  }

  helmet.position.y = 0.0;
  helmet.rotation.x = 0.06;
  {
    helmet.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(helmet);
    FLOOR_Y = box.min.y + 0.002;
    U.uFloorY.value = FLOOR_Y;
  }

  const spin = new THREE.Group();
  const tilt = new THREE.Group();
  const root = new THREE.Group();
  spin.add(helmet);
  tilt.add(spin);
  root.add(tilt);
  scene.add(root);

  /* ---- glossy table: contact shadow + faded mirror reflection ---- */
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false });
  const shadowPivot = new THREE.Group();
  shadowPivot.position.y = FLOOR_Y + 0.002;
  const shadow = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.5, 1.9)), shadowMat);
  shadow.rotation.x = -PI / 2;
  shadow.renderOrder = -2;
  const shadowCore = new THREE.Mesh(shadow.geometry, shadowMat.clone());
  shadowCore.rotation.x = -PI / 2;
  shadowCore.scale.set(0.55, 0.6, 1);
  shadowCore.position.y = 0.001;
  shadowCore.renderOrder = -1;
  shadowPivot.add(shadow, shadowCore);
  scene.add(shadowPivot);

  const mirrorMats = new Map();
  const mirrorMat = (m) => {
    if (mirrorMats.has(m)) return mirrorMats.get(m);
    const mm = m.clone();
    mm.onBeforeCompile = m.onBeforeCompile;
    mm.customProgramCacheKey = m.customProgramCacheKey;
    patch(mm, 'mirror', {
      uniforms: U,
      fragDecl: 'uniform float uFloorY;',
      fragCode: `
        float below = uFloorY - vWPos.y;
        if (below < 0.0) discard;
        diffuseColor.a *= smoothstep(0.42, 0.0, below);
        outgoingLight *= 0.75;`,
    });
    mm.transparent = true;
    mm.depthWrite = false;
    mirrorMats.set(m, mm);
    return mm;
  };
  const mirror = helmet.clone(true);
  mirror.matrixAutoUpdate = false;
  mirror.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.noMirror) { o.visible = false; return; }
    o.material = mirrorMat(o.material);
  });
  scene.add(mirror);
  const reflectM = new THREE.Matrix4().makeTranslation(0, 2 * FLOOR_Y, 0).multiply(new THREE.Matrix4().makeScale(1, -1, 1));

  /* ---- state ---- */
  const target = { p: 0, px: 0, py: 0, v: 0, intro: reducedMotion ? 1 : 0 };
  const cur = { p: 0, px: 0, py: 0, v: 0, intro: target.intro, spinExtra: 0, streak: -0.5 };
  let baseDist = 5;
  let running = false;
  let raf = 0;
  let last = 0;
  let time = 0;
  let fadeTransparent = false;
  let disposed = false;
  let lastVisible = true;

  const YAW_FRONT34 = 0.72;
  const LOOK_Y = -0.08;

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const k = 2 * Math.tan((camera.fov * PI) / 360);
    const H_OBJ = 1.36;
    const W_OBJ = 1.2;
    if (camera.aspect < 0.9) baseDist = Math.max(W_OBJ / (0.38 * k * camera.aspect), H_OBJ / (0.6 * k));
    else baseDist = Math.max(H_OBJ / (0.45 * k), W_OBJ / (0.8 * k * camera.aspect));
  }

  function setFade(o, introF) {
    const needT = o < 0.999;
    if (needT !== fadeTransparent) {
      fadeTransparent = needT;
      for (const m of materials) { m.transparent = needT; m.needsUpdate = true; }
    }
    for (const m of materials) m.opacity = o;
    for (const mm of mirrorMats.values()) mm.opacity = o * 0.32 * introF;
    shadowMat.opacity = 0.55 * o * introF;
    shadowCore.material.opacity = 0.7 * o * introF;
  }

  function update(dt) {
    const snap = reducedMotion || dt > 1;
    const k = (rate) => (snap ? 1 : 1 - Math.exp(-dt * rate));
    cur.p += (target.p - cur.p) * k(7);
    cur.intro += (target.intro - cur.intro) * k(6);
    cur.px += (target.px - cur.px) * k(3.5);
    cur.py += (target.py - cur.py) * k(3.5);
    cur.v += (target.v - cur.v) * k(5);
    if (!snap) time += dt;

    const p = reducedMotion ? 0 : cur.p;
    const intro = reducedMotion ? 1 : cur.intro;

    // 3/4 front -> side profile (p~0.4) -> rear 3/4 (p~0.75).
    let yaw;
    if (p < 0.4) yaw = lerp(YAW_FRONT34, PI / 2, easeInOut(p / 0.4));
    else yaw = lerp(PI / 2, PI - 0.62, easeInOut((p - 0.4) / 0.6));

    if (!reducedMotion) {
      cur.spinExtra += (cur.v * 0.35 - cur.spinExtra) * k(4);
      cur.streak += cur.v * dt * 2.2;
      if (cur.streak > 1.6) cur.streak = -0.6;
      if (cur.streak < -0.6) cur.streak = 1.6;
    }
    U.uStreak.value = cur.streak;
    U.uStreakAmt.value = reducedMotion ? 0 : Math.min(1, Math.abs(cur.v) * 1.6);

    // Slow idle turntable wobble (fades out as the scroll takes over).
    const idle = reducedMotion ? 0 : (1 - sstep(0.0, 0.15, p));
    const wobble = Math.sin(time * 0.45) * 0.09 * idle;
    const bob = Math.sin(time * 0.7) * 0.008 * idle;

    const ie = easeOutCubic(intro);
    spin.rotation.y = yaw + cur.spinExtra + wobble + (1 - ie) * 0.9;
    root.position.y = -(1 - ie) * 2.2 + bob;

    // Intro light sweep: shader band + a real light crossing the clearcoat.
    const sw = sstep(0.25, 1.0, intro);
    const env = reducedMotion ? 0 : Math.sin(PI * sw);
    U.uSweep.value = lerp(-1.1, 1.1, sw);
    U.uSweepAmt.value = env;
    sweepLight.intensity = env * 3.0;
    sweepLight.position.set(lerp(-5, 5, sw), 2.5, 3);

    const maxT = (10 * PI) / 180;
    tilt.rotation.y = cur.px * maxT;
    tilt.rotation.x = cur.py * maxT * 0.8;

    // Fade + shrink after p 0.75; fully gone at p = 1.
    const out = sstep(0.75, 1.0, cur.p);
    const opacity = clamp01(intro / 0.35) * (1 - out);
    root.scale.setScalar(1 - 0.28 * out);
    root.position.y += out * 0.15;
    setFade(opacity, sstep(0.55, 1.0, intro));
    const visible = opacity > 0.002;
    root.visible = mirror.visible = shadowPivot.visible = visible;

    shadowPivot.rotation.y = spin.rotation.y + tilt.rotation.y;
    shadowPivot.scale.setScalar(1 - 0.28 * out);

    const dist = baseDist * (1 + 0.16 * easeInOut(p));
    camera.position.set(0, 0.12 + 0.1 * p, dist);
    camera.lookAt(0, LOOK_Y, 0);

    scene.updateMatrixWorld();
    mirror.matrix.multiplyMatrices(reflectM, helmet.matrixWorld);
    mirror.updateMatrixWorld(true);
  }

  function render() {
    if (!root.visible) {
      if (lastVisible) renderer.clear();
      lastVisible = false;
      return;
    }
    lastVisible = true;
    renderer.render(scene, camera);
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000 || 0.016);
    last = now;
    update(dt);
    render();
  }

  resize();
  update(10);

  return {
    failed: false,
    setProgress(v) { target.p = clamp01(+v || 0); },
    setPointer(x, y) {
      if (reducedMotion) return;
      target.px = Math.max(-1, Math.min(1, +x || 0));
      target.py = Math.max(-1, Math.min(1, +y || 0));
    },
    setVelocity(v) { target.v = Math.max(-1, Math.min(1, +v || 0)); },
    setIntro(t) { target.intro = reducedMotion ? 1 : clamp01(+t || 0); },
    resize() { resize(); },
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
    dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      cancelAnimationFrame(raf);
      geoms.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      mirrorMats.forEach((m) => m.dispose());
      shadowMat.dispose();
      shadowCore.material.dispose();
      textures.forEach((t) => t.dispose());
      envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
