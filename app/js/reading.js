// The personality reading (research/READING_CONTRACT.md). Pure, no DOM, so node can test it.
//
// data/reading.json gives copy for ten scales (five bands each), archetypes, contradictions, tells,
// reads lines and closers, each chosen by a `when` block of conditions. buildReading() evaluates them
// against the player's axis values, behavioural signals and reads tags, and returns
//   { archetype, scales: {id: {band, value, title, line, detail, name, plain}}, contradictions, tells, reads, closer }
// It never throws: a missing or partial reading.json falls back to plain built-in copy.

import { AXIS, AXIS_IDS } from './axes.js?v=c33a16e-1794988461';

export const SCALE_IDS = ['mach', 'narc', 'psych', 'dynasty', 'libertine', 'loyalty', 'style', 'online', 'system', 'faith'];
export const BANDS = ['high', 'above', 'mid', 'below', 'low'];
export const READS_TAGS = ['grudge', 'vanity', 'risk', 'charm', 'control', 'paranoia', 'mercy', 'hunger'];
export const SIGNAL_KEYS = ['hesitations', 'holdAvg', 'fastSwipeShare', 'revisions'];
export const READS_MIN = 1.5; // a reads tag speaks only at |score| >= 1.5

// Plain words for each band, shown beside the band's own title so high or low is never in doubt.
export const BAND_WORD = { high: 'High', above: 'Above average', mid: 'Middling', below: 'Below average', low: 'Low' };
// Two-sided scales say which end you lean to, so a badge never reads as a bare Above average (playtest).
export const SCALE_ENDS = { dynasty: ['meritocrat', 'dynast'], libertine: ['puritan', 'libertine'], loyalty: ['free agent', 'loyalist'],
  style: ['conciliator', 'brawler'], online: ['offline', 'extremely online'], system: ['establishment', 'insurgent'], faith: ['secular', 'devout'] };
export function bandWord(id, band) {
  const e = SCALE_ENDS[id];
  if (!e) return BAND_WORD[band];
  return { high: `Strongly ${e[1]}`, above: `Leans ${e[1]}`, mid: 'In the middle', below: `Leans ${e[0]}`, low: `Strongly ${e[0]}` }[band];
}

const DEFAULT_NAME = {
  mach: 'Machiavellianism', narc: 'Narcissism', psych: 'Psychopathy', dynasty: 'Nepotism and dynasty',
  libertine: 'Libertine', loyalty: 'Loyalty', style: 'Brawler or conciliator', online: 'Extremely online',
  system: 'Insurgent or institutionalist', faith: 'Faith in public life',
};

export const FALLBACK_ARCHETYPE = {
  id: 'unfiled', name: 'The Unfiled', tagline: 'The quiz is still reading your file.',
  text: 'Your scores are below and they are real. The longer reading of who you are is still being written.',
  art: null, when: {}, fallback: true,
};
export const FALLBACK_CLOSER = 'Everyone has a politician hiding inside them. Now you know the shape of yours.';

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const num = v => (typeof v === 'number' ? v : Number(v));

export function bandOf(v) {
  v = Number.isFinite(num(v)) ? num(v) : 0;
  return v >= 1.2 ? 'high' : v >= 0.4 ? 'above' : v > -0.4 ? 'mid' : v > -1.2 ? 'below' : 'low';
}

// ---- conditions -----------------------------------------------------------------------------------------
// A condition value is one of: ">=1", "<=-0.4", ">0.5", "<1", "=0" ("==0"), "between -0.4 0.4"
// ("between -0.4 and 0.4" too), true / false (for top:), or a plain string ("dem", "gop" for route).
// Returns { op, a, b } or null when it cannot be read.
const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)';
const RE_CMP = new RegExp(`^\\s*(>=|<=|==|=|>|<)\\s*(${NUM})\\s*$`);
const RE_BETWEEN = new RegExp(`^\\s*between\\s+(${NUM})\\s*(?:and|,|\\s)\\s*(${NUM})\\s*$`, 'i');

