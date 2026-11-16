// Procedural WebGL backgrounds (rain / speed / flow). Dependency-free ES module.
// Original abstract shaders: no textures, no external assets.

const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const HEADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform float u_time;
uniform vec2 u_res;
uniform float u_intensity;
uniform float u_velocity;
uniform float u_progress;
uniform vec2 u_pointer;

const vec3 YEL = vec3(1.0, 0.875, 0.0);
const vec3 GRN = vec3(0.0, 0.651, 0.318);
const vec3 BLU = vec3(0.106, 0.310, 0.847);
const vec3 NAV = vec3(0.043, 0.122, 0.294);
const vec3 WHT = vec3(0.953, 0.937, 0.894);
const vec3 BGC = vec3(0.027, 0.067, 0.051);

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash11(float n) {
  return hash21(vec2(n, n * 0.37 + 1.7));
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float dither() {
  return (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
}
`;

const FRAG_RAIN = HEADER + `
vec3 lightColor(float h, float prog) {
  float tb = mix(0.62, 0.14, prog);
  float tg = tb + 0.22;
  vec3 c = YEL;
  if (h < tg) c = GRN;
  if (h < tb) c = BLU;
  return c;
}

vec3 bokeh(vec2 p, float aspect, float t, float prog) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float h1 = hash11(fi * 1.31 + 0.5);
    float h2 = hash11(fi * 2.17 + 3.1);
    float h3 = hash11(fi * 3.73 + 7.7);
    float h4 = hash11(fi * 5.11 + 11.3);
    vec2 c = vec2((h1 - 0.5) * aspect * 1.1, mix(-0.28, 0.38, h2));
    c += vec2(sin(t * (0.05 + 0.06 * h3) + h4 * 6.283),
              cos(t * (0.04 + 0.05 * h4) + h3 * 6.283)) * vec2(0.09, 0.04);
    float r = mix(0.05, 0.16, h3);
    float d = length(p - c);
    float disc = (1.0 - smoothstep(r * 0.72, r, d));
    float rim = smoothstep(r * 0.55, r * 0.95, d) * disc;
    float a = disc * (0.55 + 0.45 * rim) * mix(0.10, 0.26, h4);
    a *= 0.75 + 0.25 * sin(t * (0.3 + h1) + h2 * 6.283);
    acc += lightColor(hash11(fi * 7.9 + 2.3), prog) * a;
  }
  return acc;
}

float rainLayer(vec2 p, float t, float scale, float slant, float density, float seed) {
  float qx = (p.x + p.y * slant) * scale * 28.0 + seed * 17.0;
  float col = floor(qx);
  float fx = fract(qx) - 0.5;
  float hc = hash21(vec2(col, seed));
  float y = p.y * scale * 2.2 + t * (3.0 + 2.0 * hc) + hc * 31.0;
  float row = floor(y);
  float fy = fract(y);
  float hr = hash21(vec2(col + seed * 13.0, row));
  float on = step(1.0 - density, hr);
  float len = mix(0.25, 0.6, hash21(vec2(row, col + seed)));
  float tail = smoothstep(0.0, 0.04, fy) * (1.0 - smoothstep(0.0, len, fy));
  float w = mix(0.05, 0.11, hr);
  float xj = (hash21(vec2(col, row + seed * 5.0)) - 0.5) * 0.6;
  float line = 1.0 - smoothstep(0.0, w, abs(fx - xj));
  return on * tail * line;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = u_time;
  float inten = clamp(u_intensity, 0.0, 1.0);
  float prog = clamp(u_progress, 0.0, 1.0);
  float av = min(abs(u_velocity), 1.5);
  vec2 par = u_pointer - 0.5;

  // wet-glass refraction of the lights
  vec2 g = vec2(vnoise(p * 5.0 + vec2(0.0, t * 0.25)),
                vnoise(p * 5.0 + vec2(7.3, t * 0.21 + 3.1))) - 0.5;
  vec2 g2 = vec2(vnoise(p * vec2(22.0, 9.0) + vec2(1.7, t * 0.9)),
                 vnoise(p * vec2(22.0, 9.0) + vec2(9.2, t * 0.8))) - 0.5;
  vec2 pd = p + g * (0.035 + 0.03 * inten) + g2 * 0.008 * inten + par * 0.03;

  vec3 col = mix(BGC, NAV * 0.5, 0.35 * uv.y);
  vec3 lights = bokeh(pd, aspect, t, prog) * 0.8;
  col += lights;

  float slant = (0.14 + 0.5 * av) * (u_velocity < 0.0 ? -1.0 : 1.0);
  float rain = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float sc = 1.0 + fi * 0.75;
    float dens = mix(0.03, 0.75, inten) * (1.0 - 0.1 * fi);
    rain += rainLayer(p + par * 0.02 / sc, t, sc, slant, dens, fi + 1.0) / (1.0 + fi * 0.6);
  }
  col += rain * (0.05 + 0.20 * inten) * (WHT * 0.6 + lights * 1.5);

  // mist near the bottom
  float m = 1.0 - smoothstep(0.0, 0.5, uv.y);
  float mn = 0.7 + 0.6 * vnoise(vec2(p.x * 2.0 - t * 0.05, uv.y * 3.0 + t * 0.03));
  col = mix(col, mix(NAV, WHT, 0.18), m * m * (0.18 + 0.14 * inten) * mn);

  vec2 vq = uv - 0.5;
  col *= 1.0 - 0.9 * dot(vq, vq);
  col += dither();
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

