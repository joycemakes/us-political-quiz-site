// Exhibits and the ticket, as blocks for the reveal, the dossier and the versus view.

import { portraitEl } from './art.js?v=13556fa-1795008148';

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// Exhibit A, B, C: the player's own choices, quoted back. [{ label, text }]
export function exhibitsEl(exhibits, { title = 'The exhibits', cap = 'Your own answers, read back to you.' } = {}) {
  if (!exhibits || !exhibits.length) return null;
  const box = h('div', 'exhibits');
  box.append(h('h4', 'ex-title', title));
  if (cap) box.append(h('p', 'ex-cap', cap));
  for (const x of exhibits) {
    const row = h('figure', 'exhibit');
    row.append(h('figcaption', 'ex-label', x.label), h('blockquote', 'ex-text', x.text));
    box.append(row);
  }
  return box;
}

// The ticket: running mate, knife and mark, each with a portrait, the role and the line.
// view: endgame.js ticketView(). their: the third-person intro for a shared file.
export function ticketEl(view, cands, { title = 'The ticket', cap = 'Who runs with you, who turns on you, and who you destroy.', their = false } = {}) {
  if (!view || !view.length) return null;
  const box = h('div', `ticket${their ? ' their' : ''}`);
  box.append(h('h4', 'ticket-title', title));
  if (cap) box.append(h('p', 'ticket-cap', cap));
  const list = h('div', 'ticket-list');
  for (const t of view) {
    const row = h('div', `ticket-row role-${t.role}`);
    row.dataset.role = t.role;
    row.dataset.cand = t.id;
    const meta = h('div', 'ticket-meta');
    const intro = their ? t.intro.replace(/^Your\b/, 'Their') : t.intro;
    meta.append(h('div', 'ticket-role', intro), h('div', 'ticket-name', t.name));
    if (t.line) meta.append(h('p', 'ticket-line', t.line));
    row.append(portraitEl(cands.get(t.id) || { id: t.id, name: t.name, party: t.party }, 'ticket-portrait'), meta);
    list.append(row);
  }
  box.append(list);
  return box;
}