export function parseCond(spec) {
  if (spec === true || spec === false) return { op: 'is', a: spec };
  if (typeof spec === 'number' && Number.isFinite(spec)) return { op: '>=', a: spec };
  if (typeof spec !== 'string') return null;
  let m = spec.match(RE_CMP);
  if (m) return { op: m[1] === '==' ? '=' : m[1], a: Number(m[2]) };
  m = spec.match(RE_BETWEEN);
  if (m) { const a = Number(m[1]), b = Number(m[2]); return { op: 'between', a: Math.min(a, b), b: Math.max(a, b) }; }
  const t = spec.trim();
  if (t === 'true' || t === 'false') return { op: 'is', a: t === 'true' };
  if (/^[a-z][\w-]*$/i.test(t)) return { op: 'eq', a: t };
  return null;
}

// The player's value for a condition key, or undefined when there is none (the condition then fails).
export function lookup(key, ctx) {
  if (key === 'route') return ctx.route;
  if (key.startsWith('top:')) return !!ctx.top && ctx.top === key.slice(4);
  if (key.startsWith('tag:')) return num(ctx.reads?.[key.slice(4)]) || 0;
  if (SIGNAL_KEYS.includes(key)) { const v = ctx.signals?.[key]; return Number.isFinite(v) ? v : undefined; }
  if (AXIS[key]) { const v = ctx.axes?.[key]; return Number.isFinite(v) ? v : 0; }
  return undefined;
}

