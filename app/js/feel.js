// Feel: drawn pressed states, haptics, sound cues, FX tags and the typewriter.
import { sfx } from './sound.js?v=eafef2c-1794988692';

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
export { store };

export const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

// ---- haptics --------------------------------------------------------------------
// Android: navigator.vibrate. iOS 18+: clicking the label of a hidden <input type=checkbox switch>
// fires the system haptic. Both only work inside a user gesture, which is where we call them.
let hapticsOn = store.get('uspq.haptics', true);
let iosLabel = null;
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const canVibrate = () => typeof navigator.vibrate === 'function' && !isIOS() && 'ontouchstart' in window;

function ensureIOS() {
  if (iosLabel || !isIOS()) return;
  iosLabel = document.createElement('label');
  iosLabel.className = 'ios-haptic';
  iosLabel.setAttribute('aria-hidden', 'true');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  iosLabel.appendChild(input);
  document.body.appendChild(iosLabel);
}

const PATTERNS = {
  tap: [8], select: [14], light: [18], commit: [24], heavy: [40, 30, 80], fill: [10],
  shake: [30, 40, 30, 40, 60], stamp: [70], error: [20, 40, 20],
  ratchet: [6], chip: [10], paper: [16], whoosh: [12], pen: [4], rustle: [10], chime: [18],
};
const IOS_TICKS = { tap: 1, select: 1, light: 1, commit: 1, heavy: 3, fill: 1, shake: 3, stamp: 2, error: 2, ratchet: 1, chip: 1, paper: 1, whoosh: 1, rustle: 1, chime: 1 };
// The sound each kind of feedback makes (sound has its own toggle; see sound.js).
const SOUND_OF = {
  tap: 'tick', select: 'tick', commit: 'clunk', heavy: 'thunk', stamp: 'stamp', error: 'buzz', light: 'chime', chime: 'chime',
  shake: 'rumble', ratchet: 'ratchet', chip: 'chip', paper: 'paper', whoosh: 'whoosh', pen: 'pen', rustle: 'rustle',
};

export function haptic(kind = 'tap') {
  if (SOUND_OF[kind]) sfx(SOUND_OF[kind]);
  if (!hapticsOn) return;
  if (kind === 'pen') return; // the pen scratches by sound only
  try {
    if (canVibrate()) {
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
      navigator.vibrate(PATTERNS[kind] || PATTERNS.tap);
    } else if (isIOS()) {
      ensureIOS();
      const n = IOS_TICKS[kind] || 1;
      for (let i = 0; i < n; i++) setTimeout(() => iosLabel && iosLabel.click(), i * 70);
    }
  } catch { /* never let haptics break a tap */ }
}
export function setHaptics(on) { hapticsOn = !!on; store.set('uspq.haptics', hapticsOn); if (on) haptic('select'); }
export function getHaptics() { return hapticsOn; }

// ---- pressed state ----------------------------------------------------------------
// Every .btn gets .is-pressed while a pointer or key holds it. The CSS draws the brass border
// filling (via the --fill custom property) plus the pushed-in bevel and inner glow.
export function installPress(root = document) {
  const release = () => document.querySelectorAll('.btn.is-pressed').forEach(b => b.classList.remove('is-pressed'));
  root.addEventListener('pointerdown', e => {
    const b = e.target.closest('.btn');
    if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return;
    b.classList.add('is-pressed');
    haptic(b.classList.contains('hold') ? 'fill' : 'tap');
  }, { passive: true });
  for (const ev of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(ev, release, { passive: true });
  root.addEventListener('pointerleave', e => { if (e.target.classList?.contains('btn')) e.target.classList.remove('is-pressed'); }, true);
  root.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('btn') && !e.repeat) e.target.classList.add('is-pressed');
  });
  root.addEventListener('keyup', e => { if (e.target.classList?.contains('btn')) e.target.classList.remove('is-pressed'); });
}

// ---- FX tags --------------------------------------------------------------------------
export function shake(el, strong = false) {
  if (reducedMotion() || !el) return;
  el.classList.remove('fx-shake', 'fx-shake-strong');
  void el.offsetWidth;
  el.classList.add(strong ? 'fx-shake-strong' : 'fx-shake');
  setTimeout(() => el.classList.remove('fx-shake', 'fx-shake-strong'), 650);
}

