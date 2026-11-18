// Scoring (SPEC section 1) and candidate matching (section 2). Pure, no DOM.
//
// Each answered question adds one observation per axis it probes:
//   v = 2 * picked * valueMult / maxAbs   (so always taking the most extreme option on an axis reads as +-2)
//   w = maxAbs * weightMult               (questions with bigger deltas are stronger evidence)
// Axis score = sum(v*w) / sum(w), clamped to -2..+2. Evidence = sum(w).
//
// Matching (playtest 1, M1): a player's axis scores shrink toward the middle whenever the option that
// fits them best is not the extreme one on every axis it touches, so comparing them with candidates'
// raw positions favours centrists. Instead each candidate is run through the same questions with a
// canonical policy (predictAnswer), and the player is compared with that predicted profile. A consistent
// AOC player shrinks exactly as predicted-AOC shrinks, so they land on AOC.

import { AXIS, AXIS_IDS, AXES, GROUP_WEIGHT } from './axes.js?v=13556fa-1795008148';
import { rankFactors, textLength, normalizeFaithFlag } from './questions.js?v=13556fa-1795008148';
import { firedReceipts } from './endgame.js?v=13556fa-1795008148';

export const HOLD_FULL_MS = 1500;
export const FAST_SWIPE_MS = 1500;
export const EVIDENCE_FULL = 2.5; // evidence at which an axis counts fully in matching
export const ROUTE_NUDGE = 4;
export const AFF_MAX = 4; // most a candidate can gain from options that point straight at them
// Distance to % is calibrated (app/tests/run.mjs, calibration test) so a random-answer bot's best match
// sits around 60-70% and a bot that answers like a candidate scores that candidate 90%+.
export const CAL = { d0: 1.1, p: 1.8, lenPow: 0.3, choiceW: 1 }; // pct = 100 * exp(-(d / d0)^p): no flat top, so near neighbours separate

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function holdMultiplier(h) {
  h = clamp(Number(h) || 0, 0, 1);
  return h < 0.5 ? 0.5 + h : 1 + 2 * (h - 0.5); // tap 0.5x, half hold 1x, full hold 2x
}

export function hesitationThreshold(q) {
  return Math.min(12000, 4000 + 30 * textLength(q));
}

export function createScorer() {
  return {
    S: {}, S2: {}, W: {}, cand: {}, flags: {},
    signals: { hesitations: 0, holdStrengths: [], swipes: 0, fastSwipes: 0, revisionNudges: 0, revisions: 0 },
    reads: {},   // personality reads tags (READING_CONTRACT section 2): never used in matching
    receipts: [], // exhibits the answers fired (ENDGAME_CONTRACT section 1): { qid, key, text, weight, order }
    answered: [],
    qs: [],      // answered questions, in order (for predicted profiles)
    ans: [],     // the player's answers, in the same order
    picks: {},   // times the player drafted a candidate (portrait-card picks only)
  };
}

function addObs(sc, axis, v, w) {
  if (!(w > 0) || !AXIS[axis] || !Number.isFinite(v)) return;
  sc.S[axis] = (sc.S[axis] || 0) + v * w;
  sc.S2[axis] = (sc.S2[axis] || 0) + v * v * w;
  sc.W[axis] = (sc.W[axis] || 0) + w;
}

// Option `reads` tags feed the personality reading only, scaled exactly like the option's effects.
function addReads(sc, reads, mult = 1) {
  if (!reads || typeof reads !== 'object' || !Number.isFinite(mult) || mult === 0) return;
  for (const [tag, v] of Object.entries(reads)) {
    if (!Number.isFinite(v)) continue;
    sc.reads[tag] = (sc.reads[tag] || 0) + v * mult;
  }
}

function addCand(sc, cand, mult = 1) {
  for (const [id, pts] of Object.entries(cand || {})) {
    if (!Number.isFinite(pts)) continue;
    sc.cand[id] = (sc.cand[id] || 0) + pts * mult;
  }
}

