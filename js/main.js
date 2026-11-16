// Ayrton Senna — unofficial fan tribute. Page logic: loader, smooth scroll, scroll-driven sequences.
const html = document.documentElement;
const RM = html.classList.contains('rm');
const { gsap, ScrollTrigger, Lenis } = window;
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const FINE = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const SEASONS = [
  [1984, 'Toleman', 0, 0, false], [1985, 'Lotus', 2, 7, false], [1986, 'Lotus', 2, 8, false],
  [1987, 'Lotus', 2, 1, false], [1988, 'McLaren', 8, 13, true], [1989, 'McLaren', 6, 13, false],
  [1990, 'McLaren', 6, 10, true], [1991, 'McLaren', 7, 8, true], [1992, 'McLaren', 3, 1, false],
  [1993, 'McLaren', 5, 1, false], [1994, 'Williams', 0, 3, false],
];

/* ───────── Optional modules (generated assets). The page still works if one fails. ───────── */
const safeImport = (p) => import(p).catch((e) => { console.warn('[senna] optional module failed:', p, e); return null; });
const MOD_NAMES = ['hero-scene', 'shaders', 'circuits', 'lap-drive', 'depth-photo', 'story', 'helmet-scene'];
const modules = Promise.all(MOD_NAMES.map((n) => safeImport(`./${n}.js`)));
const NO_MODS = MOD_NAMES.map(() => null);
let VEL = 0; // smoothed scroll velocity, shared with modules

/* ───────── Static content builders (run with or without animation) ───────── */
function buildChart() {
  const root = $('#season-chart');
  if (!root) return;
  const max = 13;
  root.innerHTML = SEASONS.map(([y, team, w, p, champ]) => `
    <div class="chart__col${champ ? ' is-champ' : ''}">
      <div class="chart__bars">
        <div class="chart__bar chart__bar--w" style="height:${(w / max) * 100}%"><span>${w}</span></div>
        <div class="chart__bar chart__bar--p" style="height:${(p / max) * 100}%"><span>${p}</span></div>
      </div>
      <div class="chart__yr">’${String(y).slice(2)}</div>
      <div class="chart__tm">${team}</div>
    </div>`).join('');
}

