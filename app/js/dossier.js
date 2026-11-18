// Shareable dossiers (Chris, 18 Nov 2026): the RESULT of a run packed into a short code, USQ1, so a link
// <site>/app/#d=<code> opens that dossier anywhere. Pure, no DOM, so node can test it.
//
// The code holds the result, not the answers, so links survive changes to the question bank. Traits,
// the reading and the share card are recomputed from it; the camp is stored as it was found.
//
//   USQ1-<73 base64url characters: 438 bits, below><4-character checksum>   (82 characters)
//
//   route 1 · questions answered 7 · minutes since 2026-01-01 UTC 23
//   19 axes, in axes.js order: value 10 bits (-2..2 in steps of 0.005) and confidence 2 bits (0 = no evidence, 1..3 thirds)
//   top 5 matches: candidate index 5 (candidates.json order) · pct 7 · direct picks 2 (0..3)
//   8 reads tags, in reading.js order: 7 bits each (-6.4..6.3 in steps of 0.1)
//   signals: hesitations 5 · revisions 5 · swipes 5 · fast swipes 5 · average hold 7 (0..100 %, 127 = none)
//   faith flags: professed 2 · private 2 (0 none, 1 religious, 2 secular)
//   camps: best overall, then nearest in the route: camps.json index 4 (15 = none) · fit % 7
//   (candidates.json and camps.json may only ever grow at the end, or old links change meaning)
//
// Rounding never moves a value across a line the dossier draws (band edges, the reading's conditions,
// one-decimal rounding), and the encoder checks that the rebuilt dossier matches.

import { AXIS_IDS } from './axes.js?v=055793d-1794987752';
import { buildProfile } from './profile.js?v=055793d-1794987752';
import { readingContext, buildReading, normalizeReading, parseCond, READS_TAGS, READS_MIN } from './reading.js?v=055793d-1794987752';

// A 4-character base36 checksum (FNV-1a), so a mistyped or edited code is caught.
export function checksum4(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h % 1679616).toString(36).toUpperCase().padStart(4, '0');
}

export const DOSSIER_PREFIX = 'USQ1-';
export const DOSSIER_BITS = 438;
const PAYLOAD_CHARS = Math.ceil(DOSSIER_BITS / 6); // 73
export const DOSSIER_LENGTH = DOSSIER_PREFIX.length + PAYLOAD_CHARS + 4;
const EPOCH = Date.UTC(2026, 0, 1) / 1000;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const FAITH = [null, 'religious', 'secular'];
const AX_STEP = 200, AX_MAX = 400;   // value = k / 200, k in -400..400 (stored + 400 in 10 bits)
const TAG_STEP = 10, TAG_MIN = -64, TAG_MAX = 63;
const CONF_LEVELS = 3;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- bits ----------------------------------------------------------------------------------------------
function writer() {
  const bits = [];
  return {
    put(v, n) { v = Math.round(v); if (v < 0 || v >= 2 ** n) throw new Error(`field out of range: ${v} in ${n} bits`); for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); },
    bits,
  };
}
function reader(bits) {
  let p = 0;
  return { get(n) { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | (bits[p++] || 0); return v; }, get pos() { return p; } };
}
const bitsToB64 = bits => { let s = ''; for (let i = 0; i < bits.length; i += 6) { let v = 0; for (let k = 0; k < 6; k++) v = (v << 1) | (bits[i + k] || 0); s += B64[v]; } return s; };
function b64ToBits(s) {
  const bits = [];
  for (const ch of s) { const v = B64.indexOf(ch); if (v < 0) throw new Error('bad character'); for (let k = 5; k >= 0; k--) bits.push((v >> k) & 1); }
  return bits;
}

