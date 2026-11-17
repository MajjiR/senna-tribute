// Original generative soundtrack for the Senna fan tribute — synthesised live with the Web Audio API.
// No recordings or samples: a dark pad, a soft pulse, a heartbeat kick, an engine tone that follows
// scroll speed, and rain noise for the wet sections. Nothing plays until the visitor turns sound on.
//
//   const audio = createAudio();
//   await audio.enable();  audio.disable();  audio.toggle();
//   audio.setVelocity(v /* -1..1 */); audio.setRev(r /* 0..1 */); audio.setMood('drive'|'rain'|'calm'|'silence');

const BPM = 104;
const STEP = 60 / BPM / 4; // 16th note
// Am – F – C – G, voiced low; one chord per bar
const CHORDS = [
  [45, 52, 57, 60, 64],
  [41, 48, 53, 57, 60],
  [48, 52, 55, 60, 64],
  [43, 50, 55, 59, 62],
];
const ARP = [0, 2, 3, 4, 3, 2, 1, 2]; // indexes into the chord, an 8-step figure
const MOODS = {
  //        pad   cutoff pulse kick  engine rain
  drive:   [0.22, 1400,  0.10, 0.20, 1.00, 0.00],
  rain:    [0.20, 900,   0.06, 0.12, 0.70, 0.55],
  calm:    [0.20, 700,   0.03, 0.00, 0.25, 0.00],
  silence: [0.00, 400,   0.00, 0.00, 0.00, 0.00],
};

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function createAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return stub();

  let ctx = null, nodes = null, on = false, timer = 0;
  let nextTime = 0, step = 0;
  let vel = 0, rev = 0, mood = 'drive';

  function build() {
    ctx = new AC();
    const master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.3;
    master.connect(comp).connect(ctx.destination);

    // Shared space: a short generated-noise reverb
    const verb = ctx.createConvolver();
    verb.buffer = impulse(2.8, 2.2);
    const verbGain = ctx.createGain(); verbGain.gain.value = 0.35;
    verb.connect(verbGain).connect(master);

    // Pad bus
    const padGain = ctx.createGain(); padGain.gain.value = 0;
    const padFilter = ctx.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 900; padFilter.Q.value = 0.7;
    padGain.connect(padFilter); padFilter.connect(master); padFilter.connect(verb);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 260;
    lfo.connect(lfoAmt).connect(padFilter.frequency); lfo.start();
    const padVoices = [];
    for (let i = 0; i < 5; i++) {
      const g = ctx.createGain(); g.gain.value = 0.16;
      g.connect(padGain);
      const oscs = [-7, 7].map((det) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = det;
        o.frequency.value = mtof(CHORDS[0][i]); o.connect(g); o.start(); return o;
      });
      padVoices.push(oscs);
    }

    // Pulse (plucked arpeggio) and kick buses
    const pulseGain = ctx.createGain(); pulseGain.gain.value = 0;
    const pulseFilter = ctx.createBiquadFilter(); pulseFilter.type = 'lowpass'; pulseFilter.frequency.value = 2200; pulseFilter.Q.value = 4;
    pulseGain.connect(pulseFilter); pulseFilter.connect(master); pulseFilter.connect(verb);
    const kickGain = ctx.createGain(); kickGain.gain.value = 0; kickGain.connect(master);

    // Engine: two detuned oscillators through a resonant band-pass, pitch follows scroll speed
    const engGain = ctx.createGain(); engGain.gain.value = 0;
    const engFilter = ctx.createBiquadFilter(); engFilter.type = 'bandpass'; engFilter.frequency.value = 400; engFilter.Q.value = 2.5;
    const engShape = ctx.createWaveShaper(); engShape.curve = drive(2.2);
    engFilter.connect(engShape).connect(engGain).connect(master);
    const eng1 = ctx.createOscillator(); eng1.type = 'sawtooth'; eng1.frequency.value = 52;
    const eng2 = ctx.createOscillator(); eng2.type = 'square'; eng2.frequency.value = 52 * 1.5; eng2.detune.value = 9;
    const eng2g = ctx.createGain(); eng2g.gain.value = 0.35;
    eng1.connect(engFilter); eng2.connect(eng2g).connect(engFilter); eng1.start(); eng2.start();

    // Rain: looping noise, high-passed, with a softer low rumble
    const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer(3); noise.loop = true;
    const rainHi = ctx.createBiquadFilter(); rainHi.type = 'highpass'; rainHi.frequency.value = 1800;
    const rainLo = ctx.createBiquadFilter(); rainLo.type = 'lowpass'; rainLo.frequency.value = 7000;
    const rainGain = ctx.createGain(); rainGain.gain.value = 0;
    noise.connect(rainHi).connect(rainLo).connect(rainGain).connect(master); noise.start();

    nodes = { master, padGain, padFilter, padVoices, pulseGain, pulseFilter, kickGain, engGain, engFilter, eng1, eng2, rainGain };
  }

  function impulse(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  function noiseBuffer(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function drive(k) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
    return c;
  }

  // ---- sequencer (look-ahead scheduling) ----
  function pluck(t, midi, amp) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = mtof(midi);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(nodes.pulseGain); o.start(t); o.stop(t + 0.36);
  }
  function kick(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g).connect(nodes.kickGain); o.start(t); o.stop(t + 0.45);
  }
  function schedule() {
    const ahead = ctx.currentTime + 0.12;
    while (nextTime < ahead) {
      const bar = Math.floor(step / 16) % CHORDS.length, s = step % 16, chord = CHORDS[bar];
      if (s === 0) {
        nodes.padVoices.forEach((oscs, i) => oscs.forEach((o) => o.frequency.setTargetAtTime(mtof(chord[i]), nextTime, 0.4)));
      }
      // denser figure when scrolling fast: 8ths at rest, 16ths at speed
      const dense = Math.abs(vel) > 0.18 || rev > 0.3;
      if (dense || s % 2 === 0) pluck(nextTime, chord[ARP[s % 8]] + 24, s % 4 === 0 ? 0.5 : 0.32);
      if (s === 0 || s === 8) kick(nextTime);
      nextTime += STEP; step++;
    }
  }

  // ---- continuous parameters ----
  function apply(fast) {
    if (!nodes) return;
    const t = ctx.currentTime, k = fast ? 0.08 : 0.9;
    const [pad, cutoff, pulse, kickAmt, engine, rain] = MOODS[mood] || MOODS.drive;
    const speed = Math.min(1, Math.abs(vel) + rev);
    nodes.padGain.gain.setTargetAtTime(pad, t, k);
    nodes.padFilter.frequency.setTargetAtTime(cutoff + speed * 900, t, 0.25);
    nodes.pulseGain.gain.setTargetAtTime(pulse * (0.6 + speed * 0.8), t, k);
    nodes.pulseFilter.frequency.setTargetAtTime(1600 + speed * 2600, t, 0.2);
    nodes.kickGain.gain.setTargetAtTime(kickAmt, t, k);
    nodes.rainGain.gain.setTargetAtTime(rain * 0.12, t, k);
    const f = 48 + speed * 150;
    nodes.eng1.frequency.setTargetAtTime(f, t, 0.12);
    nodes.eng2.frequency.setTargetAtTime(f * 1.5, t, 0.12);
    nodes.engFilter.frequency.setTargetAtTime(300 + speed * 1500, t, 0.12);
    nodes.engGain.gain.setTargetAtTime(engine * (0.012 + speed * 0.11), t, 0.1);
  }

  let lastApply = 0;
  function tick() {
    if (!on) return;
    schedule();
    const now = performance.now();
    if (now - lastApply > 60) { apply(false); lastApply = now; }
  }

  return {
    get enabled() { return on; },
    async enable() {
      if (!ctx) build();
      if (ctx.state !== 'running') await ctx.resume();
      on = true;
      nextTime = ctx.currentTime + 0.05;
      nodes.master.gain.cancelScheduledValues(ctx.currentTime);
      nodes.master.gain.setTargetAtTime(0.7, ctx.currentTime, 0.8);
      apply(true);
      clearInterval(timer); timer = setInterval(tick, 25);
    },
    disable() {
      if (!ctx) return;
      on = false;
      clearInterval(timer);
      nodes.master.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
      setTimeout(() => { if (!on && ctx.state === 'running') ctx.suspend(); }, 1200);
    },
    async toggle() { if (on) this.disable(); else await this.enable(); return on; },
    setVelocity(v) { vel = Math.max(-1, Math.min(1, v || 0)); },
    setRev(r) { rev = Math.max(0, Math.min(1, r || 0)); },
    setMood(m) { if (MOODS[m] && m !== mood) { mood = m; if (on) apply(true); } },
    get mood() { return mood; },
  };
}

function stub() {
  return { enabled: false, enable: async () => {}, disable() {}, toggle: async () => false, setVelocity() {}, setRev() {}, setMood() {}, mood: 'drive', failed: true };
}
