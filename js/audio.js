// Original generative soundtrack for the Senna fan tribute — synthesised live with the Web Audio API.
// Two layers:
//   1. a sparse, soft "felt piano" score: notes that ring and fade, with silence between them —
//      no sustained drones or pads, so nothing hums in the background, and
//   2. an engine that is silent at rest and only speaks when you scroll or drive a lap. It uses
//      real CC BY-SA recordings (js/sample-engine.js) when they load, else the synthesised engine.
// Nothing plays until the visitor turns sound on.

import { createEngine, ENGINE_BY_YEAR, ENGINES } from './engine-audio.js';
import { createSampleEngine } from './sample-engine.js';

const BPM = 72;
const BEAT = 60 / BPM;
// A minor colour: Am9 – Fmaj7 – C(add9) – G6, each voiced softly in the middle register
const CHORDS = [
  [57, 64, 67, 71],
  [53, 60, 64, 69],
  [48, 55, 62, 64],
  [55, 59, 64, 67],
];
const MELODY = [76, null, 74, null, 72, null, null, 71, 69, null, 72, null, 74, null, null, null];
const MOODS = {
  //        piano  melody engine rain
  drive:   [0.30,  0.22,  1.00,  0.00],
  rain:    [0.26,  0.16,  0.85,  0.40],
  calm:    [0.22,  0.10,  0.25,  0.00],
  silence: [0.00,  0.00,  0.00,  0.00],
};
const MASTER = 0.42;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function createAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return stub();

  let ctx = null, n = null, engine = null, on = false, timer = 0, last = 0;
  let nextBeat = 0, beat = 0;
  let vel = 0, rev = 0, lap = 0, mood = 'drive', pendingEngine = 'v6th', ambientPlayed = false;

  function build() {
    ctx = new AC();
    const master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 2.5; comp.attack.value = 0.01; comp.release.value = 0.3;
    master.connect(comp).connect(ctx.destination);

    const music = ctx.createGain(); music.gain.value = 1; music.connect(master);
    const verb = ctx.createConvolver(); verb.buffer = impulse(3.2, 2.4);
    const verbG = ctx.createGain(); verbG.gain.value = 0.3; verb.connect(verbG).connect(music);
    const piano = ctx.createGain(); piano.gain.value = 0;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2600; tone.Q.value = 0.4;
    piano.connect(tone); tone.connect(music); tone.connect(verb);
    const melody = ctx.createGain(); melody.gain.value = 0; melody.connect(tone);

    const rainSrc = ctx.createBufferSource(); rainSrc.buffer = noiseBuf(3); rainSrc.loop = true;
    const rainHp = ctx.createBiquadFilter(); rainHp.type = 'highpass'; rainHp.frequency.value = 2400;
    const rainLp = ctx.createBiquadFilter(); rainLp.type = 'lowpass'; rainLp.frequency.value = 7000;
    const rainG = ctx.createGain(); rainG.gain.value = 0;
    rainSrc.connect(rainHp).connect(rainLp).connect(rainG).connect(master); rainSrc.start();

    const engBus = ctx.createGain(); engBus.gain.value = 1; engBus.connect(master);
    engine = createEngine(ctx, engBus); // synthesised fallback until the recordings decode
    engine.setProfile(pendingEngine);
    createSampleEngine(ctx, engBus).then((rec) => {
      if (!rec) return;
      rec.setProfile(pendingEngine);
      engine.setMaster(0); engine.setThrottle(0); engine.update(0.1);
      engine = rec;
    }).catch(() => {});

    n = { master, music, piano, melody, rainG };
  }

  function impulse(sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  function noiseBuf(sec) {
    const len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // Felt-piano voice: a sine fundamental plus a quieter octave and a soft attack, decaying to silence.
  function note(t, midi, amp, dest, decay = 2.6) {
    const f = mtof(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.012);
    g.gain.exponentialRampToValueAtTime(amp * 0.35, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(dest);
    [[1, 1], [2, 0.18], [3, 0.05]].forEach(([mult, a]) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * mult; o.detune.value = (Math.random() - 0.5) * 4;
      const og = ctx.createGain(); og.gain.value = a; o.connect(og).connect(g);
      o.start(t); o.stop(t + decay + 0.05);
    });
  }

  function schedule() {
    const ahead = ctx.currentTime + 0.2;
    while (nextBeat < ahead) {
      const bar = Math.floor(beat / 4) % CHORDS.length, b = beat % 4, chord = CHORDS[bar];
      // one gently rolled chord per bar, then space
      if (b === 0) chord.forEach((m, i) => note(nextBeat + i * 0.07, m, i === 0 ? 0.22 : 0.15, n.piano, 3.6));
      const m = MELODY[beat % MELODY.length];
      if (m && (beat % 8 !== 7)) note(nextBeat + 0.02, m, 0.16, n.melody, 2.4);
      nextBeat += BEAT; beat++;
    }
  }

  function apply(dt) {
    const t = ctx.currentTime;
    const [pianoAmt, melodyAmt, engAmt, rain] = MOODS[mood] || MOODS.drive;
    const throttle = Math.max(lap, Math.min(1, Math.abs(vel) * 1.4 + rev));
    engine.setMaster(engAmt);
    engine.setThrottle(throttle);
    engine.update(dt);
    const duck = 1 - Math.min(0.6, Math.max(0, engine.loudness - 0.15) * engAmt * 0.8);
    n.music.gain.setTargetAtTime(duck, t, 0.2);
    n.piano.gain.setTargetAtTime(pianoAmt, t, 1.0);
    n.melody.gain.setTargetAtTime(melodyAmt, t, 1.0);
    n.rainG.gain.setTargetAtTime(rain * 0.07, t, 0.8);
  }

  function tick() {
    if (!on) return;
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    schedule();
    apply(dt);
  }

  return {
    get enabled() { return on; },
    get mood() { return mood; },
    get engineLabel() { return engine ? engine.label : ENGINES.v6th.label; },
    get engineId() { return engine ? engine.id : pendingEngine; },
    get usingRecordings() { return !!(engine && engine.recordings); },
    async enable() {
      if (!ctx) build();
      if (ctx.state !== 'running') await ctx.resume();
      on = true; last = performance.now();
      nextBeat = ctx.currentTime + 0.1;
      n.master.gain.cancelScheduledValues(ctx.currentTime);
      n.master.gain.setTargetAtTime(MASTER, ctx.currentTime, 1.2);
      clearInterval(timer); timer = setInterval(tick, 25);
      if (!ambientPlayed) setTimeout(() => { if (on && engine.playAmbient) { engine.playAmbient(); ambientPlayed = true; } }, 1500);
    },
    disable() {
      if (!ctx) return;
      on = false; clearInterval(timer);
      n.master.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      setTimeout(() => { if (!on && ctx.state === 'running') ctx.suspend(); }, 1200);
    },
    async toggle() { if (on) this.disable(); else await this.enable(); return on; },
    setVelocity(v) { vel = Math.max(-1, Math.min(1, v || 0)); },
    setRev(r) { rev = Math.max(0, Math.min(1, r || 0)); },
    setLap(s) { lap = Math.max(0, Math.min(1, s || 0)); },
    setMood(m) { if (MOODS[m]) mood = m; },
    setEngine(id) { if (!ENGINES[id]) return; pendingEngine = id; if (engine) engine.setProfile(id); },
    setEra(year) { this.setEngine(ENGINE_BY_YEAR(year)); },
  };
}

function stub() {
  return { enabled: false, mood: 'drive', engineLabel: '', engineId: '', usingRecordings: false, enable: async () => {}, disable() {}, toggle: async () => false,
    setVelocity() {}, setRev() {}, setLap() {}, setMood() {}, setEngine() {}, setEra() {}, failed: true };
}
