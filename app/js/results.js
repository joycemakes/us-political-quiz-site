// The result screen (the full dossier): ghost reveal, the personality reading, top five, your camp, ideology gauges, temperament,
// dynasty and libertine dials, three words and your tells, and the share sheet.

import { AXES, AXIS } from './axes.js?v=055793d-1794987752';
import { reasonFor } from './scoring.js?v=055793d-1794987752';
import { portraitEl } from './art.js?v=055793d-1794987752';
import { silhouetteEl } from './hud.js?v=055793d-1794987752';
import { haptic, sleep, reducedMotion, typewriter } from './feel.js?v=055793d-1794987752';
import { sfx } from './sound.js?v=055793d-1794987752';
import { renderShareSheet } from './sharesheet.js?v=055793d-1794987752';
import { normalizeShareConfig } from './share.js?v=055793d-1794987752';
import { archetypeArt, archName } from './reveal.js?v=055793d-1794987752';

// The words on a dossier someone shared (the only quiz-specific copy for shared links).
export const SHARED_COPY = {
  banner: "Someone's 2028 dossier. Their answers stay private; this is what they add up to.",
  cta: 'Take the quiz yourself',
};

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const section = (title, cls = '') => {
  const s = h('section', `res-block ${cls}`);
  s.appendChild(h('h3', 'res-h', title));
  return s;
};
const partyName = p => (p === 'dem' ? 'Democrat' : p === 'gop' ? 'Republican' : '');
const word = v => (v >= 1.2 ? 'High' : v >= 0.4 ? 'Above average' : v > -0.4 ? 'Middling' : v > -1.2 ? 'Below average' : 'Low');

function gauge(ax, value, conf) {
  const row = h('div', 'gauge');
  if (!(conf > 0)) row.classList.add('no-evidence');
  const pct = ((value + 2) / 4) * 100;
  row.innerHTML = `<div class="gauge-ends"><span>${ax.neg}</span><span>${ax.pos}</span></div>
    <div class="gauge-track"><span class="gauge-mid"></span><span class="gauge-needle" style="left:${pct}%"></span></div>`;
  row.setAttribute('aria-label', `${ax.neg} to ${ax.pos}: ${value.toFixed(1)}`);
  return row;
}

function dial(label, value, sub) {
  const el = h('div', 'dial');
  const ang = (value / 2) * 90; // -2..2 -> -90..90 degrees
  el.innerHTML = `<svg viewBox="0 0 100 60" aria-hidden="true">
      <path class="dial-arc" d="M10 55 A40 40 0 0 1 90 55"/>
      ${[-90, -45, 0, 45, 90].map(a => `<line class="dial-tick" x1="50" y1="15" x2="50" y2="21" transform="rotate(${a} 50 55)"/>`).join('')}
      <g class="dial-needle" style="transform: rotate(${ang}deg)"><line x1="50" y1="55" x2="50" y2="20"/></g>
      <rect class="dial-hub" x="46" y="51" width="8" height="8"/>
    </svg>`;
  el.append(h('div', 'dial-label', label), h('div', 'dial-sub', sub || word(value)));
  el.setAttribute('aria-label', `${label}: ${sub || word(value)}`);
  return el;
}

// A shared dossier is someone else's file: its headings say their, not your (playtest of shared links).
let SHARED_VIEW = false;
const Y = t => (SHARED_VIEW ? t.replace(/\bYour\b/g, 'Their').replace(/\byour\b/g, 'their').replace(/\byou chose\b/g, 'they chose').replace(/\bseats you\b/g, 'seats them') : t);