// ---- thresholds: the lines a rounded value must stay on the right side of ------------------------------
const BASE_AXIS = [-1.2, -0.4, -0.3, 0.3, 0.4, 1.2];
for (let k = -20; k < 20; k++) BASE_AXIS.push((k + 0.5) / 10);              // one-decimal rounding
const LIBERTINE_EXTRA = []; for (let n = 0; n <= 10; n++) LIBERTINE_EXTRA.push((n - 4.5) / 2); // half-step rounding
export function readingThresholds(raw) {
  const d = normalizeReading(raw);
  const out = { axes: {}, tags: {}, holdAvg: [] };
  const add = (key, spec) => {
    const c = parseCond(spec);
    if (!c || typeof c.a !== 'number') return;
    const vals = c.op === 'between' ? [c.a, c.b] : [c.a];
    if (key.startsWith('tag:')) (out.tags[key.slice(4)] = out.tags[key.slice(4)] || []).push(...vals);
    else if (key === 'holdAvg') out.holdAvg.push(...vals);
    else if (AXIS_IDS.includes(key)) (out.axes[key] = out.axes[key] || []).push(...vals);
  };
  const scan = when => { if (when && typeof when === 'object') for (const [k, v] of Object.entries(when)) add(k, v); };
  for (const list of [d.archetypes, d.contradictions, d.tells, d.closers]) for (const x of list) scan(x.when);
  for (const sides of Object.values(d.reads)) for (const v of Object.values(sides || {})) for (const x of Array.isArray(v) ? v : [v]) if (x && typeof x === 'object') scan(x.when);
  return out;
}

// Round v to k / scale, then keep it on the same side of every threshold (equal stays equal when it can).
function quantize(v, scale, lo, hi, thresholds, nudge = 0) {
  let k = clamp(Math.round(v * scale) + nudge, lo, hi);
  const E = 1e-9;
  for (const T of thresholds) {
    const t = T * scale;
    if (Math.abs(v - T) <= E) { if (Math.abs(t - Math.round(t)) < 1e-6) k = Math.round(t); else k = Math.ceil(t); }
    else if (v > T && k / scale <= T + E) k = Math.floor(t + 1e-6) + 1;
    else if (v < T && k / scale >= T - E) k = Math.ceil(t - 1e-6) - 1;
  }
  return clamp(k, lo, hi);
}

// ---- the result in and out --------------------------------------------------------------------------------
// Float sums leave values like 0.39999999999999997, which the reading counts as 0.4 (it allows 1e-9) but a
// band edge does not. The page, the reading and the code all use values tidied to 1e-9, so they agree.
export const tidy = v => (Number.isFinite(v) ? Math.round(v * 1e9) / 1e9 : v);
export const tidyScores = scores => Object.fromEntries(Object.entries(scores).map(([a, s]) => [a, { ...s, value: tidy(s.value) }]));
export const tidyReads = reads => Object.fromEntries(Object.entries(reads || {}).map(([k, v]) => [k, tidy(v)]));

// From a finished run: route, length (questions answered), t (unix seconds), scores (axisScores),
// matches (matchCandidates rows), reads (sc.reads), signals (sc.signals), flags (sc.flags).
// campRows: matchCamps() over every camp (scoring.js), best first.
export function dossierFromRun({ route, length, t, scores, matches, reads = {}, signals = {}, flags = {}, campRows = [] }) {
  const holds = Array.isArray(signals.holdStrengths) ? signals.holdStrengths : [];
  return {
    route, length, t: minuteOf(t),
    axes: Object.fromEntries(AXIS_IDS.map(a => [a, { value: tidy(scores[a]?.value || 0), conf: scores[a]?.conf || 0 }])),
    top: matches.slice(0, 5).map(m => ({ id: m.id, pct: m.pct, picks: m.picks || 0 })),
    reads: Object.fromEntries(READS_TAGS.map(tg => [tg, tidy(Number(reads[tg]) || 0)])),
    signals: {
      hesitations: signals.hesitations || 0,
      revisions: Number.isFinite(signals.revisions) ? signals.revisions : signals.revisionNudges || 0,
      swipes: signals.swipes || 0, fastSwipes: signals.fastSwipes || 0,
      holdAvg: holds.length ? tidy(holds.reduce((s, v) => s + v, 0) / holds.length) : null,
    },
    faith: flags.faith ? { professed: flags.faith.professed || null, private: flags.faith.private || null } : null,
    campRows: [campRows[0], campRows.find(r => r.party === route)].map(r => (r ? { id: r.id, pct: r.pct } : null)),
  };
}
// The dossier's time is kept to the minute, so a rebuilt dossier matches the original.
export const minuteOf = t => Math.floor((Number(t) || Math.floor(Date.now() / 1000)) / 60) * 60;

