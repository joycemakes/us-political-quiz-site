// The endgame (research/ENDGAME_CONTRACT.md): receipts and exhibits, the ticket (running mate, knife,
// mark), versus lines, and the hand-off text. Pure, no DOM, so node can test it.

import { AXES, AXIS_IDS } from './axes.js?v=c75380f-1795191132';
import { parseCond } from './reading.js?v=c75380f-1795191132';

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const clampW = w => Math.max(1, Math.min(3, Math.round(Number(w) || 1)));

// ---- receipts ---------------------------------------------------------------------------------------------
// Every receipt a question can fire, keyed by the option it belongs to: option and region ids, L / R for
// slider ends, <card>:y / <card>:n for swipe cards. [{ key, text, weight }]
export function receiptsOf(q) {
  const out = [];
  const add = (key, text, weight) => { if (typeof text === 'string' && text.trim()) out.push({ key: String(key), text: text.trim(), weight: clampW(weight) }); };
  switch (q.type) {
    case 'whosaid': break;
    case 'slider': {
      const s = q.slider || {};
      add('L', s.receiptLeft ?? q.receiptLeft, s.receiptWeightLeft ?? q.receiptWeightLeft);
      add('R', s.receiptRight ?? q.receiptRight, s.receiptWeightRight ?? q.receiptWeightRight);
      break;
    }
    case 'swipe': for (const c of q.cards || []) { add(`${c.id}:y`, c.receiptYes, c.receiptWeightYes); add(`${c.id}:n`, c.receiptNo, c.receiptWeightNo); } break;
    case 'pin': for (const r of q.regions || []) add(r.id, r.receipt, r.receiptWeight); break;
    default: for (const o of q.options || []) add(o.id, o.receipt, o.receiptWeight);
  }
  return out;
}

// The receipts an answer fired: chosen options (choice, dilemma, hold, envelope, sign, draft, pin), a slider
// at |pos| >= 0.5, each swipe card's side, a budget line with 50 or more of 100, a rank's first place.
export function firedReceipts(q, a = {}) {
  const all = receiptsOf(q);
  if (!all.length) return [];
  const by = new Map(all.map(r => [r.key, r]));
  const keys = [];
  switch (q.type) {
    case 'slider': { const v = Number(a.value) || 0; if (v <= -0.5) keys.push('L'); if (v >= 0.5) keys.push('R'); break; }
    case 'swipe': for (const c of q.cards || []) { const r = a.cards?.[c.id]; if (r && (r.v === 'yes' || r.v === 'no')) keys.push(`${c.id}:${r.v === 'yes' ? 'y' : 'n'}`); } break;
    case 'budget': {
      const alloc = a.alloc || {};
      const total = Object.values(alloc).reduce((t, v) => t + (Number(v) || 0), 0) || 100;
      for (const o of q.options || []) if ((Number(alloc[o.id]) || 0) / total >= 0.5) keys.push(o.id);
      break;
    }
    case 'rank': if (a.order && a.order.length) keys.push(a.order[0]); break;
    case 'pin': if (a.regionId) keys.push(a.regionId); break;
    case 'whosaid': break;
    default: if (a.optionId) keys.push(a.optionId);
  }
  return keys.map(k => by.get(String(k))).filter(Boolean);
}

// Exhibits A, B, C: the three heaviest receipts; ties go to the later answer.
export function pickExhibits(receipts = [], n = 3) {
  return receipts.slice().sort((x, y) => y.weight - x.weight || y.order - x.order).slice(0, n)
    .map((r, i) => ({ ...r, label: `Exhibit ${'ABC'[i] || i + 1}` }));
}