function observe(sc, picked, maxAbs, valueMult = 1, weightMult = 1) {
  for (const a of Object.keys(maxAbs)) {
    const m = maxAbs[a];
    if (!(m > 0)) continue;
    addObs(sc, a, (2 * (picked[a] || 0) * valueMult) / m, m * weightMult);
  }
}

// One-of-N pick: chosen vector versus all the vectors offered.
function observePick(sc, vectors, chosen, valueMult = 1, weightMult = 1, direct = true) {
  const maxAbs = {};
  for (const v of vectors) for (const [a, d] of Object.entries(v.effects || {})) maxAbs[a] = Math.max(maxAbs[a] || 0, Math.abs(d));
  observe(sc, chosen?.effects || {}, maxAbs, valueMult, weightMult);
  if (chosen) {
    addCand(sc, chosen.cand, valueMult);
    addReads(sc, chosen.reads, valueMult * weightMult); // hold strength; fast swipes count 1.25x
    takeFlags(sc, chosen);
  }
}

// Option-level flags. faithFlag: the last answered one wins.
function takeFlags(sc, o) {
  if (!o) return;
  if (o.flags) Object.assign(sc.flags, o.flags);
  const f = normalizeFaithFlag(o.faithFlag);
  if (f) sc.flags.faith = f;
}

function findOpt(q, id) { return (q.options || []).find(o => o.id === id); }