// One condition: { ok, margin }. margin is how far the value clears the bar (0 for true/false and strings).
export function evalCond(key, spec, ctx) {
  const c = parseCond(spec);
  const v = lookup(key, ctx);
  if (!c || v === undefined) return { ok: false, margin: 0 };
  switch (c.op) {
    case 'is': return { ok: v === c.a, margin: 0 };
    case 'eq': return { ok: String(v) === c.a, margin: 0 };
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, margin: 0 };
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

// A whole `when` block: every condition must hold. { ok, n (conditions), margin (total) }.
export function evalWhen(when, ctx) {
  if (!isObj(when)) return { ok: true, n: 0, margin: 0 };
  let n = 0, margin = 0;
  for (const [k, spec] of Object.entries(when)) {
    const r = evalCond(k, spec, ctx);
    if (!r.ok) return { ok: false, n: 0, margin: 0 };
    n++;
    margin += r.margin;
  }
  return { ok: true, n, margin };
}

// Condition keys and values that the engine cannot read (for tests and the console).
export function badConditions(when) {
  const out = [];
  if (!isObj(when)) return out;
  for (const [k, spec] of Object.entries(when)) {
    const keyOk = k === 'route' || k.startsWith('top:') || (k.startsWith('tag:') && READS_TAGS.includes(k.slice(4))) || SIGNAL_KEYS.includes(k) || !!AXIS[k];
    const c = parseCond(spec);
    if (!keyOk) out.push(`unknown key ${k}`);
    else if (!c) out.push(`${k}: cannot read ${JSON.stringify(spec)}`);
    else if (c.op === 'eq' && k !== 'route') out.push(`${k}: a word where a number test belongs (${JSON.stringify(spec)})`);
    else if (c.op === 'is' && !k.startsWith('top:')) out.push(`${k}: true or false only fits top:`);
    else if (k === 'route' && c.op !== 'eq') out.push(`route: dem or gop, not ${JSON.stringify(spec)}`);
    else if (k.startsWith('top:') && c.op !== 'is') out.push(`${k}: needs true or false`);
  }
  return out;
}

// ---- the player's context ------------------------------------------------------------------------------
// scores: axisScores() output (or plain numbers by axis). signals: the scorer's signals. reads: sc.reads.
export function readingContext({ scores = {}, signals = {}, reads = {}, matches = [], route = null } = {}) {
  const axes = {}, evidence = {};
  for (const a of AXIS_IDS) {
    const s = scores[a];
    axes[a] = isObj(s) ? (Number.isFinite(s.value) ? s.value : 0) : Number.isFinite(s) ? s : 0;
    evidence[a] = isObj(s) ? s.evidence || 0 : 0;
  }
  const holds = Array.isArray(signals.holdStrengths) ? signals.holdStrengths : [];
  const sig = {
    hesitations: signals.hesitations || 0,
    holdAvg: holds.length ? holds.reduce((t, v) => t + v, 0) / holds.length : undefined,
    fastSwipeShare: signals.swipes ? (signals.fastSwipes || 0) / signals.swipes : undefined,
    revisions: Number.isFinite(signals.revisions) ? signals.revisions : signals.revisionNudges || 0,
  };
  return { axes, evidence, signals: sig, reads: { ...(reads || {}) }, route, top: matches[0]?.id || null };
}

// ---- reading.json, tolerated in any state ---------------------------------------------------------------
export function normalizeReading(raw) {
  const r = isObj(raw) ? raw : {};
  const list = v => (Array.isArray(v) ? v.filter(isObj) : []);
  return {
    scales: isObj(r.scales) ? r.scales : {},
    archetypes: list(r.archetypes).filter(a => a.id && a.name),
    contradictions: list(r.contradictions).filter(c => typeof c.text === 'string' && c.text.trim()),
    tells: list(r.tells).filter(c => typeof c.text === 'string' && c.text.trim()),
    reads: isObj(r.reads) ? r.reads : {},
    closers: list(r.closers).filter(c => typeof c.text === 'string' && c.text.trim()),
    present: isObj(raw),
  };
}

// Problems with a reading.json (the tests assert there are none once the real file exists).
export function validateReading(raw) {
  const p = [];
  if (!isObj(raw)) return ['reading.json is not an object'];
  const d = normalizeReading(raw);
  for (const id of SCALE_IDS) {
    const s = d.scales[id];
    if (!isObj(s)) { p.push(`scale ${id} missing`); continue; }
    if (!s.name) p.push(`scale ${id}: no name`);
    for (const b of BANDS) {
      const x = s.bands?.[b];
      if (!isObj(x)) { p.push(`scale ${id}: band ${b} missing`); continue; }
      for (const k of ['title', 'line', 'detail']) if (!(typeof x[k] === 'string' && x[k].trim())) p.push(`scale ${id}.${b}: no ${k}`);
    }
  }
  const fallbacks = d.archetypes.filter(a => !isObj(a.when) || !Object.keys(a.when).length);
  if (fallbacks.length !== 1) p.push(`${fallbacks.length} fallback archetypes (need exactly one with when {})`);
  const ids = new Set();
  for (const a of d.archetypes) {
    if (ids.has(a.id)) p.push(`duplicate archetype ${a.id}`);
    ids.add(a.id);
    if (!a.text) p.push(`archetype ${a.id}: no text`);
    for (const b of badConditions(a.when)) p.push(`archetype ${a.id}: ${b}`);
  }
  for (const [kind, arr] of [['contradiction', d.contradictions], ['tell', d.tells], ['closer', d.closers]]) {
    for (const c of arr) for (const b of badConditions(c.when)) p.push(`${kind} ${c.id || c.text.slice(0, 20)}: ${b}`);
  }
  for (const t of Object.keys(d.reads)) if (!READS_TAGS.includes(t)) p.push(`unknown reads tag ${t}`);
  if (!d.closers.some(c => !isObj(c.when) || !Object.keys(c.when).length)) p.push('no fallback closer');
  return p;
}

const pickArchetype = (list, ctx) => {
  let best = null;
  list.forEach((a, i) => {
    const r = evalWhen(a.when, ctx);
    if (!r.ok) return;
    // Most conditions wins; ties go to the larger total margin; then list order.
    if (!best || r.n > best.n || (r.n === best.n && r.margin > best.margin + 1e-9)) best = { a, n: r.n, margin: r.margin, i };
  });
  return best;
};

// ---- the reading ---------------------------------------------------------------------------------------
export function buildReading(raw, ctx) {
  const d = normalizeReading(raw);
  const scales = {};
  for (const id of SCALE_IDS) {
    const value = Number.isFinite(ctx.axes?.[id]) ? ctx.axes[id] : 0;
    const band = bandOf(value);
    const src = isObj(d.scales[id]) ? d.scales[id] : {};
    const b = isObj(src.bands?.[band]) ? src.bands[band] : {};
    const ax = AXIS[id];
    scales[id] = {
      id, value, band, word: bandWord(id, band),
      name: src.name || DEFAULT_NAME[id],
      plain: src.plain || (ax ? `${ax.neg} at the low end, ${ax.pos.toLowerCase()} at the high end.` : ''),
      title: b.title || BAND_WORD[band],
      line: b.line || (ax ? defaultLine(band, ax) : ''),
      detail: b.detail || '',
      evidence: ctx.evidence?.[id] || 0,
    };
  }

  const best = pickArchetype(d.archetypes, ctx);
  const a = best ? best.a : FALLBACK_ARCHETYPE;
  const archetype = { id: a.id, name: a.name, tagline: a.tagline || '', text: a.text || '', art: a.art || null, fallback: !best, general: !!best && best.n === 0 };

  const contradictions = d.contradictions
    .map((c, i) => ({ c, i, r: evalWhen(c.when, ctx) }))
    .filter(x => x.r.ok)
    .sort((x, y) => y.r.n - x.r.n || x.i - y.i) // most conditions first, then list order
    .slice(0, 2)
    .map(x => ({ id: x.c.id || `c${x.i}`, text: x.c.text }));

  const tells = d.tells
    .filter(t => evalWhen(t.when, ctx).ok)
    .slice(0, 2)
    .map((t, i) => ({ id: t.id || `t${i}`, text: t.text }));

  // A reads line may be plain text, or { text, when } (or a list of those, the first that holds wins),
  // so a line can stay quiet when it would contradict the rest of the reading (playtest, 18 Nov 2026).
  const readsLine = (v) => {
    for (const x of Array.isArray(v) ? v : [v]) {
      if (typeof x === 'string' && x.trim()) return x;
      if (isObj(x) && typeof x.text === 'string' && x.text.trim() && evalWhen(x.when, ctx).ok) return x.text;
    }
    return null;
  };
  const reads = Object.entries(ctx.reads || {})
    .filter(([, v]) => Number.isFinite(v) && Math.abs(v) >= READS_MIN)
    .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]) || (x[0] < y[0] ? -1 : 1))
    .map(([tag, score]) => {
      const side = score > 0 ? 'high' : 'low';
      const text = isObj(d.reads[tag]) ? readsLine(d.reads[tag][side]) : null;
      return text ? { tag, score, side, text } : null;
    })
    .filter(Boolean)
    .slice(0, 2);

  const c = d.closers.find(x => evalWhen(x.when, ctx).ok);
  const closer = c ? c.text : FALLBACK_CLOSER;
  const closerId = c ? c.id || null : null;

  return { archetype, scales, contradictions, tells, reads, closer, closerId, present: d.present };
}

function defaultLine(band, ax) {
  const pos = ax.pos.toLowerCase(), neg = ax.neg.toLowerCase();
  switch (band) {
    case 'high': return `You sit far toward ${pos}.`;
    case 'above': return `You lean toward ${pos}.`;
    case 'mid': return `You sit between ${neg} and ${pos}.`;
    case 'below': return `You lean toward ${neg}.`;
    default: return `You sit far toward ${neg}.`;
  }
}
