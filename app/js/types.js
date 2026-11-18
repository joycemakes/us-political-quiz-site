// One interaction per question type. Each renderer builds its controls into ctx.el and resolves
// with the answer payload the scorer reads ({ ms, revisions, ...type fields }).
//
// ctx: { el, artHost, cands (Map id -> candidate), stage }

import { haptic, shake, sleep, reducedMotion } from './feel.js?v=c583357-1795003897';
import { holdStart, holdLevel, holdStop, sfx } from './sound.js?v=c583357-1795003897';
import { HOLD_TAP, rankLine } from './howto.js?v=c583357-1795003897';
import { createArtSlot, portraitEl, hasArt } from './art.js?v=c583357-1795003897';
import { HOLD_FULL_MS } from './scoring.js?v=c583357-1795003897';

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (label, cls = '') => {
  const b = h('button', `btn ${cls}`.trim());
  b.type = 'button';
  const s = h('span', 'btn-label', label);
  b.appendChild(s);
  return b;
};
const lockAll = el => el.querySelectorAll('button, .btn, [tabindex]').forEach(b => { b.disabled = true; b.setAttribute('aria-disabled', 'true'); });
// Pointer capture throws for pointers the browser no longer tracks; never let that break a control.
const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } };
export const HOLD_MIN_MS = 150;

// A short role for a who-said-it card: Governor, Kentucky; Senator, Ohio; Former Vice President.
export function shortTitle(c) {
  const t = c.title || '';
  let m = /^Governor of (.+)$/.exec(t); if (m) return `Governor, ${m[1]}`;
  m = /^U\.S\. Senator from (.+)$/.exec(t); if (m) return `Senator, ${m[1]}`;
  m = /^U\.S\. Representative, (.+?)'s/.exec(t); if (m) return `House, ${m[1]}`;
  m = /^Former Governor of (.+)$/.exec(t); if (m) return `Former governor, ${m[1]}`;
  return t.split(/[;,]/)[0].replace(/^U\.S\. /, '');
}

// A bill's title: its own `bill` field, or a short context; long set-ups stay above as context.
export function billTitle(q) {
  if (q.bill) return q.bill;
  if (q.context && q.context.length <= 60) return q.context;
  return 'On your desk';
}

