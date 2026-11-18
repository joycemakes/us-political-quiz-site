// Versus (ENDGAME_CONTRACT section 4): two files side by side. Both types and their pictures, the dark
// triad both ways, the two best-fitting versus lines from endgame.json, and both tickets.

import { AXIS_IDS } from './axes.js?v=13556fa-1795008148';
import { archetypeArt, archName } from './reveal.js?v=13556fa-1795008148';
import { ticketEl } from './endgame-ui.js?v=13556fa-1795008148';
import { pickVersus } from './endgame.js?v=13556fa-1795008148';
import { bandWord, bandOf } from './reading.js?v=13556fa-1795008148';
import { haptic } from './feel.js?v=13556fa-1795008148';

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (label, cls) => { const b = h('button', `btn ${cls}`); b.type = 'button'; b.append(h('span', 'btn-label', label)); return b; };

// Their ticket's lines speak to them in the second person; this says so (live playtest: beside Your
// ticket they read as the viewer's).
export const THEIRS_CAP = 'Read to them, not to you: each line speaks to the other file.';

// The versus-condition view of one file: axis values, archetype, first match, route.
export function versusSide(rb) {
  return {
    axes: Object.fromEntries(AXIS_IDS.map(a => [a, rb.scores[a]?.value || 0])),
    archetype: rb.reading.archetype.id, archetypeName: rb.reading.archetype.name,
    top: rb.matches[0]?.id || null, route: rb.route,
  };
}

// A: your file, B: theirs; each { rb (rebuilt dossier), ticketView, file }.
export function renderVersus(root, A, B, { endgame, cands, onTheirs, onMine }) {
  root.innerHTML = '';
  const screen = h('div', 'results versus');
  root.appendChild(screen);
  const head = h('header', 'res-head');
  head.append(h('div', 'wordmark sm', 'US Political Quiz'), h('div', 'eyebrow', 'Versus · two files side by side'));
  const t = h('h2', 'vs-title', 'Your file against theirs');
  t.tabIndex = -1;
  head.append(t);
  screen.appendChild(head);

  // ---- the two types ----
  const pair = h('section', 'res-block vs-pair');
  pair.setAttribute('aria-label', 'The two types');
  // Both names on one scale (the longer of the two sets it) and every row lined up across the columns
  // (live playtest at 375: The Collaborator shrank to one small line while The Coward ran huge).
  const longest = Math.max(6, ...[A, B].flatMap(s => String(s.rb.reading.archetype.name || '').split(/\s+/).map(w => w.length)));
  for (const [who, side] of [['You', A], ['Them', B]]) {
    const a = side.rb.reading.archetype;
    const col = h('div', 'vs-col');
    const m = side.rb.matches[0];
    const name = archName('vs-name', a.name);
    name.style.setProperty('--w', String(longest));
    col.append(h('div', 'vs-who', who), archetypeArt(a, 'vs-art'), name, h('p', 'vs-tag', a.tagline || ''),
      h('p', 'vs-match', m ? `Closest match: ${cands.get(m.id)?.name || m.id}, ${m.pct < 25 ? 'under 25' : m.pct}%` : ''),
      h('p', 'vs-file', side.file ? `File No. ${side.file}` : ''));
    pair.append(col);
  }
  screen.appendChild(pair);

  // ---- the versus lines ----
  const lines = pickVersus(endgame?.versus || [], versusSide(A.rb), versusSide(B.rb));
  if (lines.length) {
    const sec = h('section', 'res-block vs-lines');
    sec.append(h('h3', 'res-h', 'The verdict on the two of you'));
    for (const l of lines) sec.append(h('p', 'vs-line', l.text));
    screen.appendChild(sec);
  }

  // ---- the dark triad, both ways ----
  const tri = h('section', 'res-block vs-triad');
  tri.append(h('h3', 'res-h', 'The dark triad, both ways'), h('p', 'res-cap', 'Scheming, self-regard and coldness. The left bar is yours, the right bar is theirs.'));
  for (const [id, name] of [['mach', 'Machiavellianism'], ['narc', 'Narcissism'], ['psych', 'Psychopathy']]) {
    const row = h('div', 'vs-scale');
    row.append(h('div', 'vs-scale-name', name));
    const bars = h('div', 'vs-bars');
    for (const [who, side] of [['You', A], ['Them', B]]) {
      const v = side.rb.scores[id]?.value || 0;
      const band = bandOf(v);
      const cell = h('div', 'vs-bar');
      const track = h('div', 'vs-track');
      const fill = h('span', 'vs-needle');
      fill.style.left = `${(((Math.max(-2, Math.min(2, v)) + 2) / 4) * 100).toFixed(1)}%`;
      track.append(fill);
      track.setAttribute('aria-hidden', 'true');
      cell.append(h('div', 'vs-bar-who', who), track, h('span', `rv-band band-${band}`, bandWord(id, band)));
      cell.setAttribute('aria-label', `${who}: ${name} ${bandWord(id, band)}`);
      bars.append(cell);
    }
    row.append(bars);
    tri.append(row);
  }
  screen.appendChild(tri);

  // ---- both tickets ----
  const tk = h('section', 'res-block vs-tickets');
  tk.append(h('h3', 'res-h', 'Both tickets'));
  const yours = ticketEl(A.ticketView, cands, { title: 'Your ticket', cap: '' });
  const theirs = ticketEl(B.ticketView, cands, { title: 'Their ticket', cap: THEIRS_CAP, their: true });
  if (yours) tk.append(yours);
  if (theirs) tk.append(theirs);
  screen.appendChild(tk);

  const nav = h('div', 'vs-nav');
  const b1 = btn('Back to their file', 'vs-theirs');
  b1.addEventListener('click', () => { haptic('select'); onTheirs(); });
  const b2 = btn('Your dossier', 'primary vs-mine');
  b2.addEventListener('click', () => { haptic('select'); onMine(); });
  nav.append(b1, b2);
  screen.append(nav, h('p', 'fineprint', 'Both files are read from their codes. Answers stay private; only the results are compared.'));
  window.scrollTo({ top: 0 });
  t.focus({ preventScroll: true });
}
