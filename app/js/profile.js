// The player's profile for the result screen and share card: ideology camp (data/camps.json),
// three personality words and a few flags. `camps` is the parsed data/camps.json camps array.

import { AXES, AXIS_IDS } from './axes.js?v=c583357-1795003897';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// RMS distance over the axes a camp defines. fit % = 100 x (1 - rms / 3).
export function campFit(values, camp) {
  const ks = Object.entries(camp.centroid || {});
  if (!ks.length) return { rms: 4, pct: 0 };
  let s = 0;
  for (const [k, v] of ks) s += ((values[k] || 0) - v) ** 2;
  const rms = Math.sqrt(s / ks.length);
  return { rms, pct: clamp(Math.round(100 * (1 - rms / 3)), 0, 100) };
}

// Nearest camp, optionally inside one party.
export function campFor(values, camps, party) {
  let best = null;
  for (const camp of camps || []) {
    if (party && camp.party !== party) continue;
    const f = campFit(values, camp);
    if (!best || f.rms < best.rms) best = { camp, ...f };
  }
  if (!best) return null;
  const { camp, rms, pct } = best;
  return { id: camp.id, short: camp.short, name: camp.name, blurb: camp.blurb || '', party: camp.party, rms, pct };
}

// ---- personality words -------------------------------------------------------------------------
const TRAIT_RULES = [
  ['mach', 1, 'Opportunistic', 1], ['mach', 1, 'Secretive', 0.9], ['mach', 1, 'Transactional', 0.85], ['mach', 1, 'Calculating', 0.7],
  ['mach', -1, 'Honest', 1], ['mach', -1, 'Principled', 0.9], ['mach', -1, 'Scrupulous', 0.8],
  ['narc', 1, 'Ambitious', 1], ['narc', 1, 'Competitive', 0.8], ['narc', 1, 'Vain', 0.6],
  ['narc', -1, 'Patient', 0.7], ['narc', -1, 'Modest', 0.6],
  ['psych', 1, 'Ruthless', 1], ['psych', 1, 'Vindictive', 0.7],
  ['psych', -1, 'Protective', 0.9], ['psych', -1, 'Public-Spirited', 0.8], ['psych', -1, 'Trusting', 0.6],
  ['loyalty', 1, 'Loyal', 1], ['loyalty', 1, 'Partisan', 0.8],
  ['loyalty', -1, 'Independent', 1], ['loyalty', -1, 'Maverick', 0.6],
  ['style', 1, 'Combative', 1], ['style', 1, 'Competitive', 0.7], ['style', 1, 'Impulsive', 0.6],
  ['style', -1, 'Diplomatic', 1], ['style', -1, 'Consensus-Seeker', 0.9], ['style', -1, 'Composed', 0.7],
  ['system', 1, 'Populist', 0.9], ['system', 1, 'Maverick', 0.9], ['system', 1, 'Restless', 0.6],
  ['system', -1, 'Institutionalist', 1], ['system', -1, 'Cautious', 0.6],
  ['online', 1, 'Restless', 0.6], ['online', 1, 'Attention-Seeking', 0.5],
  ['online', -1, 'Conventional', 0.5], ['online', -1, 'Aloof', 0.4],
  ['tech', 1, 'Technocrat', 0.8], ['tech', 1, 'Inventive', 0.5],
  ['democracy', 1, 'Consensus-Seeker', 0.5], ['democracy', -1, 'Decisive', 0.7], ['democracy', -1, 'Combative', 0.5],
  ['dynasty', 1, 'Machine-Minded', 0.8],
  ['libertine', 1, 'Impulsive', 0.6], ['libertine', -1, 'Disciplined', 0.8], ['libertine', -1, 'Scrupulous', 0.5],
  ['faith', 1, 'Principled', 0.5],
];

