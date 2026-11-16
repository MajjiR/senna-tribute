/*
 * depth-photo.js — 2.5D "depth photo" parallax for photo slots.
 * Original code for an unofficial fan-tribute site. Raw WebGL1, no dependencies.
 *
 * The effect only re-projects the existing image (parallax tilt, glare, grain,
 * ripple). It never generates or alters image content.
 *
 *   attachDepth(figure, { reducedMotion, strength })
 *     -> { setVelocity(v), refresh(), setActive(bool), destroy(), failed }
 */

const MAX_TEX = 1600;   // long-side cap for the colour texture
const DEPTH_RES = 128;  // long side of the derived depth map
const MAX_DPR = 2;
const OFFSET_MAX = 0.018;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform sampler2D uImg;
uniform sampler2D uDepth;
uniform float uImgAspect;
uniform float uCanvasAspect;
uniform vec2 uPointer;   // -1..1, y up
uniform float uHover;    // 0..1
uniform float uVel;      // -1..1
uniform float uTime;
uniform float uStrength;
uniform float uGrain;    // grain amount (0 disables)
uniform vec2 uRes;

vec2 cover(vec2 uv) {
  float r = uCanvasAspect / uImgAspect;
  vec2 s = r > 1.0 ? vec2(1.0, 1.0 / r) : vec2(r, 1.0);
  return (uv - 0.5) * s + 0.5;
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = cover(vUv);
  // small safety margin so offsets never sample past the edge
  uv = 0.5 + (uv - 0.5) * 0.97;

  float d0 = texture2D(uDepth, uv).r;
  vec2 off = (d0 - 0.5) * uPointer * ${OFFSET_MAX.toFixed(4)} * uStrength;
  // one refinement step: re-read depth at the displaced point
  float d = texture2D(uDepth, uv + off).r;
  off = (d - 0.5) * uPointer * ${OFFSET_MAX.toFixed(4)} * uStrength;

  // near layer scales up a touch on hover
  uv = 0.5 + (uv - 0.5) * (1.0 - uHover * 0.014 * d);

  // scroll-velocity liquid ripple
  float av = abs(uVel);
  off.x += sin(uv.y * 24.0 + uTime * 3.2 + d * 3.0) * 0.006 * uVel * (0.35 + d);
  off.y += sin(uv.x * 17.0 - uTime * 2.1) * 0.0015 * av;

  vec2 p = clamp(uv + off, 0.001, 0.999);
  vec2 ca = vec2(av * 0.0045, 0.0);
  vec3 col;
  col.r = texture2D(uImg, clamp(p + ca, 0.001, 0.999)).r;
  col.g = texture2D(uImg, p).g;
  col.b = texture2D(uImg, clamp(p - ca, 0.001, 0.999)).b;

  // soft glare band following the pointer, cream-tinted
  vec2 lp = uPointer * 0.5 + 0.5;
  float dist = dot(vUv - lp, vec2(0.7071, 0.7071));
  float band = exp(-dist * dist * 22.0) * (0.035 + 0.045 * uHover) * (0.55 + 0.45 * d);
  col += vec3(1.0, 0.95, 0.86) * band;

  // gentle vignette
  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * 0.5;

  // fine film grain
  float g = hash(floor(vUv * uRes) + fract(uTime * 7.13) * 91.7) - 0.5;
  col += g * uGrain;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

function noop() {}
function failedHandle() {
  return { setVelocity: noop, refresh: noop, setActive: noop, destroy: noop, failed: true };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('image load failed: ' + src));
    im.src = src;
  });
}

