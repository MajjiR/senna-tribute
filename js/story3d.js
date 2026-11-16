// WebGL renderer for "The story" (js/story.js). One Three.js renderer behind
// the chapter text. Each chapter is a small procedural scene, built lazily;
// only the current chapter (plus the incoming one during a transition) is
// rendered. Scenes render into HDR targets, then a single fullscreen pass does
// the scroll-driven transition, lens rain, tunnel-vision blur, colour drain,
// vignette, tone mapping and grain. A transparent 2D canvas on top carries the
// small HUD read-outs (margins, gears, positions).
//
// Everything is original and procedural: generic open-wheel car and kart,
// plain colours only, no logos, liveries, text decals, people or faces.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

/* ───────────── helpers ───────────── */

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const range = (t, a, b) => clamp((t - a) / (b - a));
const smooth = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeBack = (t) => { const c = 1.6; return t <= 0 ? 0 : 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const fract = (x) => x - Math.floor(x);
const hash = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453123);
const TAU = Math.PI * 2;
const FONT_D = '"Big Shoulders Display", "Arial Narrow", Impact, sans-serif';
const FONT_M = '"JetBrains Mono", ui-monospace, Menlo, monospace';

const HEX = { ink: 0x07110d, cream: 0xf3efe4, yellow: 0xffdf00, green: 0x00a651, blue: 0x1b4fd8, navy: 0x0b1f4b };

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// tileable value noise
function makeNoise(period, seed) {
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = hash(i * 1.37 + seed);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const P = period;
    const a = g[((yi % P + P) % P) * P + ((xi % P + P) % P)];
    const b = g[((yi % P + P) % P) * P + (((xi + 1) % P + P) % P)];
    const c = g[(((yi + 1) % P + P) % P) * P + ((xi % P + P) % P)];
    const d = g[(((yi + 1) % P + P) % P) * P + (((xi + 1) % P + P) % P)];
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
}

/* ───────────── shared resources ───────────── */

function makeAsphalt(N, wet) {
  const n1 = makeNoise(64, 1), n2 = makeNoise(8, 7), n3 = makeNoise(256, 3);
  const h = new Float32Array(N * N);
  const puddle = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const grain = n3(u * 256, v * 256) * 0.55 + n1(u * 64, v * 64) * 0.3 + n1(u * 32 + 5, v * 32 + 3) * 0.15;
    const p = n2(u * 8, v * 8) * 0.7 + n1(u * 16 + 9, v * 16 + 2) * 0.3;
    const pd = smooth(range(p, 0.5, 0.62));
    puddle[y * N + x] = pd;
    h[y * N + x] = grain * (1 - pd * 0.9);
  }
  const mk = (fn) => {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4;
      const [r, g, b] = fn(x, y);
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const H = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
  const normal = mk((x, y) => {
    const dx = (H(x + 1, y) - H(x - 1, y)) * 3.2, dy = (H(x, y + 1) - H(x, y - 1)) * 3.2;
    const l = Math.hypot(dx, dy, 1);
    return [(-dx / l * 0.5 + 0.5) * 255, (-dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
  });
  const rough = mk((x, y) => {
    const p = puddle[y * N + x];
    const r = wet ? lerp(0.32 + H(x, y) * 0.25, 0.03, p) : 0.78 + H(x, y) * 0.2;
    return [r * 255, r * 255, r * 255];
  });
  const color = mk((x, y) => {
    const p = wet ? puddle[y * N + x] : 0;
    const g = (0.13 + H(x, y) * 0.12) * (1 - p * 0.55);
    return [g * 255, g * 255 * 1.02, g * 255 * 1.04];
  });
  color.colorSpace = THREE.SRGBColorSpace;
  return { normal, rough, color };
}

function glowTexture() {
  return canvasTex(128, 128, (c, w) => {
    const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, w);
  });
}
function streakTexture() {
  return canvasTex(64, 256, (c, w, h) => {
    const img = c.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = Math.abs(x / w - 0.5) * 2, v = y / h;
      const a = Math.pow(1 - u, 2.2) * Math.pow(1 - v, 1.4) * (0.75 + 0.25 * Math.sin(v * 60 + x * 0.3));
      const o = (y * w + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = clamp(a) * 255;
    }
    c.putImageData(img, 0, 0);
  });
}

function nightEnv(pmrem) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x020405);
  const add = (w, h, p, col, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...p); m.lookAt(0, 0, 0); s.add(m);
  };
  add(14, 3, [0, 9, 0], 0x7fa6b8, 1.1);
  add(2.4, 2.4, [9, 3, -6], 0xffcf73, 7);
  add(2.4, 2.4, [-9, 3.5, -9], 0xffd27a, 6);
  add(16, 3, [0, 2, -15], 0x2c5a68, 1.3);
  add(1.6, 1.6, [-6, 4, 8], 0xffe9b0, 4);
  add(1.6, 1.6, [6, 2.5, 9], 0x9cc6ff, 3);
  const rt = pmrem.fromScene(s, 0.035);
  s.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return rt.texture;
}

/* ── rain: instanced view-aligned streaks, pure function of time ── */
function makeRain(count, { box = [30, 16, 30], len = 0.45, width = 0.012, speed = 11, alpha = 0.35, color = 0xbcd2dc } = {}) {
  const base = new THREE.PlaneGeometry(1, 1);
  base.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.uv = base.attributes.uv;
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) seeds[i] = hash(i * 0.731 + 4.2);
  geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 3));
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uBox: { value: new THREE.Vector3(...box) }, uCenter: { value: new THREE.Vector3() },
      uLen: { value: len }, uWidth: { value: width }, uSpeed: { value: speed }, uSlant: { value: new THREE.Vector2(0.15, 0) },
      uAlpha: { value: alpha }, uColor: { value: new THREE.Color(color) },
    },
    vertexShader: /* glsl */`
      attribute vec3 seed;
      uniform float uTime, uLen, uWidth, uSpeed; uniform vec3 uBox, uCenter; uniform vec2 uSlant;
      varying vec2 vUv; varying float vFade;
      void main(){
        vec3 dir = normalize(vec3(uSlant.x, -1.0, uSlant.y));
        float sp = uSpeed * (0.75 + 0.5 * seed.y);
        vec3 p = (seed - 0.5) * uBox;
        float fall = mod(seed.y * uBox.y + uTime * sp, uBox.y);
        p.y = uBox.y * 0.5 - fall;
        p.xz -= dir.xz / max(0.2, -dir.y) * fall;
        p.xz = mod(p.xz - uCenter.xz + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5 + uCenter.xz;
        p.y += uCenter.y;
        vec3 tail = p - dir * uLen * (0.6 + 0.8 * seed.z);
        vec4 a = modelViewMatrix * vec4(p, 1.0);
        vec4 b = modelViewMatrix * vec4(tail, 1.0);
        vec3 ax = b.xyz - a.xyz;
        vec3 side = normalize(cross(ax, vec3(0.0, 0.0, 1.0)) + 1e-5) * uWidth * (0.6 + seed.x);
        vec3 pos = mix(a.xyz, b.xyz, uv.y) + side * (uv.x - 0.5) * 2.0;
        float d = -a.z;
        vFade = smoothstep(0.4, 2.0, d) * (1.0 - smoothstep(uBox.z * 0.35, uBox.z * 0.55, d));
        vUv = uv;
        gl_Position = projectionMatrix * vec4(pos, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uAlpha; uniform vec3 uColor;
      varying vec2 vUv; varying float vFade;
      void main(){
        float x = 1.0 - abs(vUv.x - 0.5) * 2.0;
        float a = x * x * (1.0 - vUv.y * 0.85) * vFade * uAlpha;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.userData.fx = true;
  return mesh;
}

/* ── spray / smoke plume: points, pure function of time ── */
function makePlume(count, { emit = [[-0.7, 0.2, 1.4], [0.7, 0.2, 1.4]], dir = [0, 0, 1], speed = 9, rise = 2.2, size = 1.6, alpha = 0.22, color = 0xcfdde3, rate = 1.3, spread = 1.2, blend = THREE.NormalBlending } = {}) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const e = emit[i % emit.length];
    pos.set(e, i * 3);
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = hash(i * 4.11 + k * 1.7 + 0.3);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: blend,
    uniforms: {
      uTime: { value: 0 }, uDir: { value: new THREE.Vector3(...dir) }, uSpeed: { value: speed }, uRise: { value: rise },
      uSize: { value: size }, uPx: { value: 600 }, uAlpha: { value: alpha }, uColor: { value: new THREE.Color(color) },
      uRate: { value: rate }, uSpread: { value: spread }, uOn: { value: 1 },
    },
    vertexShader: /* glsl */`
      attribute vec4 seed;
      uniform float uTime, uSpeed, uRise, uSize, uPx, uRate, uSpread;
      uniform vec3 uDir;
      varying float vA;
      void main(){
        float age = fract(seed.x + uTime * uRate * (0.8 + 0.4 * seed.w));
        vec3 side = normalize(cross(uDir, vec3(0.0, 1.0, 0.0)) + 1e-5);
        vec3 v = uDir * uSpeed * (0.5 + 0.8 * seed.z) + side * (seed.y - 0.5) * uSpread * 3.0 + vec3(0.0, uRise * (0.4 + seed.w), 0.0);
        vec3 p = position + v * age + vec3(0.0, -2.5, 0.0) * age * age;
        p.y = max(p.y, 0.03);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * (0.35 + age * 2.2) * uPx / max(0.5, -mv.z);
        vA = smoothstep(0.0, 0.08, age) * (1.0 - age);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uAlpha, uOn; uniform vec3 uColor;
      varying float vA;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q) * 2.0;
        float a = smoothstep(1.0, 0.0, d); a *= a;
        a *= vA * uAlpha * uOn;
        gl_FragColor = vec4(uColor, a);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 8;
  pts.userData.fx = true;
  return pts;
}

/* ── circuit tube with a scroll-driven light trail ── */
function makeTrackTube(track, scale, radius, { base = 0xf3efe4, baseA = 0.18, trail = 0xffdf00 } = {}) {
  const pts = [];
  for (let i = 0; i < track.N; i += 3) pts.push(new THREE.Vector3((track.pts[i * 2] - 500) * scale, 0, (track.pts[i * 2 + 1] - 350) * scale));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const geo = new THREE.TubeGeometry(curve, 900, radius, 6, true);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uHead: { value: 0 }, uLen: { value: 0 }, uDraw: { value: 1 }, uBase: { value: new THREE.Color(base) }, uBaseA: { value: baseA },
      uTrail: { value: new THREE.Color(trail) }, uGain: { value: 3 },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: /* glsl */`
      uniform float uHead, uLen, uDraw, uBaseA, uGain; uniform vec3 uBase, uTrail; varying vec2 vUv;
      void main(){
        float f = vUv.x;
        float d = fract(uHead - f);
        float tr = uLen > 0.0 ? pow(1.0 - clamp(d / uLen, 0.0, 1.0), 2.0) : 0.0;
        float drawn = step(f, uDraw);
        vec3 col = uBase * uBaseA * drawn + uTrail * tr * uGain;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = radius;
  mesh.userData.fx = true;
  const at = (f) => {
    const p = curve.getPointAt(fract(f));
    return p.setY(radius);
  };
  return { mesh, at, mat };
}

/* ── generic glossy sprite ── */
function sprite(tex, color, size, opacity = 1) {
  const m = new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  s.userData.fx = true;
  return s;
}

/* ── wet-ground reflection streak under a light, turned to the camera ── */
function makeStreak(tex, color, width, length, opacity = 0.8) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 0, 1, 0.5, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  m.scale.set(width, 1, length);
  m.renderOrder = 5;
  m.userData.fx = true;
  m.userData.face = (cam) => { m.rotation.y = Math.atan2(cam.position.x - m.position.x, cam.position.z - m.position.z); };
  return m;
}

/* ── planar wet reflection: Reflector with a puddle-masked, vertically streaked shader ── */
const WetReflectShader = {
  uniforms: {
    color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
    tMask: { value: null }, tNormal: { value: null }, uRepeat: { value: new THREE.Vector2(1, 1) },
    uStrength: { value: 1 }, uStreak: { value: 0.035 }, uFogD: { value: 0.04 },
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix; uniform vec2 uRepeat;
    varying vec4 vUv; varying vec2 vT; varying vec3 vW;
    void main(){
      vUv = textureMatrix * vec4(position, 1.0);
      vT = uv * uRepeat;
      vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 color; uniform sampler2D tDiffuse, tMask, tNormal; uniform float uStrength, uStreak, uFogD;
    varying vec4 vUv; varying vec2 vT; varying vec3 vW;
    void main(){
      float rough = texture2D(tMask, vT).g;
      float puddle = 1.0 - smoothstep(0.06, 0.4, rough);
      vec3 n = texture2D(tNormal, vT).xyz * 2.0 - 1.0;
      vec4 uv = vUv;
      uv.xy += n.xy * (0.01 + 0.035 * (1.0 - puddle)) * uv.w;
      vec3 acc = vec3(0.0); float ws = 0.0;
      for (int i = -6; i <= 6; i++) {
        float k = float(i) / 6.0; float w = 1.0 - abs(k) * 0.75;
        acc += texture2DProj(tDiffuse, uv + vec4(0.0, k * uStreak * uv.w * (1.0 - puddle * 0.55), 0.0, 0.0)).rgb * w; ws += w;
      }
      acc /= ws;
      vec3 V = normalize(cameraPosition - vW);
      float fres = 0.12 + 0.88 * pow(1.0 - max(V.y, 0.0), 4.0);
      float fog = exp(-length(cameraPosition - vW) * uFogD);
      float a = mix(0.3, 1.0, puddle) * fres * uStrength * fog;
      gl_FragColor = vec4(min(color * acc * a, vec3(40.0)), 1.0);
    }`,
};