const FRAG_SPEED = HEADER + `
vec3 streaks(vec2 p, float dy, float t, float av, float seed) {
  float ady = abs(dy);
  float d = 1.0 / (ady + 0.14);
  float rc = d * (5.0 + 2.0 * seed) + seed * 3.7;
  float row = floor(rc) + step(0.0, dy) * 57.0;
  float fr = fract(rc);
  float h0 = hash21(vec2(row, seed * 9.1));
  float u = p.x * d * 0.35 + t * (0.5 + 1.2 * h0) + h0 * 40.0;
  float cu = floor(u);
  float fu = fract(u);
  float h1 = hash21(vec2(cu, row + seed * 3.3));
  float h2 = hash21(vec2(row + 11.0, cu + seed));
  float on = step(0.45, h1);
  float len = min(mix(0.08, 0.45, h2) * (1.0 + 1.2 * av), 0.95);
  float body = smoothstep(0.0, 0.015, fu) * (1.0 - smoothstep(0.0, len, fu));
  float w = mix(0.5, mix(0.03, 0.10, h2), smoothstep(0.0, 0.2, ady));
  float line = 1.0 - smoothstep(w * 0.3, w, abs(fr - 0.5));
  float a = on * body * line * mix(0.25, 1.0, h1);
  float hc = hash21(vec2(cu + 5.0, row + seed * 7.0));
  vec3 c = WHT;
  if (hc > 0.55) c = YEL;
  if (hc > 0.84) c = GRN;
  if (hc > 0.92) c = BLU;
  return c * a;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = u_time;
  float inten = clamp(u_intensity, 0.0, 1.0);
  float av = min(abs(u_velocity), 1.5);
  float dy = uv.y - 0.45;
  float ady = abs(dy);
  vec2 split = vec2(clamp(u_velocity, -1.5, 1.5) * 0.012, 0.0);

  vec3 acc = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float s = float(i) + 1.0;
    vec3 c0 = streaks(p, dy, t, av, s);
    vec3 cr = streaks(p + split, dy, t, av, s);
    vec3 cb = streaks(p - split, dy, t, av, s);
    acc += vec3(cr.r, c0.g, cb.b) / (0.6 + 0.4 * s);
  }
  float fade = 0.15 + 0.85 * smoothstep(0.0, 0.10, ady);
  float glow = exp(-ady * 9.0);

  vec3 col = BGC;
  col += (acc * fade * 0.8 + NAV * 0.30 * glow + YEL * 0.03 * glow * glow) * inten;

  vec2 vq = uv - 0.5;
  col *= 1.0 - 0.6 * dot(vq, vq);
  col += dither();
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

const FRAG_FLOW = HEADER + `
const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);

float fbm3(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p = ROT * p * 2.03 + vec2(17.1, 9.3);
    a *= 0.5;
  }
  return s * 1.143;
}