function pack(d, candidates, th, nudges = {}, camps = []) {
  const w = writer();
  const idx = new Map(candidates.map((c, i) => [c.id, i]));
  w.put(d.route === 'gop' ? 1 : 0, 1);
  w.put(clamp(d.length, 1, 127), 7);
  w.put(clamp(Math.round((d.t - EPOCH) / 60), 0, 2 ** 23 - 1), 23);
  for (const a of AXIS_IDS) {
    const { value, conf } = d.axes[a];
    const extra = a === 'libertine' ? LIBERTINE_EXTRA : [];
    w.put(quantize(value, AX_STEP, -AX_MAX, AX_MAX, BASE_AXIS.concat(extra, th.axes[a] || []), nudges[a] || 0) + AX_MAX, 10);
    w.put(conf > 0 ? clamp(Math.round(conf * CONF_LEVELS) + (nudges[`conf:${a}`] || 0), 1, CONF_LEVELS) : 0, 2);
  }
  const top = d.top.slice(0, 5);
  if (top.length !== 5) throw new Error('a dossier needs five matches');
  for (const m of top) {
    if (!idx.has(m.id) || idx.get(m.id) > 31) throw new Error(`unknown candidate ${m.id}`);
    w.put(idx.get(m.id), 5);
    w.put(clamp(m.pct, 0, 127), 7);
    w.put(clamp(m.picks || 0, 0, 3), 2);
  }
  for (const tg of READS_TAGS) {
    const v = d.reads[tg] || 0;
    const ths = [READS_MIN, -READS_MIN].concat(th.tags[tg] || []);
    w.put(quantize(v, TAG_STEP, TAG_MIN, TAG_MAX, ths, nudges[`tag:${tg}`] || 0) - TAG_MIN, 7);
  }
  const s = d.signals;
  w.put(clamp(s.hesitations, 0, 31), 5);
  w.put(clamp(s.revisions, 0, 31), 5);
  const sw = clamp(s.swipes, 0, 31);
  w.put(sw, 5);
  w.put(clamp(s.fastSwipes, 0, sw), 5);
  w.put(s.holdAvg == null ? 127 : quantize(clamp(s.holdAvg, 0, 1), 100, 0, 100, th.holdAvg, nudges.holdAvg || 0), 7);
  w.put(Math.max(0, FAITH.indexOf(d.faith?.professed ?? null)), 2);
  w.put(Math.max(0, FAITH.indexOf(d.faith?.private ?? null)), 2);
  const cidx = new Map(camps.map((k, i) => [k.id, i]));
  for (const r of (d.campRows || []).concat([null, null]).slice(0, 2)) {
    const i = r && cidx.has(r.id) && cidx.get(r.id) < 15 ? cidx.get(r.id) : 15;
    w.put(i, 4);
    w.put(i === 15 ? 0 : clamp(r.pct, 0, 100), 7);
  }
  if (w.bits.length !== DOSSIER_BITS) throw new Error(`packed ${w.bits.length} bits`);
  const payload = bitsToB64(w.bits);
  return DOSSIER_PREFIX + payload + checksum4(payload);
}