// Press and hold a button to repeat its action (budget chips).
function repeatOn(b, fn) {
  let t1 = 0, t2 = 0, fired = false;
  const stop = () => { clearTimeout(t1); clearInterval(t2); };
  b.addEventListener('pointerdown', () => { fired = false; stop(); t1 = setTimeout(() => { t2 = setInterval(() => { fired = true; if (!fn()) stop(); }, 110); }, 380); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
  b.addEventListener('click', () => { if (!fired) fn(); fired = false; });
}

// Draft labels often start with the candidate's name ("Beshear: a deacon who..."); drop it.
export function stripName(label, c) {
  const m = /^([^:]{1,40}):\s*(.+)$/.exec(label || '');
  if (!m || !c) return label;
  const head = m[1].toLowerCase();
  const parts = c.name.toLowerCase().replace(/\./g, '').split(/\s+/);
  if (parts.some(p => p.length > 2 && head.includes(p))) return m[2].charAt(0).toUpperCase() + m[2].slice(1);
  return label;
}

const clock = () => { const t0 = performance.now(); return () => Math.round(performance.now() - t0); };

async function chosen(el, b, kind = 'commit') {
  b.classList.add('chosen');
  lockAll(el);
  haptic(kind);
  await sleep(reducedMotion() ? 80 : 300);
}

export const RENDERERS = {
  choice: renderChoice,
  dilemma: renderDilemma,
  envelope: renderEnvelope,
  hold: renderHold,
  slider: renderSlider,
  pin: renderPin,
  budget: renderBudget,
  rank: renderRank,
  swipe: renderSwipe,
  whosaid: renderWhosaid,
  draft: renderDraft,
  sign: renderSign,
};

export function renderAnswer(q, ctx) {
  const fn = RENDERERS[q.type];
  if (!fn) return Promise.resolve({ ms: 0 });
  ctx.el.dataset.type = q.type;
  return fn(q, ctx);
}

// ---- choice ---------------------------------------------------------------------------
function renderChoice(q, ctx) {
  return new Promise(resolve => {
    const ms = clock();
    const list = h('div', 'opts');
    for (const o of q.options) {
      const b = btn(o.label || o.id, 'opt');
      b.dataset.opt = o.id;
      b.addEventListener('click', async () => { await chosen(list, b); resolve({ optionId: o.id, ms: ms() }); });
      list.appendChild(b);
    }
    ctx.el.appendChild(list);
  });
}

// ---- dilemma: two hard options, no middle ----------------------------------------------
function renderDilemma(q, ctx) {
  return new Promise(resolve => {
    const ms = clock();
    const wrap = h('div', 'dilemma');
    q.options.slice(0, 2).forEach((o, i) => {
      if (i === 1) wrap.appendChild(h('div', 'dilemma-or', 'or'));
      const b = btn(o.label || o.id, 'opt dilemma-opt');
      b.dataset.opt = o.id;
      b.addEventListener('click', async () => { await chosen(wrap, b, 'heavy'); resolve({ optionId: o.id, ms: ms() }); });
      wrap.appendChild(b);
    });
    ctx.el.appendChild(wrap);
  });
}

// ---- envelope: scene + 3 choices, hesitation timed, the scene plays the choice out ----------
function renderEnvelope(q, ctx) {
  return new Promise(resolve => {
    const ms = clock();
    const list = h('div', 'opts envelope-opts');
    q.options.forEach((o, i) => {
      const b = btn(o.label || o.id, 'opt');
      b.dataset.opt = o.id;
      b.addEventListener('click', async () => {
        const t = ms();
        b.classList.add('chosen');
        lockAll(list);
        haptic('commit');
        haptic('rustle');
        const scene = ctx.artHost.querySelector('.art-slot') || ctx.artHost;
        scene.dataset.grade = ['warm', 'cold', 'smoke', 'warm', 'cold'][i] || 'warm';
        const cap = h('div', 'scene-caption', o.label || '');
        (scene.querySelector('.art-frame') || scene).appendChild(cap);
        // A note, file or leak plays out as the opened letter; money and offers as the sealed envelope.
        const isLetter = /\b(letter|note|memo|file|leak|dossier|photographs?|folder|statement|pledge|questionnaire|resum[eé]|resignation|complaint|folded card)\b/i.test(`${q.context || ''} ${q.prompt || ''}`);
        const env = h('div', `scene-envelope play-${i % 3}${isLetter ? ' is-letter' : ''}`);
        (scene.querySelector('.art-frame') || scene).appendChild(env);
        await sleep(reducedMotion() ? 150 : 1100);
        resolve({ optionId: o.id, ms: t });
      });
      list.appendChild(b);
    });
    ctx.el.appendChild(list);
  });
}

// ---- hold: hold to commit, hold strength measured ------------------------------------------
function renderHold(q, ctx) {
  return new Promise(resolve => {
    const ms = clock();
    const hint = ctx.how || h('p', 'hint');
    const list = h('div', 'opts');
    const meterLbl = h('div', 'hold-meter-label', 'Conviction');
    const meter = h('div', 'hold-meter');
    meter.innerHTML = '<span class="hold-meter-fill"></span>';
    let done = false;
    for (const o of q.options) {
      const b = btn(o.label || o.id, 'opt hold');
      b.dataset.opt = o.id;
      // The button says what it wants: a HOLD tag and its own fill bar.
      const tag = h('span', 'hold-tag', 'Hold');
      const bar = h('span', 'hold-bar');
      bar.appendChild(h('span', 'hold-bar-fill'));
      b.append(tag, bar);
      b.style.setProperty('--press-dur', `${HOLD_FULL_MS}ms`);
      let t0 = 0, raf = 0, ticked = false;
      const fill = meter.querySelector('.hold-meter-fill');
      const loop = () => {
        const p = Math.min(1, (performance.now() - t0) / HOLD_FULL_MS);
        fill.style.width = `${p * 100}%`;
        bar.firstChild.style.width = `${p * 100}%`;
        holdLevel(p);
        if (p >= 1 && !ticked) { ticked = true; haptic('heavy'); b.classList.add('full'); }
        raf = requestAnimationFrame(loop);
      };
      const start = e => {
        if (done || t0) return;
        if (e.pointerId != null) capture(b, e);
        t0 = performance.now(); ticked = false;
        holdStart();
        raf = requestAnimationFrame(loop);
      };
      const cancel = () => { cancelAnimationFrame(raf); holdStop(); t0 = 0; fill.style.width = '0%'; bar.firstChild.style.width = '0%'; b.classList.remove('full'); };
      const end = async () => {
        if (done || !t0) return;
        cancelAnimationFrame(raf);
        holdStop();
        const held = performance.now() - t0;
        if (held < HOLD_MIN_MS) { // a plain tap is not an answer here
          t0 = 0; fill.style.width = '0%'; bar.firstChild.style.width = '0%';
          hint.textContent = HOLD_TAP;
          hint.classList.remove('flash'); void hint.offsetWidth; hint.classList.add('flash');
          haptic('error');
          return;
        }
        const strength = Math.min(1, held / HOLD_FULL_MS);
        t0 = 0;
        done = true;
        const t = ms();
        meterLbl.textContent = strength >= 1 ? 'Full conviction' : strength < 0.25 ? 'A shrug' : strength < 0.6 ? 'Lukewarm' : 'Firm';
        await chosen(list, b, strength >= 1 ? 'heavy' : 'commit');
        await sleep(reducedMotion() ? 200 : 750); // let the verdict read
        resolve({ optionId: o.id, holdStrength: strength, ms: t });
      };
      b.addEventListener('pointerdown', start);
      b.addEventListener('pointerup', end);
      b.addEventListener('pointercancel', cancel);
      b.addEventListener('lostpointercapture', () => { if (t0 && !done) end(); });
      b.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start(e); } });
      b.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); end(); } });
      b.addEventListener('contextmenu', e => e.preventDefault());
      list.appendChild(b);
    }
    if (!ctx.how) ctx.el.append(hint);
    ctx.el.append(list, meterLbl, meter);
  });
}

