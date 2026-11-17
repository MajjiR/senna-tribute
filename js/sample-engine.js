// Engine player built on real recordings (CC BY-SA 3.0, Goodwood Festival of Speed, by Edvvc — see footer).
// Same interface as the synthesised engine in engine-audio.js, so audio.js can use either:
//   setProfile(id) · setThrottle(0..1) · setMaster(0..1) · update(dt) · loudness · id · label
// How it plays: the loudest stretch of each recording is looped with overlapping crossfaded grains;
// playback rate and gain follow the throttle. A sudden burst of throttle replays the full
// "pulling away from the start" clip once, and era changes crossfade between engines.

import { ENGINES } from './engine-audio.js';

// Era profile → recording
export const RECORDING_FOR = { i4t: 'i4t', v6t: 'v6t', v6th: 'v6t', v10: 'v10', v10r: 'v10', v12: 'v12', v8: 'v8' };

// Recordings that also ship as local files in assets/audio/<id>.m4a (none yet).
const LOCAL_COPIES = [];

// Original recordings on Wikimedia Commons — all by Edvvc, Goodwood Festival of Speed, CC BY-SA 3.0.
const UP = 'https://upload.wikimedia.org/wikipedia/commons/';
export const COMMONS = {
  i4t: UP + 'b/b2/Toleman-Hart_TG183B_%281983%29.ogg',
  v6t: UP + '5/52/McLaren-Honda_MP4_4_%281988%29_driven_by_Bruno_Senna.ogg',
  v10: UP + 'c/cd/Williams-Renault_FW18_%281996%29.ogg',
  v12: UP + '7/7a/Alfa_Romeo_182_%281982%29.ogg',
  v8: UP + '5/5b/Benetton-Ford_B192_%281992%29.ogg',
  ambient: UP + '0/0c/F1-start-echoing-in-the-grounds-of-Goodwood-House.ogg',
};
export const RECORDING_CREDITS = [
  ['McLaren-Honda MP4/4 (1988), driven by Bruno Senna', 'McLaren-Honda_MP4_4_(1988)_driven_by_Bruno_Senna.ogg'],
  ['Toleman-Hart TG183B (1983)', 'Toleman-Hart_TG183B_(1983).ogg'],
  ['Williams-Renault FW18 (1996)', 'Williams-Renault_FW18_(1996).ogg'],
  ['Alfa Romeo 182 (1982)', 'Alfa_Romeo_182_(1982).ogg'],
  ['Benetton-Ford B192 (1992)', 'Benetton-Ford_B192_(1992).ogg'],
  ['F1 start echoing around Goodwood House (2009)', 'F1-start-echoing-in-the-grounds-of-Goodwood-House.ogg'],
];