// answer: { ms, revisions, ...type payload }. Returns a short log entry.
export function applyAnswer(sc, q, answer = {}) {
  const ms = Number(answer.ms) || 0;
  let summary = '';
  switch (q.type) {
    case 'choice': case 'dilemma': case 'envelope': case 'draft': case 'sign': {
      const o = findOpt(q, answer.optionId);
      observePick(sc, q.options, o);
      if (q.type === 'draft' && o) sc.picks[o.id] = (sc.picks[o.id] || 0) + 1;
      summary = answer.optionId;
      break;
    }
    case 'hold': {
      const o = findOpt(q, answer.optionId);
      const h = clamp(Number(answer.holdStrength) || 0, 0, 1);
      sc.signals.holdStrengths.push(h);
      observePick(sc, q.options, o, holdMultiplier(h));
      summary = `${answer.optionId}@${h.toFixed(2)}`;
      break;
    }
    case 'pin': {
      const r = (q.regions || []).find(x => x.id === answer.regionId);
      observePick(sc, q.regions, r);
      summary = answer.regionId;
      break;
    }
    case 'slider': {
      const s = q.slider || {};
      const pos = clamp(Number(answer.value) || 0, -1, 1);
      const picked = {}, maxAbs = {};
      for (const [a, e] of Object.entries(s.effects || {})) { picked[a] = e * pos; maxAbs[a] = Math.abs(e); }
      observe(sc, picked, maxAbs);
      // Slider reads run from -reads at the far left to +reads at the far right, like its effects.
      addReads(sc, s.reads || q.reads, pos);
      if (pos < 0) addCand(sc, s.candLeft, -pos);
      if (pos > 0) addCand(sc, s.candRight, pos);
      if (pos <= -0.25) takeFlags(sc, { faithFlag: s.faithFlagLeft });
      if (pos >= 0.25) takeFlags(sc, { faithFlag: s.faithFlagRight });
      summary = pos.toFixed(2);
      break;
    }
    case 'budget': {
      const alloc = answer.alloc || {};
      const total = Object.values(alloc).reduce((t, v) => t + (Number(v) || 0), 0) || 100;
      const picked = {}, maxAbs = {};
      for (const o of q.options) {
        const share = (Number(alloc[o.id]) || 0) / total;
        for (const [a, e] of Object.entries(o.effects || {})) {
          picked[a] = (picked[a] || 0) + e * share;
          maxAbs[a] = Math.max(maxAbs[a] || 0, Math.abs(e));
        }
        addCand(sc, o.cand, share);
        addReads(sc, o.reads, share);
        if (share >= 0.5) takeFlags(sc, o);
      }
      observe(sc, picked, maxAbs);
      summary = q.options.map(o => `${o.id}:${alloc[o.id] || 0}`).join(' ');
      break;
    }
    case 'rank': {
      const order = (answer.order || []).filter(id => findOpt(q, id));
      const f = rankFactors(order.length);
      const picked = {}, maxAbs = {};
      const axes = new Set();
      for (const o of q.options) for (const a of Object.keys(o.effects || {})) axes.add(a);
      order.forEach((id, i) => {
        const o = findOpt(q, id);
        for (const [a, e] of Object.entries(o.effects || {})) picked[a] = (picked[a] || 0) + e * f[i];
        addCand(sc, o.cand, f[i]);
        addReads(sc, o.reads, f[i]);
      });
      for (const a of axes) {
        const effs = q.options.map(o => (o.effects || {})[a] || 0);
        const desc = effs.slice().sort((x, y) => y - x), asc = effs.slice().sort((x, y) => x - y);
        const hi = desc.reduce((t, e, i) => t + e * (f[i] ?? 0), 0);
        const lo = asc.reduce((t, e, i) => t + e * (f[i] ?? 0), 0);
        maxAbs[a] = Math.max(Math.abs(hi), Math.abs(lo));
      }
      observe(sc, picked, maxAbs);
      summary = order.join('>');
      break;
    }
    case 'swipe': {
      const res = answer.cards || {};
      const bits = [];
      for (const c of q.cards || []) {
        const r = res[c.id];
        if (!r || (r.v !== 'yes' && r.v !== 'no')) { bits.push(`${c.id}:-`); continue; }
        const fast = (Number(r.ms) || 99999) < FAST_SWIPE_MS;
        sc.signals.swipes++;
        if (fast) sc.signals.fastSwipes++;
        // A card's reads: readsYes / readsNo, or `reads` for the yes side.
        const vecs = [{ effects: c.yes || {}, cand: c.candYes || {}, reads: c.readsYes || c.reads }, { effects: c.no || {}, cand: c.candNo || {}, reads: c.readsNo }];
        observePick(sc, vecs, r.v === 'yes' ? vecs[0] : vecs[1], 1, fast ? 1.25 : 1);
        bits.push(`${c.id}:${r.v}${fast ? '!' : ''}`);
      }
      summary = bits.join(' ');
      break;
    }
    case 'whosaid': {
      const g = findOpt(q, answer.guess);
      if ((q.options || []).some(o => o.effects && Object.keys(o.effects).length)) observePick(sc, q.options, g);
      else if (g) { if (g.cand) addCand(sc, g.cand); addReads(sc, g.reads); }
      const agreeVec = { effects: q.agree?.effects || {}, cand: q.agree?.cand || (q.answer ? { [q.answer]: 2 } : {}), reads: q.agree?.reads };
      const disVec = { effects: q.disagree?.effects || {}, cand: q.disagree?.cand || {}, reads: q.disagree?.reads };
      observePick(sc, [agreeVec, disVec], answer.agree ? agreeVec : disVec, 1, 1, false);
      summary = `${answer.guess}${answer.guess === q.answer ? '(right)' : '(wrong)'} ${answer.agree ? 'agree' : 'disagree'}`;
      break;
    }
    default: break;
  }

  // Behavioural signals.
  const touchesLoyalty = (q.options || []).some(o => o.effects && 'loyalty' in o.effects);
  if ((q.measure.includes('hesitation') || q.type === 'envelope' || touchesLoyalty) && ms > hesitationThreshold(q)) {
    sc.signals.hesitations++;
    addObs(sc, 'mach', 1, 0.5);
  }
  if ((Number(answer.revisions) || 0) >= 2) {
    sc.signals.revisionNudges++;
    sc.signals.revisions++;
    addObs(sc, 'narc', -1, 0.3);
    addObs(sc, 'mach', 1, 0.3);
  }
  for (const r of firedReceipts(q, answer)) sc.receipts.push({ qid: q.id, key: r.key, text: r.text, weight: r.weight, order: sc.qs.length });
  sc.answered.push({ id: q.id, type: q.type, ms, summary });
  sc.qs.push(q);
  sc.ans.push(answer);
  return summary;
}