function isSvgSrc(src) {
  return /^data:image\/svg/i.test(src) || /\.svg(?:[?#]|$)/i.test(src);
}

/* Derive a depth map on the CPU (white = near). Returns a canvas. */
function deriveDepth(source, sw, sh) {
  const s = DEPTH_RES / Math.max(sw, sh);
  const w = Math.max(8, Math.round(sw * s));
  const h = Math.max(8, Math.round(sh * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h);
  const data = px.data;
  const n = w * h;
  const lum = new Float32Array(n);
  let d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  // foreground prior: radial falloff towards bottom-centre (y down in canvas space)
  for (let y = 0; y < h; y++) {
    const fy = y / (h - 1);
    for (let x = 0; x < w; x++) {
      const fx = x / (w - 1);
      const dx = (fx - 0.5) / 0.6;
      const dy = (fy - 0.72) / 0.8;
      const radial = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
      const prior = 0.8 * radial * radial * (3 - 2 * radial) + 0.2 * fy;
      const i = y * w + x;
      d[i] = 0.45 * lum[i] + 0.55 * prior;
    }
  }
  // edge-preserving blur: a-trous box passes weighted by luminance difference
  const sigma2 = 2 * 0.08 * 0.08;
  let tmp = new Float32Array(n);
  for (const step of [1, 2, 4, 2]) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const l0 = lum[i];
        let acc = 0, wsum = 0;
        for (let oy = -1; oy <= 1; oy++) {
          const yy = Math.min(h - 1, Math.max(0, y + oy * step));
          for (let ox = -1; ox <= 1; ox++) {
            const xx = Math.min(w - 1, Math.max(0, x + ox * step));
            const j = yy * w + xx;
            const dl = lum[j] - l0;
            const wt = Math.exp(-(dl * dl) / sigma2);
            acc += d[j] * wt; wsum += wt;
          }
        }
        tmp[i] = acc / wsum;
      }
    }
    const t = d; d = tmp; tmp = t;
  }
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n; i++) { if (d[i] < mn) mn = d[i]; if (d[i] > mx) mx = d[i]; }
  const range = mx - mn > 1e-5 ? mx - mn : 1;
  for (let i = 0; i < n; i++) {
    const v = Math.round(((d[i] - mn) / range) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  ctx.putImageData(px, 0, 0);
  return c;
}

export function attachDepth(figure, { reducedMotion = false, strength = 1 } = {}) {
  const media = figure && figure.querySelector('.slot__media');
  const img = media && media.querySelector('img');
  if (!media || !img || typeof window === 'undefined') return failedHandle();

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'slot__depth';
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block',
    zIndex: '1', pointerEvents: 'none', opacity: '0', transformOrigin: '50% 50%',
  });

  let gl = null;
  try {
    const attrs = { alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
    gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
  } catch (e) { gl = null; }
  if (!gl) return failedHandle();

  media.appendChild(canvas);

  // ---------- state ----------
  let failed = false, destroyed = false, active = true, visible = false, lost = false;
  let ready = false, drawnOnce = false, raf = 0, lastT = 0, loadToken = 0;
  let prog = null, buf = null, texImg = null, texDepth = null, loc = {};
  let colorCanvas = null, depthCanvas = null, imgAspect = 1, svgRaster = null;
  let cssW = 1, cssH = 1, dpr = 1;
  const hoverCapable = window.matchMedia && window.matchMedia('(hover: hover)').matches;
  const sway = !reducedMotion && !hoverCapable;
  const ptr = { tx: 0, ty: 0, x: 0, y: 0, th: 0, h: 0 };
  let velTarget = 0, vel = 0, time = 0;
  const prevMediaTransform = media.style.transform;
  const prevImgVisibility = img.style.visibility;

  // ---------- GL ----------
  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('depth-photo shader: ' + log);
    }
    return sh;
  }
  function makeTex() {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function upload(tex, source) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }
  function initGL() {
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error('depth-photo link: ' + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    loc = {};
    for (const u of ['uImg', 'uDepth', 'uImgAspect', 'uCanvasAspect', 'uPointer', 'uHover',
      'uVel', 'uTime', 'uStrength', 'uGrain', 'uRes']) loc[u] = gl.getUniformLocation(prog, u);
    gl.uniform1i(loc.uImg, 0);
    gl.uniform1i(loc.uDepth, 1);
    texImg = makeTex();
    texDepth = makeTex();
  }

  // ---------- texture building ----------
  function bgColor() {
    const c = getComputedStyle(media).backgroundColor;
    return c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)' ? c : '#0b1f4b';
  }
  function rasterise(im, svg) {
    let w, h;
    if (svg) {
      // draw at the slot's pixel size (incl. the 1.12 overscan); preserveAspectRatio handles cover
      w = Math.max(2, Math.round(cssW * dpr * 1.12));
      h = Math.max(2, Math.round(cssH * dpr * 1.12));
    } else {
      w = im.naturalWidth || cssW; h = im.naturalHeight || cssH;
    }
    const s = Math.min(1, MAX_TEX / Math.max(w, h));
    w = Math.max(2, Math.round(w * s)); h = Math.max(2, Math.round(h * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bgColor();
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(im, 0, 0, w, h);
    return c;
  }

  async function build() {
    const token = ++loadToken;
    const src = img.currentSrc || img.src;
    if (!src) throw new Error('no image source');
    measure();
    const im = await loadImage(src);
    if (token !== loadToken || destroyed) return;
    const svg = isSvgSrc(src);
    const color = rasterise(im, svg);
    let depth;
    const depthUrl = figure.getAttribute('data-depth');
    if (depthUrl) {
      const dim = await loadImage(depthUrl);
      if (token !== loadToken || destroyed) return;
      const dc = document.createElement('canvas');
      const s = Math.min(1, 512 / Math.max(dim.naturalWidth || 1, dim.naturalHeight || 1));
      dc.width = Math.max(2, Math.round((dim.naturalWidth || 256) * s));
      dc.height = Math.max(2, Math.round((dim.naturalHeight || 256) * s));
      dc.getContext('2d').drawImage(dim, 0, 0, dc.width, dc.height);
      depth = dc;
    } else {
      depth = deriveDepth(color, color.width, color.height);
    }
    colorCanvas = color; depthCanvas = depth;
    imgAspect = color.width / color.height;
    svgRaster = svg ? { im, w: cssW, h: cssH } : null;
    if (!lost) uploadAll();
    ready = true;
    renderOnce();
  }
  function uploadAll() {
    upload(texImg, colorCanvas);
    upload(texDepth, depthCanvas);
  }

  // ---------- sizing ----------
  function measure() {
    const r = media.getBoundingClientRect();
    cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
    dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  let svgTimer = 0;
  function onResize() {
    measure();
    if (svgRaster && (Math.abs(cssW / cssH - svgRaster.w / svgRaster.h) > 0.01 || cssW > svgRaster.w * 1.25)) {
      clearTimeout(svgTimer);
      svgTimer = setTimeout(() => {
        if (destroyed || !svgRaster) return;
        colorCanvas = rasterise(svgRaster.im, true);
        imgAspect = colorCanvas.width / colorCanvas.height;
        svgRaster.w = cssW; svgRaster.h = cssH;
        if (!lost) upload(texImg, colorCanvas);
        renderOnce();
      }, 150);
    }
    renderOnce();
  }

  // ---------- drawing ----------
  function draw() {
    if (!ready || lost || destroyed) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texImg);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texDepth);
    gl.uniform1f(loc.uImgAspect, imgAspect);
    gl.uniform1f(loc.uCanvasAspect, canvas.width / canvas.height);
    gl.uniform2f(loc.uPointer, ptr.x, -ptr.y);
    gl.uniform1f(loc.uHover, ptr.h);
    gl.uniform1f(loc.uVel, vel);
    gl.uniform1f(loc.uTime, time);
    gl.uniform1f(loc.uStrength, strength);
    gl.uniform1f(loc.uGrain, 0.032);
    gl.uniform2f(loc.uRes, canvas.width / dpr, canvas.height / dpr);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!reducedMotion) {
      media.style.transform =
        `perspective(900px) rotateX(${(-ptr.y * 4).toFixed(3)}deg) rotateY(${(ptr.x * 4).toFixed(3)}deg)`;
    }
    if (!drawnOnce) {
      drawnOnce = true;
      canvas.style.opacity = '1';
      img.style.visibility = 'hidden';
    }
  }
  function renderOnce() {
    if (!ready || lost || destroyed) return;
    if (raf) return;               // loop will pick it up
    draw();
    kick();
  }

  function busy() {
    if (reducedMotion) return false;
    return sway ||
      Math.abs(ptr.tx - ptr.x) > 1e-4 || Math.abs(ptr.ty - ptr.y) > 1e-4 ||
      Math.abs(ptr.th - ptr.h) > 1e-3 ||
      Math.abs(velTarget) > 1e-3 || Math.abs(vel) > 1e-3;
  }
  function canRun() { return ready && active && visible && !lost && !destroyed && !reducedMotion; }
  function kick() {
    if (raf || !canRun() || !busy()) return;
    lastT = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function tick(now) {
    raf = 0;
    if (!canRun()) return;
    const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
    lastT = now;
    time += dt;
    if (sway) {
      const t = time * 0.55;
      ptr.tx = Math.sin(t) * 0.4;
      ptr.ty = Math.sin(t * 2) * 0.2;
      ptr.th = 0.4;
    }
    const k = 1 - Math.exp(-dt * 6);
    ptr.x += (ptr.tx - ptr.x) * k;
    ptr.y += (ptr.ty - ptr.y) * k;
    ptr.h += (ptr.th - ptr.h) * (1 - Math.exp(-dt * 4));
    vel += (velTarget - vel) * (1 - Math.exp(-dt * 8));
    velTarget *= Math.exp(-dt * 3);   // decays unless the caller keeps feeding it
    if (Math.abs(vel) < 1e-3 && Math.abs(velTarget) < 1e-3) { vel = 0; velTarget = 0; }
    draw();
    if (busy()) raf = requestAnimationFrame(tick);
  }

  // ---------- input ----------
  function onMove(e) {
    if (e.pointerType === 'touch' || reducedMotion) return;
    const r = figure.getBoundingClientRect();
    if (!r.width || !r.height) return;
    ptr.tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    ptr.ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    ptr.th = 1;
    kick();
  }
  function onLeave() {
    if (sway) return;
    ptr.tx = 0; ptr.ty = 0; ptr.th = 0;
    kick();
  }

  // mirror the img's scroll-parallax transform onto the canvas
  function syncTransform() {
    const t = getComputedStyle(img).transform;
    canvas.style.transform = t && t !== 'none' ? t : '';
  }

  // ---------- observers ----------
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const en of entries) visible = en.isIntersecting;
    if (visible) renderOnce();
  }, { rootMargin: '100px' }) : null;
  if (io) io.observe(media); else visible = true;
  const ro = 'ResizeObserver' in window ? new ResizeObserver(onResize) : null;
  if (ro) ro.observe(media);
  const mo = 'MutationObserver' in window ? new MutationObserver(syncTransform) : null;
  if (mo) mo.observe(img, { attributes: true, attributeFilter: ['style', 'class'] });
  syncTransform();

  figure.addEventListener('pointermove', onMove, { passive: true });
  figure.addEventListener('pointerleave', onLeave, { passive: true });

  function onLost(e) {
    e.preventDefault();
    lost = true;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    canvas.style.opacity = '0';
    img.style.visibility = prevImgVisibility;
    drawnOnce = false;
  }
  function onRestored() {
    if (destroyed) return;
    try {
      initGL();
      lost = false;
      if (colorCanvas && depthCanvas) { uploadAll(); renderOnce(); }
    } catch (err) { fail(err); }
  }
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  // ---------- lifecycle ----------
  function teardown() {
    destroyed = true;
    loadToken++;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(svgTimer);
    if (io) io.disconnect();
    if (ro) ro.disconnect();
    if (mo) mo.disconnect();
    figure.removeEventListener('pointermove', onMove);
    figure.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    try {
      if (!gl.isContextLost()) {
        gl.deleteTexture(texImg); gl.deleteTexture(texDepth);
        gl.deleteBuffer(buf); gl.deleteProgram(prog);
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
    } catch (e) { /* ignore */ }
    canvas.remove();
    img.style.visibility = prevImgVisibility;
    media.style.transform = prevMediaTransform;
  }
  function fail(err) {
    if (destroyed) return;
    failed = true;
    if (err && typeof console !== 'undefined') console.warn('[depth-photo]', err.message || err);
    teardown();
  }

  try { initGL(); } catch (err) { fail(err); return failedHandle(); }
  build().catch(fail);

  return {
    setVelocity(v) {
      if (failed || destroyed || reducedMotion) return;
      velTarget = Math.max(-1, Math.min(1, +v || 0));
      kick();
    },
    refresh() {
      if (failed || destroyed) return;
      build().catch(fail);
    },
    setActive(on) {
      if (failed || destroyed) return;
      active = !!on;
      if (!active && raf) { cancelAnimationFrame(raf); raf = 0; }
      if (active) renderOnce();
    },
    destroy() { if (!destroyed) teardown(); },
    get failed() { return failed; },
  };
}