function buildCircuits(mod) {
  if (!mod || !mod.circuitSVG) return;
  $$('.circuit[data-circuit]').forEach((el) => {
    try {
      el.innerHTML = mod.circuitSVG(el.dataset.circuit, { labels: 'labels' in el.dataset });
      const svg = $('svg', el);
      if (svg) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Stylised outline of ${mod.CIRCUITS[el.dataset.circuit]?.name || 'the circuit'}`); }
    } catch (e) { console.warn('[senna] circuit failed', el.dataset.circuit, e); }
  });
}

async function fillPhotoSlots() {
  try {
    const res = await fetch('assets/photos/photos.json');
    if (!res.ok) return;
    const { slots = {} } = await res.json();
    const credits = [];
    for (const [id, p] of Object.entries(slots)) {
      const fig = $(`.slot[data-slot="${id}"]`);
      if (!fig || !p || !p.src) continue;
      const img = $('img', fig);
      img.src = p.src; img.alt = p.alt || '';
      fig.classList.add('is-filled');
      const cap = $('figcaption', fig);
      const line = [p.caption, p.credit && `Photo: ${p.credit}`, p.licence].filter(Boolean).join(' · ');
      if (cap) cap.textContent = line;
      credits.push(p);
    }
    if (credits.length) {
      const ul = $('#photo-credits');
      ul.replaceChildren(...credits.map((p) => {
        const li = document.createElement('li');
        const text = [p.caption || p.alt, p.credit, p.licence].filter(Boolean).join(' — ');
        if (p.source) { const a = document.createElement('a'); a.href = p.source; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = text; li.append(a); }
        else li.textContent = text;
        return li;
      }));
    }
  } catch (e) { /* manifest is optional */ }
}

function splitChars(el) {
  if (!el.hasAttribute('aria-hidden') && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
  const frag = document.createDocumentFragment();
  [...el.childNodes].forEach((n) => {
    if (n.nodeType !== 3) { frag.append(n.cloneNode(true)); return; }
    n.textContent.split(/(\s+)/).forEach((tok) => {
      if (!tok) return;
      if (/^\s+$/.test(tok)) { frag.append(' '); return; }
      const w = document.createElement('span');
      w.style.cssText = 'display:inline-block;white-space:nowrap';
      w.setAttribute('aria-hidden', 'true');
      [...tok].forEach((c) => {
        const o = document.createElement('span'); o.className = 'ch';
        const i = document.createElement('span'); i.textContent = c;
        o.append(i); w.append(o);
      });
      frag.append(w);
    });
  });
  el.replaceChildren(frag);
}
function splitWords(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.setAttribute('aria-label', words.join(' '));
  el.innerHTML = words.map((w) => `<span class="wd" aria-hidden="true">${w}</span>`).join(' ');
}

function setupMenu(scrollTo) {
  const btn = $('#menu-btn'), menu = $('#menu');
  const toggle = (open) => {
    menu.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    $('span', btn).textContent = open ? 'Close' : 'Menu';
  };
  btn.addEventListener('click', () => toggle(menu.hidden));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) toggle(false); });
  $$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
    const target = $(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    toggle(false);
    scrollTo(target);
  }));
}

/* ───────── Moments: stat cards + Monaco years ───────── */
function setupMoments() {
  $$('.stat').forEach((li) => {
    const btn = $('.stat__btn', li);
    btn.addEventListener('click', () => {
      const open = !li.classList.contains('is-open');
      $$('.stat.is-open').forEach((o) => { o.classList.remove('is-open'); $('.stat__btn', o).setAttribute('aria-expanded', 'false'); });
      li.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.stat')) $$('.stat.is-open').forEach((o) => { o.classList.remove('is-open'); $('.stat__btn', o).setAttribute('aria-expanded', 'false'); });
  });
  const box = $('#monaco-moment');
  if (box) $$('.monaco__years button').forEach((b) => {
    b.addEventListener('click', () => {
      $$('.monaco__years li').forEach((li) => li.classList.toggle('is-picked', li === b.parentElement));
      $('.mono', box).textContent = b.parentElement.classList.contains('is-dnf') ? `${b.textContent} · Did not finish` : `${b.textContent} · Win`;
      $('.monaco__moment-text', box).textContent = b.dataset.moment;
      if (window.gsap && !RM) gsap.fromTo(box, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6, ease: 'expo.out' });
    });
  });
}

/* Hold-to-drive laps in the races list */
function setupLaps(lapMod, reducedMotion) {
  const laps = [];
  if (!lapMod || !lapMod.createLapDrive) return laps;
  $$('.race__map[data-circuit]').forEach((map, i) => {
    try {
      const host = document.createElement('div');
      host.className = 'lapdrive';
      map.replaceChildren(host);
      const d = map.dataset;
      const inst = lapMod.createLapDrive(host, {
        circuitId: d.circuit, wet: 'wet' in d,
        theme: map.closest('.race')?.dataset.theme || 'light',
        accent: (map.closest('.race')?.style.getPropertyValue('--acc') || '').trim() || (i % 2 ? '#00a651' : '#1b4fd8'),
        finish: { kicker: d.kicker, title: d.title, result: d.result, note: d.note },
        reducedMotion,
      });
      laps.push({ map, inst });
    } catch (e) { console.warn('[senna] lap drive failed', e); }
  });
  return laps;
}

/* 2.5D depth on every photo slot (works on placeholders now, real photos later) */
async function setupDepth(depthMod, reducedMotion) {
  if (!depthMod || !depthMod.attachDepth) return [];
  await photosReady;
  return $$('.slot').map((fig) => {
    try { return depthMod.attachDepth(fig, { reducedMotion, strength: fig.classList.contains('takeover__slot') ? 1.3 : 1 }); }
    catch (e) { console.warn('[senna] depth failed', e); return null; }
  }).filter((d) => d && !d.failed);
}

function setupStory(storyMod, reducedMotion) {
  const sec = $('#story');
  if (!sec || !storyMod || !storyMod.initStory) return null;
  try { return storyMod.initStory(sec, { gsap: window.gsap, ScrollTrigger: window.ScrollTrigger, reducedMotion, getVelocity: () => VEL }); }
  catch (e) { console.warn('[senna] story failed', e); return null; }
}

/* Scroll-scrubbed video slot (fills from assets/video/video.json) */
async function setupVideo(animated) {
  const sec = $('#video');
  if (!sec) return;
  let cfg = {};
  try { const r = await fetch('assets/video/video.json'); if (r.ok) cfg = await r.json(); } catch (e) { /* optional */ }
  if (!cfg.src) return;
  const v = $('.vslot__video', sec);
  if (cfg.poster) v.poster = cfg.poster;
  v.src = cfg.src;
  const credit = [cfg.caption, cfg.credit].filter(Boolean).join(' · ');
  $('.vslot__credit', sec).textContent = credit;
  if (credit) {
    const ul = $('#photo-credits'), li = document.createElement('li');
    li.textContent = 'Video: ' + credit;
    if (ul.textContent.includes('No photographs')) ul.replaceChildren(li); else ul.append(li);
  }
  v.addEventListener('loadeddata', () => sec.classList.add('has-video'), { once: true });
  if (!animated) { v.controls = true; v.removeAttribute('aria-hidden'); return; }
  // Seek straight from scroll (Lenis already smooths it); queue one pending seek while the decoder is busy.
  let pending = null;
  const seek = (t) => {
    if (v.seeking) { pending = t; return; }
    if (Math.abs(v.currentTime - t) > 0.01) v.currentTime = t;
  };
  v.addEventListener('seeked', () => { if (pending !== null) { const t = pending; pending = null; seek(t); } });
  const bar = $('.vslot__bar i', sec);
  ScrollTrigger.create({ trigger: sec, start: 'top top', end: 'bottom bottom', scrub: true,
    onUpdate: (s) => {
      gsap.set(bar, { scaleX: s.progress });
      if (v.duration) seek(s.progress * (v.duration - 0.05));
    } });
}

/* ───────── Boot ───────── */
buildChart();
const photosReady = fillPhotoSlots();

if (RM || !gsap || !ScrollTrigger) {
  if (!RM) html.classList.add('rm');
  bootStatic();
} else {
  bootAnimated();
}

async function bootStatic() {
  html.classList.remove('is-loading');
  setupMenu((t) => t.scrollIntoView());
  const [heroMod, shaderMod, circuitMod, lapMod, depthMod, storyMod, helmetMod] = await modules;
  buildCircuits(circuitMod);
  setupMoments();
  setupVideo(false);
  setupLaps(lapMod, true);
  setupDepth(depthMod, true);
  setupStory(storyMod, true);
  const hero = $('.hero');
  let helmet = null, scene = null;
  try { helmet = helmetMod && helmetMod.createHelmetScene($('#helmet-canvas'), { reducedMotion: true }); } catch (e) { console.warn(e); }
  if (helmet && !helmet.failed) {
    $('#hero-canvas').style.display = 'none';
    helmet.setIntro(1); helmet.setProgress(0); helmet.resize(); helmet.renderOnce();
    addEventListener('resize', () => { helmet.resize(); helmet.renderOnce(); });
    return;
  }
  hero.classList.add('no-helmet');
  try { scene = heroMod && heroMod.createHeroScene($('#hero-canvas'), { reducedMotion: true }); } catch (e) { console.warn(e); }
  if (!scene || scene.failed) hero.classList.add('no-gl');
  else { scene.setIntro(1); scene.setProgress(0); scene.resize(); scene.renderOnce(); addEventListener('resize', () => { scene.resize(); scene.renderOnce(); }); }
  if (shaderMod) $$('canvas[data-shader]').forEach((c) => {
    try { const s = shaderMod.createShaderCanvas(c, c.dataset.shader, { reducedMotion: true }); s.start(); } catch (e) { console.warn(e); }
  });
}

async function bootAnimated() {
  gsap.registerPlugin(ScrollTrigger);
  history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);
  html.classList.add('is-loading');

  $$('[data-split="chars"]').forEach(splitChars);
  $$('[data-split="words"]').forEach(splitWords);
  $$('[data-count]').forEach((el) => { el.textContent = '0'; });

  /* Smooth scroll */
  const lenis = Lenis ? new Lenis({ lerp: 0.09, smoothWheel: true, wheelMultiplier: 0.9 }) : null;
  if (lenis) {
    window.__lenis = lenis;
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    lenis.stop();
  }
  setupMenu((t) => (lenis ? lenis.scrollTo(t, { duration: 1.8, easing: (x) => 1 - Math.pow(1 - x, 4) }) : t.scrollIntoView({ behavior: 'smooth' })));

  /* Loader */
  const countEl = $('#loader-count');
  const lights = $$('.loader__lights span');
  const counter = { v: 0 };
  const paint = () => {
    countEl.textContent = String(Math.round(counter.v)).padStart(3, '0');
    const n = Math.floor(counter.v / 20);
    lights.forEach((l, i) => l.classList.toggle('on', i < n));
  };
  const run = gsap.to(counter, { v: 88, duration: 2.1, ease: 'power2.inOut', onUpdate: paint });
  const timeout = new Promise((r) => setTimeout(r, 7000));
  const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  const [heroMod, shaderMod, circuitMod, lapMod, depthMod, storyMod, helmetMod] = await Promise.race([modules, timeout.then(() => NO_MODS)]);
  await Promise.race([Promise.all([fonts, run]), timeout]);

  buildCircuits(circuitMod);

  /* 3D hero + shader backgrounds */
  const hero = $('.hero');
  let scene = null;
  try { scene = heroMod && heroMod.createHeroScene($('#hero-canvas'), {}); } catch (e) { console.warn('[senna] hero scene failed', e); }
  if (!scene || scene.failed) { hero.classList.add('no-gl'); scene = null; }
  else { scene.setIntro(0); scene.setProgress(0); scene.resize(); scene.start(); }
  let helmet = null;
  try { helmet = helmetMod && helmetMod.createHelmetScene($('#helmet-canvas'), {}); } catch (e) { console.warn('[senna] helmet failed', e); }
  if (!helmet || helmet.failed) { hero.classList.add('no-helmet'); helmet = null; }
  else { helmet.setIntro(0); helmet.setProgress(0); helmet.resize(); helmet.start(); hero.classList.add('has-helmet'); }

  setupMoments();
  setupVideo(true);
  const laps = setupLaps(lapMod, false);
  const depthsP = setupDepth(depthMod, false);
  setupStory(storyMod, false);

  const shaders = {};
  if (shaderMod) $$('canvas[data-shader]').forEach((c) => {
    try {
      const s = shaderMod.createShaderCanvas(c, c.dataset.shader, {});
      if (!s.failed) { shaders[c.dataset.shader] = s; s.start(); }
    } catch (e) { console.warn('[senna] shader failed', c.dataset.shader, e); }
  });
  if (shaders.speed) shaders.speed.set('intensity', 0.35);
  if (shaders.rain) shaders.rain.set('intensity', 0.35);

  setupScroll({ lenis, scene, helmet, shaders, laps, depthsP });
  setupCursor();

  /* Lights out → reveal */
  const intro = { t: 0 };
  const out = gsap.timeline({ onComplete: () => { $('#loader').remove(); } });
  out.to(counter, { v: 100, duration: 0.5, ease: 'power2.out', onUpdate: paint })
    .add(() => lights.forEach((l) => l.classList.remove('on')), '+=0.45')
    .to('.loader__body', { autoAlpha: 0, y: -30, duration: 0.45, ease: 'power2.in' }, '+=0.12')
    .to('.loader__cols i', { scaleY: 0, duration: 1.0, ease: 'expo.inOut', stagger: 0.07 }, '-=0.15')
    .add(() => { html.classList.remove('is-loading'); if (lenis) lenis.start(); ScrollTrigger.refresh(); }, '-=0.7')
    .to(intro, { t: 1, duration: 2.6, ease: 'power3.out', onUpdate: () => { if (helmet) helmet.setIntro(intro.t); else if (scene) scene.setIntro(intro.t); } }, '-=0.9')
    .fromTo('.hero__word .ch > span', { yPercent: 110, y: 0 }, { yPercent: 0, duration: 1.3, ease: 'expo.out', stagger: 0.045 }, '<0.1')
    .from('.hero__meta > *', { autoAlpha: 0, y: 24, duration: 1, ease: 'expo.out', stagger: 0.1 }, '<0.5')
    .from('.nav', { yPercent: -120, duration: 1, ease: 'expo.out' }, '<');
}

/* ───────── Scroll-driven sequences ───────── */
function setupScroll({ lenis, scene, helmet, shaders, laps = [], depthsP }) {
  const mm = gsap.matchMedia();

  /* Hero: pinned 3D sequence */
  gsap.set('.hero__word .ch > span', { yPercent: 110 });
  const heroTl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: '.hero', start: 'top top', end: 'bottom bottom', scrub: true,
      onUpdate: (s) => {
        const p = s.progress;
        if (helmet) {
          helmet.setProgress(clamp(p / 0.32, 0, 1));
          if (scene) { scene.setIntro(clamp((p - 0.18) / 0.14, 0, 1)); scene.setProgress(clamp((p - 0.3) / 0.7, 0, 1)); }
        } else if (scene) scene.setProgress(p);
      },
    },
  });
  const beats = $$('.beat');
  heroTl
    .to('.hero__meta', { autoAlpha: 0, y: 30, duration: 0.06 }, 0.01)
    .to('.hero__word--a', { xPercent: -45, autoAlpha: 0, duration: 0.2 }, 0.03)
    .to('.hero__word--b', { xPercent: 45, autoAlpha: 0, duration: 0.2 }, 0.03)
    .fromTo(beats[0], { autoAlpha: 0, y: 60 }, { autoAlpha: 1, y: 0, duration: 0.06 }, helmet ? 0.4 : 0.24)
    .to(beats[0], { autoAlpha: 0, y: -60, duration: 0.05 }, helmet ? 0.54 : 0.42)
    .fromTo(beats[1], { autoAlpha: 0, y: 60 }, { autoAlpha: 1, y: 0, duration: 0.06 }, helmet ? 0.6 : 0.5)
    .to(beats[1], { autoAlpha: 0, y: -60, duration: 0.05 }, helmet ? 0.73 : 0.68)
    .fromTo(beats[2], { autoAlpha: 0, scale: 0.8 }, { autoAlpha: 1, scale: 1, duration: 0.08 }, helmet ? 0.8 : 0.76)
    .to(beats[2], { autoAlpha: 0, scale: 1.08, duration: 0.05 }, 0.95)
    .set({}, {}, 1);
  ScrollTrigger.create({ trigger: '.hero', start: 'top bottom', end: 'bottom top', onToggle: (s) => {
    [scene, helmet].forEach((x) => x && (s.isActive ? x.start() : x.stop()));
  } });

  /* Hold anywhere in the hero to rev the engine */
  const heroEl = $('.hero');
  let revTarget = 0, rev = 0;
  const revOn = (e) => { if (e.button > 0 || e.target.closest('a, button')) return; revTarget = 1; heroEl.classList.add('is-revving'); };
  const revOff = () => { revTarget = 0; heroEl.classList.remove('is-revving'); };
  heroEl.addEventListener('pointerdown', revOn);
  addEventListener('pointerup', revOff); addEventListener('pointercancel', revOff); heroEl.addEventListener('pointerleave', revOff);

  /* Photo takeovers: a card that opens to full screen */
  $$('.takeover').forEach((sec) => {
    const fig = $('.takeover__slot', sec), img = $('img', fig), inner = $('.takeover__inner', sec);
    const card = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = vw <= 820 ? vw * 0.78 : Math.min(vw * 0.46, 640), h = w * 0.62;
      return `inset(${((vh - h) / 2).toFixed(1)}px ${((vw - w) / 2).toFixed(1)}px ${((vh - h) / 2).toFixed(1)}px ${((vw - w) / 2).toFixed(1)}px round 8px)`;
    };
    const tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: true, invalidateOnRefresh: true } });
    tl.fromTo(fig, { clipPath: card }, { clipPath: 'inset(0px 0px 0px 0px round 0px)', duration: 0.55, ease: 'power2.inOut' }, 0)
      .fromTo(inner, { '--shade': 0 }, { '--shade': 1, duration: 0.3 }, 0.35)
      .fromTo($$('.takeover__text > *', sec), { autoAlpha: 0, y: 50 }, { autoAlpha: 1, y: 0, stagger: 0.06, duration: 0.2 }, 0.45)
      .to({}, { duration: 0.3 });
    if (img) gsap.fromTo(img, { scale: 1.35 }, { scale: 1.02, ease: 'none', scrollTrigger: { trigger: sec, start: 'top bottom', end: 'bottom bottom', scrub: true } });
  });

  /* Lap drives only run while visible */
  laps.forEach(({ map, inst }) => ScrollTrigger.create({ trigger: map, start: 'top bottom', end: 'bottom top', onToggle: (s) => inst.setActive && inst.setActive(s.isActive) }));
  let depths = [];
  if (depthsP) depthsP.then((d) => { depths = d; });

  /* Rising headings */
  $$('[data-rise]').forEach((el) => {
    const chars = $$('.ch > span', el);
    gsap.set(chars, { yPercent: 110, y: 0 });
    ScrollTrigger.create({ trigger: el, start: 'top 90%', once: true, onEnter: () => gsap.to(chars, { yPercent: 0, duration: 1.2, ease: 'expo.out', stagger: 0.028 }) });
  });
  ScrollTrigger.batch('.reveal', { start: 'top 92%', once: true, onEnter: (b) => gsap.to(b, { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out', stagger: 0.09 }) });

  /* Intro: words light up as you read */
  const words = $$('.intro__text .wd');
  if (words.length) gsap.to(words, { opacity: 1, ease: 'none', stagger: 0.1, scrollTrigger: { trigger: '.intro__text', start: 'top 78%', end: 'bottom 42%', scrub: true } });

  /* Count-ups */
  $$('[data-count]').forEach((el) => {
    const end = +el.dataset.count, o = { v: 0 };
    ScrollTrigger.create({ trigger: el, start: 'top 92%', once: true, onEnter: () => gsap.to(o, { v: end, duration: 1.6 + Math.min(end, 100) / 120, ease: 'power3.out', onUpdate: () => { el.textContent = Math.round(o.v); } }) });
  });

  /* Parallax on slots */
  $$('[data-parallax]').forEach((el) => {
    const p = +el.dataset.parallax;
    gsap.fromTo(el, { yPercent: -p }, { yPercent: p, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
  });
  $$('.slot__media img').forEach((img) => {
    if (img.closest('.panel')) return;
    gsap.fromTo(img, { yPercent: -5 }, { yPercent: 5, ease: 'none', scrollTrigger: { trigger: img.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } });
  });

  /* Career: horizontal track on desktop, vertical stack on mobile */
  const pin = $('.career'), track = $('#career-track');
  const bars = $$('.chart__bar');
  const growBars = () => gsap.to(bars, { scaleY: 1, duration: 1.2, ease: 'expo.out', stagger: 0.03 });
  gsap.set(bars, { scaleY: 0 });
  mm.add('(min-width: 821px)', () => {
    const dist = () => Math.max(0, track.offsetWidth - window.innerWidth);
    const size = () => { pin.style.height = `${dist() + window.innerHeight}px`; };
    size();
    ScrollTrigger.addEventListener('refreshInit', size);
    const yearEl = $('#career-year'), bar = $('#career-bar');
    const panels = $$('.panel[data-year]', track);
    let eraPanel;
    const tween = gsap.to(track, {
      x: () => -dist(), ease: 'none',
      scrollTrigger: {
        trigger: pin, start: 'top top', end: 'bottom bottom', scrub: true, invalidateOnRefresh: true,
        onUpdate: (s) => {
          gsap.set(bar, { scaleX: s.progress });
          const x = dist() * s.progress + window.innerWidth * 0.55;
          let y = '1984';
          let cur = null;
          panels.forEach((p) => { if (p.offsetLeft <= x) { y = p.dataset.year; if (p.style.getPropertyValue('--bg')) cur = p; } });
          if (yearEl.textContent !== y) yearEl.textContent = y;
          if (cur !== eraPanel) {
            eraPanel = cur;
            const inner = pin.querySelector('.career__inner');
            inner.style.setProperty('--era-bg', cur ? cur.style.getPropertyValue('--bg') : '#0b1f4b');
            inner.style.setProperty('--era-acc', cur ? cur.style.getPropertyValue('--acc') : '#ffdf00');
          }
        },
      },
    });
    const chartSt = ScrollTrigger.create({ trigger: '.panel--chart', containerAnimation: tween, start: 'left 75%', once: true, onEnter: growBars });
    $$('.panel__num', track).forEach((n) => gsap.fromTo(n, { xPercent: 30 }, { xPercent: -30, ease: 'none', scrollTrigger: { trigger: n.parentElement, containerAnimation: tween, start: 'left right', end: 'right left', scrub: true } }));
    return () => { ScrollTrigger.removeEventListener('refreshInit', size); chartSt.kill(); pin.style.height = ''; gsap.set(track, { clearProps: 'transform' }); };
  });
  mm.add('(max-width: 820px)', () => {
    const st = ScrollTrigger.create({ trigger: '#season-chart', start: 'top 85%', once: true, onEnter: growBars });
    return () => st.kill();
  });

  /* Championship cards: each one recedes as the next slides over it */
  const crowns = $$('.crown');
  crowns.forEach((c, i) => {
    const inner = $('.crown__inner', c);
    gsap.fromTo($('.crown__year', c), { yPercent: 18 }, { yPercent: -18, ease: 'none', scrollTrigger: { trigger: c, start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.from($('.crown__laurel', c), { rotate: -25, scale: 0.7, opacity: 0, duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: c, start: 'top 45%', toggleActions: 'play none none reverse' } });
    if (crowns[i + 1]) gsap.to(inner, { scale: 0.9, opacity: 0.35, borderRadius: 28, ease: 'none', scrollTrigger: { trigger: crowns[i + 1], start: 'top bottom', end: 'top top', scrub: true } });
  });

  /* Monaco: pinned lap, six wins */
  const mLine = $('.monaco .circuit-line'), mSvg = $('.monaco .circuit svg');
  const years = $$('.monaco__years li'), mCount = $('#monaco-count');
  let dot = null, mLen = 0;
  if (mLine && mSvg) {
    dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', 11); dot.setAttribute('class', 'circuit-dot');
    mSvg.append(dot);
    mLen = mLine.getTotalLength();
    gsap.set($$('.monaco .circuit-labels text'), { opacity: 0 });
    gsap.to($$('.monaco .circuit-labels text'), { opacity: 1, stagger: 0.12, ease: 'none', scrollTrigger: { trigger: '.monaco', start: 'top top', end: 'bottom bottom', scrub: true } });
  }
  let lastWins = -1;
  ScrollTrigger.create({
    trigger: '.monaco', start: 'top top', end: 'bottom bottom', scrub: true,
    onUpdate: (s) => {
      const p = clamp((s.progress - 0.04) / 0.86, 0, 1);
      if (mLine) {
        mLine.style.strokeDashoffset = 1 - p;
        const pt = mLine.getPointAtLength(mLen * p);
        dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
      }
      const wins = Math.min(6, Math.floor(p * 6 + 0.02));
      if (wins !== lastWins) { lastWins = wins; mCount.textContent = wins; years.forEach((li, i) => li.classList.toggle('on', i < wins)); }
      if (shaders.rain) { shaders.rain.set('intensity', 0.3 + 0.7 * Math.sin(s.progress * Math.PI)); shaders.rain.set('progress', s.progress); }
    },
  });
  gsap.fromTo('.monaco__title', { xPercent: 6 }, { xPercent: -22, ease: 'none', scrollTrigger: { trigger: '.monaco', start: 'top bottom', end: 'bottom top', scrub: true } });

  /* Races: each outline is driven as its row passes */
  $$('.race').forEach((r) => {
    const line = $('.circuit-line', r);
    if (line) gsap.to(line, { strokeDashoffset: 0, ease: 'none', scrollTrigger: { trigger: r, start: 'top 78%', end: 'bottom 60%', scrub: true } });
    gsap.from($('h3', r), { xPercent: -6, opacity: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: r, start: 'top 85%', once: true } });
  });
  const iLine = $('.imola .circuit-line');
  if (iLine) gsap.to(iLine, { strokeDashoffset: 0, ease: 'none', scrollTrigger: { trigger: '.imola', start: 'top 70%', end: 'bottom bottom', scrub: true } });

  if (shaders.flow) ScrollTrigger.create({ trigger: '.legacy', start: 'top bottom', end: 'bottom top', scrub: true, onUpdate: (s) => shaders.flow.set('progress', s.progress) });

  /* Nav: progress, hide on the way down, active link */
  const nav = $('#nav'), prog = $('#nav-progress');
  ScrollTrigger.create({
    start: 0, end: 'max',
    onUpdate: (s) => {
      gsap.set(prog, { scaleX: s.progress });
      nav.classList.toggle('is-hidden', s.direction === 1 && s.scroll() > window.innerHeight * 0.6 && $('#menu').hidden);
    },
  });
  $$('.nav__links a').forEach((a) => {
    const sec = $(a.getAttribute('href'));
    if (sec) ScrollTrigger.create({ trigger: sec, start: 'top 50%', end: 'bottom 50%', onToggle: (s) => a.classList.toggle('is-active', s.isActive) });
  });

  /* Velocity → "liquid" response */
  const marquees = $$('[data-marquee]').map((row) => {
    const t = $('.marquee__track', row);
    const clone = t.cloneNode(true);
    row.append(clone);
    return { row, tracks: [t, clone], dir: +row.dataset.marquee, x: 0, w: 0 };
  });
  const measure = () => marquees.forEach((m) => { m.w = m.tracks[0].offsetWidth; });
  measure(); addEventListener('resize', measure);
  marquees.forEach((m) => { m.row.style.display = 'flex'; });

  const skewY = $$('.liquid-y').map((el) => gsap.quickSetter(el, 'skewY', 'deg'));
  const panels = $$('.panel');
  const disp = $('#liquid feDisplacementMap');
  let vel = 0, fast = false;
  const desktop = window.matchMedia('(min-width: 821px)');
  gsap.ticker.add((time, dt) => {
    const raw = lenis ? lenis.velocity : 0;
    vel += (clamp(raw / 55, -1, 1) - vel) * 0.14;
    if (Math.abs(vel) < 0.0005) vel = 0;
    VEL = vel;
    const a = Math.abs(vel);
    rev += (revTarget - rev) * (revTarget ? 0.06 : 0.04);
    const heroVel = clamp(vel + rev * 0.9, -1, 1);
    if (scene) scene.setVelocity(heroVel);
    if (helmet) helmet.setVelocity(heroVel);
    if (a > 0.002) for (const d of depths) d.setVelocity(vel);
    if (shaders.speed) { shaders.speed.set('velocity', vel); shaders.speed.set('intensity', 0.35 + a * 0.5); }
    if (shaders.rain) shaders.rain.set('velocity', vel);
    if (shaders.flow) shaders.flow.set('velocity', vel);
    skewY.forEach((s) => s(vel * 3.5));
    if (desktop.matches) for (const p of panels) p.style.transform = `skewX(${(-vel * 7).toFixed(3)}deg) scaleX(${(1 + a * 0.04).toFixed(4)})`;
    const isFast = a > 0.04;
    if (isFast !== fast) { fast = isFast; html.classList.toggle('is-fast', fast); }
    if (fast && disp) disp.setAttribute('scale', (a * 90).toFixed(1));
    marquees.forEach((m) => {
      if (!m.w) return;
      m.x -= m.dir * (0.06 + vel * 1.6) * dt;
      m.x = ((m.x % m.w) + m.w) % m.w;
      const tx = -m.x;
      m.tracks[0].style.transform = m.tracks[1].style.transform = `translate3d(${tx.toFixed(2)}px,0,0) skewX(${(-vel * 12).toFixed(2)}deg)`;
    });
  });

  addEventListener('resize', () => { if (scene) scene.resize(); if (helmet) helmet.resize(); Object.values(shaders).forEach((s) => s.resize()); });
  if (FINE) addEventListener('pointermove', (e) => {
    const x = e.clientX / window.innerWidth, y = e.clientY / window.innerHeight;
    if (scene) scene.setPointer(x * 2 - 1, -(y * 2 - 1));
    if (helmet) helmet.setPointer(x * 2 - 1, -(y * 2 - 1));
  }, { passive: true });
  $$('canvas[data-shader]').forEach((c) => {
    const s = shaders[c.dataset.shader];
    if (s && FINE) c.parentElement.addEventListener('pointermove', (e) => { const r = c.getBoundingClientRect(); s.setPointer((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }, { passive: true });
  });
}

/* ───────── Cursor + magnetic buttons ───────── */
function setupCursor() {
  if (!FINE) return;
  const cur = $('.cursor'), dot = $('.cursor__dot'), ring = $('.cursor__ring'), label = $('.cursor__label');
  const dx = gsap.quickTo(dot, 'x', { duration: 0.12, ease: 'power3' }), dy = gsap.quickTo(dot, 'y', { duration: 0.12, ease: 'power3' });
  const rx = gsap.quickTo(ring, 'x', { duration: 0.55, ease: 'power3' }), ry = gsap.quickTo(ring, 'y', { duration: 0.55, ease: 'power3' });
  gsap.set([dot, ring], { xPercent: -50, yPercent: -50 });

  addEventListener('pointermove', (e) => { dx(e.clientX); dy(e.clientY); rx(e.clientX); ry(e.clientY); }, { passive: true });
  document.addEventListener('pointerover', (e) => {
    const lab = e.target.closest('[data-cursor]');
    const link = e.target.closest('a, button');
    cur.classList.toggle('is-label', !!lab);
    cur.classList.toggle('is-link', !lab && !!link);
    if (lab) label.textContent = lab.dataset.cursor;
  });
  $$('[data-magnetic]').forEach((el) => {
    const mx = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3' }), my = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3' });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      mx((e.clientX - (r.left + r.width / 2)) * 0.4); my((e.clientY - (r.top + r.height / 2)) * 0.4);
    });
    el.addEventListener('pointerleave', () => gsap.to(el, { x: 0, y: 0, duration: 1, ease: 'elastic.out(1, 0.35)' }));
  });
}
