// Small retro sound effects, synthesized with WebAudio (no files): brass, wood, typewriter, candle and
// old wireless. Restrained by design: a modest master volume through a soft compressor.
// The AudioContext starts on the first user gesture. On/off lives in localStorage under uspq.sound.

const KEY = 'uspq.sound';
const MASTER = 0.42;
let on = true;
try { const v = localStorage.getItem(KEY); if (v !== null) on = JSON.parse(v) !== false; } catch { /* default on */ }
let ctx = null, master = null, noiseBuf = null;
const last = {};

const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

function ensure() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try {
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = on ? MASTER : 0;
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; }
  return ctx;
}

// Start (or resume) on the first gesture: browsers only allow audio after one.
if (typeof window !== 'undefined') {
  const wake = () => { ensure(); window.removeEventListener('pointerdown', wake, true); window.removeEventListener('keydown', wake, true); };
  window.addEventListener('pointerdown', wake, true);
  window.addEventListener('keydown', wake, true);
}

export function getSound() { return on; }
export function setSound(v) {
  on = !!v;
  try { localStorage.setItem(KEY, JSON.stringify(on)); } catch { /* private mode */ }
  if (master) master.gain.setTargetAtTime(on ? MASTER : 0, ctx.currentTime, 0.02);
  if (on) { ensure(); sfx('tick'); }
}

// ---- building blocks ------------------------------------------------------------------------------
function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function tone(type, f0, f1, t, a, d, peak, filter = null) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + a + d);
  env(g, t, a, peak, d);
  let node = o;
  if (filter) { const f = ctx.createBiquadFilter(); f.type = filter.type; f.frequency.value = filter.f; f.Q.value = filter.q || 0.7; o.connect(f); node = f; }
  node.connect(g); g.connect(master);
  o.start(t); o.stop(t + a + d + 0.05);
}
function noise(t, dur, peak, type, f0, f1 = f0, q = 1, a = 0.004) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; s.loop = true;
  f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, a, peak, dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t, Math.random() * 0.5); s.stop(t + a + dur + 0.05);
}

