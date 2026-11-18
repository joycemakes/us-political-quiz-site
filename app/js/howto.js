// How to answer: a plain instruction line for every question type, a short animated demo the first
// time a type appears in a run, and a gentle nudge when a player does nothing for a while.

export const HOW = {
  choice: 'Tap your answer.',
  dilemma: 'Pick one. There is no middle.',
  hold: 'Press and hold your answer. The longer you hold, the stronger you mean it: about a second and a half is full.',
  slider: 'Drag the lever to where you stand, then lock it in.',
  budget: 'Split your 100 points, 10 at a time. Tap + and − on each line, then lock it in.',
  rank: 'Drag the cards into the order the question asks. The top card is first.',
  swipe: 'Press Start, then swipe right for yes, left for no, or use the buttons. Four seconds a card.',
  whosaid: 'First guess who said it. Then say if you agree.',
  draft: 'Tap the person you would pick.',
  sign: 'Drag the pen across the line to sign, or hold VETO to veto.',
  envelope: 'Choose what you do.',
  pin: 'Tap a spot on the picture. Each spot is a different answer. Then confirm.',
};
// The line for this question: the data's own line when it has one, ends for speed rounds and units for
// budgets, Click and the keys on desktop.
export function howFor(q, { fine = false, ends = null } = {}) {
  if (q.line || q.how) return q.line || q.how;
  let t = HOW[q.type] || 'Tap your answer.';
  if (q.type === 'swipe' && ends) t = `Press Start, then swipe right for ${ends.yes}, left for ${ends.no}, or use the buttons. Four seconds a card.`;
  if (q.type === 'budget' && q.unit) t = t.replace('points', q.unit);
  if (q.type === 'rank') t = rankLine(q);
  if (fine) {
    t = t.replace(/\bTap\b/g, 'Click').replace(/\btap\b/g, 'click').replace(/^Press and hold/, 'Click and hold').replace(/swipe right for/, 'drag right for');
    const keys = { slider: ' Or use the arrow keys.', rank: ' Or use the arrow keys on a card.', swipe: ' Arrow keys work too.', sign: ' Or press Enter on the pen.' }[q.type];
    if (keys) t += keys;
  }
  return t;
}

export const HOLD_TAP = 'Keep holding. Release when the bar fills as far as you mean it.';
export const IDLE_MS = 6000;
export const CUE_MS = 2200;

// The control a demo points at and an idle nudge pulses, and the gesture it acts out.
const TARGET = {
  choice: ['.q-answer .opt', 'tap'],
  dilemma: ['.q-answer .opt', 'tap'],
  envelope: ['.q-answer .opt', 'tap'],
  hold: ['.q-answer .opt.hold', 'hold'],
  slider: ['.lever-handle', 'drag-x'],
  budget: ['.budget .plus', 'tap'],
  rank: ['.rank-item', 'drag-y'],
  swipe: ['.swipe-go, .swipe-card', 'swipe'],
  whosaid: ['.whosaid-grid .opt', 'tap'],
  draft: ['.draft-card', 'tap'],
  sign: ['.pen', 'drag-x'],
  pin: ['.art-frame:not(.no-taps) .pin-marker, .pin-opt', 'tap'],
};

export function controlFor(type, root) {
  const t = TARGET[type];
  return t ? root.querySelector(t[0]) : null;
}

const HAND = '<svg viewBox="0 0 12 14" width="36" height="42" aria-hidden="true" shape-rendering="crispEdges">'
  + '<path fill="#060405" d="M3 0h2v1h1v4h4v1h1v1h1v5h-1v1h-1v1H3v-1H2v-1H1V9H0V7h1v1h1V1h1z"/>'
  + '<path fill="#EFE5CC" d="M3 1h2v5h1V5h1v1h1V6h1v1h1v1h1v4h-1v1H4v-1H3v-1H2V9H1V8h1v1h1z"/>'
  + '<path fill="#D9A441" d="M4 12h6v1H4z"/></svg>';

// A pixel hand acting out the gesture on the control, about two seconds; any tap skips it.
export function showCue(type, root) {
  const t = TARGET[type];
  const el = controlFor(type, root);
  if (!t || !el) return () => {};
  const r = el.getBoundingClientRect();
  if (!r.width) return () => {};
  const cue = document.createElement('div');
  cue.className = `demo-cue cue-${t[1]}`;
  cue.innerHTML = `<span class="demo-ring"></span><span class="demo-hand">${HAND}</span>`;
  cue.style.left = `${Math.round(r.left + Math.min(r.width * 0.5, 120))}px`;
  cue.style.top = `${Math.round(r.top + r.height * 0.55)}px`;
  document.body.appendChild(cue);
  el.classList.add('demo-target');
  let gone = false;
  const stop = () => {
    if (gone) return;
    gone = true;
    cue.remove();
    el.classList.remove('demo-target');
    window.removeEventListener('pointerdown', stop, true);
    window.removeEventListener('scroll', stop, true);
    window.removeEventListener('keydown', stop, true);
  };
  window.addEventListener('pointerdown', stop, true);
  window.addEventListener('scroll', stop, true);
  window.addEventListener('keydown', stop, true);
  setTimeout(stop, CUE_MS);
  return stop;
}

// After IDLE_MS without a touch or key on this question, pulse the control and repeat the instruction;
// again every IDLE_MS while the player stays idle.
export function watchIdle(type, wrap, howEl) {
  let timer = 0, stopped = false;
  const fire = () => {
    if (stopped || !wrap.isConnected) return;
    const el = controlFor(type, wrap);
    if (el) { el.classList.remove('idle-pulse'); void el.offsetWidth; el.classList.add('idle-pulse'); }
    if (howEl) { howEl.classList.remove('again'); void howEl.offsetWidth; howEl.classList.add('again'); }
    timer = setTimeout(fire, IDLE_MS);
  };
  const reset = () => { clearTimeout(timer); if (!stopped) timer = setTimeout(fire, IDLE_MS); };
  wrap.addEventListener('pointerdown', reset, true);
  wrap.addEventListener('keydown', reset, true);
  reset();
  return () => { stopped = true; clearTimeout(timer); };
}

// Rank: what goes on top, in the question's own words (sense check: prompts say worst first while the old
// line said most important at the top). An optional rankHint in the data wins.
export function rankLine(q) {
  if (q.rankHint) return q.rankHint;
  const p = String(q.prompt || '');
  let top = null;
  let m = /\b(?:from\s+)?(most[\w\s]*?)\s+to\s+least\b/i.exec(p);
  if (m) top = m[1].trim();
  // Otherwise the last phrase before first / at the top / on top that is not the Rank instruction itself.
  if (!top) for (const x of p.matchAll(/(?:^|[,.;:]\s*)([^,.;:]{2,60}?)\s+(?:goes\s+)?(?:first|at the top|on top)\b/gi)) {
    const t = x[1].trim();
    if (!/^(rank|order)\b/i.test(t)) top = t;
  }
  if (top) top = top.replace(/^(the one|one)\s/i, m => m.toLowerCase()).replace(/^[A-Z](?![A-Z])/, c => c.toLowerCase());
  return top ? `Drag the cards into order: ${top} at the top.` : 'Drag the cards into the order the question asks. The top card is first.';
}