export function axisScores(sc) {
  const out = {};
  for (const a of AXIS_IDS) {
    const W = sc.W[a] || 0;
    out[a] = { value: W > 0 ? clamp(sc.S[a] / W, -2, 2) : 0, evidence: W, conf: Math.min(1, W / EVIDENCE_FULL) };
  }
  return out;
}

export function affinityPct(points) {
  return AFF_MAX * Math.tanh((points || 0) / 6);
}

// ---- the canonical policy: how candidate c answers q ----------------------------------------
const dot = (e, c) => { let s = 0; for (const [a, d] of Object.entries(e || {})) s += d * (c.axes[a] || 0); return s; };
const fit = (v, c) => dot(v.effects, c) + 2 * ((v.cand || {})[c.id] || 0);
const bestOf = (list, c) => { let b = null, bs = -Infinity; for (const o of list) { const f = fit(o, c); if (f > bs + 1e-9) { bs = f; b = o; } } return b; };

export function predictAnswer(q, c, byId = null) {
  switch (q.type) {
    case 'slider': {
      const e = q.slider?.effects || {};
      let num = 0, den = 0;
      for (const [a, d] of Object.entries(e)) { num += d * (c.axes[a] || 0); den += Math.abs(d); }
      let pos = den ? num / (2 * den) : 0;
      pos += 0.25 * (((q.slider?.candRight || {})[c.id] || 0) - ((q.slider?.candLeft || {})[c.id] || 0));
      return { value: clamp(pos, -1, 1) };
    }
    case 'pin': return { regionId: bestOf(q.regions, c)?.id };
    case 'budget': {
      const sorted = q.options.slice().sort((x, y) => fit(y, c) - fit(x, c));
      return { alloc: { [sorted[0].id]: 70, [sorted[1].id]: 30 } };
    }
    case 'rank': return { order: q.options.slice().sort((x, y) => fit(y, c) - fit(x, c)).map(o => o.id) };
    case 'swipe': return { cards: Object.fromEntries((q.cards || []).map(cd => {
      const y = fit({ effects: cd.yes, cand: cd.candYes }, c), n = fit({ effects: cd.no, cand: cd.candNo }, c);
      return [cd.id, { v: y >= n ? 'yes' : 'no', ms: 2000 }];
    })) };
    case 'whosaid': {
      const ag = { effects: q.agree?.effects, cand: q.agree?.cand || (q.answer ? { [q.answer]: 2 } : {}) };
      const di = { effects: q.disagree?.effects, cand: q.disagree?.cand };
      return { guess: q.answer, agree: fit(ag, c) >= fit(di, c) };
    }
    case 'draft': {
      // Pick yourself; otherwise the nearest candidate in the pool, nudged by the option's own effects.
      const near = o => {
        const k = byId?.get(o.id);
        let d = 0;
        if (k) for (const a of Object.keys(c.axes)) d += (c.axes[a] - (k.axes[a] || 0)) ** 2;
        return -Math.sqrt(d) + 0.3 * dot(o.effects, c) + (o.id === c.id ? 100 : 0);
      };
      let b = null, bs = -Infinity;
      for (const o of q.options) { const f = near(o); if (f > bs) { bs = f; b = o; } }
      return { optionId: b?.id };
    }
    case 'hold': return { optionId: bestOf(q.options, c)?.id, holdStrength: 0.5 };
    default: return { optionId: bestOf(q.options, c)?.id };
  }
}

