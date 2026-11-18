// The win reveal (Chris, 18 Nov 2026): a full-screen sequence of five cards after the last answer,
// before the dossier page. 1 the victory (confetti, top match, archetype), 2 the dark triad, 3 power and
// private life, 4 the reading, 5 your share card. Tap, swipe, Next, Back, Skip, the pips or the arrow keys.
//
// playReveal(R) resolves when the player asks for the full dossier.
// R: { reading, matches, cands, profile, scores, route, shareCfg, replay }

import { AXIS } from './axes.js?v=21123e1-1795007242';
import { portraitEl, artUrl, artVersion } from './art.js?v=21123e1-1795007242';
import { haptic, sleep, reducedMotion, typewriter, finishTyping, typingSkippedAt } from './feel.js?v=21123e1-1795007242';
import { sfx } from './sound.js?v=21123e1-1795007242';
import { renderShareSheet } from './sharesheet.js?v=21123e1-1795007242';
import { ticketEl } from './endgame-ui.js?v=21123e1-1795007242';

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (label, cls) => { const b = h('button', `btn ${cls}`); b.type = 'button'; b.append(h('span', 'btn-label', label)); return b; };

const CARDS = [
  { key: 'win', label: 'The result' },
  { key: 'triad', label: 'The dark triad' },
  { key: 'power', label: 'Power and private life' },
  { key: 'reading', label: 'Your reading' },
  { key: 'card', label: 'Your card' },
];
const TRIAD = ['mach', 'narc', 'psych'];
const POWER = ['dynasty', 'libertine', 'loyalty', 'style'];
// Backdrops: the reveal art when it has landed, otherwise a chapter backdrop that already exists.
const BACKDROP = { win: ['RV-CONFETTI', 'election_night'], triad: ['RV-TRIAD', 'scandal'], power: ['RV-DYNASTY', 'convention'], reading: [null, 'backroom'], card: ['RV-CONFETTI', 'election_night'] };

function backdropUrl(card, reading) {
  const v = artVersion();
  const [rv, ch] = BACKDROP[card];
  const id = card === 'reading' ? reading.archetype.art : rv;
  const own = id && artUrl(`${id}_${card === 'reading' ? 'tall' : v}.webp`);
  return own || `art/bg/${ch}_${v}.webp`;
}

// The archetype's card picture (AR-<ID>_tall.webp), or a drawn stand-in on the election night art.
function archetypeArt(arch, cls = '') {
  const fig = h('figure', `rv-art ${cls}`);
  const frame = h('div', 'rv-art-frame');
  fig.appendChild(frame);
  const stand = () => {
    frame.classList.add('stand-in');
    frame.replaceChildren(h('span', 'rv-art-mono', (arch.name || '?').replace(/^the\s+/i, '').charAt(0).toUpperCase()));
  };
  const url = arch.art ? artUrl(`${arch.art}_tall.webp`) : null;
  if (url) {
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.width = 1024; img.height = 1536;
    img.onerror = stand;
    img.src = url;
    frame.appendChild(img);
  } else stand();
  return fig;
}
export { archetypeArt };

// The archetype's name in the blackletter face, sized so its longest word fits its column (CSS reads --w).
export function archName(cls, name) {
  const el = h('div', cls, name);
  el.style.setProperty('--w', String(Math.max(6, ...String(name || '').split(/\s+/).map(w => w.length))));
  return el;
}