// Applies a question's fx list. Returns a promise that resolves when intro FX are done.
export function runFx(q, { stage, banner }) {
  const fx = new Set(q.fx || []);
  stage.classList.toggle('fx-night', fx.has('night'));
  stage.classList.toggle('fx-candles', fx.has('candles'));
  let wait = Promise.resolve();
  if (fx.has('breaking')) {
    banner.hidden = false;
    const raw = (q.headline || q.context || '').replace(/^\s*breaking\s*[:\u2014-]\s*/i, '').trim();
    const norm = x => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    // No filler: with no headline, or one that just repeats the prompt, the banner is the tag alone.
    const text = raw && norm(raw) !== norm(q.prompt || '') ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
    const el = banner.querySelector('.breaking-text');
    el.hidden = !text;
    typewriter(el, text, { maxMs: 1400 });
    banner.classList.remove('in');
    void banner.offsetWidth;
    banner.classList.add('in');
    wait = new Promise(r => setTimeout(r, reducedMotion() ? 200 : 900));
  } else {
    banner.hidden = true;
  }
  if (fx.has('breaking')) sfx('sting');
  if (fx.has('shake')) setTimeout(() => { shake(stage, true); sfx('rumble'); }, fx.has('breaking') ? 350 : 0);
  if (fx.has('buzz_heavy')) haptic('heavy');
  else if (fx.has('buzz_light')) haptic('light');
  return wait;
}

// ---- typewriter ----------------------------------------------------------------------
// Text appears letter by letter with a soft typewriter tick (spaces silent) and a small carriage-return
// ding at the end. About 40 characters a second, faster for long text (never much over two seconds).
// Progress follows the clock, not the timer count, so a throttled tab still finishes on time.
// A tap on the text or anywhere on the screen finishes every line being typed at once.
const typing = new Set();
let skippedAt = -1e9;
export function finishTyping() { for (const f of [...typing]) f(); }
export const isTyping = () => typing.size > 0;
// When a tap last cut typing short (so the same tap does not also count as a move on).
export const typingSkippedAt = () => skippedAt;
if (typeof window !== 'undefined') window.addEventListener('pointerdown', () => { if (typing.size) skippedAt = performance.now(); finishTyping(); }, true);

export function typewriter(el, text, { cps = 40, maxMs = 2200, sound = true } = {}) {
  el.textContent = '';
  if (!text) return { done: Promise.resolve(), skip() {} };
  if (reducedMotion()) { el.textContent = text; if (sound) sfx('type'); return { done: Promise.resolve(), skip() {} }; }
  const rate = Math.max(cps, (text.length * 1000) / maxMs);
  let shown = 0, raf = 0, to = 0, resolve, over = false;
  const done = new Promise(r => (resolve = r));
  const caret = document.createElement('span');
  caret.className = 'caret';
  const node = document.createTextNode('');
  el.append(node, caret);
  const t0 = performance.now();
  const finish = () => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf); clearTimeout(to);
    typing.delete(finish);
    node.data = text;
    caret.remove();
    el.removeEventListener('pointerdown', finish);
    if (sound) sfx('ding');
    resolve();
  };
  // One text write per animation frame. A timer backs the frame up, so text still finishes when the
  // browser stops painting (a hidden or covered window gives no frames).
  const schedule = () => { raf = requestAnimationFrame(step); to = setTimeout(step, 120); };
  const step = () => {
    cancelAnimationFrame(raf); clearTimeout(to);
    if (over) return;
    const n = Math.min(text.length, Math.floor(((performance.now() - t0) * rate) / 1000));
    if (n > shown) {
      const added = text.slice(shown, n);
      shown = n;
      node.data = text.slice(0, n);
      if (sound && /\S/.test(added)) sfx('type');
    }
    if (shown >= text.length) { finish(); return; }
    schedule();
  };
  schedule();
  typing.add(finish);
  el.addEventListener('pointerdown', finish);
  return { done, skip: finish };
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
