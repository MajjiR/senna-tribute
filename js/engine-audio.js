// Procedural racing-engine synthesiser (Web Audio). Original sound design — no recordings.
// Each profile models an engine layout Senna raced with: cylinder count sets the firing rhythm,
// rev range and shift points set the character, turbo engines add whistle and wastegate chatter.
//
//   const eng = createEngine(ctx, outputNode);
//   eng.setProfile('v10'); eng.setThrottle(0..1); eng.update(dt); eng.loudness (0..1)

export const ENGINES = {
  // id         label                     cyl idle  shift  peak   turbo formants (Hz, gain dB)                 rough
  i4t:   { label: '4-cylinder turbo · 1984',   cyl: 4,  idle: 3800, shift: 10400, peak: 10800, turbo: 1, formants: [[180, 7], [620, 5], [2100, 3]], rough: 0.035 },
  v6t:   { label: 'V6 turbo · 1985–86',        cyl: 6,  idle: 4000, shift: 11000, peak: 11500, turbo: 1, formants: [[240, 6], [900, 5], [2600, 3]], rough: 0.025 },
  v6th:  { label: 'V6 turbo · 1987–88',        cyl: 6,  idle: 4200, shift: 12000, peak: 12500, turbo: 1, formants: [[260, 6], [980, 6], [2900, 3]], rough: 0.02 },
  v10:   { label: 'V10 · 1989–90',             cyl: 10, idle: 4600, shift: 13000, peak: 13600, turbo: 0, formants: [[420, 6], [1500, 6], [3800, 4]], rough: 0.015 },
  v12:   { label: 'V12 · 1991–92',             cyl: 12, idle: 4800, shift: 14000, peak: 14600, turbo: 0, formants: [[520, 5], [1900, 7], [4600, 5]], rough: 0.012 },
  v8:    { label: 'V8 · 1993',                 cyl: 8,  idle: 4400, shift: 13000, peak: 13600, turbo: 0, formants: [[320, 7], [1200, 5], [3200, 3]], rough: 0.02 },
  v10r:  { label: 'V10 · 1994',                cyl: 10, idle: 4800, shift: 14200, peak: 14800, turbo: 0, formants: [[440, 6], [1600, 6], [4100, 4]], rough: 0.015 },
};

export const ENGINE_BY_YEAR = (y) => {
  y = +y;
  if (y <= 1984) return 'i4t';
  if (y <= 1986) return 'v6t';
  if (y <= 1988) return 'v6th';
  if (y <= 1990) return 'v10';
  if (y <= 1992) return 'v12';
  if (y === 1993) return 'v8';
  return 'v10r';
};