// Returns { ok: true, data, checksum } or { ok: false, error } (a plain sentence for the page).
export function decodeDossier(code, { candidates, camps = [] }) {
  try {
    const s = String(code || '').trim().replace(/\s+/g, '');
    const ver = /^USQ(\d+)-/i.exec(s);
    if (!ver) return { ok: false, error: 'This is not a dossier link.' };
    if (ver[1] !== '1') return { ok: false, error: 'This dossier link comes from a newer version of the quiz.' };
    const body = s.slice(DOSSIER_PREFIX.length);
    if (body.length !== PAYLOAD_CHARS + 4) return { ok: false, error: 'This dossier link is cut short or has extra characters.' };
    const payload = body.slice(0, PAYLOAD_CHARS), sum = body.slice(PAYLOAD_CHARS);
    if (checksum4(payload) !== sum) return { ok: false, error: 'This dossier link has been changed or mistyped.' };
    const bits = b64ToBits(payload);
    if (bits.slice(DOSSIER_BITS).some(Boolean)) return { ok: false, error: 'This dossier link has been changed or mistyped.' };
    const r = reader(bits);
    const d = { route: r.get(1) ? 'gop' : 'dem', length: r.get(7), t: EPOCH + r.get(23) * 60, axes: {}, top: [], reads: {}, signals: {}, faith: null };
    for (const a of AXIS_IDS) {
      const k = r.get(10) - AX_MAX, c = r.get(2);
      if (Math.abs(k) > AX_MAX) throw new Error('axis out of range');
      d.axes[a] = { value: k / AX_STEP, conf: c / CONF_LEVELS };
    }
    for (let i = 0; i < 5; i++) {
      const ci = r.get(5), pct = r.get(7), picks = r.get(2);
      if (!candidates[ci] || pct > 100) throw new Error('match out of range');
      d.top.push({ id: candidates[ci].id, pct, picks });
    }
    if (new Set(d.top.map(m => m.id)).size !== 5) throw new Error('repeated match');
    for (const tg of READS_TAGS) d.reads[tg] = (r.get(7) + TAG_MIN) / TAG_STEP;
    const hes = r.get(5), rev = r.get(5), sw = r.get(5), fast = r.get(5), hold = r.get(7);
    if (fast > sw || (hold > 100 && hold !== 127)) throw new Error('signal out of range');
    d.signals = { hesitations: hes, revisions: rev, swipes: sw, fastSwipes: fast, holdAvg: hold === 127 ? null : hold / 100 };
    const fp = r.get(2), fv = r.get(2);
    if (fp > 2 || fv > 2) throw new Error('flag out of range');
    if (fp || fv) d.faith = { professed: FAITH[fp], private: FAITH[fv] };
    d.campRows = [];
    for (let i = 0; i < 2; i++) {
      const ki = r.get(4), pct = r.get(7);
      if (ki !== 15 && (!camps[ki] || pct > 100)) throw new Error('camp out of range');
      d.campRows.push(ki === 15 ? null : { id: camps[ki].id, pct });
    }
    if (d.length < 1) throw new Error('no questions');
    return { ok: true, data: d, checksum: sum };
  } catch {
    return { ok: false, error: 'This dossier link could not be read. It may have been cut short or changed.' };
  }
}

// Everything the dossier page and the reveal need, rebuilt from dossier data.
export function rebuildDossier(d, { candidates, camps, reading }) {
  const byId = new Map(candidates.map(c => [c.id, c]));
  const scores = Object.fromEntries(AXIS_IDS.map(a => {
    const { value, conf } = d.axes[a];
    return [a, { value, conf, evidence: conf >= 1 ? 2.5 : conf * 2.5 }];
  }));
  const matches = d.top.map(m => { const c = byId.get(m.id) || {}; return { id: m.id, name: c.name || m.id, party: c.party, pct: m.pct, picks: m.picks || 0 }; });
  const signals = {
    hesitations: d.signals.hesitations, revisions: d.signals.revisions, revisionNudges: d.signals.revisions,
    swipes: d.signals.swipes, fastSwipes: d.signals.fastSwipes, holdStrengths: d.signals.holdAvg == null ? [] : [d.signals.holdAvg],
  };
  const scorerFlags = d.faith ? { faith: d.faith } : {};
  // The stored camps as matchCamps rows (best first), so the camp reads exactly as it did on the page.
  const byCamp = new Map((camps || []).map(k => [k.id, k]));
  const campRows = (d.campRows || []).filter(Boolean).map(r => { const k = byCamp.get(r.id) || {}; return { id: r.id, short: k.short, name: k.name, blurb: k.blurb || '', party: k.party, pct: r.pct }; });
  const profile = buildProfile({ scores, matches, camps, route: d.route, scorerFlags, campRows: campRows.length ? campRows : null });
  const read = buildReading(reading, readingContext({ scores, signals, reads: d.reads, matches, route: d.route }));
  return { route: d.route, length: d.length, t: d.t, scores, matches, signals, reads: d.reads, profile, reading: read };
}