// ---- confetti: a small canvas of pixel confetti, scaled up, stopped when done -------------------------
const CONFETTI = ['#D9A441', '#F2C66D', '#A8322D', '#7A1E22', '#EFE5CC', '#ffd77a'];
function confetti(canvas, ms = 4200) {
  if (reducedMotion()) { canvas.remove(); return { stop() {} }; }
  const PX = 3; // one confetti pixel = 3 CSS pixels: chunky, and cheap to draw
  const W = Math.ceil(window.innerWidth / PX), H = Math.ceil(window.innerHeight / PX);
  canvas.width = W; canvas.height = H;
  const x = canvas.getContext('2d');
  const n = Math.max(70, Math.min(170, Math.round((W * H) / 160)));
  const parts = [];
  for (let i = 0; i < n; i++) {
    const side = i % 3; // left cannon, right cannon, a shower from the top
    const p = { c: CONFETTI[i % CONFETTI.length], w: 1 + (i % 2), h: 1 + (i % 3), ph: Math.random() * 6, spin: 6 + Math.random() * 10, delay: side === 2 ? 0.35 + Math.random() * 0.9 : Math.random() * 0.25 };
    if (side === 2) { p.x = Math.random() * W; p.y = -4 - Math.random() * H * 0.3; p.vx = (Math.random() - 0.5) * 12; p.vy = 10 + Math.random() * 20; }
    else {
      const left = side === 0;
      p.x = left ? -2 : W + 2; p.y = H * (0.72 + Math.random() * 0.2);
      const sp = H * (0.95 + Math.random() * 0.55);
      const ang = (left ? -1 : 1) * (0.25 + Math.random() * 0.5);
      p.vx = Math.sin(-ang) * sp * 0.55; p.vy = -Math.cos(ang) * sp;
    }
    parts.push(p);
  }
  const G = H * 0.9, DRAG = 1.6;
  let raf = 0, last = performance.now(), t = 0, stopped = false;
  const step = now => {
    if (stopped) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!document.hidden) t += dt;
    x.clearRect(0, 0, W, H);
    const fade = t > ms / 1000 - 0.9 ? Math.max(0, (ms / 1000 - t) / 0.9) : 1;
    x.globalAlpha = fade;
    for (const p of parts) {
      if (t < p.delay) continue;
      p.vx -= p.vx * DRAG * dt;
      p.vy += G * dt - p.vy * DRAG * 0.6 * dt;
      p.x += p.vx * dt + Math.sin(t * 3 + p.ph) * 4 * dt;
      p.y += p.vy * dt;
      if (p.y > H + 4) continue;
      const flip = Math.abs(Math.sin(t * p.spin + p.ph)); // tumbling: the piece narrows as it turns
      x.fillStyle = p.c;
      x.fillRect(Math.round(p.x), Math.round(p.y), Math.max(1, Math.round(p.w * 1.5 * flip + 0.5)), p.h);
    }
    if (t * 1000 >= ms) { stop(); return; }
    raf = requestAnimationFrame(step);
  };
  const stop = () => { stopped = true; cancelAnimationFrame(raf); canvas.remove(); };
  raf = requestAnimationFrame(step);
  return { stop };
}

// ---- a scale: name, meter, band, title, line; tap for the detail ------------------------------------
function scaleEl(s, i) {
  const ax = AXIS[s.id];
  const el = h('div', `rv-scale band-${s.band}`);
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.setAttribute('aria-expanded', 'false');
  el.dataset.scale = s.id;
  el.style.setProperty('--i', String(i));
  const head = h('div', 'rv-scale-head');
  const more = h('span', 'rv-more', '+');
  more.setAttribute('aria-hidden', 'true');
  head.append(h('span', 'rv-scale-name', s.name), h('span', `rv-band band-${s.band}`, s.word), more);
  const meter = h('div', 'rv-meter');
  meter.setAttribute('aria-hidden', 'true');
  ['low', 'below', 'mid', 'above', 'high'].forEach(b => { const seg = h('i', `seg seg-${b}`); if (b === s.band) seg.classList.add('on'); meter.appendChild(seg); });
  const needle = h('b', 'rv-needle');
  meter.appendChild(needle);
  el.style.setProperty('--pos', `${(((Math.max(-2, Math.min(2, s.value)) + 2) / 4) * 100).toFixed(1)}%`);
  const ends = h('div', 'rv-meter-ends');
  ends.append(h('span', null, ax ? ax.neg : 'Low'), h('span', null, ax ? ax.pos : 'High'));
  const detail = h('div', 'rv-scale-detail');
  detail.hidden = true;
  if (s.plain) detail.appendChild(h('p', 'rv-scale-plain', s.plain));
  if (s.detail) detail.appendChild(h('p', null, s.detail));
  el.append(head, meter, ends, h('div', 'rv-scale-title', s.title), h('p', 'rv-scale-line', s.line), detail);
  el.setAttribute('aria-label', `${s.name}: ${s.word}. ${s.title}. ${s.line}`);
  const toggle = () => {
    const open = el.getAttribute('aria-expanded') !== 'true';
    el.setAttribute('aria-expanded', String(open));
    detail.hidden = !open;
    more.textContent = open ? '−' : '+';
    haptic('select');
  };
  el.addEventListener('click', toggle);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  return el;
}