// A short hash of question id plus option key, for carrying exhibits in a dossier link.
export function receiptHash(qid, key, bits = 20) {
  let h = 0x811c9dc5;
  const s = `${qid}|${key}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % (2 ** bits);
}
// Hash -> receipt, over the whole bank. Two receipts that share a hash are dropped (never the wrong text).
export function receiptIndex(bank = [], bits = 20) {
  const map = new Map(), clash = new Set();
  for (const q of bank) for (const r of receiptsOf(q)) {
    const k = receiptHash(q.id, r.key, bits);
    if (map.has(k)) clash.add(k);
    else map.set(k, { qid: q.id, key: r.key, text: r.text, weight: r.weight });
  }
  for (const k of clash) map.delete(k);
  return map;
}

// ---- the ticket: running mate, knife, mark -------------------------------------------------------------
const IDEO = AXES.filter(a => a.group === 'ideology').map(a => a.id);
const val = (scores, a) => { const s = scores?.[a]; return typeof s === 'number' ? s : s?.value || 0; };
const dist = (scores, c, axes) => Math.sqrt(axes.reduce((t, a) => t + (val(scores, a) - (c.axes?.[a] || 0)) ** 2, 0) / axes.length);
const byScore = (list, f) => list.map(c => ({ c, s: f(c) })).sort((x, y) => y.s - x.s || (x.c.id < y.c.id ? -1 : 1));

export const KNIFE_W = { scheme: 0.9, close: 1.8, clash: 0.6, jitter: 1.2 };
// A stable 0..1 number from the player's axes (to 0.05) and a candidate id: the same file, the same knife.
function jitter(scores, id) {
  let x = 0x811c9dc5;
  const s = AXIS_IDS.map(a => Math.round(val(scores, a) * 20)).join(',') + '|' + id;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return x / 4294967296;
}

// matches: the player's match list, best first (the whole list for a fresh run; for an old link, the top
// five then everyone else by axis distance). Returns { mate, knife, mark } as candidate ids.
// - mate: in the top 6 and of your route's party, the best complement: closest on ideology, furthest on
//   style and narcissism. Your first match is passed over when anyone else qualifies (you are them).
// - knife: in the top 10, not the mate or your first match; scheming, closeness, clash and a stable jitter (below).
// - mark: of your route's party, the furthest from you (last in your list), not the mate or the knife.
export function pickTicket({ matches, scores, route, candidates }) {
  const byId = new Map(candidates.map(c => [c.id, c]));
  const list = matches.map(m => byId.get(m.id)).filter(Boolean);
  const own = c => c.party === route;
  const fit = c => -2 * dist(scores, c, IDEO) + Math.abs(val(scores, 'style') - (c.axes.style || 0)) + 0.6 * Math.abs(val(scores, 'narc') - (c.axes.narc || 0));
  let pool = list.slice(0, 6).filter(own);
  if (pool.length > 1) pool = pool.filter(c => c.id !== list[0].id);
  if (!pool.length) pool = list.filter(own).slice(0, 3);
  const mate = byScore(pool, fit)[0]?.c || list[0];
  // The knife (retuned 18 Nov 2026: the plain highest schemer was the same 6 people in 92 runs):
  // someone in your top 10, not the mate and not your first match, scored on how much they scheme
  // compared with the rest of your top 10, how close they stand to you (higher in your list), a pull
  // toward a style or narcissism that clashes with yours, and a stable jitter from your own axes.
  let kpool = list.slice(0, 10).map((c, i) => ({ c, i })).filter(x => x.c.id !== mate.id);
  if (kpool.length > 1) kpool = kpool.filter(x => x.i > 0);
  const scheme = c => (c.axes.mach || 0) - (c.axes.loyalty || 0);
  const sorted = kpool.map(x => scheme(x.c)).sort((a, b) => a - b);
  const pctl = c => (kpool.length > 1 ? sorted.indexOf(scheme(c)) / (kpool.length - 1) : 1);
  const clash = c => (Math.abs(val(scores, 'style') - (c.axes.style || 0)) + Math.abs(val(scores, 'narc') - (c.axes.narc || 0))) / 4;
  const knifeScore = ({ c, i }) => KNIFE_W.scheme * pctl(c) + KNIFE_W.close * (1 - i / 9) + KNIFE_W.clash * clash(c) + KNIFE_W.jitter * jitter(scores, c.id);
  const knife = kpool.map(x => ({ x, s: knifeScore(x) })).sort((a, b) => b.s - a.s || (a.x.c.id < b.x.c.id ? -1 : 1))[0]?.x.c;
  const marks = list.filter(c => own(c) && c.id !== mate.id && c.id !== knife?.id);
  const mark = marks[marks.length - 1] || list[list.length - 1];
  return { mate: mate.id, knife: knife?.id || null, mark: mark?.id || null };
}

// For a link without its own ticket: the top five, then everyone else by distance on all axes.
export function matchListFromAxes(top, scores, candidates) {
  const seen = new Set(top.map(m => m.id));
  const rest = candidates.filter(c => !seen.has(c.id))
    .map(c => ({ id: c.id, d: dist(scores, c, AXIS_IDS) }))
    .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
  return top.map(m => ({ id: m.id })).concat(rest);
}

// The ticket with its lines from endgame.json; a missing line falls back to the role's intro alone.
export function ticketView(ticket, endgame, cands) {
  const intro = { mate: 'Your running mate', knife: 'The knife', mark: 'The mark', ...(endgame?.ticket?.intro || {}) };
  return ['mate', 'knife', 'mark'].filter(role => ticket?.[role]).map(role => {
    const id = ticket[role];
    const c = cands.get ? cands.get(id) : cands[id];
    return { role, id, name: c?.name || id, party: c?.party, intro: intro[role], line: endgame?.ticket?.lines?.[id]?.[role] || '' };
  });
}

// ---- versus ------------------------------------------------------------------------------------------------
// Keys: a:<axis> (you), b:<axis> (them), d:<axis> (you minus them), same:archetype, same:top, same:route,
// top:<candidateId> (either file's first match). Values use the reading's condition syntax.
export function versusValue(key, A, B) {
  const ax = (side, a) => (side.axes?.[a] ?? val(side.scores, a));
  if (key.startsWith('a:')) return AXIS_IDS.includes(key.slice(2)) ? ax(A, key.slice(2)) : undefined;
  if (key.startsWith('b:')) return AXIS_IDS.includes(key.slice(2)) ? ax(B, key.slice(2)) : undefined;
  if (key.startsWith('d:')) return AXIS_IDS.includes(key.slice(2)) ? ax(A, key.slice(2)) - ax(B, key.slice(2)) : undefined;
  if (key === 'same:archetype') return !!A.archetype && A.archetype === B.archetype;
  if (key === 'same:top') return !!A.top && A.top === B.top;
  if (key === 'same:route') return !!A.route && A.route === B.route;
  if (key.startsWith('top:')) return A.top === key.slice(4) || B.top === key.slice(4);
  return undefined;
}
export function versusCond(key, spec, A, B) {
  const c = parseCond(spec);
  const v = versusValue(key, A, B);
  if (!c || v === undefined) return { ok: false, margin: 0 };
  if (c.op === 'is') return { ok: v === c.a, margin: 0 };
  if (c.op === 'eq') return { ok: String(v) === c.a, margin: 0 };
  if (typeof v !== 'number') return { ok: false, margin: 0 };
  const E = 1e-9;
  switch (c.op) {
    case '>=': return { ok: v >= c.a - E, margin: v - c.a };
    case '>': return { ok: v > c.a + E, margin: v - c.a };
    case '<=': return { ok: v <= c.a + E, margin: c.a - v };
    case '<': return { ok: v < c.a - E, margin: c.a - v };
    case '=': return { ok: Math.abs(v - c.a) <= E, margin: 0 };
    case 'between': return { ok: v >= c.a - E && v <= c.b + E, margin: Math.min(v - c.a, c.b - v) };
  }
  return { ok: false, margin: 0 };
}
export function versusWhen(when, A, B) {
  if (!isObj(when)) return { ok: true, n: 0, margin: 0 };
  let n = 0, margin = 0;
  for (const [k, spec] of Object.entries(when)) { const r = versusCond(k, spec, A, B); if (!r.ok) return { ok: false, n: 0, margin: 0 }; n++; margin += r.margin; }
  return { ok: true, n, margin };
}
// The two best-fitting versus lines (most conditions, then margin, then list order), filled in.
// A, B: { axes: {id: value}, archetype: id, archetypeName, top, route }.
export function pickVersus(lines = [], A, B, { aName = 'You', bName = 'Them', n = 2 } = {}) {
  const twins = !!A.archetype && A.archetype === B.archetype;
  // Two files of the same type: a line that uses both {a} and {b} would read The Coward out-schemes The
  // Coward, so it is skipped unless its conditions ask for the same type.
  const fitsTwins = x => !twins || !(x.text.includes('{a}') && x.text.includes('{b}')) || (isObj(x.when) && 'same:archetype' in x.when);
  return lines.filter(x => isObj(x) && typeof x.text === 'string' && fitsTwins(x))
    .map((x, i) => ({ x, i, r: versusWhen(x.when, A, B) }))
    .filter(y => y.r.ok)
    .sort((p, q) => q.r.n - p.r.n || q.r.margin - p.r.margin || p.i - q.i)
    .slice(0, n)
    .map(y => ({ id: y.x.id || `v${y.i}`, text: fill(y.x.text, { a: A.archetypeName, b: B.archetypeName, aName, bName }) }));
}
export function badVersusConditions(when) {
  const out = [];
  if (!isObj(when)) return out;
  for (const [k, spec] of Object.entries(when)) {
    const axisKey = /^[abd]:/.test(k) && AXIS_IDS.includes(k.slice(2));
    const boolKey = ['same:archetype', 'same:top', 'same:route'].includes(k) || k.startsWith('top:');
    const c = parseCond(spec);
    if (!axisKey && !boolKey) out.push(`unknown key ${k}`);
    else if (!c) out.push(`${k}: cannot read ${JSON.stringify(spec)}`);
    else if (boolKey && c.op !== 'is') out.push(`${k}: needs true or false`);
    else if (axisKey && (c.op === 'is' || c.op === 'eq')) out.push(`${k}: needs a number test`);
  }
  return out;
}

// ---- the hand-off ------------------------------------------------------------------------------------------
export const fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k]))).replace(/[ \t]+/g, ' ').trim();
export function handoffView(endgame, reading) {
  const h = endgame?.handoff;
  if (!isObj(h) || !h.url) return null;
  const vars = { archetype: reading?.archetype?.name || '', tagline: reading?.archetype?.tagline || '' };
  return { title: fill(h.title, vars), text: fill(h.text, vars), button: h.button || 'Open', url: h.url, codeNote: fill(h.codeNote, vars) };
}