export async function createSampleEngine(ctx, out, base = 'assets/audio/') {
  const ids = ['i4t', 'v6t', 'v10', 'v12', 'v8', 'ambient'];
  const buffers = {};
  // Prefer a local copy (assets/audio/<id>.m4a) if one has been added; otherwise stream the original
  // recording from Wikimedia Commons, which allows embedding with attribution (credits in the footer).
  const tryLoad = async (url) => {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) throw new Error(r.status);
    return ctx.decodeAudioData(await r.arrayBuffer());
  };
  await Promise.all(ids.map(async (id) => {
    // Local copies are optional; list them in LOCAL_COPIES to prefer them (avoids 404 probes otherwise).
    for (const url of [LOCAL_COPIES.includes(id) && `${base}${id}.m4a`, COMMONS[id]].filter(Boolean)) {
      try { buffers[id] = await tryLoad(url); return; } catch (e) { /* next source */ }
    }
  }));
  if (!['i4t', 'v6t', 'v10', 'v12', 'v8'].some((k) => buffers[k])) return null;

  const loops = {};
  for (const id of Object.keys(buffers)) loops[id] = findLoop(buffers[id]);

  const bus = ctx.createGain(); bus.gain.value = 0;
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 9000; tone.Q.value = 0.3;
  tone.connect(bus).connect(out);

  // One voice per recording; only the active one (and one fading out) are audible.
  const voices = {};
  for (const id of ['i4t', 'v6t', 'v10', 'v12', 'v8']) {
    if (!buffers[id]) continue;
    const g = ctx.createGain(); g.gain.value = 0; g.connect(tone);
    voices[id] = { g, next: 0, live: [] };
  }

  let profile = 'v6th', rec = pickRec('v6th');
  let throttle = 0, smooth = 0, master = 0, level = 0, burstCool = 0, lastT = 0, running = false;

  function pickRec(p) {
    const want = RECORDING_FOR[p];
    if (voices[want]) return want;
    return Object.keys(voices)[0];
  }

  // Overlapping grains from the loop window keep the sound continuous at any playback rate.
  const GRAIN = 0.9, XF = 0.3;
  function spawn(id, when, rate) {
    const v = voices[id], L = loops[id], buf = buffers[id];
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    const env = ctx.createGain(); env.gain.value = 0;
    src.connect(env).connect(v.g);
    const span = Math.max(0.05, L.end - L.start - GRAIN);
    const offset = L.start + Math.random() * span;
    const dur = GRAIN / rate;
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(1, when + XF / rate);
    env.gain.setValueAtTime(1, when + dur - XF / rate);
    env.gain.linearRampToValueAtTime(0, when + dur);
    src.start(when, offset, GRAIN);
    v.live.push(src);
    src.onended = () => { v.live = v.live.filter((s) => s !== src); };
    return when + dur - XF / rate; // next grain overlaps the tail of this one
  }

  function burst(id) {
    const buf = buffers[id];
    if (!buf) return;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    src.connect(g).connect(tone);
    const t = ctx.currentTime, len = Math.min(buf.duration, 7);
    g.gain.exponentialRampToValueAtTime(0.9 * master, t + 0.08);
    g.gain.setValueAtTime(0.9 * master, t + len - 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.start(t, 0, len);
  }

  return {
    get id() { return profile; },
    get label() { return (ENGINES[profile] || ENGINES.v6th).label; },
    get loudness() { return level; },
    get recordings() { return Object.keys(buffers); },
    setProfile(p) {
      if (!ENGINES[p] || p === profile) return;
      profile = p;
      const next = pickRec(p);
      if (next !== rec) rec = next;
    },
    setThrottle(t) { throttle = Math.max(0, Math.min(1, t)); },
    setMaster(m) { master = Math.max(0, Math.min(1, m)); },
    playAmbient() {
      if (!buffers.ambient) return;
      const src = ctx.createBufferSource(); src.buffer = buffers.ambient;
      const g = ctx.createGain(); g.gain.value = 0.35; src.connect(g).connect(out); src.start();
    },
    update(dt) {
      const t = ctx.currentTime;
      if (!running) { running = true; for (const id in voices) voices[id].next = t + 0.05; }
      const rise = throttle > smooth ? 2.8 : 1.6;
      const jump = throttle - smooth;
      smooth += (throttle - smooth) * Math.min(1, dt * rise);
      burstCool -= dt;
      if (jump > 0.5 && burstCool <= 0 && master > 0.2) { burst(rec); burstCool = 6; }

      const rate = 0.72 + smooth * 0.62;          // revs: pitch rises with speed
      level = smooth;
      tone.frequency.setTargetAtTime(3500 + smooth * 9000, t, 0.1);
      // silent at rest: the recording only comes in while you scroll or drive
      const audible = smooth > 0.03 ? Math.min(1, (smooth - 0.03) * 1.6) : 0;
      bus.gain.setTargetAtTime(master * audible * 0.55, t, smooth > 0.03 ? 0.08 : 0.5);

      for (const id in voices) {
        const v = voices[id], active = id === rec;
        v.g.gain.setTargetAtTime(active ? 1 : 0, t, active ? 0.35 : 0.5);
        for (const s of v.live) s.playbackRate.setTargetAtTime(rate, t, 0.08);
        // keep grains scheduled only for audible voices
        if (active || v.g.gain.value > 0.01) {
          while (v.next < t + 0.25) v.next = spawn(id, Math.max(v.next, t), rate);
        } else {
          v.next = t;
        }
      }
      lastT = t;
    },
  };
}

// Pick the loudest ~2.4 s window (steady high revs) as the loop region.
function findLoop(buf) {
  const ch = buf.getChannelData(0), sr = buf.sampleRate, win = Math.floor(sr * 0.1);
  const rms = [];
  for (let i = 0; i + win < ch.length; i += win) {
    let s = 0; for (let j = i; j < i + win; j++) s += ch[j] * ch[j];
    rms.push(Math.sqrt(s / win));
  }
  const span = Math.min(rms.length, 24); // 2.4 s
  let best = 0, bestI = 0, acc = 0;
  for (let i = 0; i < rms.length; i++) {
    acc += rms[i]; if (i >= span) acc -= rms[i - span];
    if (i >= span - 1 && acc > best) { best = acc; bestI = i - span + 1; }
  }
  const start = (bestI * win) / sr, end = Math.min(buf.duration, start + span * 0.1);
  return { start, end: Math.max(end, start + 1.0) };
}