// What must come out the same after the round trip.
export function dossierSignature(rb) {
  const r = rb.reading, p = rb.profile;
  return JSON.stringify([r.archetype.id, r.closer, r.contradictions.map(c => c.id), r.tells.map(t => t.id), r.reads.map(x => x.tag + x.side),
    Object.values(r.scales).map(s => s.band), p.camp?.id, p.camp?.pct, p.campAlt?.id, p.traits, p.flags, null, null, null, rb.matches.map(m => m.id + m.pct)]);
}

// Encode, rebuild and compare. If rounding moved anything (most often a value next to a band edge), nudge single values by one step, keeping any nudge that leaves fewer details
// different, until nothing differs or nothing helps. Returns { code, exact, off } (off: details still
// different, 0 when exact).
// Each detail as [weight, text]: what the reading and camp say weighs far more than a trait's order.
const WEIGHT = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 100, 1000, 30, 1000, 10, 1, 10, 1000];
const leaves = sig => JSON.parse(sig).flatMap((x, i) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : [x]).map(y => [WEIGHT[i] ?? 1, JSON.stringify(y)]));
export function encodeDossier(d, env) {
  const th = readingThresholds(env.reading);
  const want = leaves(dossierSignature(rebuildDossier(d, env)));
  const off = code => {
    const r = decodeDossier(code, env);
    if (!r.ok) return Infinity;
    const got = leaves(dossierSignature(rebuildDossier(r.data, env)));
    let n = Math.abs(got.length - want.length) * 1000;
    for (let i = 0; i < Math.min(got.length, want.length); i++) if (got[i][1] !== want[i][1]) n += want[i][0];
    return n;
  };
  const nudges = {};
  let code = pack(d, env.candidates, th, nudges, env.camps), best = off(code);
  const keys = AXIS_IDS.concat(READS_TAGS.map(t => `tag:${t}`), ['holdAvg'], AXIS_IDS.map(a => `conf:${a}`));
  for (let pass = 0; pass < 6 && best > 0; pass++) {
    let improved = false;
    for (const k of keys) for (const step of [1, -1]) {
      if (best === 0) break;
      const n = (nudges[k] || 0) + step;
      if (Math.abs(n) > 2) continue;
      const trial = { ...nudges, [k]: n };
      const c = pack(d, env.candidates, th, trial, env.camps), o = off(c);
      if (o < best) { best = o; code = c; nudges[k] = n; improved = true; }
    }
    if (!improved) break;
  }
  return { code, exact: best === 0, off: best };
}

// ---- links and file numbers ----------------------------------------------------------------------------
export function dossierLink(code, siteUrl) {
  const base = String(siteUrl || '').replace(/[#?].*$/, '').replace(/\/?$/, '/');
  return `${base}app/#d=${code}`;
}
export function codeFromHash(hash) {
  const m = /(?:^#|[#&])d=([^&]+)/.exec(String(hash || ''));
  return m ? decodeURIComponent(m[1]) : null;
}
// A short file number for the top of the dossier: FNV-1a of the code under two seeds, 4 + 4 base36.
export function fileNumber(code) {
  const h = seed => { let x = seed >>> 0; for (let i = 0; i < code.length; i++) { x ^= code.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return (x % 1679616).toString(36).toUpperCase().padStart(4, '0'); };
  return `${h(0x811c9dc5)}-${h(0x9e3779b9)}`;
}