// ---- slider: the brass lever ------------------------------------------------------------------
function renderSlider(q, ctx) {
  return new Promise(resolve => {
    const ms = clock();
    const s = q.slider;
    const steps = Math.max(2, s.steps || 5);
    let idx = Math.floor((steps - 1) / 2), lastRelease = idx, moves = 0, touched = false;
    const wrap = h('div', 'lever');
    const ends = h('div', 'lever-ends');
    ends.append(h('span', 'lever-left', s.left || ''), h('span', 'lever-right', s.right || ''));
    const track = h('div', 'lever-track');
    track.setAttribute('role', 'slider');
    track.tabIndex = 0;
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(steps - 1));
    track.setAttribute('aria-label', `${s.left} to ${s.right}`);
    for (let i = 0; i < steps; i++) {
      const n = h('span', 'lever-notch');
      n.style.left = `${(i / (steps - 1)) * 100}%`;
      track.appendChild(n);
    }
    const handle = h('div', 'lever-handle');
    handle.innerHTML = '<span class="lever-arrow l" aria-hidden="true"></span><span class="lever-knob"><span class="lever-grip"></span></span><span class="lever-arrow r" aria-hidden="true"></span><span class="lever-shaft"></span>';
    track.appendChild(handle);
    const readout = h('div', 'lever-readout');
    const commit = btn('Lock it in', 'primary commit');
    commit.disabled = true;
    commit.setAttribute('aria-disabled', 'true');
    const value = () => (idx / (steps - 1)) * 2 - 1;
    const describe = () => {
      const v = value();
      if (!touched) { readout.textContent = 'Not set yet. Move the lever.'; return; }
      readout.textContent = 'Your answer: ' + (Math.abs(v) < 0.01 ? (s.centre || 'Dead centre') : `${Math.abs(v) > 0.99 ? 'All the way' : 'Leaning'}: ${v < 0 ? s.left : s.right}`);
    };
    const place = () => {
      if (touched && commit.disabled) { commit.disabled = false; commit.setAttribute('aria-disabled', 'false'); }
      handle.style.left = `${(idx / (steps - 1)) * 100}%`;
      describe();
      track.setAttribute('aria-valuenow', String(idx));
      track.setAttribute('aria-valuetext', readout.textContent);
    };
    const setFromX = x => {
      const r = track.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (x - r.left) / r.width));
      const ni = Math.round(p * (steps - 1));
      if (ni !== idx) { idx = ni; haptic('ratchet'); place(); }
    };
    const release = () => { if (idx !== lastRelease) { moves++; lastRelease = idx; } };
    let dragging = false;
    track.addEventListener('pointerdown', e => { dragging = true; touched = true; capture(track, e); handle.classList.add('grab'); setFromX(e.clientX); place(); });
    track.addEventListener('pointermove', e => { if (dragging) setFromX(e.clientX); });
    const up = () => { if (!dragging) return; dragging = false; handle.classList.remove('grab'); release(); };
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
    track.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') touched = true;
      if (e.key === 'ArrowLeft' && idx > 0) { idx--; place(); release(); haptic('ratchet'); }
      if (e.key === 'ArrowRight' && idx < steps - 1) { idx++; place(); release(); haptic('ratchet'); }
    });
    commit.addEventListener('click', async () => {
      const t = ms();
      await chosen(wrap, commit, Math.abs(value()) > 0.99 ? 'heavy' : 'commit');
      resolve({ value: value(), revisions: Math.max(0, moves - 1), ms: t });
    });
    wrap.append(ends, track, readout, commit);
    ctx.el.appendChild(wrap);
    place();
  });
}