/* ── raindrop splashes: flat instanced rings on the ground ── */
function makeSplashes(count, { box = [22, 26], rate = 1.6, size = 0.22, alpha = 0.5 } = {}) {
  const base = new THREE.PlaneGeometry(1, 1); base.rotateX(-Math.PI / 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index; geo.attributes.position = base.attributes.position; geo.attributes.uv = base.attributes.uv;
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = hash(i * 0.917 + 11.3);
  geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 3));
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector2(...box) }, uRate: { value: rate }, uSize: { value: size }, uAlpha: { value: alpha } },
    vertexShader: /* glsl */`
      attribute vec3 seed; uniform float uTime, uRate, uSize; uniform vec3 uCenter; uniform vec2 uBox;
      varying vec2 vUv; varying float vAge;
      void main(){
        float ph = seed.z + uTime * uRate * (0.7 + 0.6 * seed.x);
        float cyc = floor(ph); float age = fract(ph);
        vec2 j = fract(sin(vec2(cyc * 12.9898 + seed.x * 78.233, cyc * 39.346 + seed.y * 11.135)) * 43758.5453);
        vec2 c = uCenter.xz + (fract(seed.xy + j) - 0.5) * uBox;
        vec3 p = vec3(c.x, 0.015, c.y) + position * uSize * (0.25 + age * 1.2);
        vUv = uv; vAge = age;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uAlpha; varying vec2 vUv; varying float vAge;
      void main(){
        float d = length(vUv - 0.5) * 2.0;
        float ring = smoothstep(0.12, 0.0, abs(d - 0.82)) * (1.0 - vAge);
        float hit = smoothstep(0.35, 0.0, d) * smoothstep(0.18, 0.0, vAge);
        float a = (ring * 0.7 + hit) * uAlpha;
        gl_FragColor = vec4(vec3(0.75, 0.85, 0.9) * a, a);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false; m.renderOrder = 6; m.userData.fx = true;
  return m;
}

/* ── cheap volumetric light shaft under a lamp ── */
function makeShaft(color, h, r, alpha = 0.1) {
  const geo = new THREE.ConeGeometry(r, h, 28, 1, true);
  geo.translate(0, -h / 2, 0);
  const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha }, uH: { value: h } },
    vertexShader: /* glsl */`
      uniform float uH; varying float vH; varying float vNV; varying float vD;
      void main(){
        vH = clamp(-position.y / uH, 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 nn = normalMatrix * normal; float ln = length(nn); float lv = length(mv.xyz);
        vD = lv;
        vNV = (ln > 1e-5 && lv > 1e-5) ? abs(dot(nn / ln, -mv.xyz / lv)) : 0.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uAlpha; varying float vH; varying float vNV; varying float vD;
      void main(){
        float h = clamp(1.0 - vH, 0.0, 1.0); float nv = clamp(vNV, 0.0, 1.0);
        float a = uAlpha * h * sqrt(h) * smoothstep(0.0, 0.06, vH) * nv * nv * smoothstep(3.0, 10.0, vD);
        if (!(a >= 0.0 && a < 10.0)) a = 0.0;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  }));
  m.userData.fx = true; m.renderOrder = 7;
  return m;
}

function mistTexture() {
  const t = canvasTex(256, 256, (c, w, h) => {
    const n = makeNoise(16, 21), n2 = makeNoise(32, 9);
    const img = c.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = n(x / 16, y / 16) * 0.65 + n2(x / 8, y / 8) * 0.35;
      const a = smooth(range(v, 0.35, 0.85));
      const o = (y * w + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = a * 255;
    }
    c.putImageData(img, 0, 0);
  }, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* ── tube between two points ── */
function rod(a, b, r, mat, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const v = B.clone().sub(A);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, v.length(), seg), mat);
  m.position.copy(A).addScaledVector(v, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
  return m;
}

/* ── procedural kart (nose along -Z, ~1.8 m) ── */
function makeKart() {
  const g = new THREE.Group();
  const parts = [];
  const chrome = new THREE.MeshStandardMaterial({ color: 0xb9bcbf, metalness: 0.9, roughness: 0.28 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x121313, roughness: 0.82 });
  const hub = new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 0.8, roughness: 0.35 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0d0f10, roughness: 0.45 });
  const body = new THREE.MeshPhysicalMaterial({ color: 0xf1ede2, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 });
  const helmetM = new THREE.MeshPhysicalMaterial({ color: 0xffd400, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 });
  const add = (m, name) => { m.castShadow = true; m.name = name || ''; g.add(m); parts.push(m); return m; };
  const y = 0.1;
  // chassis rails
  add(rod([-0.24, y, 0.72], [-0.3, y, -0.05], 0.016, chrome), 'Chassis');
  add(rod([0.24, y, 0.72], [0.3, y, -0.05], 0.016, chrome));
  add(rod([-0.3, y, -0.05], [-0.16, y, -0.72], 0.016, chrome));
  add(rod([0.3, y, -0.05], [0.16, y, -0.72], 0.016, chrome));
  add(rod([-0.24, y, 0.6], [0.24, y, 0.6], 0.016, chrome));
  add(rod([-0.2, y, -0.55], [0.2, y, -0.55], 0.016, chrome));
  add(rod([-0.29, y, 0.05], [0.29, y, 0.05], 0.014, chrome));
  // axles
  add(rod([-0.52, 0.14, 0.6], [0.52, 0.14, 0.6], 0.02, chrome));
  add(rod([-0.42, 0.13, -0.55], [0.42, 0.13, -0.55], 0.014, chrome));
  // tyres: small and fat
  const tyre = (x, z, r, w) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 24, 1), rubber);
    t.rotation.z = Math.PI / 2; t.position.set(x, r, z);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.004, 16), hub);
    h.rotation.z = Math.PI / 2; h.position.copy(t.position);
    add(t, 'Tyre'); add(h);
    return t;
  };
  const wheels = [tyre(-0.46, -0.55, 0.13, 0.12), tyre(0.46, -0.55, 0.13, 0.12), tyre(-0.5, 0.6, 0.14, 0.2), tyre(0.5, 0.6, 0.14, 0.2)];
  // side nerf bars and bumpers
  add(rod([-0.42, 0.14, -0.3], [-0.42, 0.14, 0.38], 0.014, chrome));
  add(rod([0.42, 0.14, -0.3], [0.42, 0.14, 0.38], 0.014, chrome));
  add(rod([-0.2, 0.13, -0.84], [0.2, 0.13, -0.84], 0.014, chrome));
  add(rod([-0.36, 0.16, 0.86], [0.36, 0.16, 0.86], 0.014, chrome));
  // nose panel
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.22), body);
  nose.position.set(0, 0.17, -0.8); nose.rotation.x = -0.35;
  add(nose, 'Nose');
  // seat
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.34, 18, 1, true, -Math.PI * 0.8, Math.PI * 1.6), black);
  seat.material = seat.material.clone(); seat.material.side = THREE.DoubleSide;
  seat.position.set(0, 0.3, 0.2); seat.rotation.x = -0.4;
  add(seat, 'Seat');
  const seatBase = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.3), black);
  seatBase.position.set(0, 0.14, 0.18); add(seatBase);
  // engine on the right side
  const eng = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.22), new THREE.MeshStandardMaterial({ color: 0x6d7174, metalness: 0.7, roughness: 0.4 }));
  eng.position.set(0.33, 0.23, 0.38); add(eng, 'Engine');
  const fins = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 12), chrome);
  fins.position.set(0.33, 0.39, 0.38); add(fins);
  // steering
  add(rod([0, 0.12, -0.55], [0, 0.36, -0.28], 0.012, chrome), 'Steering');
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.014, 8, 28), black);
  wheel.position.set(0, 0.38, -0.25); wheel.rotation.x = -1.0;
  add(wheel);
  // the driver is only a plain helmet dome
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 28, 18, 0, TAU, 0, Math.PI * 0.62), helmetM);
  helmet.position.set(0, 0.55, 0.14);
  add(helmet, 'Helmet');
  return { group: g, parts, wheels, engine: eng, steering: wheel };
}

/* ── simple fallback open-wheel car (nose along -Z, wheels on y=0, ~4.4 m) ── */
function makeFallbackCar({ upper = 0xffffff, lower = 0xffffff, helmet = 0xffd400 } = {}) {
  const g = new THREE.Group();
  const paint = (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.28, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 });
  const U = paint(upper), L = paint(lower);
  const carbon = new THREE.MeshStandardMaterial({ color: 0x101112, roughness: 0.45, metalness: 0.3 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.75 });
  const box = (w, h, d, x, y, z, m, rx = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.x = rx; b.castShadow = true; g.add(b); return b; };
  // body: side profile extruded across the car (shape x = car z)
  const prof = (pts, width, mat, x = 0, bevel = 0.06) => {
    const sh = new THREE.Shape(); pts.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 4 });
    geo.translate(0, 0, -width / 2); geo.rotateY(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat); m.position.x = x; m.castShadow = true; g.add(m); return m;
  };
  prof([[-2.25, 0.17], [-1.3, 0.3], [-0.75, 0.48], [-0.45, 0.56], [-0.42, 0.6], [0.05, 0.6], [0.3, 0.92], [0.62, 0.9], [1.2, 0.6], [1.62, 0.42], [1.62, 0.2], [-2.25, 0.12]], 0.36, U);
  prof([[-0.8, 0.2], [-0.6, 0.36], [0.4, 0.42], [1.2, 0.36], [1.45, 0.22], [1.45, 0.1], [-0.8, 0.1]], 0.42, L, -0.52, 0.05);
  prof([[-0.8, 0.2], [-0.6, 0.36], [0.4, 0.42], [1.2, 0.36], [1.45, 0.22], [1.45, 0.1], [-0.8, 0.1]], 0.42, L, 0.52, 0.05);
  prof([[-1.1, 0.12], [-0.9, 0.32], [0.3, 0.32], [0.3, 0.12]], 0.62, L, 0, 0.04);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 20), carbon); ring.rotation.x = Math.PI / 2; ring.position.set(0, 0.63, -0.18); g.add(ring);
  box(0.4, 0.3, 0.7, 0, 0.36, 1.45, carbon);
  box(1.3, 0.04, 2.8, 0, 0.08, 0.2, carbon);
  box(1.75, 0.035, 0.36, 0, 0.1, -2.1, carbon);
  box(0.03, 0.2, 0.42, -0.86, 0.17, -2.1, carbon);
  box(0.03, 0.2, 0.42, 0.86, 0.17, -2.1, carbon);
  box(1.0, 0.05, 0.3, 0, 0.95, 1.95, L);
  box(1.0, 0.04, 0.22, 0, 0.82, 2.0, carbon);
  box(0.04, 0.5, 0.55, -0.52, 0.78, 1.95, carbon);
  box(0.04, 0.5, 0.55, 0.52, 0.78, 1.95, carbon);
  const hm = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 16, 0, TAU, 0, Math.PI * 0.62), paint(helmet));
  hm.position.set(0, 0.68, -0.2); g.add(hm);
  const wheels = [];
  const wheel = (x, z, r, w) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 28), rubber);
    t.rotation.z = Math.PI / 2; t.position.set(x, r, z); t.castShadow = true;
    const hubm = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w + 0.01, 12), carbon);
    hubm.rotation.z = Math.PI / 2; hubm.position.copy(t.position);
    const w2 = new THREE.Group(); w2.add(t, hubm); g.add(w2); wheels.push(t);
  };
  wheel(-0.8, -1.35, 0.33, 0.3); wheel(0.8, -1.35, 0.33, 0.3);
  wheel(-0.78, 1.2, 0.36, 0.42); wheel(0.78, 1.2, 0.36, 0.42);
  return { group: g, wheels, dispose() {} };
}

/* ───────────── composite pass ───────────── */

const POST_DEFAULT = { vig: 0.55, focus: 2, radial: 0, sat: 1, black: 0, lens: 0, chequer: 0, grain: 0.035, ca: 0.12, contrast: 1, tint: [1, 1, 1], lift: [0, 0, 0] };