float fbm4(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = ROT * p * 2.03 + vec2(17.1, 9.3);
    a *= 0.5;
  }
  return s * 1.067;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 asp = vec2(aspect, 1.0);
  vec2 p = (uv - 0.5) * asp;
  float inten = clamp(u_intensity, 0.0, 1.0);
  float prog = clamp(u_progress, 0.0, 1.0);
  float v = clamp(u_velocity, -1.5, 1.5);
  float av = abs(v);

  // pointer bulge
  vec2 dp = p - (u_pointer - 0.5) * asp;
  float bulge = exp(-dot(dp, dp) * 7.0);
  p -= dp * bulge * 0.3;
  p *= 1.7;

  float t = u_time * 0.06;
  p.y += v * 0.12 * sin(p.x * 1.8 + u_time * 0.7);

  vec2 q = vec2(fbm3(p + vec2(0.0, t)), fbm3(p + vec2(5.2, 1.3 - t)));
  float wa = 1.8 + 1.4 * av;
  vec2 r = vec2(fbm3(p + wa * q + vec2(1.7 + t * 0.7, 9.2)),
                fbm3(p + wa * q + vec2(8.3, 2.8 - t * 0.6)));
  float f = fbm4(p + wa * r + vec2(v * 0.2, 0.0));

  float x = f + (prog - 0.5) * 0.22 + bulge * 0.08 + (0.5 - uv.y) * 0.18;
  float sheen = 0.5 + 0.5 * sin(x * 42.0 + r.x * 6.0);

  vec3 col = BGC;
  col = mix(col, NAV, smoothstep(0.30, 0.44, x));
  col = mix(col, GRN * 0.75, smoothstep(0.47, 0.56, x));
  col = mix(col, YEL * 0.9, smoothstep(0.60, 0.70, x));
  col *= 0.88 + 0.12 * sheen;
  col *= 0.7 + 0.5 * q.x;
  col *= mix(1.0, 0.28, smoothstep(0.3, 0.85, uv.y));
  col = mix(BGC, col, inten);

  col += dither();
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

const KINDS = {
  // timeScale: extra time speed per unit |velocity| (integrated in JS so speed changes never jump)
  rain: { frag: FRAG_RAIN, intensity: 0.6, timeScale: 0.5, staticTime: 12.0 },
  speed: { frag: FRAG_SPEED, intensity: 0.35, timeScale: 3.0, staticTime: 7.5 },
  flow: { frag: FRAG_FLOW, intensity: 1.0, timeScale: 1.5, staticTime: 20.0 },
};

const noop = () => {};
const FAILED = Object.freeze({
  set: noop, setPointer: noop, resize: noop, start: noop, stop: noop,
  renderOnce: noop, dispose: noop, failed: true,
});

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  if (!sh) return { error: 'createShader returned null' };
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const error = gl.getShaderInfoLog(sh) || 'unknown compile error';
    gl.deleteShader(sh);
    return { error };
  }
  return { shader: sh };
}