// ---- pin: tap a place on the picture --------------------------------------------------------
function renderPin(q, ctx) {
  return new Promise(resolve => {
    const ms = clock();
    let done = false, current = null, changes = 0;
    const cleanups = [];
    const esc = id => CSS.escape(id);
    const legend = h('div', 'pin-legend');
    legend.setAttribute('role', 'radiogroup');
    legend.setAttribute('aria-label', 'Spots on the picture');
    const confirm = btn('Confirm', 'primary commit pin-confirm');
    confirm.disabled = true;
    confirm.setAttribute('aria-disabled', 'true');
    let caption = null;
    const narrow = () => window.innerWidth < 900;

    // A tap (on the picture, a marker or a legend row) selects; Confirm commits.
    const select = r => {
      if (done || !r) return;
      if (current && current.id !== r.id) changes++;
      current = r;
      slot.frame.querySelectorAll('[data-region]').forEach(x => x.classList.toggle('sel', x.dataset.region === r.id));
      legend.querySelectorAll('.pin-opt').forEach(x => {
        const on = x.dataset.region === r.id;
        x.classList.toggle('sel', on);
        x.setAttribute('aria-checked', String(on));
      });
      // The chosen spot's label sits under the picture, never over it (sense check, 375 px).
      if (slot.el) {
        if (!caption) { caption = h('div', 'pin-caption'); caption.setAttribute('aria-live', 'polite'); slot.el.appendChild(caption); }
        const n = q.regions.indexOf(r) + 1;
        caption.textContent = `${n}. ${r.label || r.id}`;
      }
      confirm.disabled = false;
      confirm.setAttribute('aria-disabled', 'false');
      haptic('select');
      // Phones: Confirm follows the list instead of floating over it; bring it into view once chosen.
      if (narrow()) {
        const b = confirm.getBoundingClientRect();
        if (b.bottom > window.innerHeight - 4) confirm.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    };

    const firstHint = 'Tap a spot on the picture to choose. Each spot is a different answer.';
    const tapLine = ctx.fine ? 'Click a spot or a numbered square on the picture, or pick from the list. Then confirm.' : 'Tap a spot or a numbered square on the picture, or pick from the list. Then confirm.';
    const hint = ctx.how || h('p', 'hint pin-hint', firstHint);
    const withArt = hasArt(q.art, 'wide') || hasArt(q.art, 'tall');
    const slot = withArt
      ? createArtSlot(q.art, {
        kind: 'pin', regions: q.regions, onRegion: r => select(r), chapter: ctx.chapter,
        onTraced: t => { hint.textContent = t === '0' ? 'Choose from the list below, then confirm.' : tapLine; },
        onMiss: () => { hint.classList.remove('flash'); void hint.offsetWidth; hint.classList.add('flash'); haptic('error'); },
      })
      : { frame: document.createElement('div'), el: null };
    if (slot.el) ctx.artHost.appendChild(slot.el);
    else { ctx.artHost.hidden = true; ctx.artHost.closest('.q')?.classList.remove('has-art'); hint.textContent = 'Choose from the list below, then confirm.'; }
    if (slot.el) hint.textContent = slot.el.dataset.traced === '0' ? 'Choose from the list below, then confirm.' : tapLine;

    q.regions.forEach((r, i) => {
      const b = h('button', 'pin-opt');
      b.type = 'button';
      b.dataset.region = r.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.append(h('span', 'pin-num', String(i + 1)), h('span', 'pin-label', r.label || r.id));
      b.addEventListener('click', () => select(r));
      const hl = on => slot.frame.querySelectorAll(`[data-region="${esc(r.id)}"]`).forEach(x => x.classList.toggle('hot', on));
      b.addEventListener('pointerenter', () => hl(true));
      b.addEventListener('pointerleave', () => hl(false));
      b.addEventListener('focus', () => hl(true));
      b.addEventListener('blur', () => hl(false));
      legend.appendChild(b);
    });

    confirm.addEventListener('click', async () => {
      if (done || !current) return;
      done = true;
      const t = ms();
      slot.frame.querySelectorAll(`[data-region="${esc(current.id)}"]`).forEach(x => x.classList.add('chosen'));
      lockAll(legend);
      await chosen(ctx.el, confirm);
      for (const f of cleanups) f();
      resolve({ regionId: current.id, revisions: changes, ms: t });
    });

    // The legend sits right under the picture and the whole question fits the screen: the picture gives
    // up height until hint, legend and Confirm are all visible without scrolling.
    if (!ctx.how) ctx.el.append(hint);
    ctx.el.append(legend, confirm);
    if (slot.el) {
      const fit = () => {
        if (!slot.el.isConnected || done) { window.removeEventListener('resize', fit); return; }
        slot.el.style.removeProperty('--pin-h');
        // Phones give the picture the full width and let the page scroll (sense check: 120x180 was too small).
        if (narrow()) return;
        const over = document.documentElement.scrollHeight - window.innerHeight;
        const fh = slot.frame.getBoundingClientRect().height;
        if (over > 0 && fh > 0) slot.el.style.setProperty('--pin-h', `${Math.max(180, Math.floor(fh - over - 4))}px`);
      };
      requestAnimationFrame(fit);
      setTimeout(fit, 120);
      window.addEventListener('resize', fit);
      cleanups.push(() => window.removeEventListener('resize', fit), () => slot.destroy?.());
    }
  });
}

// ---- budget: poker chips summing to 100 ------------------------------------------------------
function renderBudget(q, ctx) {
  return new Promise(resolve => {
    const ms = clock();
    const CHIP = 10, TOTAL = 100;
    const alloc = Object.fromEntries(q.options.map(o => [o.id, 0]));
    let reachedFull = false, revisions = 0;
    const wrap = h('div', 'budget');
    const pile = h('div', 'chip-pile');
    const rows = h('div', 'budget-rows');
    const commit = btn('Lock it in', 'primary commit');
    const left = () => TOTAL - Object.values(alloc).reduce((a, b) => a + b, 0);
    const chips = n => { const s = h('div', 'chip-stack'); for (let i = 0; i < n / CHIP; i++) s.appendChild(h('span', 'chip')); return s; };
    const rowEls = {};
    const refresh = () => {
      pile.innerHTML = '';
      pile.append(h('span', 'chip-pile-label', `${left()} left`), chips(left()));
      for (const o of q.options) {
        const r = rowEls[o.id];
        r.querySelector('.budget-amt').textContent = String(alloc[o.id]);
        r.querySelector('.chip-stack')?.replaceWith(chips(alloc[o.id]));
        r.querySelector('.minus').disabled = alloc[o.id] <= 0;
        r.querySelector('.plus').disabled = left() <= 0;
      }
      // Lock it in stays pressable (it explains itself) but looks waiting until every point is placed.
      commit.classList.toggle('waiting', left() !== 0);
      commit.setAttribute('aria-disabled', String(left() !== 0));
      if (left() === 0) reachedFull = true;
    };
    for (const o of q.options) {
      const r = h('div', 'budget-row');
      r.dataset.opt = o.id;
      const lab = h('div', 'budget-label', o.label || o.id);
      const minus = btn('−', 'chipbtn minus');
      const plus = btn('+', 'chipbtn plus');
      minus.setAttribute('aria-label', `Take a chip from ${o.label}`);
      plus.setAttribute('aria-label', `Put a chip on ${o.label}`);
      const amt = h('span', 'budget-amt', '0');
      const sub = () => { if (alloc[o.id] > 0) { alloc[o.id] -= CHIP; if (reachedFull) revisions++; haptic('chip'); refresh(); return true; } return false; };
      const add = (n = CHIP) => { const k = Math.min(n, left()); if (k > 0) { alloc[o.id] += k; haptic('chip'); refresh(); return true; } return false; };
      repeatOn(minus, sub);
      repeatOn(plus, () => add());

      const ctl = h('div', 'budget-ctl');
      ctl.append(minus, amt, plus);
      r.append(lab, chips(0), ctl);
      rows.appendChild(r);
      rowEls[o.id] = r;
    }
    commit.addEventListener('click', async () => {
      if (left() !== 0) {
        const how = ctx.how || pile;
        how.textContent = `Place the last ${left()} first.`;
        how.classList.remove('again'); void how.offsetWidth; how.classList.add('again');
        haptic('error');
        return;
      }
      const t = ms();
      await chosen(wrap, commit);
      resolve({ alloc: { ...alloc }, revisions, ms: t });
    });
    wrap.append(pile, rows, commit);
    ctx.el.appendChild(wrap);
    refresh();
  });
}

// ---- rank: drag to order (pointer events, works with touch) ---------------------------------------
function renderRank(q, ctx) {
  return new Promise(resolve => {
    const ms = clock();
    const wrap = h('div', 'rank');
    const hint = ctx.how ? null : h('p', 'hint', rankLine(q));
    const list = h('ol', 'rank-list');
    const moved = {};
    const renumber = () => list.querySelectorAll('.rank-item').forEach((li, i) => { li.querySelector('.rank-n').textContent = String(i + 1); });
    const start = q.options.slice();
    for (let k = start.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [start[k], start[j]] = [start[j], start[k]]; }
    for (const o of start) {
      const li = h('li', 'rank-item btn');
      li.dataset.opt = o.id;
      li.tabIndex = 0;
      li.append(h('span', 'rank-n', ''), h('span', 'rank-label', o.label || o.id), h('span', 'rank-grip', ''));
      list.appendChild(li);
    }
    let drag = null;
    list.addEventListener('pointerdown', e => {
      const li = e.target.closest('.rank-item');
      if (!li || li.disabled || drag) return;
      e.preventDefault();
      li.focus({ preventScroll: true });
      capture(li, e);
      drag = { li, id: e.pointerId, startY: e.clientY, startTop: li.getBoundingClientRect().top, dy: 0, from: [...list.children].indexOf(li) };
      li.classList.add('dragging');
    });
    // Move and release are heard on window, so letting go above or below the list still drops.
    const onMove = e => {
      if (!drag || (drag.id != null && e.pointerId !== drag.id)) return;
      const { li } = drag;
      const y = e.clientY;
      const others = [...list.children].filter(x => x !== li);
      let idx = others.findIndex(x => { const r = x.getBoundingClientRect(); return y < r.top + r.height / 2; });
      if (idx < 0) idx = others.length; // below the list: last
      if (idx !== [...list.children].indexOf(li)) {
        list.insertBefore(li, others[idx] || null);
        capture(li, e); // moving the node drops pointer capture; take it back
        haptic('tap');
        renumber();
      }
      // Keep the item under the finger while its slot moves.
      const slotTop = li.getBoundingClientRect().top - drag.dy;
      drag.dy = drag.startTop + (y - drag.startY) - slotTop;
      li.style.transform = `translateY(${drag.dy}px)`;
    };
    const drop = e => {
      if (!drag || (e && drag.id != null && e.pointerId != null && e.pointerId !== drag.id)) return;
      const { li, from } = drag;
      li.style.transform = '';
      li.classList.remove('dragging');
      const to = [...list.children].indexOf(li);
      if (to !== from) { moved[li.dataset.opt] = (moved[li.dataset.opt] || 0) + 1; haptic('paper'); }
      li.classList.remove('is-pressed');
      drag = null;
      renumber();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', drop);
    const unhook = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', drop); window.removeEventListener('pointercancel', drop); };
    list.addEventListener('keydown', e => {
      const li = e.target.closest('.rank-item');
      if (!li) return;
      if (e.key === 'ArrowUp' && li.previousElementSibling) { list.insertBefore(li, li.previousElementSibling); li.focus(); }
      else if (e.key === 'ArrowDown' && li.nextElementSibling) { list.insertBefore(li.nextElementSibling, li); li.focus(); }
      else return;
      e.preventDefault();
      moved[li.dataset.opt] = (moved[li.dataset.opt] || 0) + 1;
      renumber();
    });
    const commit = btn('Lock in the order', 'primary commit');
    commit.addEventListener('click', async () => {
      const t = ms();
      const order = [...list.children].map(li => li.dataset.opt);
      unhook();
      await chosen(wrap, commit);
      list.querySelectorAll('.rank-item').forEach(li => li.classList.add('locked'));
      resolve({ order, revisions: Object.values(moved).filter(n => n > 1).length, ms: t });
    });
    if (hint) wrap.append(hint);
    wrap.append(list, commit);
    ctx.el.appendChild(wrap);
    renumber();
  });
}

// ---- swipe: rapid round, 4 s a card, swipe or tap ----------------------------------------------
const CARD_MS = 4000;
const GRACE_MS = 2500;
// The two ends of a speed round: per card where the data names them, else the question's, else
// Agree and Disagree.
export function swipeEnds(q, c = null) {
  const yes = c?.yesLabel || q.yesLabel || q.ends?.yes || 'Agree';
  const no = c?.noLabel || q.noLabel || q.ends?.no || 'Disagree';
  return { yes, no };
}

function renderSwipe(q, ctx) {
  return new Promise(resolve => {
    const ms = clock();
    const res = {};
    const ends = swipeEnds(q);
    const wrap = h('div', 'swipe');
    const count = h('div', 'swipe-count');
    const deck = h('div', 'swipe-deck');
    const ctl = h('div', 'swipe-ctl');
    const no = btn(ends.no, 'swipe-no');
    const yes = btn(ends.yes, 'swipe-yes');
    ctl.append(no, yes);
    wrap.append(count, deck, ctl);
    ctx.el.appendChild(wrap);
    // Cards missed on time come back once at the end before they count as no answer.
    const queue = q.cards.map(c => ({ c, retry: false }));
    let k = 0, timer = 0, shownAt = 0, card = null, busy = false, started = false;

    const label = (el, t) => { el.querySelector('.btn-label').textContent = t; };
    const next = () => {
      if (k >= queue.length) { lockAll(wrap); window.removeEventListener('keydown', onKey); resolve({ cards: res, ms: ms() }); return; }
      const { c, retry } = queue[k];
      const e = swipeEnds(q, c);
      label(yes, e.yes); label(no, e.no);
      count.textContent = retry ? 'One more try' : `${Math.min(k + 1, q.cards.length)} / ${q.cards.length}`;
      card = h('div', 'swipe-card');
      card.dataset.card = c.id;
      card.append(h('span', 'swipe-edge no', e.no), h('div', 'swipe-text', c.text || c.id), h('span', 'swipe-edge yes', e.yes), h('div', 'swipe-timer'));
      card.querySelector('.swipe-timer').style.animationDuration = `${CARD_MS}ms`;
      deck.innerHTML = '';
      deck.appendChild(card);
      shownAt = performance.now();
      busy = false;
      timer = setTimeout(() => decide(null), CARD_MS);
      attachDrag(card);
    };
    const decide = async v => {
      if (busy || !started || k >= queue.length) return;
      busy = true;
      clearTimeout(timer);
      const item = queue[k];
      res[item.c.id] = { v, ms: Math.round(performance.now() - shownAt) };
      card.classList.add(v === 'yes' ? 'out-right' : v === 'no' ? 'out-left' : 'out-down');
      haptic(v ? 'whoosh' : 'error');
      if (!v) {
        card.appendChild(h('div', 'swipe-stamp', item.retry ? 'Too slow' : 'Back at the end'));
        if (!item.retry) queue.push({ c: item.c, retry: true });
      }
      k++;
      await sleep(reducedMotion() ? 60 : v ? 220 : 520);
      next();
    };
    const attachDrag = el => {
      let x0 = null, dx = 0;
      let left = CARD_MS;
      el.addEventListener('pointerdown', e => {
        x0 = e.clientX; dx = 0; capture(el, e); el.classList.add('held');
        // The clock stops while the card is in your hand.
        clearTimeout(timer);
        left = Math.max(600, CARD_MS - (performance.now() - shownAt));
      });
      el.addEventListener('pointermove', e => {
        if (x0 == null) return;
        dx = e.clientX - x0;
        el.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
        el.dataset.lean = dx > 30 ? 'yes' : dx < -30 ? 'no' : '';
      });
      const up = () => {
        if (x0 == null) return;
        x0 = null;
        el.classList.remove('held');
        if (Math.abs(dx) > 70) decide(dx > 0 ? 'yes' : 'no');
        else { el.style.transform = ''; el.dataset.lean = ''; clearTimeout(timer); timer = setTimeout(() => decide(null), left); }
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    };
    yes.addEventListener('click', () => decide('yes'));
    no.addEventListener('click', () => decide('no'));
    const onKey = e => {
      if (!wrap.isConnected) { window.removeEventListener('keydown', onKey); return; }
      if (!started && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); begin(); return; }
      if (e.key === 'ArrowRight') decide('yes');
      if (e.key === 'ArrowLeft') decide('no');
    };
    window.addEventListener('keydown', onKey);
    // Nothing runs until Start: the card says what the two ends mean.
    const gate = h('div', 'swipe-card swipe-ready');
    gate.append(h('div', 'swipe-text', `${q.cards.length} cards, ${CARD_MS / 1000} seconds each. Right for ${ends.yes}, left for ${ends.no}.`));
    const go = btn('Start', 'primary swipe-go');
    deck.appendChild(gate);
    ctl.hidden = true;
    wrap.insertBefore(go, ctl);
    count.textContent = 'Press Start when you are ready';
    const begin = () => { if (started) return; started = true; go.remove(); ctl.hidden = false; next(); };
    go.addEventListener('click', begin);
  });
}

// ---- whosaid: who said it, then agree or disagree -------------------------------------------------
function renderWhosaid(q, ctx) {
  return new Promise(resolve => {
    const ms = clock();
    const quote = h('blockquote', 'quote-card');
    quote.append(h('span', 'quote-mark', ''), h('p', 'quote-text', q.quote || ''));
    const grid = h('div', 'whosaid-grid');
    const step2 = h('div', 'whosaid-step2');
    step2.hidden = true;
    ctx.el.append(quote, grid, step2);
    // Shuffled, names only: faces (and the set-up line) come with the reveal, so neither gives it away.
    const opts = q.options.slice();
    for (let k = opts.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [opts[k], opts[j]] = [opts[j], opts[k]]; }
    for (const o of opts) {
      const c = ctx.cands.get(o.id);
      const b = btn(o.label || c?.name || o.id, 'opt cand-chip');
      b.dataset.opt = o.id;
      if (c?.title) b.appendChild(h('span', 'cand-tag', shortTitle(c)));
      b.addEventListener('click', async () => {
        const right = o.id === q.answer;
        grid.querySelectorAll('.cand-chip').forEach(x => { const cc = ctx.cands.get(x.dataset.opt); x.prepend(portraitEl(cc || { id: x.dataset.opt, name: x.textContent }, 'sm')); });
        b.classList.add('chosen', right ? 'right' : 'wrong');
        grid.querySelector(`[data-opt="${CSS.escape(q.answer)}"]`)?.classList.add('right');
        lockAll(grid);
        haptic(right ? 'select' : 'error');
        const who = ctx.cands.get(q.answer)?.name || q.options.find(x => x.id === q.answer)?.label || q.answer;
        step2.hidden = false;
        step2.append(
          h('p', `verdict ${right ? 'right' : 'wrong'}`, right ? `Right. It was ${String(who).replace(/\.$/, '')}.` : `No. It was ${String(who).replace(/\.$/, '')}.`),
          ...(q.context ? [h('p', 'reveal-context', q.context)] : []),
          h('p', 'followup', q.followup || 'Do you agree with it?'),
        );
        const row = h('div', 'opts two');
        const a = btn(q.agree?.label || 'Agree', 'opt');
        const d = btn(q.disagree?.label || 'Disagree', 'opt');
        a.dataset.opt = 'agree'; d.dataset.opt = 'disagree';
        const finish = async (el, agree) => { const t = ms(); await chosen(row, el); resolve({ guess: o.id, agree, ms: t }); };
        a.addEventListener('click', () => finish(a, true));
        d.addEventListener('click', () => finish(d, false));
        row.append(a, d);
        step2.appendChild(row);
        requestAnimationFrame(() => row.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }));
        setTimeout(() => row.scrollIntoView?.({ block: 'nearest' }), 120);
      });
      grid.appendChild(b);
    }
  });
}