export function renderResults(root, R) {
  SHARED_VIEW = !!R.shared;
  const { profile, matches, scores, cands, camps, route, length, signals } = R;
  root.innerHTML = '';
  const screen = h('div', 'results');
  root.appendChild(screen);

  const head = h('header', 'res-head');
  head.append(h('div', 'wordmark sm', 'US Political Quiz'), h('div', 'eyebrow', `The 2028 Race · ${partyName(route)} route · ${length} questions`));
  if (R.shared) {
    const ban = h('div', 'shared-banner');
    ban.setAttribute('role', 'note');
    const go = h('button', 'btn primary shared-go');
    go.type = 'button';
    go.append(h('span', 'btn-label', SHARED_COPY.cta));
    go.addEventListener('click', () => { haptic('commit'); R.onAgain && R.onAgain(); });
    ban.append(h('p', 'shared-text', SHARED_COPY.banner), go);
    screen.appendChild(ban);
  }
  if (R.dossier) head.appendChild(fileBlock(R.dossier));
  screen.appendChild(head);

  // ---- ghost reveal ----
  const pod = h('div', 'podium');
  matches.slice(0, 3).forEach((m, i) => {
    const c = cands.get(m.id);
    const slot = h('div', `pod pod-${i + 1}`);
    const card = h('div', 'pod-card');
    const sil = h('div', 'pod-sil');
    sil.appendChild(silhouetteEl(m.id, 'pod-sil-img', '#D9A441'));
    card.append(sil, portraitEl(c, 'pod-portrait'));
    slot.append(card, h('div', 'pod-rank', String(i + 1)), h('div', 'pod-name', c.name), h('div', 'pod-pct', `${m.pct}%`));
    pod.appendChild(slot);
  });
  screen.appendChild(pod);
  (async () => {
    await sleep(reducedMotion() ? 50 : 500);
    sfx('swell');
    for (const p of pod.querySelectorAll('.pod')) { p.classList.add('revealed'); haptic('select'); await sleep(reducedMotion() ? 0 : 260); }
  })();

  // ---- the personality reading ----
  if (R.reading) screen.appendChild(readingBlock(R.reading, R.onReplay));

  // ---- top five ----
  const top = section(Y('Your top five'), 'top-block');
  top.appendChild(h('p', 'res-cap', 'The five of the 23 candidates whose answers sit closest to yours.'));
  const ol = h('ol', 'top5');
  const campShort = id => (camps || []).find(l => l.id === id)?.short || '';
  const usedPhrases = new Set();
  matches.slice(0, 5).forEach((m, i) => {
    const c = cands.get(m.id);
    const li = h('li', 'top5-row');
    li.dataset.cand = m.id;
    const meta = h('div', 'top5-meta');
    const name = h('div', 'top5-name');
    name.append(h('span', 'top5-rank', `${i + 1}`), document.createTextNode(c.name));
    const tags = h('div', 'top5-tags');
    tags.append(h('span', `tag party-${c.party}`, partyName(c.party)));
    if (c.camp) tags.append(h('span', 'tag lane', campShort(c.camp) || c.camp));
    const reason = h('p', 'top5-reason');
    const reasonText = reasonFor(scores, c, m.picks, usedPhrases);
    reason.dataset.text = reasonText;
    meta.append(name, h('div', 'top5-title', c.title || ''), tags, reason);
    const pct = h('div', 'top5-pct');
    // Below 25 the number means only far away, so say that instead of printing 8%.
    if (m.pct < 25) { pct.classList.add('low'); pct.append(h('span', 'pct-low', 'under 25%')); }
    else pct.append(h('span', 'pct-n', `${m.pct}`), h('span', 'pct-s', '%'));
    li.append(portraitEl(c, 'md'), meta, pct);
    ol.appendChild(li);
  });
  top.appendChild(ol);
  screen.appendChild(top);
  // The verdicts type on, one after another, after the reveal.
  (async () => {
    await sleep(reducedMotion() ? 0 : 1400);
    for (const r of ol.querySelectorAll('.top5-reason')) await typewriter(r, r.dataset.text, { maxMs: 900 }).done;
  })();

  // ---- camp ----
  if (profile.camp) {
    const camp = section(Y('Your camp'), 'lane-block');
    const big = h('div', 'lane-big');
    big.append(h('span', 'lane-short', profile.camp.short), h('span', 'lane-name', profile.camp.name), h('span', 'lane-pct', `${profile.camp.pct}% fit`));
    camp.appendChild(big);
    if (profile.camp.blurb) camp.appendChild(h('p', 'lane-note', profile.camp.blurb));
    const otherParty = matches[0] && cands.get(matches[0].id)?.party !== route;
    if (profile.campAlt) {
      camp.appendChild(h('p', 'lane-note', Y(`Your answers sit closer to the other party: ${profile.campAlt.name}, ${profile.campAlt.pct}% fit. The camp above is the nearest one in the primary you chose.`)));
    } else if (otherParty) {
      camp.appendChild(h('p', 'lane-note', Y('Your closest match runs in the other primary. The camp above is the nearest one in the primary you chose.')));
    }
    const peers = [...cands.values()].filter(c => c.camp === profile.camp.id).map(c => c.name);
    if (peers.length) camp.appendChild(h('p', 'lane-note', `Also in this camp: ${peers.join(', ')}.`));
    screen.appendChild(camp);
  }

  // ---- ideology gauges ----
  const ideo = section('Ideology');
  ideo.appendChild(h('p', 'res-cap', 'Where you sit on each fight, left pole to right pole. Faded rows had too few questions to say.'));
  const g = h('div', 'gauges');
  for (const ax of AXES.filter(a => a.group === 'ideology' || a.group === 'style')) g.appendChild(gauge(ax, scores[ax.id].value, scores[ax.id].conf));
  ideo.appendChild(g);
  screen.appendChild(ideo);

  // ---- temperament ----
  const tem = section('Temperament');
  tem.appendChild(h('p', 'res-cap', 'The dark triad: scheming, self-regard and coldness. Middling is normal.'));
  const trio = h('div', 'dials trio');
  trio.append(dial('Machiavellianism', scores.mach.value), dial('Narcissism', scores.narc.value), dial('Psychopathy', scores.psych.value));
  tem.appendChild(trio);
  screen.appendChild(tem);

  // ---- power: dynasty and libertine ----
  const pow = section('Power and private life');
  pow.appendChild(h('p', 'res-cap', 'How you feel about family power, and how scandal-proof you play it.'));
  const duo = h('div', 'dials duo');
  duo.append(
    dial('Dynasty', scores.dynasty.value, scores.dynasty.value >= 0.4 ? 'Family power is fine' : scores.dynasty.value <= -0.4 ? 'Meritocrat' : 'Undecided'),
    dial('Libertine', scores.libertine.value, scores.libertine.value >= 0.4 ? 'Scandal-proof' : scores.libertine.value <= -0.4 ? 'Puritan' : 'Discreet'),
  );
  pow.appendChild(duo);
  screen.appendChild(pow);

  // ---- three words and your tells ----
  const sheet = section('In three words');
  const tr = h('div', 'traits');
  for (const t of profile.traits) tr.appendChild(h('span', 'trait', t));
  const fl = h('dl', 'flags');
  const f = profile.flags;
  const add = (k, v) => { fl.append(h('dt', null, k), h('dd', null, v)); };
  add('Family power', f.dynasty ? 'Built for a dynasty' : 'No dynasty in you');
  if (f.faithProfessed) add('Faith', `Professed ${f.faithProfessed}, privately ${f.faithPrivate}`);
  const tells = [];
  if (signals.hesitations) tells.push(`${signals.hesitations} slow answer${signals.hesitations > 1 ? 's' : ''} on loyalty and envelopes`);
  if (signals.holdStrengths.length) tells.push(`average hold ${Math.round((signals.holdStrengths.reduce((a, b) => a + b, 0) / signals.holdStrengths.length) * 100)}%`);
  if (signals.swipes) tells.push(`${signals.fastSwipes} of ${signals.swipes} swipes under a second and a half`);
  if (tells.length) add('Tells', tells.join('; '));
  sheet.append(tr, fl);
  screen.appendChild(sheet);

  // ---- share ----
  const share = section('Share your result', 'share-block');
  renderShareSheet(share, { profile, matches, cands, route, scores, shareCfg: R.shareCfg || normalizeShareConfig(null), reading: R.reading, link: R.dossier?.link });
  screen.appendChild(share);

  const again = h('button', `btn again${R.shared ? ' primary' : ''}`, R.shared ? SHARED_COPY.cta : 'Play again');
  again.type = 'button';
  again.addEventListener('click', () => R.onAgain && R.onAgain());
  screen.append(again, h('p', 'fineprint', 'Real officeholders appear only in their portraits. Everything else is simulated fiction. Match percentages are editorial estimates, not claims.'));
  return { shown: true };
}