function makeComposite() {
  const mat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: {
      tA: { value: null }, tB: { value: null }, uMix: { value: 0 }, uType: { value: 0 }, uFade: { value: new THREE.Color() },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      uVig: { value: 0.5 }, uFocus: { value: 2 }, uRadial: { value: 0 }, uSat: { value: 1 }, uBlack: { value: 0 }, uLens: { value: 0 },
      uChequer: { value: 0 }, uGrain: { value: 0.03 }, uCA: { value: 0 }, uContrast: { value: 1 },
      uTint: { value: new THREE.Vector3(1, 1, 1) }, uLift: { value: new THREE.Vector3() },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`
      uniform sampler2D tA, tB; uniform float uMix, uAspect, uTime, uVig, uFocus, uRadial, uSat, uBlack, uLens, uChequer, uGrain, uCA, uContrast;
      uniform vec3 uTint, uLift;
      uniform int uType; uniform vec3 uFade; uniform vec2 uCenter, uRes;
      varying vec2 vUv;
      vec2 h2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
      float h1(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      vec3 drops(vec2 uv, float t, float sc){
        vec2 p = uv * vec2(uAspect, 1.0) * sc;
        vec2 id = floor(p); vec2 f = fract(p);
        vec2 h = h2(id);
        float life = fract(t * 0.07 + h.x * 3.1);
        vec2 c = vec2(0.25 + 0.5 * h.x, 0.25 + 0.5 * h.y);
        c.y += life * 0.3 * step(0.75, h.y);
        float r = 0.1 + 0.16 * fract(h.x * 7.31);
        vec2 d = f - c; d.y *= 1.15;
        float l = length(d);
        float m = smoothstep(r, r * 0.8, l) * smoothstep(1.0, 0.75, life) * smoothstep(0.0, 0.05, life) * step(0.4, fract(h.y * 13.1));
        return vec3(d / r, m);
      }
      vec3 rs(sampler2D t, vec2 uv, float amt){
        if (amt < 0.002) return texture2D(t, uv).rgb;
        vec3 acc = vec3(0.0); vec2 d = uv - uCenter;
        for (int i = 0; i < 12; i++){ float k = float(i) / 11.0; acc += texture2D(t, uCenter + d * (1.0 - amt * 0.16 * k)).rgb; }
        return acc / 12.0;
      }
      void main(){
        vec2 uv = vUv;
        float lm = 0.0;
        if (uLens > 0.01){
          vec3 d1 = drops(uv, uTime, 4.5); vec3 d2 = drops(uv + 0.37, uTime * 1.3, 10.0);
          uv -= (d1.xy * d1.z * 0.03 + d2.xy * d2.z * 0.018) * uLens;
          lm = max(d1.z, d2.z) * uLens;
        }
        float dist = length((uv - uCenter) * vec2(uAspect, 1.0));
        float amt = uRadial * smoothstep(uFocus, uFocus + 0.45, dist);
        float e = uMix;
        vec3 col;
        if (e <= 0.0) col = rs(tA, uv, amt);
        else if (uType == 1) {
          float xb = mix(1.35, -0.35, e) + (uv.y - 0.5) * 0.35;
          vec3 A = rs(tA, uv + vec2(e * 0.04, 0.0), amt);
          vec3 B = rs(tB, uv - vec2((1.0 - e) * 0.04, 0.0), amt);
          col = uv.x > xb ? B : A;
          col += vec3(1.0, 0.85, 0.0) * smoothstep(0.004, 0.0, abs(uv.x - xb)) * sin(3.14159 * e) * 2.0;
        } else if (uType == 2) {
          vec3 A = rs(tA, uCenter + (uv - uCenter) / (1.0 + 0.35 * e), amt + e * 1.4);
          vec3 B = rs(tB, uCenter + (uv - uCenter) / (0.86 + 0.14 * e), (1.0 - e) * 1.4);
          col = mix(A, B, smoothstep(0.0, 1.0, e));
        } else if (uType == 3) {
          float r = e * 1.7;
          vec3 A = rs(tA, uv, amt); vec3 B = rs(tB, uv, 0.0);
          col = dist < r ? B : A;
          col += vec3(0.9) * smoothstep(0.006, 0.0, abs(dist - r)) * (1.0 - e);
        } else {
          col = mix(rs(tA, uv, amt), rs(tB, uv, 0.0), smoothstep(0.0, 1.0, e));
          col = mix(col, uFade, 0.75 * sin(3.14159 * e));
        }
        if (uCA > 0.001 && e <= 0.0) {
          vec2 dca = (uv - uCenter) * uCA * 0.008;
          col.r = rs(tA, uv + dca, amt).r;
          col.b = rs(tA, uv - dca, amt).b;
        }
        col *= uTint;
        col *= 1.0 - lm * 0.12; col += lm * 0.015;
        if (uChequer > 0.0){
          float rows = 9.0; vec2 g = vUv * vec2(uAspect, 1.0) * rows; vec2 cell = floor(g); vec2 f = fract(g) - 0.5;
          float cols = ceil(uAspect * rows);
          float k = clamp((uChequer * (cols + rows + 6.0) - (cell.x + (rows - cell.y))) / 5.0, 0.0, 1.0);
          float s = 1.0 - pow(1.0 - k, 3.0);
          if (max(abs(f.x), abs(f.y)) < s * 0.5) col = mod(cell.x + cell.y, 2.0) > 0.5 ? vec3(0.86, 0.84, 0.78) : vec3(0.008);
        }
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(lum), col, uSat);
        float v = length((vUv - 0.5) * vec2(uAspect, 1.0));
        col *= 1.0 - uVig * smoothstep(0.35, 1.25, v);
        col *= 1.0 - uBlack;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        vec3 g = (gl_FragColor.rgb - 0.5) * uContrast + 0.5;
        g += uLift * (1.0 - g);
        gl_FragColor.rgb = max(g, 0.0) * (1.0 - uBlack);
        gl_FragColor.rgb += (h1(vUv * uRes + fract(uTime) * 100.0) - 0.5) * uGrain * (1.0 - uBlack);
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  return { scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mat };
}

/* ───────────── HUD helpers (2D canvas) ───────────── */

function hudMono(ctx, text, x, y, size, color, a = 1, align = 'left') {
  if (a <= 0.01) return;
  ctx.font = `500 ${size}px ${FONT_M}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillStyle = color; ctx.globalAlpha = a;
  ctx.fillText(String(text).toUpperCase(), x, y);
  ctx.globalAlpha = 1;
}
function hudBig(ctx, text, x, y, size, color, a = 1, align = 'center') {
  if (a <= 0.01) return;
  ctx.font = `900 ${size}px ${FONT_D}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillStyle = color; ctx.globalAlpha = a;
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}

/* ───────────── main factory ───────────── */

export async function createStory3D({ canvas, tracks, mobile = false, finale }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!renderer.getContext()) throw new Error('no webgl');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const isGL2 = renderer.capabilities.isWebGL2;

  if (document.fonts && document.fonts.ready) { try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]); } catch (e) { /* ignore */ } }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envStudio = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  const envNight = nightEnv(pmrem);

  /* ── optional assets: assets/hdr/<kind>.hdr and assets/tex/asphalt/*.jpg ── */
  const ASSET = (rel) => new URL(`../assets/${rel}`, import.meta.url).href;
  const listCache = new Map();
  const listDir = (rel) => {
    if (!listCache.has(rel)) {
      listCache.set(rel, fetch(ASSET(rel), { cache: 'no-store' }).then(async (r) => {
        if (!r.ok) return null;
        const txt = await r.text();
        if (!/<a\s+href=/i.test(txt)) return null;
        return new Set([...txt.matchAll(/href="([^"?#]+)"/gi)].map((m) => decodeURIComponent(m[1])));
      }).catch(() => null));
    }
    return listCache.get(rel);
  };
  // true / false when a directory listing answers, null when unknown (then just try)
  async function assetExists(dir, file) {
    const root = await listDir('');
    if (root && !root.has(dir.split('/')[0] + '/')) return false;
    const l = await listDir(dir + '/');
    if (l) return l.has(file);
    return root ? false : null;
  }
  const envFallback = { night: envNight, studio: envStudio, overcast: envStudio };
  const envLoaded = {}, envUsers = { night: [], studio: [], overcast: [] }, envLoading = {};
  function useEnv(scene, kind) {
    scene.environment = envLoaded[kind] || envFallback[kind];
    envUsers[kind].push(scene);
    if (envLoading[kind]) return;
    envLoading[kind] = (async () => {
      const ex = await assetExists('hdr', `${kind}.hdr`);
      if (ex === false) return;
      try {
        const hdr = await new RGBELoader().setDataType(THREE.HalfFloatType).loadAsync(ASSET(`hdr/${kind}.hdr`));
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        envLoaded[kind] = pmrem.fromEquirectangular(hdr).texture;
        hdr.dispose();
        envUsers[kind].forEach((sc) => { sc.environment = envLoaded[kind]; });
      } catch (e) { /* keep procedural environment */ }
    })();
  }
  const asphaltMats = [];
  let asphaltReal = null, asphaltLoading = null;
  function applyAsphalt(entry) {
    if (!asphaltReal) return;
    const { mat, rep } = entry;
    const cl = (t) => { const c = t.clone(); c.repeat.copy(rep); c.needsUpdate = true; return c; };
    mat.map = cl(asphaltReal.base); mat.normalMap = cl(asphaltReal.normal);
    if (!entry.wet) mat.roughnessMap = cl(asphaltReal.rough);
    mat.needsUpdate = true;
  }
  function registerAsphalt(mat, wetFlag, rep) {
    const e = { mat, wet: wetFlag, rep: rep.clone() };
    asphaltMats.push(e);
    if (asphaltReal) applyAsphalt(e);
    if (!asphaltLoading) {
      asphaltLoading = (async () => {
        const files = ['basecolor.jpg', 'normal.jpg', 'roughness.jpg'];
        const ex = await Promise.all(files.map((f) => assetExists('tex/asphalt', f)));
        if (ex.some((x) => x === false)) return;
        try {
          const L = new THREE.TextureLoader();
          const [base, normal, rough] = await Promise.all(files.map((f) => L.loadAsync(ASSET(`tex/asphalt/${f}`))));
          base.colorSpace = THREE.SRGBColorSpace;
          [base, normal, rough].forEach((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; });
          asphaltReal = { base, normal, rough };
          asphaltMats.forEach(applyAsphalt);
        } catch (e) { /* keep procedural asphalt */ }
      })();
    }
  }

  /* ── quality tiers: 2 = AO + DOF + bloom, 1 = DOF + bloom, 0 = bloom only ── */
  const forcedTier = new URLSearchParams(location.search).get('st-tier');
  let tier = forcedTier != null ? clamp(+forcedTier, 0, 2) : (mobile ? 0 : 2);
  let slowFrames = 0;
  const reflectors = [];
  const reflScale = () => [0.25, 0.35, 0.5][tier];
  function sizeReflectors() {
    const s = reflScale();
    reflectors.forEach((r) => r.getRenderTarget().setSize(Math.max(64, Math.round(view.W * view.dpr * s)), Math.max(64, Math.round(view.H * view.dpr * s))));
  }
  const glowTex = glowTexture();
  const streakTex = streakTexture();
  const texN = mobile ? 256 : 512;
  let wetTex = null, dryTex = null;
  const wet = () => (wetTex || (wetTex = makeAsphalt(texN, true)));
  const dry = () => (dryTex || (dryTex = makeAsphalt(texN, false)));
  const Q = mobile ? 0.5 : 1; // particle budget

  // car factory: the colleague's car3d.js if present, else our fallback
  let carFactory = null;
  const carReady = import('./car3d.js').then((m) => { carFactory = m.createCarModel || (m.default && m.default.createCarModel) || null; }).catch(() => { carFactory = null; });
  const carSlots = [];
  function makeCar(colors) {
    const holder = new THREE.Group();
    const slot = { holder, model: null, wheels: [], colors };
    const set = (model) => {
      if (slot.model) { holder.remove(slot.model.group); if (slot.model.dispose) slot.model.dispose(); }
      slot.model = model; slot.wheels = model.wheels || [];
      model.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      holder.add(model.group);
    };
    if (carFactory) { try { set(carFactory(THREE, { ...colors, detail: 'low' })); } catch (e) { set(makeFallbackCar(colors)); } }
    else set(makeFallbackCar(colors));
    slot.set = set;
    slot.dist = 0;
    slot.spin = (d) => { slot.dist += d; if (slot.model && slot.model.roll) slot.model.roll(d); else slot.wheels.forEach((w) => { w.rotation.x -= d / 0.34; }); };
    carSlots.push(slot);
    return slot;
  }
  carReady.then(() => {
    if (!carFactory) return;
    carSlots.forEach((s) => { try { s.set(carFactory(THREE, { ...s.colors, detail: 'low' })); } catch (e) { /* keep fallback */ } });
  });

  const comp = makeComposite();
  // two post-processing pipelines: outgoing (A) and incoming (B) chapter
  const dummyScene = new THREE.Scene(), dummyCam = new THREE.PerspectiveCamera();
  const withFxHidden = (pass) => {
    const orig = pass.render.bind(pass);
    pass.render = (r, w, rd, dt, mask) => {
      const sc = pass.scene;
      const list = sc.userData.fxList || (sc.userData.fxList = (() => { const a = []; sc.traverse((o) => { if (o.userData.fx) a.push(o); }); return a; })());
      const vis = list.map((o) => o.visible);
      list.forEach((o) => { o.visible = false; });
      try { orig(r, w, rd, dt, mask); } finally { list.forEach((o, i) => { o.visible = vis[i]; }); }
    };
  };
  function makePipe() {
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: isGL2 && !mobile ? 4 : 0 });
    const composer = new EffectComposer(renderer, rt);
    composer.renderToScreen = false;
    const renderPass = new RenderPass(dummyScene, dummyCam);
    composer.addPass(renderPass);
    let ao = null;
    if (!mobile) {
      try {
        ao = new GTAOPass(dummyScene, dummyCam, 4, 4);
        ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1, samples: 12 });
        ao.blendIntensity = 0.85;
        ao.enabled = false;
        withFxHidden(ao);
        composer.addPass(ao);
      } catch (e) { ao = null; }
    }
    const bokeh = new BokehPass(dummyScene, dummyCam, { focus: 5, aperture: 0.002, maxblur: 0.01 });
    bokeh.enabled = false;
    withFxHidden(bokeh);
    composer.addPass(bokeh);
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.5, 0.9);
    composer.addPass(bloom);
    return { composer, renderPass, ao, bokeh, bloom };
  }
  const pipes = [makePipe(), makePipe()];

  const view = { W: 1, H: 1, dpr: 1, portrait: false };
  const shift = () => (view.portrait ? { x: 0, y: 0.17 } : { x: -0.17, y: 0 });

  function frameCam(cam) {
    cam.aspect = view.W / view.H;
    const s = shift();
    cam.setViewOffset(view.W, view.H, s.x * view.W, s.y * view.H, view.W, view.H);
    cam.updateProjectionMatrix();
  }
  const project = (cam, v) => {
    const p = v.clone().project(cam);
    return [(p.x * 0.5 + 0.5) * view.W, (-p.y * 0.5 + 0.5) * view.H, p.z < 1];
  };

  /* ───── scene builders ───── */

  const B = {};

  // shared wet-night set: ground, lamps with reflections, rain, fog
  function wetSet(scene, { lamps = [], fog = 0x0a1518, fogD = 0.045, ground = 160, rainA = 0.32, rainCount = 2600, tile = 8, reflect = 1 } = {}) {
    scene.background = new THREE.Color(fog).multiplyScalar(0.6);
    scene.fog = new THREE.FogExp2(fog, fogD);
    useEnv(scene, 'night');
    const T0 = wet();
    const rep = new THREE.Vector2(ground / tile, ground / tile);
    const T = {};
    for (const k of ['color', 'normal', 'rough']) { T[k] = T0[k].clone(); T[k].repeat.copy(rep); T[k].needsUpdate = true; }
    const mat = new THREE.MeshStandardMaterial({ map: T.color, normalMap: T.normal, roughnessMap: T.rough, roughness: 1, metalness: 0.0, envMapIntensity: 1.2, normalScale: new THREE.Vector2(0.35, 0.35) });
    registerAsphalt(mat, true, rep);
    const g = new THREE.Mesh(new THREE.PlaneGeometry(ground, ground), mat);
    g.rotation.x = -Math.PI / 2; g.receiveShadow = true;
    scene.add(g);
    // planar reflection, masked by puddles and smeared into vertical streaks
    const rs0 = reflScale();
    const refl = new Reflector(new THREE.PlaneGeometry(ground, ground), {
      textureWidth: Math.max(64, Math.round(view.W * view.dpr * rs0)), textureHeight: Math.max(64, Math.round(view.H * view.dpr * rs0)),
      clipBias: 0.003, shader: WetReflectShader, multisample: 0, color: new THREE.Color(1, 1, 1),
    });
    refl.rotation.x = -Math.PI / 2; refl.position.y = 0.004;
    Object.assign(refl.material, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    refl.material.uniforms.tMask.value = T.rough; refl.material.uniforms.tNormal.value = T.normal;
    refl.material.uniforms.uRepeat.value.copy(rep); refl.material.uniforms.uFogD.value = fogD * 0.8; refl.material.uniforms.uStrength.value = reflect;
    refl.renderOrder = 4;
    const reflUpdate = refl.onBeforeRender;
    refl.onBeforeRender = () => {};
    reflectors.push(refl);
    (scene.userData.reflectors || (scene.userData.reflectors = [])).push((cam) => reflUpdate.call(refl, renderer, scene, cam));
    scene.add(refl);
    // low mist
    const mt = mistTexture();
    const mists = [0.35, 1.1].map((y, i) => {
      const t = mt.clone(); t.needsUpdate = true; t.repeat.set(3 + i, 3 + i);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ground * 0.6, ground * 0.6), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(fog).multiplyScalar(4.5), transparent: true, opacity: 0.09 - i * 0.03, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = y; m.userData.fx = true; scene.add(m);
      return m;
    });
    const splash = makeSplashes(Math.round(700 * Q), { alpha: rainA > 0 ? 0.55 : 0 });
    scene.add(splash);
    scene.add(new THREE.HemisphereLight(0x6b8a99, 0x050807, 0.35));
    const moon = new THREE.DirectionalLight(0x9fc1d6, 0.7); moon.position.set(-6, 10, -8); scene.add(moon);
    const streaks = [];
    lamps.forEach((l, i) => {
      const col = new THREE.Color(l.color || 0xffd58a);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, l.y, 6), new THREE.MeshStandardMaterial({ color: 0x1a1d1e, roughness: 0.6 }));
      pole.position.set(l.x, l.y / 2, l.z); scene.add(pole);
      const s = sprite(glowTex, col.clone().multiplyScalar(2.2), l.size || 3.2, 1);
      s.position.set(l.x, l.y, l.z); scene.add(s);
      const core = sprite(glowTex, col.clone().multiplyScalar(6), 0.5, 1);
      core.position.copy(s.position); scene.add(core);
      const st = makeStreak(streakTex, col.clone().multiplyScalar(1.4), (l.size || 3.2) * 0.3, l.y * 3.2, 0.3);
      const sh = makeShaft(col, l.y, l.y * 0.42, 0.09); sh.position.set(l.x, l.y, l.z); scene.add(sh);
      st.position.set(l.x, 0.02, l.z); scene.add(st); streaks.push(st);
      if (l.light) { const p = new THREE.PointLight(col, l.light, 26, 2); p.position.set(l.x, l.y - 0.2, l.z); scene.add(p); }
    });
    const rain1 = makeRain(Math.round(rainCount * Q), { alpha: rainA, len: 0.5, speed: 12, box: [26, 14, 30] });
    const rain2 = makeRain(Math.round(rainCount * 0.35 * Q), { alpha: rainA * 1.3, len: 0.9, speed: 15, width: 0.02, box: [12, 8, 14] });
    scene.add(rain1, rain2);
    return {
      ground: g, streaks,
      update(cam, S, k = 1) {
        streaks.forEach((s) => s.userData.face(cam));
        mists.forEach((m, i) => { m.material.map.offset.set(S.time * (0.004 + i * 0.003), S.time * 0.002); });
        const su = splash.material.uniforms;
        su.uTime.value = S.time; su.uAlpha.value = (rainA > 0 ? 0.55 : 0) * k;
        const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
        su.uCenter.value.copy(cam.position).addScaledVector(fwd, 10);
        for (const r of [rain1, r2()]) {
          const u = r.material.uniforms;
          u.uTime.value = S.time; u.uCenter.value.copy(cam.position);
          u.uSlant.value.set(0.12 + S.vel * 0.35, -0.05);
          u.uLen.value = (r === rain1 ? 0.5 : 0.9) * (1 + Math.abs(S.vel) * 0.8);
          u.uAlpha.value = (r === rain1 ? rainA : rainA * 1.3) * k;
        }
      },
    };
    function r2() { return rain2; }
  }

  B.dawn = () => {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(38, 1, 0.5, 1200);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSun: { value: new THREE.Vector3(0, 0, -1) }, uRise: { value: 0 } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */`
        uniform vec3 uSun; uniform float uRise; varying vec3 vD;
        void main(){
          vec3 d = normalize(vD); float h = d.y;
          vec3 top = mix(vec3(0.004,0.008,0.03), vec3(0.05,0.12,0.32), uRise);
          vec3 mid = mix(vec3(0.015,0.03,0.08), vec3(0.55,0.32,0.30), uRise);
          vec3 hor = mix(vec3(0.03,0.05,0.10), vec3(1.25,0.62,0.25), uRise);
          vec3 col = mix(hor, mid, smoothstep(0.0, 0.12, h));
          col = mix(col, top, smoothstep(0.12, 0.6, h));
          float s = max(dot(d, normalize(uSun)), 0.0);
          col += vec3(1.0, 0.55, 0.22) * pow(s, 6.0) * 0.9 * uRise;
          col += vec3(1.0, 0.8, 0.5) * pow(s, 60.0) * 1.2 * uRise;
          col += vec3(2.2, 1.8, 1.3) * smoothstep(0.99955, 0.9998, s) * (0.4 + uRise);
          if (h < 0.0) col = mix(col, hor * 0.25, smoothstep(0.0, -0.08, h));
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
    scene.add(sky);
    scene.fog = new THREE.Fog(0x1a1420, 220, 700);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0x050707, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    const win = canvasTex(64, 128, (c, w, h) => {
      c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
      for (let y = 4; y < h - 4; y += 8) for (let x = 3; x < w - 3; x += 7) {
        const r = hash(x * 7.1 + y * 3.3);
        if (r > 0.62) { c.fillStyle = r > 0.93 ? '#fff4d8' : '#ffc46a'; c.globalAlpha = 0.4 + 0.6 * hash(r * 9); c.fillRect(x, y, 3, 4); }
      }
      c.globalAlpha = 1;
    });
    const count = Math.round(700 * (mobile ? 0.5 : 1));
    const bmat = new THREE.MeshStandardMaterial({ color: 0x0b0f12, roughness: 0.75, metalness: 0.25, emissive: 0xffc06a, emissiveMap: win, emissiveIntensity: 1, envMapIntensity: 0.3 });
    const bgeo = new THREE.BoxGeometry(1, 1, 1); bgeo.translate(0, 0.5, 0);
    const city = new THREE.InstancedMesh(bgeo, bmat, count);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      let x = (hash(i * 1.3) - 0.5) * 420;
      const z = -70 - hash(i * 2.7) * 260;
      if (Math.abs(x) < 8) x += Math.sign(x || 1) * 12;
      const w = 5 + hash(i * 3.1) * 12, d = 5 + hash(i * 4.9) * 12;
      const r = hash(i * 5.3);
      const h = 5 + Math.pow(r, 2.8) * 48;
      m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
      city.setMatrixAt(i, m4);
    }
    scene.add(city);
    useEnv(scene, 'overcast');
    const sun = new THREE.DirectionalLight(0xffb470, 0); scene.add(sun);
    const hemi = new THREE.HemisphereLight(0x5a6a9a, 0x080606, 0.2); scene.add(hemi);
    const fogC = new THREE.Color();
    return {
      scene, cam,
      update(t, S) {
        const rise = easeOut(clamp(t * 1.1));
        const el = lerp(-0.03, 0.2, rise);
        const dir = new THREE.Vector3(0.22, el, -1).normalize();
        sky.material.uniforms.uSun.value.copy(dir);
        sky.material.uniforms.uRise.value = rise;
        sun.position.copy(dir).multiplyScalar(100); sun.intensity = 2.2 * rise;
        hemi.intensity = 0.15 + 0.5 * rise;
        bmat.emissiveIntensity = (1 - rise) * 1.6 + 0.05;
        fogC.setRGB(lerp(0.02, 0.6, rise), lerp(0.025, 0.36, rise), lerp(0.05, 0.25, rise));
        scene.fog.color.copy(fogC);
        cam.position.set(Math.sin(S.time * 0.05) * 0.6, 24 + t * 8, 190 - t * 30);
        cam.lookAt(0, 40 + t * 10, -300);
      },
      fx: () => ({ bloom: [0.3, 0.6, 1.8] }),
      post: () => ({ vig: 0.6, tint: [1.06, 0.98, 0.9], lift: [0.02, 0.01, 0.03], contrast: 1.06 }),
    };
  };

  B.blueprint = () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a2366);
    const cam = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
    useEnv(scene, 'studio');
    const grid = new THREE.GridHelper(16, 64, 0xf3efe4, 0xf3efe4);
    grid.material.transparent = true; grid.material.opacity = 0.12; scene.add(grid);
    const grid2 = new THREE.GridHelper(16, 16, 0xf3efe4, 0xf3efe4);
    grid2.material.transparent = true; grid2.material.opacity = 0.22; grid2.position.y = 0.001; scene.add(grid2);
    const k = makeKart();
    const lineMat = () => new THREE.LineBasicMaterial({ color: 0xf3efe4, transparent: true, opacity: 0 });
    const ghost = new THREE.MeshStandardMaterial({ color: 0x3d6ee8, transparent: true, opacity: 0, roughness: 0.4, metalness: 0.1, depthWrite: false });
    const items = k.parts.map((m) => {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 28), lineMat());
      edges.position.copy(m.position); edges.quaternion.copy(m.quaternion); edges.scale.copy(m.scale);
      m.material = ghost.clone();
      m.castShadow = false;
      k.group.add(edges);
      return { m, edges };
    });
    scene.add(k.group);
    k.group.scale.setScalar(1.25);
    const pen = sprite(glowTex, new THREE.Color(0xffdf00).multiplyScalar(2), 0.25, 1);
    scene.add(pen);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const lab = { engine: k.engine, steering: k.steering };
    let rv = 0;
    return {
      scene, cam,
      update(t, S) {
        rv = smooth(range(t, 0.04, 0.72));
        const n = items.length;
        let last = null;
        items.forEach((it, i) => {
          const a = clamp(rv * n - i);
          it.edges.material.opacity = a * 0.95;
          it.m.material.opacity = a * 0.22;
          if (a > 0 && a < 1) last = it.m;
        });
        if (last) { pen.visible = true; last.getWorldPosition(pen.position); } else pen.visible = false;
        const ang = -0.75 + t * 0.9 + Math.sin(S.time * 0.2) * 0.03;
        cam.position.set(Math.sin(ang) * 3.4, 2.3 - t * 0.4, Math.cos(ang) * 3.4);
        cam.lookAt(0, 0.2, 0);
      },
      hud(ctx, W, H, t, a) {
        const lbl = (obj, text, need) => {
          if (rv < need) return;
          const p = project(cam, obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.35, 0)));
          hudMono(ctx, text, p[0], p[1], 11, '#ffdf00', a * range(rv, need, need + 0.08), 'center');
        };
        lbl(lab.steering, 'Steering', 0.85);
        lbl(lab.engine, 'Engine · 1 hp', 0.72);
        const bx = view.portrait ? 16 : W * 0.66, by = view.portrait ? H * 0.5 : H - 70;
        const ba = a * range(t, 0.1, 0.25);
        ctx.globalAlpha = ba * 0.5; ctx.strokeStyle = '#f3efe4'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, 240, 40); ctx.globalAlpha = 1;
        hudMono(ctx, 'Sheet 01 · Kart · 3/4 view', bx + 10, by + 13, 10, '#f3efe4', ba * 0.8);
        hudMono(ctx, 'São Paulo · c. 1964', bx + 10, by + 28, 10, '#f3efe4', ba * 0.5);
      },
      fx: () => ({ bloom: [0.5, 0.4, 0.7], dof: [cam.position.length(), 0.0025, 0.008] }),
      post: () => ({ vig: 0.5, tint: [0.95, 1.0, 1.08] }),
    };
  };

  B.arc = () => {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(36, 1, 0.1, 300);
    scene.background = new THREE.Color(0x9fb6c4);
    scene.fog = new THREE.Fog(0x9fb6c4, 25, 120);
    useEnv(scene, 'overcast');
    const D = dry();
    [D.color, D.normal, D.rough].forEach((t) => t.repeat.set(10, 10));
    const grassTex = canvasTex(256, 256, (c, w, h) => {
      const n = makeNoise(32, 5);
      const img = c.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = n(x / 8, y / 8) * 0.6 + hash(x * 7 + y * 13) * 0.4;
        const o = (y * w + x) * 4;
        img.data[o] = 40 + v * 30; img.data[o + 1] = 70 + v * 45; img.data[o + 2] = 30 + v * 20; img.data[o + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    });
    grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping; grassTex.repeat.set(40, 40);
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true; scene.add(grass);
    const R0 = 15, R1 = 21, RM = 18;
    const road = new THREE.Mesh(new THREE.RingGeometry(R0, R1, 160, 1, -0.2, Math.PI * 1.4), new THREE.MeshStandardMaterial({ map: D.color, normalMap: D.normal, roughnessMap: D.rough, roughness: 1 }));
    registerAsphalt(road.material, false, new THREE.Vector2(10, 10));
    road.rotation.x = -Math.PI / 2; road.position.y = 0.01; road.receiveShadow = true; scene.add(road);
    // kerbs
    const kN = 140;
    const kerbs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.06, 0.9), new THREE.MeshStandardMaterial({ roughness: 0.5 }), kN * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    for (let i = 0; i < kN; i++) {
      const th = -0.2 + (i / kN) * Math.PI * 1.4;
      [R0 + 0.25, R1 - 0.25].forEach((r, j) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), th);
        m4.compose(new THREE.Vector3(r * Math.cos(th), 0.03, -r * Math.sin(th)), q, new THREE.Vector3(1, 1, 1));
        kerbs.setMatrixAt(i * 2 + j, m4);
        kerbs.setColorAt(i * 2 + j, col.set(i % 2 ? 0xc81e28 : 0xf2efe6));
      });
    }
    kerbs.receiveShadow = true; scene.add(kerbs);
    // tyre-wall barrier
    const tN = Math.round(160 * (mobile ? 0.6 : 1));
    const tyres = new THREE.InstancedMesh(new THREE.TorusGeometry(0.28, 0.12, 8, 16), new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.85 }), tN * 3);
    for (let i = 0; i < tN; i++) {
      const th = -0.2 + (i / tN) * Math.PI * 1.4;
      for (let l = 0; l < 3; l++) {
        q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
        m4.compose(new THREE.Vector3((R1 + 3) * Math.cos(th), 0.12 + l * 0.24, -(R1 + 3) * Math.sin(th)), q, new THREE.Vector3(1, 1, 1));
        tyres.setMatrixAt(i * 3 + l, m4);
      }
    }
    tyres.castShadow = true; scene.add(tyres);
    const k = makeKart();
    scene.add(k.group);
    const smoke = makePlume(Math.round(500 * Q), { emit: [[-0.5, 0.1, 0.6], [0.5, 0.1, 0.6]], dir: [0, 0, 1], speed: 3, rise: 0.9, size: 0.6, alpha: 0.26, color: 0xdedad2, rate: 1.1, spread: 0.6 });
    k.group.add(smoke);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 40 });
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x3a4a2a, 0.7));
    return {
      scene, cam,
      update(t, S) {
        const th = lerp(0.1, Math.PI * 1.05, easeInOut(range(t, 0, 1)));
        const p = new THREE.Vector3(RM * Math.cos(th), 0, -RM * Math.sin(th));
        k.group.position.copy(p);
        k.group.rotation.y = th + 0.38 + Math.sin(S.time * 3) * 0.02;
        k.wheels.forEach((w) => { w.rotation.x -= 0.4; });
        smoke.material.uniforms.uTime.value = S.time;
        smoke.material.uniforms.uPx.value = view.H * view.dpr * 0.5;
        sun.position.copy(p).add(new THREE.Vector3(8, 14, 6)); sun.target.position.copy(p);
        const out = new THREE.Vector3(Math.cos(th), 0, -Math.sin(th));
        const tan = new THREE.Vector3(-Math.sin(th), 0, -Math.cos(th));
        cam.position.copy(p).addScaledVector(out, 4.2).addScaledVector(tan, 2.6).add(new THREE.Vector3(0, 1.3, 0));
        cam.lookAt(p.x, 0.35, p.z);
      },
      fx: () => ({ bloom: [0.22, 0.4, 0.95], dof: [cam.position.distanceTo(k.group.position), 0.0028, 0.01], ao: true }),
      post: () => ({ vig: 0.45, radial: 0.25, focus: 0.35, tint: [1.03, 1.0, 0.95], contrast: 1.08, ca: 0.25 }),
    };
  };

  B.rain = () => {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    const lamps = [];
    for (let i = 0; i < 7; i++) lamps.push({ x: i % 2 ? 7 : -7, y: 5.5, z: 8 - i * 8, light: i < 4 ? 26 : 0 });
    const set = wetSet(scene, { lamps, fog: 0x0b171b, fogD: 0.05 });
    const k = makeKart();
    scene.add(k.group);
    const spray = makePlume(Math.round(900 * Q), { emit: [[-0.5, 0.1, 0.6], [0.5, 0.1, 0.6]], dir: [0, 0, 1], speed: 5, rise: 1.4, size: 0.45, alpha: 0.16, color: 0xc8d7dd, rate: 1.5, spread: 0.9 });
    k.group.add(spray);
    const head = new THREE.PointLight(0xffe8b0, 2.5, 8, 2); head.position.set(0, 1.4, -1.5); k.group.add(head);
    return {
      scene, cam,
      update(t, S) {
        const u = lerp(0, 1, easeInOut(t));
        const z = lerp(10, -36, u);
        const x = Math.sin(u * TAU * 1.1 + 0.4) * 2.4;
        const dx = Math.cos(u * TAU * 1.1 + 0.4) * 2.4 * TAU * 1.1 / 46;
        const heading = Math.atan2(-dx, 1) ;
        const slip = Math.cos(u * TAU * 1.1 + 0.4) * 0.5 + Math.sin(S.time * 2.1) * 0.04;
        k.group.position.set(x, 0, z);
        k.group.rotation.y = heading + slip;
        k.wheels.forEach((w) => { w.rotation.x -= 0.35; });
        spray.material.uniforms.uTime.value = S.time; spray.material.uniforms.uPx.value = view.H * view.dpr * 0.5;
        cam.position.set(x + 3.2, 1.2, z - 4.2);
        cam.lookAt(x, 0.3, z + 0.4);
        set.update(cam, S);
      },
      fx: () => ({ bloom: [0.75, 0.6, 0.75], dof: [cam.position.distanceTo(k.group.position), 0.003, 0.011], ao: true }),
      post: () => ({ vig: 0.65, lens: 0.85, tint: [0.86, 1.0, 1.05], lift: [0.0, 0.015, 0.02], contrast: 1.1, ca: 0.25 }),
    };
  };

  B.bands = () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040b1a);
    useEnv(scene, 'studio');
    const cam = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    const cols = [0x00a651, 0xffdf00, 0x1b4fd8, 0xf3efe4, 0x00a651];
    const flags = cols.map((c, i) => {
      const geo = new THREE.PlaneGeometry(40, 2.1, 90, 6);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, side: THREE.DoubleSide, envMapIntensity: 0.6 }));
      m.position.set(0, 5.2 - i * 2.05, -6 - i * 0.05);
      m.rotation.z = -0.18;
      m.userData.base = geo.attributes.position.array.slice();
      scene.add(m);
      return m;
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x05080d, roughness: 0.22, metalness: 0.6 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const blockMat = new THREE.MeshPhysicalMaterial({ color: 0xece7da, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12 });
    const two = canvasTex(256, 256, (c, w, h) => { c.font = `900 220px ${FONT_D}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#0b0f0d'; c.fillText('2', w / 2, h / 2 + 10); });
    const one = canvasTex(256, 256, (c, w, h) => { c.font = `900 220px ${FONT_D}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.strokeStyle = 'rgba(243,239,228,0.6)'; c.lineWidth = 4; c.strokeText('1', w / 2, h / 2 + 10); });
    const mkBlock = (x, h, solid) => {
      const g = new THREE.Group(); g.position.x = x;
      const geo = new THREE.BoxGeometry(1.1, h, 1.1); geo.translate(0, h / 2, 0);
      let body;
      if (solid) { body = new THREE.Mesh(geo, blockMat); body.castShadow = true; }
      else { body = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineDashedMaterial({ color: 0xf3efe4, dashSize: 0.12, gapSize: 0.1, transparent: true, opacity: 0.7 })); body.computeLineDistances(); }
      g.add(body);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: solid ? two : one, transparent: true, depthWrite: false }));
      label.position.set(0, h - 0.55, 0.56); g.add(label);
      scene.add(g);
      return g;
    };
    const blocks = [mkBlock(-1.5, 2.0, true), mkBlock(0, 2.9, false), mkBlock(1.5, 2.0, true)];
    const key = new THREE.SpotLight(0xfff4e0, 60, 30, 0.5, 0.6, 1.5); key.position.set(3, 7, 6); key.castShadow = true; scene.add(key, key.target);
    scene.add(new THREE.HemisphereLight(0x8aa0d0, 0x101010, 0.4));
    return {
      scene, cam,
      update(t, S) {
        flags.forEach((f, i) => {
          const pos = f.geometry.attributes.position; const b = f.userData.base;
          for (let v = 0; v < pos.count; v++) {
            const x = b[v * 3], y = b[v * 3 + 1];
            pos.array[v * 3 + 2] = Math.sin(x * 0.55 + S.time * 1.6 + i * 0.7 + t * 4) * 0.35 + Math.sin(x * 1.3 - S.time * 1.1 + y) * 0.08;
          }
          pos.needsUpdate = true; f.geometry.computeVertexNormals();
        });
        const ks = [range(t, 0.18, 0.4), range(t, 0.05, 0.3), range(t, 0.38, 0.6)];
        blocks.forEach((b, i) => { const e = easeOut(ks[i]); b.scale.set(1, Math.max(0.001, e), 1); b.visible = e > 0.001; });
        const a = 0.25 + t * 0.2;
        cam.position.set(Math.sin(a) * 9, 2.6, Math.cos(a) * 9);
        cam.lookAt(0, 1.6, 0);
      },
      hud(ctx, W, H, t, a) {
        [['1979', -1.5, range(t, 0.25, 0.4)], ['1980', 1.5, range(t, 0.45, 0.6)]].forEach(([s, x, k]) => {
          const p = project(cam, new THREE.Vector3(x, -0.25, 0.6));
          hudMono(ctx, s, p[0], p[1], 12, '#f3efe4', a * k, 'center');
        });
      },
      fx: () => ({ bloom: [0.25, 0.4, 0.95], dof: [cam.position.distanceTo(new THREE.Vector3(0, 1.6, 0)), 0.002, 0.008], ao: true }),
      post: () => ({ vig: 0.6, contrast: 1.05 }),
    };
  };

  B.globe = () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02050a);
    const cam = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
    const sN = Math.round(1500 * Q);
    const sp = new Float32Array(sN * 3);
    for (let i = 0; i < sN; i++) { const v = new THREE.Vector3(hash(i) - 0.5, hash(i + 0.3) - 0.5, hash(i + 0.7) - 0.5).normalize().multiplyScalar(80); sp.set([v.x, v.y, v.z], i * 3); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xbfc8d8, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.6 })));
    const globe = new THREE.Group(); scene.add(globe);
    const R = 2;
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), new THREE.ShaderMaterial({
      uniforms: { uL: { value: new THREE.Vector3(-0.4, 0.5, 0.8).normalize() } },
      vertexShader: 'varying vec3 vN; varying vec3 vWN; varying vec3 vV; void main(){ vN = normalize(position); vWN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */`
        uniform vec3 uL; varying vec3 vN; varying vec3 vWN; varying vec3 vV;
        void main(){
          float lat = asin(clamp(vN.y, -1.0, 1.0)); float lon = atan(vN.x, vN.z);
          float rows = 80.0; float row = floor((lat / 3.14159 + 0.5) * rows);
          float clat = ((row + 0.5) / rows - 0.5) * 3.14159;
          float cols = max(6.0, floor(rows * 2.0 * cos(clat)));
          vec2 g = vec2((lon / 6.28318 + 0.5) * cols, (lat / 3.14159 + 0.5) * rows);
          vec2 f = fract(g) - 0.5;
          float dotm = smoothstep(0.26, 0.12, length(f));
          float diff = clamp(dot(vWN, uL) * 0.6 + 0.45, 0.08, 1.0);
          vec3 col = vec3(0.004, 0.012, 0.035) + vec3(0.55, 0.6, 0.66) * dotm * 0.6 * diff;
          float fr = pow(1.0 - max(dot(vWN, vV), 0.0), 3.0);
          col += vec3(0.08, 0.22, 0.85) * fr * 1.4;
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
    globe.add(sphere);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.12, 64, 32), new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float f = pow(clamp(1.0 + dot(vN, vV), 0.0, 1.0), 4.0); gl_FragColor = vec4(vec3(0.1,0.3,1.0)*f*1.6, f); }',
    }));
    scene.add(atmo);
    const vec = (lat, lon, r = R) => { const la = lat * Math.PI / 180, lo = lon * Math.PI / 180; return new THREE.Vector3(Math.cos(la) * Math.sin(lo) * r, Math.sin(la) * r, Math.cos(la) * Math.cos(lo) * r); };
    const A = [-23.55, -46.63], Bp = [52.6, -1.2];
    const va = vec(...A, 1), vb = vec(...Bp, 1);
    const om = va.angleTo(vb);
    const pts = [];
    for (let i = 0; i <= 120; i++) {
      const s = i / 120;
      const v = va.clone().multiplyScalar(Math.sin((1 - s) * om) / Math.sin(om)).add(vb.clone().multiplyScalar(Math.sin(s * om) / Math.sin(om)));
      pts.push(v.normalize().multiplyScalar(R * (1 + 0.2 * Math.sin(Math.PI * s))));
    }
    const arcGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 240, 0.012, 6, false);
    const arcMat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: { uDraw: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform float uDraw; varying vec2 vUv; void main(){ if (vUv.x > uDraw) discard; float k = 0.35 + 0.65 * smoothstep(uDraw - 0.25, uDraw, vUv.x); gl_FragColor = vec4(vec3(1.0,0.85,0.1)*2.2*k, 1.0); }',
    });
    globe.add(new THREE.Mesh(arcGeo, arcMat));
    const headS = sprite(glowTex, new THREE.Color(0xffdf00).multiplyScalar(3), 0.5, 1); globe.add(headS);
    const cityA = sprite(glowTex, new THREE.Color(0xffdf00).multiplyScalar(2), 0.3, 1); cityA.position.copy(vec(...A, R * 1.01)); globe.add(cityA);
    const cityB = sprite(glowTex, new THREE.Color(0xffdf00).multiplyScalar(2), 0.3, 1); cityB.position.copy(vec(...Bp, R * 1.01)); globe.add(cityB);
    const tmp = new THREE.Vector3();
    return {
      scene, cam,
      update(t, S) {
        const e = easeInOut(range(t, 0, 0.9));
        const lon0 = lerp(-50, -15, e) + Math.sin(S.time * 0.1) * 1.5, lat0 = lerp(-12, 22, e);
        globe.rotation.set(lat0 * Math.PI / 180, -lon0 * Math.PI / 180, 0, 'XYZ');
        const prog = easeInOut(range(t, 0.18, 0.75));
        arcMat.uniforms.uDraw.value = prog;
        headS.visible = prog > 0 && prog < 1;
        headS.position.copy(pts[Math.min(120, Math.round(prog * 120))]);
        cityA.material.opacity = range(t, 0.05, 0.2);
        cityB.material.opacity = range(t, 0.72, 0.82);
        const d = view.portrait ? 10.5 : 9.6;
        cam.position.set(0, 0.3, d); cam.lookAt(0, 0, 0);
      },
      hud(ctx, W, H, t, a) {
        const lbl = (sp, text, k, right) => {
          sp.getWorldPosition(tmp);
          if (tmp.z < 0) return;
          const p = project(cam, tmp);
          hudMono(ctx, text, p[0] + (right ? 14 : -14), p[1], 11, '#f3efe4', a * k, right ? 'left' : 'right');
        };
        lbl(cityA, 'São Paulo', range(t, 0.05, 0.2), true);
        lbl(cityB, 'England', range(t, 0.72, 0.82), false);
      },
      fx: () => ({ bloom: [0.9, 0.6, 0.55] }),
      post: () => ({ vig: 0.5, tint: [0.95, 1.0, 1.1] }),
    };
  };

  B.titles = () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02100a);
    scene.fog = new THREE.FogExp2(0x02100a, 0.06);
    useEnv(scene, 'studio');
    const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    const rows = [
      ['1981', 'Formula Ford 1600', 'Two titles', false],
      ['1982', 'Formula Ford 2000', 'British + European', false],
      ['1983', 'British Formula 3', 'Champion', true],
    ];
    const slabMat = new THREE.MeshPhysicalMaterial({ color: 0x0b1410, roughness: 0.18, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.2 });
    const slabs = rows.map(([yr, l1, l2, hi], i) => {
      const g = new THREE.Group();
      const s = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.15, 0.22), slabMat); g.add(s);
      const tex = canvasTex(1080, 230, (c, w, h) => {
        c.font = `900 210px ${FONT_D}`; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
        if (hi) { c.fillStyle = '#ffdf00'; c.fillText(yr, 30, 205); }
        else { c.strokeStyle = '#f3efe4'; c.lineWidth = 3; c.strokeText(yr, 30, 205); }
        c.font = `500 30px ${FONT_M}`; c.textAlign = 'right';
        c.fillStyle = '#f3efe4'; c.fillText(l1.toUpperCase(), w - 30, 100);
        c.fillStyle = '#ffdf00'; c.fillText(l2.toUpperCase(), w - 30, 145);
      });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.15), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, color: new THREE.Color(1, 1, 1).multiplyScalar(0.92) }));
      face.position.z = 0.112; g.add(face);
      g.position.y = 1.35 - i * 1.35;
      scene.add(g);
      return g;
    });
    const key = new THREE.SpotLight(0xf5fff5, 90, 30, 0.6, 0.7, 1.5); key.position.set(-4, 6, 6); scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x00a651, 1.5); rim.position.set(5, 2, -4); scene.add(rim);
    const rain = makeRain(Math.round(900 * Q), { alpha: 0.12, len: 0.35, speed: 7, box: [14, 10, 14] });
    scene.add(rain);
    return {
      scene, cam,
      update(t, S) {
        slabs.forEach((g, i) => {
          const e = easeOut(range(t, 0.1 + i * 0.18, 0.32 + i * 0.18));
          g.position.x = (1 - e) * 9; g.rotation.y = -0.25 + (1 - e) * 0.5; g.visible = e > 0.001;
        });
        cam.position.set(-1.6 + t * 0.6, 0.4, (view.portrait ? 15 : 11) - t * 0.6); cam.lookAt(0, 0, 0);
        const u = rain.material.uniforms; u.uTime.value = S.time; u.uCenter.value.copy(cam.position); u.uSlant.value.set(0.1 + S.vel * 0.3, 0);
      },
      fx: () => ({ bloom: [0.35, 0.5, 0.85], dof: [cam.position.length(), 0.0022, 0.007] }),
      post: () => ({ vig: 0.6, tint: [0.93, 1.04, 0.95], contrast: 1.05 }),
    };
  };

  B.lights = () => {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
    const lamps = [{ x: -11, y: 6, z: -14, light: 18 }, { x: 12, y: 6, z: -44 }, { x: -11, y: 6, z: -60 }];
    const set = wetSet(scene, { lamps, fog: 0x0c1621, fogD: 0.03 });
    // harbour bokeh
    const bokeh = new THREE.Group(); scene.add(bokeh);
    for (let i = 0; i < 40; i++) {
      const c = [0xffdf00, 0xfff0d0, 0xffaa50, 0x88aaff][i % 4];
      const s = sprite(glowTex, new THREE.Color(c).multiplyScalar(0.9 + hash(i) * 1.2), 2 + hash(i + 2) * 4, 0.8);
      s.position.set((hash(i + 3) - 0.5) * 90, 1 + hash(i + 4) * 9, -60 - hash(i + 5) * 40); bokeh.add(s);
    }
    // gantry: five pairs
    const gantry = new THREE.Group(); gantry.position.set(0, 5.2, -2); scene.add(gantry);
    const black = new THREE.MeshStandardMaterial({ color: 0x0c0d0d, roughness: 0.5, metalness: 0.4 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.22, 0.3), black); beam.position.y = 1.15; gantry.add(beam);
    const lampsR = [];
    for (let k = 0; k < 5; k++) {
      const x = -2.4 + k * 1.2;
      const hsg = new THREE.Mesh(new THREE.BoxGeometry(0.86, 1.9, 0.34), black); hsg.position.set(x, 0, 0); gantry.add(hsg);
      for (let j = 0; j < 2; j++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 12), new THREE.MeshStandardMaterial({ color: 0x1b1d1c, emissive: 0xff2b1c, emissiveIntensity: 0, roughness: 0.3 }));
        m.position.set(x, 0.42 - j * 0.84, 0.18); gantry.add(m);
        const g = sprite(glowTex, new THREE.Color(0xff2b1c).multiplyScalar(2.5), 1.9, 0); g.position.set(x, 0.42 - j * 0.84, 0.35); gantry.add(g);
        lampsR.push({ m, g, k });
      }
    }
    const redStreaks = [];
    for (let k = 0; k < 5; k++) { const s = makeStreak(streakTex, new THREE.Color(0xff2b1c).multiplyScalar(1.5), 0.7, 9, 0); s.position.set(-2.4 + k * 1.2, 0.02, -2); scene.add(s); redStreaks.push(s); }
    const car = makeCar({ upper: 0xf4f4f2, lower: 0xf4f4f2, helmet: 0xffd400 });
    scene.add(car.holder);
    const spray = makePlume(Math.round(1100 * Q), { emit: [[-0.8, 0.15, 1.6], [0.8, 0.15, 1.6]], dir: [0, 0, 1], speed: 7, rise: 1.6, size: 0.5, alpha: 0.07, color: 0xc8d4dc, rate: 1.4, spread: 1.4 });
    car.holder.add(spray);
    const tail = sprite(glowTex, new THREE.Color(0xff2b1c).multiplyScalar(3), 0.6, 1); tail.position.set(0, 0.55, 2.25); car.holder.add(tail);
    return {
      scene, cam,
      update(t, S) {
        const out = t >= 0.5;
        lampsR.forEach(({ m, g, k }) => { const on = !out && t >= 0.1 + k * 0.08; m.material.emissiveIntensity = on ? 5 : 0; g.material.opacity = on ? 1 : 0; });
        redStreaks.forEach((s, k) => { s.material.opacity = !out && t >= 0.1 + k * 0.08 ? 0.75 : 0; });
        const mon = smooth(range(t, 0.5, 0.78));
        const cz = lerp(9, -2 - 34 * range(t, 0.5, 1), mon);
        car.holder.position.set(0.2, 0, lerp(4.5, -30, easeInOut(range(t, 0.52, 1))));
        car.spin(out ? 0.2 : 0);
        spray.material.uniforms.uOn.value = smooth(range(t, 0.52, 0.6));
        spray.material.uniforms.uTime.value = S.time; spray.material.uniforms.uPx.value = view.H * view.dpr * 0.5;
        cam.position.set(lerp(0, 1.6, mon), lerp(1.1, 1.7, mon), lerp(9.5, car.holder.position.z + 9.5, mon));
        const look = new THREE.Vector3(lerp(0, 0.2, mon), lerp(5.4, 0.7, mon), lerp(-2, car.holder.position.z - 6, mon));
        cam.lookAt(look);
        set.update(cam, S, lerp(0.6, 1, mon));
        redStreaks.forEach((s) => s.userData.face(cam));
      },
      fx: (t) => ({ bloom: [1.0, 0.6, 0.7], dof: [t < 0.5 ? cam.position.distanceTo(gantry.position) : cam.position.distanceTo(car.holder.position), 0.0022, 0.009], ao: t > 0.5 }),
      post: (t) => ({ vig: 0.65, lens: lerp(0.15, 0.9, smooth(range(t, 0.5, 0.75))), tint: [0.94, 0.98, 1.06], contrast: 1.08, ca: 0.2 }),
    };
  };

  B.estoril = () => {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(34, 1, 0.1, 300);
    const lamps = [];
    for (let i = 0; i < 9; i++) lamps.push({ x: i % 2 ? 8 : -8, y: 6, z: 10 - i * 14, light: i < 3 ? 22 : 0 });
    const set = wetSet(scene, { lamps, fog: 0x0b1416, fogD: 0.04, ground: 260 });
    const car = makeCar({ upper: 0x0c0c0c, lower: 0x111111, helmet: 0xffd400, accent: '#c9a24a' });
    scene.add(car.holder);
    const spray = makePlume(Math.round(1300 * Q), { emit: [[-0.8, 0.15, 1.6], [0.8, 0.15, 1.6]], dir: [0, 0, 1], speed: 11, rise: 2.4, size: 0.6, alpha: 0.12, color: 0xc8d4dc, rate: 1.5, spread: 1.4 });
    car.holder.add(spray);
    return {
      scene, cam,
      update(t, S) {
        const z = 6 - t * 70;
        car.holder.position.set(0, 0, z);
        car.spin(0.25);
        spray.material.uniforms.uTime.value = S.time; spray.material.uniforms.uPx.value = view.H * view.dpr * 0.5;
        const a = lerp(-0.9, 0.5, easeInOut(range(t, 0, 0.7)));
        cam.position.set(Math.sin(a) * 6 + 1.2, 1.0 + Math.sin(S.time * 0.7) * 0.03, z + Math.cos(a) * -6);
        cam.lookAt(0, 0.5, z + 0.3);
        set.update(cam, S);
      },
      hud(ctx, W, H, t, a) {
        const f = easeInOut(range(t, 0.04, 0.6));
        hudMono(ctx, 'Lap ' + Math.max(1, Math.min(67, Math.round(f * 67))), view.portrait ? 20 : W * 0.42, view.portrait ? 70 : H * 0.14, 12, '#f3efe4', a * 0.7 * range(t, 0.05, 0.15) * (1 - range(t, 0.58, 0.66)));
      },
      fx: () => ({ bloom: [0.7, 0.6, 0.75], dof: [cam.position.distanceTo(car.holder.position), 0.003, 0.011], ao: true }),
      post: (t) => ({ vig: 0.6, lens: 0.9, chequer: range(t, 0.6, 0.9), tint: [0.9, 1.0, 1.03], lift: [0.0, 0.012, 0.015], contrast: 1.1, ca: 0.3 }),
    };
  };

  B.tunnel = () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x120d06, 0.018);
    useEnv(scene, 'night');
    const cam = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    const RR = 90, HW = 4.2, HT = 4.6, SEG = mobile ? 180 : 320;
    const ring = new THREE.Group(); scene.add(ring);
    const D = dry();
    const road = new THREE.Mesh(new THREE.RingGeometry(RR - HW, RR + HW, SEG, 1), new THREE.MeshStandardMaterial({ color: 0x8a8a8a, map: D.color, normalMap: D.normal, roughnessMap: D.rough, roughness: 0.75 }));
    road.rotation.x = -Math.PI / 2; ring.add(road);
    const wallTex = canvasTex(256, 64, (c, w, h) => {
      c.fillStyle = '#b8b2a2'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#9c968a'; for (let x = 0; x < w; x += 32) c.fillRect(x, 0, 2, h);
      c.fillStyle = '#2b2a27'; c.fillRect(0, h * 0.82, w, h * 0.18);
    });
    wallTex.wrapS = THREE.RepeatWrapping; wallTex.repeat.set(SEG / 2, 1);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.55, metalness: 0.05 });
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(RR - HW, RR - HW, HT, SEG, 1, true), wallMat); inner.position.y = HT / 2; ring.add(inner);
    const outerM = wallMat.clone(); outerM.side = THREE.BackSide;
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(RR + HW, RR + HW, HT, SEG, 1, true), outerM); outer.position.y = HT / 2; ring.add(outer);
    const ceil = new THREE.Mesh(new THREE.RingGeometry(RR - HW - 0.1, RR + HW + 0.1, SEG, 1), new THREE.MeshStandardMaterial({ color: 0x1c1a17, roughness: 0.9, side: THREE.DoubleSide }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = HT; ring.add(ceil);
    const nL = Math.round((TAU * RR) / 4.5);
    const strip = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.05, 2.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.82, 0.55).multiplyScalar(7) }), nL * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < nL; i++) {
      const th = (i / nL) * TAU;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), th);
      [RR - 1.6, RR + 1.6].forEach((r, j) => { m4.compose(new THREE.Vector3(r * Math.cos(th), HT - 0.04, -r * Math.sin(th)), q, new THREE.Vector3(1, 1, 1)); strip.setMatrixAt(i * 2 + j, m4); });
    }
    ring.add(strip);
    const wl = Math.round((TAU * RR) / 9);
    const wallLights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.25, 1.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.9, 0.7).multiplyScalar(4) }), wl);
    for (let i = 0; i < wl; i++) {
      const th = (i / wl) * TAU + 0.02;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), th);
      m4.compose(new THREE.Vector3((RR + HW - 0.05) * Math.cos(th), 2.6, -(RR + HW - 0.05) * Math.sin(th)), q, new THREE.Vector3(1, 1, 1)); wallLights.setMatrixAt(i, m4);
    }
    ring.add(wallLights);
    // moving point lights for highlights sliding over the car
    const pls = [];
    for (let i = 0; i < 4; i++) { const p = new THREE.PointLight(0xffd9a0, 30, 16, 2); const th = Math.PI + (i - 1) * 0.06; p.position.set(RR * Math.cos(th), HT - 0.4, -RR * Math.sin(th)); ring.add(p); pls.push(p); }
    scene.add(new THREE.HemisphereLight(0xffe0b0, 0x111111, 0.35));
    const car = makeCar({ upper: 0xc8102e, lower: 0xf4f4f2, helmet: 0xffd400 });
    car.holder.position.set(-RR + 0.6, 0, 0);
    scene.add(car.holder);
    let phase = 0;
    let lastFocus = 0;
    return {
      scene, cam,
      update(t, S, dt) {
        const sp = lerp(0.18, 0.62, range(t, 0, 0.6)) + Math.abs(S.vel) * 0.1;
        phase += sp * (dt || 0.016);
        ring.rotation.y = phase + t * 1.2;
        car.spin(0.3);
        const f = easeInOut(range(t, 0.05, 0.8));
        cam.fov = lerp(40, 66, f) + Math.abs(S.vel) * 3;
        cam.updateProjectionMatrix();
        cam.position.set(-RR + 0.3 + Math.sin(S.time * 7) * 0.006, 1.7, 8.2 - f * 1.6);
        cam.lookAt(-RR + 2.0, 0.6, -14);
        lastFocus = f;
      },
      hud(ctx, W, H, t, a) {
        const m = range(t, 0.32, 0.72);
        const ta = a * range(t, 0.25, 0.35);
        if (ta <= 0) return;
        const done = m >= 1;
        const cx = view.portrait ? W / 2 : W * 0.67, cy = view.portrait ? H * 0.33 : H * 0.45;
        const size = Math.min(W, H) * (done ? 0.16 : 0.11);
        if (done) { ctx.save(); ctx.shadowColor = 'rgba(255,223,0,0.6)'; ctx.shadowBlur = 40; }
        hudBig(ctx, `${(easeOut(m) * 1.427).toFixed(3)}s`, cx, cy, size, done ? '#ffdf00' : '#f3efe4', ta);
        if (done) ctx.restore();
        hudMono(ctx, done ? 'Pole margin over his team-mate' : 'Margin', cx, cy + size * 0.72, 11, '#f3efe4', ta * 0.8, 'center');
      },
      fx: () => ({ bloom: [0.8, 0.5, 0.8], dof: [cam.position.distanceTo(car.holder.position) + 1.5, 0.006, 0.016] }),
      post: (t, S) => { const f = easeInOut(range(t, 0.08, 0.78)); return { vig: lerp(0.6, 1.05, f), radial: lerp(0.2, 1.0, f), focus: lerp(0.6, 0.1, f), tint: [1.1, 1.0, 0.84], contrast: 1.12, ca: lerp(0.2, 1.2, f) + Math.abs((S && S.vel) || 0) * 0.6 }; },
    };
  };

  function makeWreath(goldMat) {
    const g = new THREE.Group();
    const leaf = new THREE.Shape();
    leaf.moveTo(0, 0);
    leaf.quadraticCurveTo(0.09, 0.12, 0, 0.3);
    leaf.quadraticCurveTo(-0.09, 0.12, 0, 0);
    const lg = new THREE.ExtrudeGeometry(leaf, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2, curveSegments: 6 });
    lg.translate(0, 0, -0.006);
    const N = 15;
    const inst = new THREE.InstancedMesh(lg, goldMat, N * 4);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let k = 0;
    const R = 0.78;
    for (const side of [-1, 1]) {
      for (let i = 0; i < N; i++) {
        const a = -Math.PI / 2 + 0.25 + (i / (N - 1)) * (Math.PI * 0.86);
        const x = side * Math.cos(a) * R, y = Math.sin(a) * R;
        for (const off of [-1, 1]) {
          const tang = Math.atan2(Math.cos(a), -Math.sin(a) * side) ;
          e.set(0.25 * off, 0, (side > 0 ? a + Math.PI / 2 : Math.PI / 2 - a) + off * 0.55 * side);
          q.setFromEuler(e);
          const s = 0.9 + 0.3 * (1 - i / N);
          m4.compose(new THREE.Vector3(x + side * off * 0.035 * Math.cos(a), y + off * 0.03, off * 0.03), q, new THREE.Vector3(s, s, s));
          inst.setMatrixAt(k++, m4);
          void tang;
        }
      }
    }
    inst.castShadow = true;
    g.add(inst);
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 20; i++) { const a = -Math.PI / 2 + 0.15 + (i / 20) * (Math.PI * 0.9); pts.push(new THREE.Vector3(side * Math.cos(a) * R, Math.sin(a) * R, 0)); }
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.018, 6), goldMat));
    }
    const knot = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.03, 10, 20), goldMat); knot.position.y = -R + 0.02; g.add(knot);
    return g;
  }

  B.crowns = () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03060f);
    useEnv(scene, 'studio');
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    const gold = new THREE.MeshPhysicalMaterial({ color: 0xe0ad45, metalness: 1, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.3 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x020306, roughness: 0.32, metalness: 0.3, envMapIntensity: 0.18 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1.3; floor.receiveShadow = true; scene.add(floor);
    const years = ['1988', '1990', '1991'];
    const wreaths = years.map((yr, i) => {
      const g = makeWreath(gold);
      const tex = canvasTex(512, 256, (c, w, h) => { c.font = `900 200px ${FONT_D}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#f3efe4'; c.fillText(yr, w / 2, h / 2 + 8); });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.475), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, metalness: 0.2, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }));
      p.position.z = 0.02; g.add(p);
      g.position.set((i - 1) * 2.15, 0.15, 0);
      scene.add(g);
      return g;
    });
    const sweep = new THREE.SpotLight(0xfff1d6, 120, 30, 0.45, 0.8, 1.2); sweep.castShadow = true; scene.add(sweep, sweep.target);
    const back = new THREE.DirectionalLight(0x5a7cff, 1.4); back.position.set(0, 3, -6); scene.add(back);
    const key = new THREE.DirectionalLight(0xffe6c0, 0.8); key.position.set(-4, 4, 5); scene.add(key);
    return {
      scene, cam,
      update(t, S) {
        wreaths.forEach((g, i) => {
          const k = range(t, 0.12 + i * 0.18, 0.32 + i * 0.18);
          const s = Math.max(0.001, easeBack(k));
          g.scale.setScalar(s); g.visible = k > 0;
          g.rotation.y = Math.sin(S.time * 0.4 + i * 1.7) * 0.3 + (1 - k) * 1.5;
          g.position.y = 0.15 + Math.sin(S.time * 0.8 + i) * 0.05;
        });
        const sx = Math.sin(S.time * 0.35 + t * 3) * 5;
        sweep.position.set(sx, 5, 5); sweep.target.position.set(sx * 0.3, 0, 0);
        const d = view.portrait ? 19 : 13;
        cam.position.set(Math.sin(t * 0.4 - 0.2) * 1.5, 0.9, d - t * 0.8); cam.lookAt(0, 0.1, 0);
      },
      hud(ctx, W, H, t, a) {
        const p = project(cam, new THREE.Vector3(0, -1.3, 0.8));
        hudMono(ctx, 'Decided at Suzuka', p[0], p[1] + 10, 11, '#f3efe4', a * 0.6 * range(t, 0.6, 0.75), 'center');
      },
      fx: () => ({ bloom: [0.32, 0.4, 1.4], dof: [cam.position.distanceTo(wreaths[1].position), 0.0028, 0.009], ao: true }),
      post: () => ({ vig: 0.7, tint: [1.04, 1.0, 0.93], contrast: 1.1 }),
    };
  };

  function trackScene({ id, fog, base, baseA, trailLen, wetGround = true, rain = 0, lens = 0, lamps = [] }) {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(34, 1, 0.1, 300);
    let set = null;
    if (wetGround) set = wetSet(scene, { lamps, fog, fogD: 0.01, ground: 160, rainA: rain, rainCount: rain > 0 ? 2600 : 0, tile: 1.6, reflect: 0.4 });
    if (set) set.ground.material.color.set(0x6a6a6a);
    const tr = makeTrackTube(tracks[id], 0.024, 0.09, { base, baseA });
    scene.add(tr.mesh);
    const head = sprite(glowTex, new THREE.Color(0xffdf00).multiplyScalar(3), 2.2, 1); scene.add(head);
    const hl = new THREE.PointLight(0xffd560, 14, 9, 2); scene.add(hl);
    return { scene, cam, tr, head, hl, set, trailLen, lens };
  }

  B.home = () => {
    const s = trackScene({ id: 'interlagos', fog: 0x061410, base: 0x00a651, baseA: 0.55, trailLen: 0.09, rain: 0.28 });
    return {
      scene: s.scene, cam: s.cam,
      update(t, S) {
        const f = range(t, 0.02, 0.9) * 2.2;
        s.tr.mat.uniforms.uHead.value = fract(f); s.tr.mat.uniforms.uLen.value = 0.09;
        const p = s.tr.at(f); s.head.position.copy(p).setY(0.25); s.hl.position.copy(p).setY(1.2);
        s.cam.position.set(Math.sin(t * 0.5) * 2, 20, 21); s.cam.lookAt(0, 0, 0.5);
        s.set.update(s.cam, S, range(t, 0.62, 0.85));
      },
      hud(ctx, W, H, t, a) {
        const order = { 4: 0.3, 5: 0.4, 3: 0.5, 2: 0.58, 1: 0.64 };
        const port = view.portrait;
        const gx = port ? W / 2 - 3 * 34 : W * 0.88, gy = port ? H * 0.52 : H * 0.22;
        const ga = a * range(t, 0.12, 0.25);
        hudMono(ctx, 'Gears', gx, gy - 22, 11, '#f3efe4', 0.6 * ga);
        for (let g = 1; g <= 6; g++) {
          const lost = g < 6 && t >= order[g];
          const x = port ? gx + (g - 1) * 34 : gx, y = port ? gy : gy + (g - 1) * 40;
          const on6 = g === 6 && t > 0.64;
          ctx.globalAlpha = ga * (lost ? 0.18 : 0.8);
          ctx.strokeStyle = g === 6 ? '#ffdf00' : '#f3efe4'; ctx.lineWidth = 1; ctx.strokeRect(x, y, 28, 32);
          if (on6) { ctx.fillStyle = '#ffdf00'; ctx.fillRect(x, y, 28, 32); }
          ctx.globalAlpha = 1;
          hudBig(ctx, String(g), x + 14, y + 17, 22, on6 ? '#07110d' : '#f3efe4', ga * (lost ? 0.18 : 1));
        }
      },
      fx: () => ({ bloom: [1.0, 0.6, 0.6], dof: [s.cam.position.distanceTo(s.head.position), 0.0012, 0.006] }),
      post: (t) => ({ vig: 0.6, lens: 0.5 * range(t, 0.65, 0.85), tint: [0.95, 1.05, 0.95] }),
    };
  };

  B.donington = () => {
    const s = trackScene({ id: 'donington', fog: 0x0b1418, base: 0xf3efe4, baseA: 0.2, trailLen: 0.1, rain: 0.34 });
    const dots = [];
    for (let k = 0; k < 7; k++) { const d = sprite(glowTex, new THREE.Color(0xf3efe4).multiplyScalar(1.6), 0.9, 1); s.scene.add(d); dots.push(d); }
    let pos = 5;
    return {
      scene: s.scene, cam: s.cam,
      update(t, S) {
        const lap = easeInOut(range(t, 0.06, 0.78));
        const base = lap * 0.985, gap = 0.014;
        const ours = lerp(4, -1.3, smooth(range(lap, 0.02, 0.9)));
        const fs = [];
        dots.forEach((d, k) => { const idx = k < 4 ? k : k + 1; const f = base - idx * gap; fs.push(f); d.position.copy(s.tr.at(f)).setY(0.25); });
        const uf = base - ours * gap;
        pos = 1 + fs.filter((f) => f > uf).length;
        s.tr.mat.uniforms.uHead.value = fract(uf); s.tr.mat.uniforms.uLen.value = 0.1;
        const p = s.tr.at(uf); s.head.position.copy(p).setY(0.3); s.hl.position.copy(p).setY(1.2);
        s.cam.position.set(2 + Math.sin(t) * 1.5, 19, 20); s.cam.lookAt(0, 0, 0.5);
        s.set.update(s.cam, S);
      },
      hud(ctx, W, H, t, a) {
        const la = a * range(t, 0.06, 0.14);
        const x = view.portrait ? 20 : W * 0.42, y = view.portrait ? 90 : H * 0.18;
        hudBig(ctx, 'P' + pos, x, y, view.portrait ? 54 : 72, pos === 1 ? '#ffdf00' : '#f3efe4', la, 'left');
        hudMono(ctx, 'Lap 1', x + 4, y + (view.portrait ? 36 : 46), 11, '#f3efe4', la * 0.7);
      },
      fx: () => ({ bloom: [1.0, 0.6, 0.6], dof: [s.cam.position.distanceTo(s.head.position), 0.0012, 0.006] }),
      post: () => ({ vig: 0.6, lens: 0.75, tint: [0.88, 1.0, 1.05], contrast: 1.06 }),
    };
  };

  B.imola = () => {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(34, 1, 0.1, 300);
    scene.background = new THREE.Color(0x030605);
    scene.fog = new THREE.FogExp2(0x050908, 0.02);
    useEnv(scene, 'night');
    const T = dry();
    [T.color, T.normal, T.rough].forEach((x) => x.repeat.set(40, 40));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ color: 0x3a3d3c, map: T.color, normalMap: T.normal, roughness: 0.75, envMapIntensity: 0.4 }));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    scene.add(new THREE.HemisphereLight(0x8899aa, 0x050505, 0.25));
    const tr = makeTrackTube(tracks.imola, 0.024, 0.08, { base: 0xf3efe4, baseA: 0.22 });
    scene.add(tr.mesh);
    const head = sprite(glowTex, new THREE.Color(1, 0.95, 0.75).multiplyScalar(3), 2.0, 1); scene.add(head);
    const hl = new THREE.PointLight(0xffe2a0, 12, 9, 2); scene.add(hl);
    // motes of light in the air (the race was run in the dry)
    const mN = Math.round(500 * Q);
    const mp = new Float32Array(mN * 3), ms = new Float32Array(mN);
    for (let i = 0; i < mN; i++) { mp.set([(hash(i) - 0.5) * 30, hash(i + 0.4) * 8, (hash(i + 0.8) - 0.5) * 24], i * 3); ms[i] = hash(i + 0.2); }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3)); mg.setAttribute('s', new THREE.BufferAttribute(ms, 1));
    const motes = new THREE.Points(mg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPx: { value: 500 } },
      vertexShader: 'attribute float s; uniform float uTime, uPx; varying float vA; void main(){ vec3 p = position; p.y = mod(p.y + uTime * (0.05 + 0.1 * s), 8.0); p.x += sin(uTime * 0.2 + s * 30.0) * 0.4; vec4 mv = modelViewMatrix * vec4(p,1.0); gl_PointSize = (1.0 + 2.5 * s) * uPx * 0.02 / max(1.0, -mv.z) * 10.0; vA = 0.2 + 0.5 * s; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(vec3(1.0,0.95,0.85) * a * vA, a * vA); }',
    }));
    motes.frustumCulled = false; scene.add(motes);
    const fT = tracks.imola.corners.Tamburello != null ? tracks.imola.corners.Tamburello : 0.12;
    const fStop = fT - 0.035;
    let headF = -0.42;
    return {
      scene, cam,
      update(t, S) {
        const run = range(Math.min(t, finale.freeze), finale.carStart, finale.freeze);
        headF = lerp(-0.42, fStop, run);
        const on = t >= finale.carStart;
        tr.mat.uniforms.uHead.value = fract(headF); tr.mat.uniforms.uLen.value = on ? 0.12 : 0;
        head.visible = on; hl.intensity = on ? 12 : 0;
        const p = tr.at(headF); head.position.copy(p).setY(0.3); hl.position.copy(p).setY(1.1);
        motes.material.uniforms.uTime.value = S.time; motes.material.uniforms.uPx.value = view.H * 0.5;
        cam.position.set(Math.sin(S.time * 0.03) * 1.2, 20, 21); cam.lookAt(0, 0, 0.6);
      },
      hud(ctx, W, H, t, a) {
        const la = a * range(t, 0.05, 0.12) * (1 - range(t, finale.freeze, finale.drainEnd));
        hudMono(ctx, headF < 0 ? 'Lap 6' : 'Lap 7', view.portrait ? 20 : W * 0.42, view.portrait ? 70 : H * 0.14, 12, '#f3efe4', la * 0.7);
      },
      fx: () => ({ bloom: [0.7, 0.6, 0.6], dof: [cam.position.distanceTo(head.position), 0.0012, 0.006] }),
      post: (t) => ({
        vig: 0.7, grain: 0.03, ca: 0,
        sat: 1 - smooth(range(t, finale.freeze, finale.drainEnd)),
        black: Math.min(1, 0.2 * smooth(range(t, finale.freeze, finale.drainEnd)) + smooth(range(t, finale.black0, finale.black1))),
      }),
    };
  };

  /* ───── runtime ───── */

  const built = new Map();
  const get = (key) => {
    if (!built.has(key)) {
      const s = B[key]();
      frameCam(s.cam);
      built.set(key, s);
    }
    return built.get(key);
  };
  const prefetch = (key) => {
    if (!key || built.has(key)) return;
    const run = () => { try { get(key); } catch (e) { /* ignore */ } };
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 600 }); else setTimeout(run, 60);
  };

  function resize(W, H, dpr) {
    view.W = W; view.H = H; view.dpr = Math.min(dpr, 1.75); view.portrait = W <= 820 || H > W;
    renderer.setPixelRatio(view.dpr);
    renderer.setSize(W, H, false);
    const pw = Math.round(W * view.dpr), ph = Math.round(H * view.dpr);
    pipes.forEach((pp) => { pp.composer.setPixelRatio(view.dpr); pp.composer.setSize(W, H); });
    sizeReflectors();
    built.forEach((s) => frameCam(s.cam));
    const u = comp.mat.uniforms;
    u.uAspect.value = W / H; u.uRes.value.set(pw, ph);
    const sh = shift();
    u.uCenter.value.set(0.5 - sh.x, 0.5 + sh.y);
  }

  const mixPost = (a, b, m) => {
    const o = {};
    for (const k of Object.keys(POST_DEFAULT)) o[k] = Array.isArray(a[k]) ? a[k].map((v, i) => lerp(v, b[k][i], m)) : lerp(a[k], b[k], m);
    return o;
  };
  const full = (p) => ({ ...POST_DEFAULT, ...(p || {}) });

  function runPipe(pp, sc, t, S, dt) {
    (sc.scene.userData.reflectors || []).forEach((f) => f(sc.cam));
    const fx = (sc.fx && sc.fx(t, S)) || {};
    pp.renderPass.scene = sc.scene; pp.renderPass.camera = sc.cam;
    if (pp.ao) {
      const on = tier >= 2 && !!fx.ao;
      pp.ao.enabled = on;
      if (on) { pp.ao.scene = sc.scene; pp.ao.camera = sc.cam; }
    }
    const dofOn = tier >= 1 && !!fx.dof;
    pp.bokeh.enabled = dofOn;
    if (dofOn) {
      pp.bokeh.scene = sc.scene; pp.bokeh.camera = sc.cam;
      const u = pp.bokeh.uniforms;
      u.focus.value = fx.dof[0]; u.aperture.value = fx.dof[1]; u.maxblur.value = fx.dof[2]; u.aspect.value = sc.cam.aspect;
    }
    const b = fx.bloom || [0.3, 0.5, 0.9];
    pp.bloom.strength = b[0] * (tier === 0 ? 0.8 : 1); pp.bloom.radius = b[1]; pp.bloom.threshold = b[2];
    pp.composer.render(dt || 0.016);
    return pp.composer.readBuffer.texture;
  }

  function render({ key, t, nextKey, m, tr, trColor, S, dt, hud }) {
    if (forcedTier == null && dt > 0) {
      if (dt > 0.022) slowFrames++; else slowFrames = Math.max(0, slowFrames - 2);
      if (slowFrames > 90 && tier > 0) { tier--; slowFrames = 0; sizeReflectors(); }
    }
    const A = get(key);
    A.update(t, S, dt);
    const u = comp.mat.uniforms;
    u.tA.value = runPipe(pipes[0], A, t, S, dt);
    let post = full(A.post && A.post(t, S));
    u.uMix.value = 0;
    if (m > 0 && nextKey) {
      const Bs = get(nextKey);
      Bs.update(0, S, dt);
      u.tB.value = runPipe(pipes[1], Bs, 0, S, dt);
      u.uMix.value = m;
      u.uType.value = { fade: 0, wipe: 1, zoom: 2, iris: 3 }[tr] || 0;
      const c = trColor || [7, 17, 13];
      u.uFade.value.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
      post = mixPost(post, full(Bs.post && Bs.post(0, S)), smooth(m));
    } else if (nextKey) prefetch(nextKey);
    u.uTime.value = S.time;
    u.uVig.value = post.vig; u.uFocus.value = post.focus; u.uRadial.value = post.radial; u.uSat.value = post.sat;
    u.uBlack.value = post.black; u.uLens.value = post.lens; u.uChequer.value = post.chequer; u.uGrain.value = post.grain;
    u.uCA.value = post.ca; u.uContrast.value = post.contrast; u.uTint.value.fromArray(post.tint); u.uLift.value.fromArray(post.lift);
    renderer.setRenderTarget(null);
    renderer.render(comp.scene, comp.cam);
    if (hud) {
      hud.clearRect(0, 0, view.W, view.H);
      if (A.hud) A.hud(hud, view.W, view.H, t, m > 0 ? 1 - smooth(m) : 1);
    }
  }

  function dispose() {
    built.forEach((s) => s.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach((mm) => { Object.values(mm).forEach((v) => { if (v && v.isTexture) v.dispose(); }); mm.dispose(); });
    }));
    built.clear();
    [wetTex, dryTex].forEach((T) => T && Object.values(T).forEach((x) => x.dispose()));
    [glowTex, streakTex, envStudio, envNight].forEach((x) => x && x.dispose());
    pipes.forEach((pp) => { pp.composer.passes.forEach((ps) => ps.dispose && ps.dispose()); pp.composer.dispose(); });
    reflectors.forEach((r) => r.dispose && r.dispose());
    Object.values(envLoaded).forEach((x) => x && x.dispose());
    pmrem.dispose();
    comp.mat.dispose();
    renderer.dispose();
  }

  return { render, resize, dispose, prefetch: (k) => prefetch(k), get tier() { return tier; } };
}