export function createEngine(ctx, out) {
  // A rich periodic wave: strong low harmonics with an uneven tail gives a rasping combustion pulse.
  const N = 48, re = new Float32Array(N), im = new Float32Array(N);
  for (let k = 1; k < N; k++) im[k] = (1 / Math.pow(k, 0.85)) * (k % 2 ? 1 : 0.62) * (k % 3 === 0 ? 1.15 : 1);
  const wave = ctx.createPeriodicWave(re, im);

  const bus = ctx.createGain(); bus.gain.value = 0;
  const shaper = ctx.createWaveShaper(); shaper.curve = curve(3.2); shaper.oversample = '2x';
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000; lp.Q.value = 0.4;
  const formants = [0, 1, 2].map(() => { const f = ctx.createBiquadFilter(); f.type = 'peaking'; f.Q.value = 1.6; return f; });
  shaper.connect(hp); let chain = hp;
  for (const f of formants) { chain.connect(f); chain = f; }
  chain.connect(lp).connect(bus).connect(out);

  // Combustion: firing-frequency oscillator + a crank-rate sub layer, each with jitter FM.
  const fire = ctx.createOscillator(); fire.setPeriodicWave(wave);
  const crank = ctx.createOscillator(); crank.type = 'sawtooth';
  const fireG = ctx.createGain(); fireG.gain.value = 0.9;
  const crankG = ctx.createGain(); crankG.gain.value = 0.35;
  fire.connect(fireG).connect(shaper); crank.connect(crankG).connect(shaper);
  const jitterSrc = ctx.createBufferSource(); jitterSrc.buffer = noise(ctx, 2); jitterSrc.loop = true;
  const jitterLp = ctx.createBiquadFilter(); jitterLp.type = 'lowpass'; jitterLp.frequency.value = 90;
  const jitterAmt = ctx.createGain(); jitterAmt.gain.value = 0;
  jitterSrc.connect(jitterLp).connect(jitterAmt); jitterAmt.connect(fire.frequency); jitterAmt.connect(crank.frequency);

  // Mechanical / intake noise
  const mech = ctx.createBufferSource(); mech.buffer = noise(ctx, 2); mech.loop = true;
  const mechBp = ctx.createBiquadFilter(); mechBp.type = 'bandpass'; mechBp.Q.value = 0.9;
  const mechG = ctx.createGain(); mechG.gain.value = 0;
  mech.connect(mechBp).connect(mechG).connect(bus);

  // Turbo whistle + boost whoosh
  const whistle = ctx.createOscillator(); whistle.type = 'sine';
  const whistleG = ctx.createGain(); whistleG.gain.value = 0;
  whistle.connect(whistleG).connect(bus);
  const whoosh = ctx.createBufferSource(); whoosh.buffer = noise(ctx, 2); whoosh.loop = true;
  const whooshBp = ctx.createBiquadFilter(); whooshBp.type = 'bandpass'; whooshBp.Q.value = 3;
  const whooshG = ctx.createGain(); whooshG.gain.value = 0;
  whoosh.connect(whooshBp).connect(whooshG).connect(bus);

  // Pops / crackle / wastegate bursts on lift-off
  const popBus = ctx.createGain(); popBus.gain.value = 0.9; popBus.connect(out);
  const popNoise = noise(ctx, 0.5);

  [fire, crank, jitterSrc, mech, whistle, whoosh].forEach((n) => n.start());

  let profile = ENGINES.v6th, id = 'v6th';
  let throttle = 0, rpm = profile.idle, boost = 0, gear = 1, lastThrottle = 0, popTimer = 0, level = 0, master = 0;

  function applyProfile() {
    profile.formants.forEach(([f, g], i) => { formants[i].frequency.setTargetAtTime(f, ctx.currentTime, 0.2); formants[i].gain.setTargetAtTime(g, ctx.currentTime, 0.2); });
  }
  applyProfile();

  function pop(t, strength, turboChatter) {
    const src = ctx.createBufferSource(); src.buffer = popNoise;
    const f = ctx.createBiquadFilter(); f.type = turboChatter ? 'highpass' : 'bandpass';
    f.frequency.value = turboChatter ? 3500 : 300 + Math.random() * 500; f.Q.value = turboChatter ? 0.7 : 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(strength, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + (turboChatter ? 0.09 : 0.05 + Math.random() * 0.05));
    src.connect(f).connect(g).connect(popBus); src.start(t, Math.random() * 0.4); src.stop(t + 0.15);
  }

  return {
    get id() { return id; },
    get label() { return profile.label; },
    get loudness() { return level; },
    setProfile(next) {
      if (!ENGINES[next] || next === id) return;
      id = next; profile = ENGINES[next]; rpm = Math.max(profile.idle, Math.min(rpm, profile.shift)); applyProfile();
    },
    setThrottle(t) { throttle = Math.max(0, Math.min(1, t)); },
    setMaster(m) { master = Math.max(0, Math.min(1, m)); },
    update(dt) {
      const t = ctx.currentTime, P = profile;
      // Rev model: throttle pulls rpm towards the shift point; at the limit, short-shift up (rpm drops); off-throttle bleeds revs.
      const target = P.idle + throttle * (P.peak - P.idle);
      const rate = throttle > rpm / P.peak ? 5200 + 1600 / gear : 4200;
      rpm += Math.sign(target - rpm) * Math.min(Math.abs(target - rpm), rate * dt);
      if (throttle > 0.55 && rpm >= P.shift && gear < 6) { gear++; rpm *= 0.74; pop(t, 0.12 * master, false); }
      if (throttle < 0.2 && gear > 1 && rpm < P.idle + (P.peak - P.idle) * 0.45) { gear--; rpm = Math.min(P.peak, rpm * 1.18); }
      // Lift-off: crackle, plus wastegate chatter on turbo engines
      if (lastThrottle - throttle > 0.08 && rpm > P.idle * 1.4) popTimer = 0.45;
      if (popTimer > 0) { popTimer -= dt; if (Math.random() < dt * 22) pop(t + Math.random() * 0.02, (0.25 + Math.random() * 0.35) * master, P.turbo && Math.random() < 0.4); }
      lastThrottle = throttle;
      boost += ((P.turbo ? throttle : 0) - boost) * Math.min(1, dt * (throttle > boost ? 1.6 : 4));

      const crankHz = rpm / 60, fireHz = crankHz * P.cyl / 2;
      fire.frequency.setTargetAtTime(fireHz, t, 0.03);
      crank.frequency.setTargetAtTime(crankHz, t, 0.03);
      jitterAmt.gain.setTargetAtTime(fireHz * P.rough, t, 0.1);
      const n = (rpm - P.idle) / (P.peak - P.idle); // 0..1 through the rev range
      lp.frequency.setTargetAtTime(2400 + n * 7000 + throttle * 1500, t, 0.05);
      mechBp.frequency.setTargetAtTime(1200 + n * 3800, t, 0.05);
      mechG.gain.setTargetAtTime(0.02 + n * 0.06, t, 0.05);
      whistle.frequency.setTargetAtTime(3800 + boost * 5200 + n * 900, t, 0.08);
      whistleG.gain.setTargetAtTime(P.turbo ? boost * 0.035 : 0, t, 0.08);
      whooshBp.frequency.setTargetAtTime(900 + boost * 2600, t, 0.1);
      whooshG.gain.setTargetAtTime(P.turbo ? boost * 0.08 : 0, t, 0.1);
      level = Math.min(1, throttle * 0.75 + n * 0.25 * throttle);
      // silent at rest: no idle hum unless the car is actually being driven
      bus.gain.setTargetAtTime(master * level * 0.34, t, throttle > 0.02 ? 0.06 : 0.4);
    },
  };
}

function curve(k) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}
function noise(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