// A paragraph that types on without moving the layout: an invisible copy holds the space.
function typePara(cls, text) {
  const p = h('p', `rv-type ${cls}`);
  p.append(h('span', 'rv-ghost', text), h('span', 'rv-live'));
  p.dataset.text = text;
  p.setAttribute('aria-label', text);
  return p;
}

// ---- the sequence -------------------------------------------------------------------------------------
export function playReveal(R) {
  return new Promise(resolve => {
    const { reading, matches, cands } = R;
    const arch = reading.archetype;
    const first = matches[0];
    const c0 = cands.get(first.id) || { id: first.id, name: first.name, party: first.party };

    const root = h('div', 'reveal');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Your result');
    const bg = h('div', 'rv-bg');
    // Load every card's backdrop up front, so a card change never flashes the old picture (playtest).
    for (const c of CARDS) { const im = new Image(); im.src = new URL(backdropUrl(c.key, reading), document.baseURI).href; }
    const canvas = h('canvas', 'rv-confetti');
    canvas.setAttribute('aria-hidden', 'true');

    const top = h('header', 'rv-top');
    const pips = h('div', 'rv-pips');
    pips.setAttribute('role', 'tablist');
    pips.setAttribute('aria-label', 'Cards');
    const pipBtns = CARDS.map((c, k) => {
      const b = h('button', 'rv-pip');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-label', `Card ${k + 1} of ${CARDS.length}: ${c.label}`);
      b.appendChild(h('span', null, String(k + 1)));
      b.addEventListener('click', () => go(k));
      pips.appendChild(b);
      return b;
    });
    const stepLbl = h('div', 'rv-step');
    const skip = h('button', 'rv-skip', 'Skip to your card');
    skip.type = 'button';
    skip.addEventListener('click', () => { haptic('select'); go(CARDS.length - 1); });
    top.append(pips, stepLbl, skip);

    const view = h('div', 'rv-view');
    const nav = h('footer', 'rv-nav');
    const back = btn('Back', 'rv-back');
    const next = btn('Next', 'primary rv-next');
    back.addEventListener('click', () => go(i - 1));
    next.addEventListener('click', () => (i < CARDS.length - 1 ? go(i + 1) : done()));
    nav.append(back, next);

    root.append(bg, view, top, nav, canvas);
    document.body.appendChild(root);
    document.documentElement.classList.add('reveal-open');

    const built = [];
    const shown = new Set();
    let i = -1, fx = null, closed = false;

    // ---- the cards ----
    const builders = {
      win() {
        const c = h('section', 'rv-card rv-win');
        c.append(h('div', 'rv-eyebrow', R.replay ? 'Your result, again' : 'Your file is complete'), h('h2', 'rv-h rv-h-win', 'The results are in'));
        const match = h('div', 'rv-match');
        const meta = h('div', 'rv-match-meta');
        meta.append(h('div', 'rv-label', 'Your closest match'), h('div', 'rv-match-name', c0.name), h('div', 'rv-match-pct', first.pct < 25 ? 'under 25%' : `${first.pct}%`));
        match.append(portraitEl(c0, 'rv-portrait'), meta);
        const archBox = h('div', 'rv-arch');
        const archMeta = h('div', 'rv-arch-meta');
        const tag = h('p', 'rv-tagline');
        archMeta.append(h('div', 'rv-label', 'Your type'), archName('rv-arch-name', arch.name), tag);
        archBox.append(archetypeArt(arch), archMeta);
        c.append(match, archBox);
        c._enter = async () => {
          if (c._typed) return;
          c._typed = true;
          await sleep(reducedMotion() ? 0 : 700);
          if (closed) return;
          c.classList.add('arch-in');
          haptic('light');
          await typewriter(tag, arch.tagline, { maxMs: 1400 }).done;
        };
        return c;
      },
      triad() { return scaleCard('rv-triad', 'The dark triad', 'Three scores for how you treat people on the way up. Tap one to read more.', TRIAD); },
      power() { return scaleCard('rv-power', 'Power and private life', 'Family power, scandal, loyalty and how you fight. Tap one to read more.', POWER); },
      reading() {
        const c = h('section', 'rv-card rv-reading');
        c.append(h('h2', 'rv-h', 'Your reading'), h('p', 'rv-cap', 'What your answers say about you, beyond the scores.'));
        const body = h('div', 'rv-read');
        body.append(archName('rv-arch-name', arch.name));
        if (arch.tagline) body.append(h('p', 'rv-read-tag', arch.tagline));
        const paras = [];
        const add = (cls, text) => { const p = typePara(cls, text); paras.push(p); return p; };
        if (arch.text) body.append(add('rv-lede', arch.text));
        // Exhibits A, B, C: the player's own answers, quoted back (ENDGAME_CONTRACT section 1).
        if (R.exhibits && R.exhibits.length) {
          const g = h('div', 'rv-group rv-exhibits');
          g.append(h('h3', 'rv-sub', 'The exhibits'));
          for (const x of R.exhibits) { const f = h('div', 'rv-exhibit'); f.append(h('div', 'ex-label', x.label), add('ex-text', x.text)); g.append(f); }
          body.append(g);
        }
        const group = (title, items) => {
          if (!items.length) return;
          const g = h('div', 'rv-group');
          g.append(h('h3', 'rv-sub', title));
          for (const t of items) g.append(add('', t.text));
          body.append(g);
        };
        group('Where you contradict yourself', reading.contradictions);
        group('What your answers gave away', reading.reads);
        group('How you answered', reading.tells);
        // The ticket and the knife: running mate, betrayer, victim.
        const tk = ticketEl(R.ticketView, cands);
        if (tk) body.append(tk);
        if (reading.closer) { body.append(h('div', 'rv-rule')); body.append(add('rv-closer', reading.closer)); }
        c.append(body);
        c._enter = async () => {
          if (c._typed) return;
          c._typed = true;
          const t0 = performance.now();
          for (const p of paras) {
            const live = p.querySelector('.rv-live');
            // A tap or a move on fills in the rest at once.
            if (closed || typingSkippedAt() > t0 || i !== CARDS.findIndex(x => x.key === 'reading')) { live.textContent = p.dataset.text; p.classList.add('typed'); continue; }
            await typewriter(live, p.dataset.text, { cps: 55, maxMs: p.classList.contains('rv-lede') ? 3200 : 1800, sound: false }).done;
            p.classList.add('typed');
            if (typingSkippedAt() <= t0) await sleep(reducedMotion() ? 0 : 160);
          }
          sfx('ding');
        };
        return c;
      },
      card() {
        const c = h('section', 'rv-card rv-share');
        c.append(h('h2', 'rv-h', 'Your card'), h('p', 'rv-cap', 'Your result as a picture to share. Your full dossier has every score and your camp.'));
        const dossier = btn('Open the full dossier', 'rv-dossier');
        dossier.addEventListener('click', () => done());
        const sheet = h('div', 'rv-sheet share-block');
        c.append(sheet, dossier);
        c._enter = () => {
          if (c._sheet) return;
          c._sheet = true;
          renderShareSheet(sheet, { profile: R.profile, matches, cands, route: R.route, scores: R.scores, shareCfg: R.shareCfg, reading, link: R.link, ticket: R.ticket });
        };
        return c;
      },
    };

    function scaleCard(cls, title, cap, ids) {
      const c = h('section', `rv-card ${cls}`);
      c.append(h('h2', 'rv-h', title), h('p', 'rv-cap', cap));
      const list = h('div', 'rv-scales');
      ids.forEach((id, k) => list.appendChild(scaleEl(reading.scales[id], k)));
      c.append(list);
      c._enter = async () => {
        if (c._metersOn) return;
        c._metersOn = true;
        await sleep(reducedMotion() ? 0 : 120);
        c.classList.add('meters-on');
        if (!reducedMotion()) for (let k = 0; k < ids.length; k++) setTimeout(() => sfx('ratchet'), 260 + k * 220);
      };
      return c;
    }

    // ---- moving between cards ----
    function go(k, quiet = false) {
      if (closed) return;
      k = Math.max(0, Math.min(CARDS.length - 1, k));
      if (k === i) return;
      const dir = k > i ? 1 : -1;
      finishTyping();
      if (fx && k !== 0) { fx.stop(); fx = null; }
      if (!built[k]) built[k] = builders[CARDS[k].key]();
      const card = built[k];
      view.replaceChildren(card);
      view.scrollTop = 0;
      card.classList.remove('in-next', 'in-prev');
      if (!reducedMotion()) { void card.offsetWidth; card.classList.add(dir > 0 ? 'in-next' : 'in-prev'); }
      i = k;
      root.dataset.card = CARDS[k].key;
      bg.style.backgroundImage = `url("${new URL(backdropUrl(CARDS[k].key, reading), document.baseURI).href}")`;
      bg.classList.remove('swap'); void bg.offsetWidth; bg.classList.add('swap');
      pipBtns.forEach((b, n) => { b.setAttribute('aria-selected', String(n === k)); b.classList.toggle('seen', shown.has(n) || n === k); });
      stepLbl.textContent = `${k + 1} of ${CARDS.length} · ${CARDS[k].label}`;
      back.disabled = k === 0;
      next.querySelector('.btn-label').textContent = k === CARDS.length - 1 ? 'Full dossier' : 'Next';
      skip.hidden = k === CARDS.length - 1;
      if (!quiet) haptic('select');
      shown.add(k);
      card.querySelector('.rv-h')?.setAttribute('tabindex', '-1');
      if (!quiet) card.querySelector('.rv-h')?.focus({ preventScroll: true });
      card._enter && card._enter();
    }

    function done() {
      if (closed) return;
      closed = true;
      finishTyping();
      fx?.stop();
      window.removeEventListener('keydown', onKey);
      haptic('commit');
      root.classList.add('out');
      setTimeout(() => {
        root.remove();
        document.documentElement.classList.remove('reveal-open');
        resolve();
      }, reducedMotion() ? 0 : 220);
    }

    // ---- input: keys, swipe, tap ----
    const onKey = e => {
      if (closed || e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); i < CARDS.length - 1 ? go(i + 1) : null; }
      else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); go(i - 1); }
      else if (k === 'Home') { e.preventDefault(); go(0); }
      else if (k === 'End') { e.preventDefault(); go(CARDS.length - 1); }
      else if (k === 'Escape') { e.preventDefault(); i < CARDS.length - 1 ? go(CARDS.length - 1) : done(); }
    };
    window.addEventListener('keydown', onKey);

    let sx = 0, sy = 0, st = 0, swiped = false, tracking = false;
    view.addEventListener('pointerdown', e => {
      if (!e.isPrimary) return;
      tracking = true; swiped = false; sx = e.clientX; sy = e.clientY; st = performance.now();
    }, { passive: true });
    view.addEventListener('pointerup', e => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 56 && Math.abs(dx) > 1.6 * Math.abs(dy) && performance.now() - st < 900) {
        swiped = true;
        if (dx < 0 && i < CARDS.length - 1) go(i + 1);
        else if (dx > 0) go(i - 1);
      }
    }, { passive: true });
    view.addEventListener('pointercancel', () => { tracking = false; }, { passive: true });
    // A tap on open space moves on; taps on controls do their own thing. The last card holds still.
    view.addEventListener('click', e => {
      if (swiped) { swiped = false; return; }
      if (i >= CARDS.length - 1) return;
      if (e.target.closest('button, a, input, select, textarea, [role="button"], canvas')) return;
      if (performance.now() - typingSkippedAt() < 700) return; // that tap finished the typing
      const sel = window.getSelection?.();
      if (sel && String(sel).length) return;
      go(i + 1);
    });

    // ---- open ----
    go(0, true);
    root.querySelector('.rv-h')?.focus({ preventScroll: true });
    sfx('swell');
    haptic('heavy');
    fx = confetti(canvas);
  });
}