// How far the player's answer is from the candidate's predicted answer on one question, 0..1.
export function disagreement(q, a, b) {
  switch (q.type) {
    case 'slider': return Math.min(1, Math.abs((Number(a.value) || 0) - (Number(b.value) || 0)) / 2);
    case 'pin': return a.regionId === b.regionId ? 0 : 1;
    case 'budget': {
      let diff = 0;
      for (const o of q.options) diff += Math.abs((Number(a.alloc?.[o.id]) || 0) - (Number(b.alloc?.[o.id]) || 0));
      return Math.min(1, diff / 200);
    }
    case 'rank': {
      const ia = a.order || [], ib = b.order || [];
      if (!ia.length) return 0.5;
      let d = 0;
      ia.forEach((id, k) => { d += Math.abs(k - Math.max(0, ib.indexOf(id))); });
      const n = ia.length, worst = Math.floor((n * n) / 2) || 1;
      return Math.min(1, d / worst);
    }
    case 'swipe': {
      let n = 0, d = 0;
      for (const [id, r] of Object.entries(a.cards || {})) {
        if (!r || !r.v) continue;
        n++;
        if (b.cards?.[id]?.v !== r.v) d++;
      }
      return n ? d / n : 0.5;
    }
    case 'whosaid': return a.agree === b.agree ? 0 : 1;
    default: return a.optionId === b.optionId ? 0 : 1;
  }
}

// Predicted profiles are cached on the scorer and extended as questions are answered.
// key picks the cache (candidates, or the camps' stand-in profiles); byId resolves draft pools.
function predicted(sc, candidates, key = '_pred', byIdIn = null) {
  if (!sc[key]) sc[key] = {};
  const byId = byIdIn || sc._byId || (sc._byId = new Map(candidates.map(c => [c.id, c])));
  for (const c of candidates) {
    let p = sc[key][c.id];
    if (!p) p = sc[key][c.id] = { scorer: createScorer(), n: 0 };
    if (!p.dis) p.dis = [];
    for (; p.n < sc.qs.length; p.n++) {
      const q = sc.qs[p.n];
      const pa = predictAnswer(q, c, byId);
      applyAnswer(p.scorer, q, { ...pa, ms: 0 });
      p.dis.push(disagreement(q, sc.ans[p.n] || {}, pa));
    }
  }
  return sc[key];
}

// For matching, the player's answers are replayed without the behavioural multipliers (hold strength,
// swipe speed, hesitation and revision nudges), so they meet the predicted profiles on equal terms; the
// signals still shape the displayed profile.
function neutral(sc) {
  if (!sc._neutral) sc._neutral = { scorer: createScorer(), n: 0 };
  const nt = sc._neutral;
  for (; nt.n < sc.qs.length; nt.n++) {
    const a = sc.ans[nt.n] || {};
    const flat = { ...a, ms: 0, revisions: 0 };
    if ('holdStrength' in flat) flat.holdStrength = 0.5;
    if (flat.cards) flat.cards = Object.fromEntries(Object.entries(flat.cards).map(([k, v]) => [k, v && { ...v, ms: 2000 }]));
    applyAnswer(nt.scorer, sc.qs[nt.n], flat);
  }
  return nt.scorer;
}

export function matchCandidates(sc, candidates, route) {
  const scores = axisScores(neutral(sc));
  const pred = predicted(sc, candidates);
  const rows = candidates.map(c => {
    const ps = axisScores(pred[c.id].scorer);
    let num = 0, den = 0, rawNum = 0;
    for (const ax of AXES) {
      const s = scores[ax.id];
      if (!(s.evidence > 0)) continue;
      const w = GROUP_WEIGHT[ax.group] * s.conf;
      num += w * (s.value - ps[ax.id].value) ** 2;
      rawNum += w * (s.value - (c.axes?.[ax.id] || 0)) ** 2;
      den += w;
    }
    // Axis distance to the predicted profile, plus how often the player answered differently from the
    // candidate's predicted pick (separates near neighbours such as Pence and Kemp).
    const dis = pred[c.id].dis || [];
    const D = dis.length ? dis.reduce((t, v) => t + v, 0) / dis.length : 0.5;
    const dist = den > 0 ? Math.sqrt(num / den + CAL.choiceW * D * D) : 2;
    const rawDist = den > 0 ? Math.sqrt(rawNum / den) : 2;
    const aff = affinityPct(sc.cand[c.id]);
    const nudge = c.party === route ? ROUTE_NUDGE : 0;
    // Random answering drifts closer to every profile as a run gets longer, so distance is scaled
    // by run length before it becomes a percentage.
    const dEff = dist * Math.pow(Math.max(10, sc.qs.length) / 50, CAL.lenPow);
    const raw = 100 * Math.exp(-Math.pow(dEff / CAL.d0, CAL.p)) + aff + nudge - 0.01 * rawDist;
    return { id: c.id, name: c.name, party: c.party, dist, rawDist, affinity: sc.cand[c.id] || 0, picks: sc.picks[c.id] || 0, raw, pct: Math.round(clamp(raw, 1, 99)) };
  });
  rows.sort((a, b) => b.raw - a.raw || a.dist - b.dist || (a.id < b.id ? -1 : 1));
  return rows;
}