// ---- draft: portrait cards ------------------------------------------------------------------------
function renderDraft(q, ctx) {
  return new Promise(resolve => {
    const ms = clock();
    const grid = h('div', 'draft-grid');
    const n = q.options.length;
    grid.style.setProperty('--cols-phone', String(n >= 5 ? 3 : 2));
    grid.style.setProperty('--cols-desk', String(n <= 4 ? n : Math.min(4, Math.ceil(n / 2))));
    grid.dataset.n = String(n);
    for (const o of q.options) {
      const c = ctx.cands.get(o.id);
      const b = h('button', 'btn draft-card');
      b.type = 'button';
      b.dataset.opt = o.id;
      b.append(portraitEl(c || { id: o.id, name: o.label }, 'lg'));
      const cap = h('span', 'draft-cap');
      cap.append(h('span', 'draft-name', c?.name || o.id));
      if (o.label) cap.append(h('span', 'draft-note', stripName(o.label, c)));
      b.append(cap);
      b.addEventListener('click', async () => { await chosen(grid, b); resolve({ optionId: o.id, ms: ms() }); });
      grid.appendChild(b);
    }
    ctx.el.appendChild(grid);
  });
}

// ---- sign: drag the pen across the line, or stamp VETO ----------------------------------------------
function renderSign(q, ctx) {
  return new Promise(resolve => {
    const ms = clock();
    const signO = q.options.find(o => o.id === 'sign');
    const vetoO = q.options.find(o => o.id === 'veto');
    const bill = h('div', 'bill');
    bill.append(h('div', 'bill-head', 'An Act'), h('div', 'bill-title', billTitle(q)));
    const line = h('div', 'sig-line');
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'sig-ink');
    svg.setAttribute('preserveAspectRatio', 'none');
    const path = document.createElementNS(NS, 'polyline');
    svg.appendChild(path);
    const pen = h('button', 'pen');
    pen.type = 'button';
    pen.setAttribute('aria-label', 'Drag the pen across the line to sign. Enter signs.');
    line.append(h('span', 'sig-guide'), svg, h('span', 'sig-x', 'x'), pen);
    const sigCap = h('div', 'sig-cap', signO?.label || 'Sign it');
    bill.append(line, sigCap);
    const veto = btn('Hold to veto', 'veto-stamp hold');
    veto.style.setProperty('--press-dur', '700ms');
    veto.dataset.opt = 'veto';
    const vetoCap = h('div', 'veto-cap', vetoO?.label || '');
    ctx.el.append(bill, veto, vetoCap);

    let done = false, x0 = null, pts = [];
    const finish = async (id, kind) => {
      if (done) return;
      done = true;
      const t = ms();
      lockAll(ctx.el);
      haptic(kind);
      bill.classList.add(id === 'sign' ? 'signed' : 'vetoed');
      if (id === 'veto') { bill.appendChild(h('div', 'stamp', 'VETO')); shake(ctx.stage, true); }
      await sleep(reducedMotion() ? 120 : 650);
      resolve({ optionId: id, ms: t });
    };
    // A looping scribble: x keeps advancing, y swings, with small back-loops.
    const scribble = (k, x) => [x - 6 * Math.sin(k * 1.7), 52 + Math.sin(k * 0.8) * 26 + Math.sin(k * 2.9) * 10];
    let downX = 0, moved = false;
    pen.addEventListener('pointerdown', e => {
      if (done) return;
      x0 = line.getBoundingClientRect().left;
      downX = e.clientX; moved = false;
      capture(pen, e);
      const r = line.getBoundingClientRect();
      svg.setAttribute('viewBox', `0 0 ${r.width} 100`);
      pts = [[0, 60]];
      pen.classList.add('writing');
    });
    pen.addEventListener('pointermove', e => {
      if (x0 == null || done) return;
      const r = line.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      pen.style.left = `${p * 100}%`;
      svg.setAttribute('viewBox', `0 0 ${r.width} 100`);
      const x = p * r.width;
      if (Math.abs(e.clientX - downX) > 6) moved = true;
      if (!pts.length || x > pts[pts.length - 1][0] + 3) {
        pts.push(scribble(pts.length, x));
        path.setAttribute('points', pts.map(q2 => q2.join(',')).join(' '));
        haptic('pen');
      }
      if (p > 0.8) { x0 = null; pen.classList.remove('writing'); finish('sign', 'commit'); }
    });
    const up = () => {
      if (x0 == null) return;
      x0 = null;
      pen.classList.remove('writing');
      if (!done) {
        pen.style.left = '0%'; pts = []; path.setAttribute('points', '');
        if (!moved) { // a tap: show what to do
          pen.classList.remove('nudge'); void pen.offsetWidth; pen.classList.add('nudge');
          sigCap.textContent = 'Drag it along the line.';
          setTimeout(() => { if (!done) sigCap.textContent = signO?.label || 'Sign it'; }, 1600);
          sigCap.classList.remove('flash'); void sigCap.offsetWidth; sigCap.classList.add('flash');
          haptic('tap');
        }
      }
    };
    pen.addEventListener('pointerup', up);
    pen.addEventListener('pointercancel', up);
    pen.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish('sign', 'commit'); } });
    // VETO cannot be undone, so it takes a short press and hold (0.7 s), with the brass border filling.
    let v0 = 0;
    veto.addEventListener('pointerdown', () => { v0 = performance.now(); });
    veto.addEventListener('pointerup', () => {
      if (!v0) return;
      const held = performance.now() - v0;
      v0 = 0;
      if (held >= 650) finish('veto', 'stamp');
      else { vetoCap.textContent = 'Hold VETO a moment to stamp it.'; vetoCap.classList.remove('flash'); void vetoCap.offsetWidth; vetoCap.classList.add('flash'); haptic('error'); }
    });
    veto.addEventListener('pointerleave', () => { v0 = 0; });
    veto.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish('veto', 'stamp'); } });
  });
}