const SOUNDS = {
  tick: t => noise(t, 0.025, 0.12, 'highpass', 3800, 3800, 0.7),                                  // button press
  clunk: t => { tone('sine', 150, 70, t, 0.004, 0.14, 0.5); noise(t, 0.05, 0.12, 'lowpass', 900); }, // commit
  thunk: t => { tone('sine', 110, 50, t, 0.004, 0.22, 0.65); noise(t, 0.08, 0.2, 'lowpass', 600); }, // full hold, heavy commit
  type: t => {                                                                                     // typewriter key, varied
    const f = 2300 + Math.random() * 1400;
    noise(t, 0.014, 0.075, 'bandpass', f, f * 0.9, 3.5);
    tone('square', 900 + Math.random() * 300, 600, t, 0.001, 0.012, 0.012, { type: 'bandpass', f: 1200, q: 2 });
  },
  ding: t => { tone('sine', 2093, 2093, t, 0.002, 0.28, 0.035); tone('sine', 3136, 3136, t, 0.002, 0.18, 0.015); }, // carriage return
  ratchet: t => { tone('square', 1700, 1200, t, 0.001, 0.018, 0.06, { type: 'bandpass', f: 1500, q: 4 }); noise(t, 0.015, 0.08, 'highpass', 2500); },
  chip: t => { tone('triangle', 3100, 2600, t, 0.001, 0.035, 0.09); tone('triangle', 3900, 3400, t + 0.028, 0.001, 0.03, 0.06); },
  paper: t => noise(t, 0.18, 0.16, 'lowpass', 2200, 450, 0.8, 0.02),                              // rank drop
  whoosh: t => noise(t, 0.22, 0.18, 'bandpass', 600, 2600, 1.6, 0.04),                           // swipe
  stamp: t => { tone('sine', 90, 45, t, 0.002, 0.3, 0.8); noise(t, 0.12, 0.3, 'lowpass', 500); },
  pen: t => noise(t, 0.05, 0.05, 'bandpass', 2600 + Math.random() * 800, 2400, 5),               // pen scratch
  rustle: t => { for (let k = 0; k < 4; k++) noise(t + k * 0.06, 0.07, 0.08, 'bandpass', 1100 + k * 300, 900, 1.2, 0.01); },
  sting: t => {                                                                                    // old-wireless news sting
    const f = { type: 'lowpass', f: 2200, q: 1 };
    tone('square', 659, 659, t, 0.005, 0.09, 0.07, f);
    tone('square', 523, 523, t + 0.11, 0.005, 0.09, 0.07, f);
    tone('square', 784, 784, t + 0.22, 0.005, 0.28, 0.08, f);
    noise(t, 0.5, 0.02, 'bandpass', 3000, 3000, 0.5);
  },
  rumble: t => { if (!reduced()) noise(t, 0.6, 0.35, 'lowpass', 140, 70, 0.8, 0.03); },
  chime: t => { tone('sine', 880, 880, t, 0.005, 1.1, 0.12); tone('sine', 1320, 1320, t + 0.09, 0.005, 1.2, 0.07); },
  buzz: t => tone('sawtooth', 120, 110, t, 0.005, 0.09, 0.05, { type: 'lowpass', f: 600 }),      // wrong, too slow
  swell: t => {                                                                                    // result reveal
    for (const [f, p] of [[110, 0.07], [165, 0.05], [220, 0.05], [330, 0.03]]) {
      const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.setValueAtTime(200, t); fl.frequency.exponentialRampToValueAtTime(1800, t + 1.6);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(p, t + 1.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      o.connect(fl); fl.connect(g); g.connect(master); o.start(t); o.stop(t + 3);
    }
  },
};
const THROTTLE = { type: 38, ding: 120, pen: 70, ratchet: 30, tick: 25, chip: 40 };
// Scheduled sounds by name, for tests and debugging (window.__quizSound).
export const stats = { scheduled: {}, skipped: 0 };
if (typeof window !== 'undefined') window.__quizSound = { stats, state: () => (ctx ? ctx.state : 'none'), on: () => on };

export function sfx(name) {
  if (!on || !SOUNDS[name]) return;
  if (!ensure() || ctx.state !== 'running') { stats.skipped++; return; }
  const now = performance.now();
  if (THROTTLE[name] && now - (last[name] || 0) < THROTTLE[name]) return;
  last[name] = now;
  try { SOUNDS[name](ctx.currentTime + 0.002); stats.scheduled[name] = (stats.scheduled[name] || 0) + 1; } catch { /* never let sound break a tap */ }
}

// ---- the brass hum while a hold answer is pressed -----------------------------------------------------
let hum = null;
export function holdStart() {
  if (!on || !ensure() || ctx.state !== 'running' || hum) return;
  const t = ctx.currentTime;
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  o1.type = 'sawtooth'; o2.type = 'square';
  o1.frequency.value = 98; o2.frequency.value = 98 * 1.5;
  f.type = 'lowpass'; f.frequency.value = 400; f.Q.value = 2;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.08);
  o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
  o1.start(t); o2.start(t);
  hum = { o1, o2, f, g };
}
export function holdLevel(p) {
  if (!hum) return;
  const t = ctx.currentTime, k = Math.max(0, Math.min(1, p));
  hum.o1.frequency.setTargetAtTime(98 + 60 * k, t, 0.05);
  hum.o2.frequency.setTargetAtTime((98 + 60 * k) * 1.5, t, 0.05);
  hum.f.frequency.setTargetAtTime(400 + 1400 * k, t, 0.05);
  hum.g.gain.setTargetAtTime(0.06 + 0.06 * k, t, 0.05);
}
export function holdStop() {
  if (!hum) return;
  const t = ctx.currentTime, h = hum;
  hum = null;
  h.g.gain.cancelScheduledValues(t);
  h.g.gain.setTargetAtTime(0.0001, t, 0.03);
  h.o1.stop(t + 0.2); h.o2.stop(t + 0.2);
}