// The reading near the top of the dossier: archetype, contradictions, all ten scales with their bands
// (tap one for the detail), what the answers gave away, the tells and the closer.
function readingBlock(reading, onReplay) {
  const sec = section(Y('Your reading'), 'reading-block');
  sec.appendChild(h('p', 'res-cap', 'Who your answers say you are: your type, ten scores in plain words, and where you contradict yourself.'));
  const a = reading.archetype;
  const head = h('div', 'rd-head');
  const meta = h('div', 'rd-meta');
  meta.append(h('div', 'rd-label', Y('Your type')), archName('rd-name', a.name));
  if (a.tagline) meta.append(h('p', 'rd-tag', a.tagline));
  if (onReplay) {
    const rp = h('button', 'btn rd-replay');
    rp.type = 'button';
    rp.append(h('span', 'btn-label', 'Replay the reveal'));
    rp.addEventListener('click', () => { haptic('commit'); onReplay(); });
    meta.append(rp);
  }
  head.append(archetypeArt(a, 'rd-art'), meta);
  const left = h('div', 'rd-col'), right = h('div', 'rd-col');
  left.appendChild(head);
  const text = h('div', 'rd-text');
  if (a.text) text.appendChild(h('p', 'rd-lede', a.text));
  const group = (title, items) => {
    if (!items.length) return;
    text.appendChild(h('h4', 'rd-sub', title));
    for (const t of items) text.appendChild(h('p', null, t.text));
  };
  group('Where you contradict yourself', reading.contradictions);
  group('What your answers gave away', reading.reads);
  group('How you answered', reading.tells);
  left.appendChild(text);

  const list = h('div', 'rd-scales');
  for (const s of Object.values(reading.scales)) {
    const d = h('details', `rd-scale band-${s.band}`);
    d.dataset.scale = s.id;
    const sum = h('summary');
    sum.append(h('span', 'rd-scale-name', s.name), h('span', `rv-band band-${s.band}`, s.word), h('span', 'rd-scale-title', s.title));
    const pos = (((Math.max(-2, Math.min(2, s.value)) + 2) / 4) * 100).toFixed(1);
    const bar = h('div', 'rd-bar');
    bar.innerHTML = `<span class="rd-bar-needle" style="left:${pos}%"></span>`;
    bar.setAttribute('aria-hidden', 'true');
    const ax = AXIS[s.id];
    const ends = h('div', 'gauge-ends');
    ends.append(h('span', null, ax ? ax.neg : 'Low'), h('span', null, ax ? ax.pos : 'High'));
    d.append(sum, bar, ends, h('p', 'rd-line', s.line));
    if (s.detail) d.append(h('p', 'rd-detail', s.detail));
    if (s.plain) d.append(h('p', 'rd-plain', s.plain));
    list.appendChild(d);
  }
  right.append(h('h4', 'rd-sub', Y('Your ten scores')), h('p', 'rd-hint', 'Tap a score for what it means.'), list);
  sec.append(left, right);
  if (reading.closer) sec.appendChild(h('p', 'rd-closer', reading.closer));
  return sec;
}

// The top of every dossier: a short file number, the full code in small type, Copy link and Share.
function fileBlock(d) {
  const box = h('div', 'file-block');
  const row = h('div', 'file-row');
  row.append(h('span', 'file-no', `File No. ${d.file}`));
  const status = h('span', 'file-status');
  status.setAttribute('role', 'status');
  const say = (t, ok = true) => { status.textContent = t; haptic(ok ? 'commit' : 'error'); setTimeout(() => { if (status.textContent === t) status.textContent = ''; }, 2400); };
  const copy = h('button', 'btn file-btn', 'Copy link');
  copy.type = 'button';
  copy.addEventListener('click', async () => say((await copyText(d.link)) ? 'Link copied.' : 'Could not copy. Select the code below.', true));
  const share = h('button', 'btn file-btn', 'Share');
  share.type = 'button';
  share.addEventListener('click', async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'A 2028 dossier', url: d.link }); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    document.querySelector('.results .share-block')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  });
  row.append(copy, share);
  const code = h('output', 'file-code', d.code);
  code.setAttribute('aria-label', 'Dossier code');
  box.append(row, code, status);
  return box;
}