function build(gl, fragSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  if (vs.error) return { error: 'vertex: ' + vs.error };
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (fs.error) { gl.deleteShader(vs.shader); return { error: 'fragment: ' + fs.error }; }
  const program = gl.createProgram();
  gl.attachShader(program, vs.shader);
  gl.attachShader(program, fs.shader);
  gl.bindAttribLocation(program, 0, 'a_pos');
  gl.linkProgram(program);
  gl.deleteShader(vs.shader);
  gl.deleteShader(fs.shader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const error = 'link: ' + (gl.getProgramInfoLog(program) || 'unknown link error');
    gl.deleteProgram(program);
    return { error };
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(program);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  const u = {};
  for (const n of ['time', 'res', 'intensity', 'velocity', 'progress', 'pointer']) {
    u[n] = gl.getUniformLocation(program, 'u_' + n);
  }
  return { program, buffer, u };
}

export function createShaderCanvas(canvas, kind, {
  reducedMotion = false,
  dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 1.5),
} = {}) {
  const def = KINDS[kind];
  if (!canvas || !def || typeof canvas.getContext !== 'function') {
    console.warn('[shaders] cannot create shader canvas for kind "' + kind + '"');
    return FAILED;
  }

  let gl = null;
  try {
    const opts = {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power',
    };
    gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
  } catch (e) {
    gl = null;
  }
  if (!gl) return FAILED;

  let res = build(gl, def.frag);
  if (res.error) {
    console.warn('[shaders] "' + kind + '" shader failed: ' + res.error);
    return FAILED;
  }

  const target = { intensity: def.intensity, velocity: 0, progress: 0, px: 0.5, py: 0.5 };
  const cur = { ...target };
  let time = 0;
  let last = 0;
  let raf = 0;
  let running = false;   // start() requested
  let visible = true;    // IntersectionObserver
  let lost = false;
  let disposed = false;
  let sizeDirty = true;
  let staticQueued = false;

  const api = {
    set, setPointer, resize, start, stop, renderOnce, dispose, failed: false,
  };

  function fail(msg) {
    if (msg) console.warn(msg);
    api.failed = true;
    cancel();
    running = false;
  }

  function dead() {
    return disposed || api.failed;
  }

  function applySize() {
    sizeDirty = false;
    const w = Math.max(1, Math.round((canvas.clientWidth || canvas.width || 1) * dpr));
    const h = Math.max(1, Math.round((canvas.clientHeight || canvas.height || 1) * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function ease(dt) {
    const k = 1 - Math.exp(-dt * 6);
    const kp = 1 - Math.exp(-dt * 4);
    cur.intensity += (target.intensity - cur.intensity) * k;
    cur.velocity += (target.velocity - cur.velocity) * k;
    cur.progress += (target.progress - cur.progress) * k;
    cur.px += (target.px - cur.px) * kp;
    cur.py += (target.py - cur.py) * kp;
  }

  function draw(t) {
    if (dead() || lost || !res) return;
    if (sizeDirty) applySize();
    const u = res.u;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1f(u.time, t);
    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform1f(u.intensity, cur.intensity);
    gl.uniform1f(u.velocity, cur.velocity);
    gl.uniform1f(u.progress, cur.progress);
    gl.uniform2f(u.pointer, cur.px, 1 - cur.py);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now) {
    raf = 0;
    if (!shouldLoop()) return;
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60;
    last = now;
    ease(dt);
    time += dt * (1 + def.timeScale * Math.min(Math.abs(cur.velocity), 1.5));
    draw(time);
    raf = requestAnimationFrame(frame);
  }

  function shouldLoop() {
    return running && visible && !lost && !reducedMotion && !dead() && !document.hidden;
  }

  function cancel() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function sync() {
    if (shouldLoop()) {
      if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
    } else {
      cancel();
    }
  }

  // one coalesced static frame (used when not looping: reduced motion, resize while stopped)
  function queueStatic() {
    if (staticQueued || dead() || raf) return;
    staticQueued = true;
    requestAnimationFrame(() => {
      staticQueued = false;
      if (!raf) renderOnce();
    });
  }

  function set(name, value) {
    if (dead()) return;
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    if (name !== 'intensity' && name !== 'velocity' && name !== 'progress') return;
    target[name] = v;
    if (reducedMotion) queueStatic();
  }

  function setPointer(x, y) {
    if (dead()) return;
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    target.px = Math.min(1, Math.max(0, nx));
    target.py = Math.min(1, Math.max(0, ny));
    // pointer does not re-render under reduced motion: it would read as animation
  }

  function resize() {
    if (dead()) return;
    sizeDirty = true;
    if (!raf) queueStatic();
  }

  function start() {
    if (dead()) return;
    if (reducedMotion) { renderOnce(); return; }
    running = true;
    sync();
  }

  function stop() {
    running = false;
    cancel();
  }

  function renderOnce() {
    if (dead() || lost) return;
    if (reducedMotion) {
      // snap params: a static frame should show the requested state, at a fixed time
      Object.assign(cur, target);
      draw(def.staticTime);
    } else {
      if (time === 0) { Object.assign(cur, target); time = def.staticTime; }
      draw(time);
    }
  }

  function onLost(e) {
    e.preventDefault();
    lost = true;
    res = null;
    cancel();
  }

  function onRestored() {
    if (disposed) return;
    try {
      res = build(gl, def.frag);
    } catch (err) {
      res = { error: String(err) };
    }
    if (res.error) {
      const msg = '[shaders] "' + kind + '" restore failed: ' + res.error;
      res = null;
      fail(msg);
      return;
    }
    lost = false;
    sizeDirty = true;
    if (running && !reducedMotion) sync(); else renderOnce();
  }

  function onVisibility() {
    sync();
  }

  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);
  document.addEventListener('visibilitychange', onVisibility, false);

  let io = null;
  if (typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver((entries) => {
      const was = visible;
      visible = entries[entries.length - 1].isIntersecting;
      if (visible && !was && !running) queueStatic();
      sync();
    }, { threshold: 0 });
    io.observe(canvas);
  }

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
  }

  function dispose() {
    if (disposed) return;
    stop();
    disposed = true;
    canvas.removeEventListener('webglcontextlost', onLost, false);
    canvas.removeEventListener('webglcontextrestored', onRestored, false);
    document.removeEventListener('visibilitychange', onVisibility, false);
    if (io) io.disconnect();
    if (ro) ro.disconnect();
    if (res && !lost) {
      try {
        gl.deleteProgram(res.program);
        gl.deleteBuffer(res.buffer);
      } catch (e) { /* context already gone */ }
    }
    res = null;
  }

  return api;
}