export const TRAIT_OPPOSITES = [
  ['Patient', 'Impulsive'], ['Cautious', 'Impulsive'], ['Restless', 'Composed'], ['Restless', 'Patient'],
  ['Attention-Seeking', 'Aloof'], ['Attention-Seeking', 'Modest'], ['Diplomatic', 'Combative'], ['Ruthless', 'Trusting'],
  ['Decisive', 'Cautious'], ['Inventive', 'Conventional'], ['Vain', 'Modest'],
  ['Honest', 'Calculating'], ['Honest', 'Secretive'], ['Scrupulous', 'Opportunistic'], ['Principled', 'Opportunistic'],
  ['Principled', 'Transactional'], ['Ruthless', 'Protective'], ['Ruthless', 'Public-Spirited'],
  ['Pragmatist', 'Ideologue'], ['Partisan', 'Independent'], ['Institutionalist', 'Maverick'],
  ['Institutionalist', 'Populist'], ['Technocrat', 'Populist'], ['Consensus-Seeker', 'Combative'],
  ['Loyal', 'Independent'], ['Loyal', 'Vindictive'], ['Disciplined', 'Impulsive'],
];

export function areOpposite(a, b) {
  return TRAIT_OPPOSITES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

// scores: axisScores() output. Returns 3 words, no opposite pairs.
export function suggestTraits(scores) {
  const best = {};
  const bump = (t, s) => { if (s > (best[t] || 0)) best[t] = s; };
  for (const [axis, dir, trait, w] of TRAIT_RULES) {
    const s = scores[axis];
    if (!s || !(s.evidence > 0)) continue;
    const v = s.value * dir;
    if (v < 0.4) continue;
    bump(trait, v * w * (0.5 + 0.5 * s.conf));
  }
  const ideo = AXES.filter(a => a.group === 'ideology' && scores[a.id]?.evidence > 0);
  if (ideo.length) {
    const mean = ideo.reduce((t, a) => t + Math.abs(scores[a.id].value), 0) / ideo.length;
    if (mean > 1.1) bump('Ideologue', (mean - 0.7) * 1.5);
    if (mean < 0.6) bump('Pragmatist', (0.9 - mean) * 1.5);
  }
  const ranked = Object.entries(best).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(e => e[0]);
  const out = [];
  for (const t of ranked.concat(['Pragmatist', 'Adaptable', 'Ambitious', 'Resilient'])) {
    if (out.length >= 3) break;
    if (out.includes(t) || out.some(o => areOpposite(o, t))) continue;
    out.push(t);
  }
  return out;
}

export function deriveFlags(scores, scorerFlags = {}) {
  const faith = scorerFlags.faith || null;
  return {
    dynasty: (scores.dynasty?.value || 0) >= 1.2,
    faithProfessed: faith ? faith.professed : null,
    faithPrivate: faith ? faith.private : null,
  };
}

// Full profile used by the result screen and the share card. campRows: matchCamps() over every camp
// (scoring.js); without them (tests, or no scorer) the camp comes from the raw axis values.
export function buildProfile({ scores, matches, camps, route, scorerFlags, campRows = null }) {
  const values = Object.fromEntries(AXIS_IDS.map(a => [a, scores[a].value]));
  const strip = r => r && { id: r.id, short: r.short, name: r.name, blurb: r.blurb || '', party: r.party, rms: r.rms, pct: r.pct };
  const camp = campRows ? strip(campRows.find(r => r.party === route)) : camps ? campFor(values, camps, route) : null;
  const anyCamp = campRows ? strip(campRows[0]) : camps ? campFor(values, camps, null) : null;
  // The route decides the camp, but when the other party's nearest camp fits clearly better
  // (10 points or more), say so.
  const campAlt = camp && anyCamp && anyCamp.party !== camp.party && anyCamp.pct >= camp.pct + 10 ? anyCamp : null;
  const top = matches.slice(0, 5);
  return { values, camp, campAlt, top, traits: suggestTraits(scores), flags: deriveFlags(scores, scorerFlags) };
}