// Ideology camps (data/camps.json). Each camp's centroid stands in for a candidate: it answers the
// player's questions with the canonical policy, and the player is compared with that predicted profile
// on the axes the camp is defined by, so a consistent player lands in their camp instead of drifting
// toward the moderate ones. fit % = 100 x (1 - rms / 3). candidates resolve draft pools.
export function matchCamps(sc, camps, candidates, route = null) {
  const scores = axisScores(neutral(sc));
  const stand = (camps || []).map(k => ({ id: `camp:${k.id}`, axes: { ...k.centroid } }));
  const byId = new Map((candidates || []).map(c => [c.id, c]));
  const pred = predicted(sc, stand, '_campPred', byId);
  const rows = [];
  for (const k of camps || []) {
    if (route && k.party !== route) continue;
    const ps = axisScores(pred[`camp:${k.id}`].scorer);
    let num = 0, den = 0;
    for (const a of Object.keys(k.centroid || {})) {
      const s = scores[a];
      if (!s || !(s.evidence > 0)) continue;
      const w = 0.25 + 0.75 * s.conf;
      num += w * (s.value - ps[a].value) ** 2;
      den += w;
    }
    const rms = den > 0 ? Math.sqrt(num / den) : 3;
    rows.push({ id: k.id, short: k.short, name: k.name, blurb: k.blurb || '', party: k.party, rms, pct: Math.round(clamp(100 * (1 - rms / 3), 0, 100)) });
  }
  rows.sort((x, y) => x.rms - y.rms || (x.id < y.id ? -1 : 1));
  return rows;
}

export function ranking(sc, candidates, route) {
  return matchCandidates(sc, candidates, route).map(r => r.id);
}

// One-line reason: the axes where player and candidate agree most, on a distinctive side.
// avoid: phrases already used on higher rows, so five rows do not all say the same thing.
export function reasonFor(scores, cand, picks = 0, avoid = null) {
  const hits = [];
  for (const ax of AXES) {
    const s = scores[ax.id];
    const k = cand.axes?.[ax.id];
    if (!s || !(s.evidence > 0) || !Number.isFinite(k)) continue;
    if (Math.abs(s.value) < 0.3 || Math.abs(k) < 0.5 || Math.sign(s.value) !== Math.sign(k)) continue;
    const score = s.conf * Math.min(Math.abs(k), Math.abs(s.value)) * (1 - Math.abs(s.value - k) / 4) * (ax.group === 'ideology' ? 1 : 0.85);
    hits.push({ score, phrase: k > 0 ? ax.likePos : ax.likeNeg });
  }
  hits.sort((a, b) => b.score - a.score);
  const fresh = avoid ? hits.filter(h => !avoid.has(h.phrase)) : hits;
  const ph = (fresh.length >= 2 ? fresh : hits).slice(0, 3).map(h => h.phrase);
  if (avoid) for (const p of ph) avoid.add(p);
  let line;
  if (ph.length === 0) line = 'Closest on the overall balance, not on any one fight.';
  else if (ph.length === 1) line = `Like you: ${ph[0]}.`;
  else line = `Like you: ${ph.slice(0, -1).join(', ')} and ${ph[ph.length - 1]}.`;
  if (picks >= 2) line += ' You kept picking them.';
  line = line.charAt(0).toUpperCase() + line.slice(1);
  return line;
}
