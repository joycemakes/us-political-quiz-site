// The run selector (SPEC section 3, revised after playtest 1). Pure, seeded, no DOM.
//
//  - Chapters in order, each with a share of the run (10/20/15/15/15/10/15 %). A chapter never takes
//    more than half of its own questions in one run (so replays differ), and a slot is only ever filled
//    from its own chapter.
//  - Questions 1-20: broad sweep, favouring high discrimination and core tier.
//  - From 21: adaptive, preferring questions whose options split the current top 5, but never the same
//    main axis three times running.
//  - Coverage: signature questions for the current top 8 are boosted, and forced (within the chapter)
//    when the chapters that can still cover a leader are running out of slots.
//  - Route filter; bombshell spacing (1 in any 8); no pin-pin or whosaid-whosaid; at most 1 draft in
//    any 8; a topic never twice within 6 questions and at most 2 per 50; `excludes` respected.
//  - Election night: `phase` count first, then one outcome (loss or victory, never both); `finale` last.
//  - A per-device seen-list (passed in) makes unseen questions preferred on replays.

import { CHAPTERS, CHAPTER_SHARE } from './axes.js';
import { routeOk, optionVectors, prepareQuestion } from './questions.js';
import { makeRng } from './rng.js';
import { predictAnswer } from './scoring.js';

// Run lengths, in one place (Chris, 17 Nov 2026): Quick 45, Full Dossier 90. Both meet the matching
// bar (like-candidate bots first for 22+ of 23, random play's best match under 75%; app/tests/run.mjs).
export const QUICK_LENGTH = 45;
export const FULL_LENGTH = 90;
// Everything that depends on length scales from the per-50 figures below.
export const SWEEP = 20;            // at 50; sweepAt(n) = min(21, round(0.4 n)): 14 at 35, 21 at 70
export const BOMB_GAP = 8;          // at 50; bombGap(n) = clamp(round(8 n / 50), 6, 10): 6 at 35, 10 at 70
export const COVER_TOP = 8;         // at 50; coverTop(n) = clamp(round(8 n / 50), 5, 8): 6 at 35, 8 at 70
// Short runs lean harder on high-discrimination questions early, so 35 answers still separate.
export let SWEEP_DISC = 2, SWEEP_NOISE = 1.2, LEADER_SPLIT_W = 3;
export const setSweepWeights = (d, n, l = LEADER_SPLIT_W) => { SWEEP_DISC = d; SWEEP_NOISE = n; LEADER_SPLIT_W = l; };
export const sweepAt = n => Math.min(21, Math.round(0.4 * n));
export const bombGap = n => Math.max(6, Math.min(10, Math.round((BOMB_GAP * n) / 50)));
export const coverTop = n => Math.max(5, Math.min(COVER_TOP, Math.round((COVER_TOP * n) / 50)));
export const DRAFT_GAP = 8;
export const TOPIC_GAP = 6;
export const TOPIC_PER_50 = 2;
export const CHAPTER_MAX_SHARE = 0.5;
const VARIETY = 0.9;
export const WHOSAID_SHARE = 0.065;
export const WHOSAID_MAX_SHARE = 0.09;
const TYPES_IN_PLAY = 10;
const NO_REPEAT_TYPES = new Set(['pin', 'whosaid']);
// Special interactions: never twice within any four questions, at most a quarter of a chapter.
export const SPECIAL_TYPES = new Set(['whosaid', 'budget', 'rank', 'draft', 'swipe', 'sign', 'envelope', 'pin']);
export const SPECIAL_GAP = 4;
export const CHAPTER_TYPE_SHARE = 0.25;
export const SWIPE_PER_50 = 2;
// Heavy types per 50 questions (first-timer playtest: five budgets, eight holds in a run).
export const TYPE_PER_50 = { budget: 3, hold: 5, rank: 3, draft: 3, sign: 3 };
export const SWIPE_GAP = 10;
// Topic groups: related slugs that must be spaced as one (playtest 2: eight family questions in fourteen,
// four affair questions in a row). A topic may sit in more than one group.
export const TOPIC_GROUPS = {
  family: ['dynasty-family', 'heir-apparent', 'family-seat', 'family-on-staff', 'inherited-money', 'fathers-shadow',
    'first-family-business', 'candidates-children', 'vanity-bestseller', 'self-funding'],
  'sex-and-marriage': ['affairs', 'office-romance', 'private-lives', 'billy-graham-rule', 'character-curve', 'hypocrisy-scandals'],
  loyalty: ['loyalty-test', 'loyalty-to-the-leader', 'serving-your-insulter', 'endorsing-your-insulter', 'staff-loyalty', 'who-you-owe'],
  'federal-vs-state': ['state-defiance', 'guard-in-cities', 'states-rights', 'swing-state-defiance', 'overturn-your-state'],
  certification: ['certifying-2020', 'overturn-your-state', 'election-rules'],
  'orders-and-force': ['illegal-orders', 'use-of-force', 'war-powers', 'troops-vs-cartels'],
  'dirty-campaign': ['dirt-on-rival', 'dirty-tricks', 'ruthless-ads', 'petty-revenge'],
  'big-tech': ['big-tech', 'tech-right', 'tech-donor-money', 'ai-speed', 'ai-state-laws', 'data-centers'],
  platform: ['platform', 'windfall-budget', 'convention-lineup'],
};
export const GROUP_PER_50 = 3;
export const GROUP_GAP = 3;
const GROUPS_OF = {};
for (const [g, list] of Object.entries(TOPIC_GROUPS)) for (const t of list) (GROUPS_OF[t] = GROUPS_OF[t] || []).push(g);
export const groupsOf = topic => GROUPS_OF[topic] || [];
// Axes that read as one subject to a player: never main axis twice running, in any phase.
const PERSONAL_AXES = new Set(['dynasty', 'libertine', 'loyalty']);

export function mainAxis(q) {
  const tot = {};
  for (const v of optionVectors(q)) for (const [a, d] of Object.entries(v.effects || {})) tot[a] = (tot[a] || 0) + Math.abs(d);
  let best = null, bv = 0;
  for (const [a, v] of Object.entries(tot)) if (v > bv) { bv = v; best = a; }
  return best;
}

export function planQuotas(bank, route, length) {
  const pool = bank.filter(q => routeOk(q, route));
  const avail = Object.fromEntries(CHAPTERS.map(c => [c, 0]));
  for (const q of pool) if (q.chapter in avail) avail[q.chapter]++;
  // Small chapters may give at most half their questions to one run.
  const cap = Object.fromEntries(CHAPTERS.map(c => [c, Math.min(avail[c], Math.max(1, Math.ceil(avail[c] * CHAPTER_MAX_SHARE)))]));
  const capTotal = CHAPTERS.reduce((t, c) => t + cap[c], 0);
  const total = Math.min(length, pool.length);
  const room = capTotal >= total ? cap : avail; // tiny banks: fall back to everything
  const quotas = Object.fromEntries(CHAPTERS.map(c => [c, 0]));
  let remaining = total;
  let open = CHAPTERS.filter(c => room[c] > 0);
  while (remaining > 0 && open.length) {
    const wsum = open.reduce((t, c) => t + CHAPTER_SHARE[c], 0);
    const alloc = open.map(c => ({ c, x: (remaining * CHAPTER_SHARE[c]) / wsum })).map(e => ({ ...e, n: Math.floor(e.x) }));
    let given = alloc.reduce((t, a) => t + a.n, 0);
    alloc.sort((a, b) => (b.x - b.n) - (a.x - a.n) || CHAPTERS.indexOf(a.c) - CHAPTERS.indexOf(b.c));
    for (let i = 0; given < remaining && i < alloc.length; i++, given++) alloc[i].n++;
    let progressed = false;
    for (const a of alloc) {
      const n = Math.min(a.n, room[a.c] - quotas[a.c]);
      if (n > 0) progressed = true;
      quotas[a.c] += n;
      remaining -= n;
    }
    open = open.filter(c => quotas[c] < room[c]);
    if (!progressed) break;
  }
  const planned = CHAPTERS.reduce((t, c) => t + quotas[c], 0);
  return { quotas, total: planned, avail, cap };
}

// How strongly a question's options pull the leaders apart.
export function splitScore(q, leaders) {
  if (!leaders.length) return 0;
  const axes = new Set();
  for (const c of leaders) for (const a of Object.keys(c.axes || {})) axes.add(a);
  const mean = {};
  for (const a of axes) mean[a] = leaders.reduce((t, c) => t + (c.axes[a] || 0), 0) / leaders.length;
  const vecs = optionVectors(q);
  if (!vecs.length) return 0;
  let total = 0;
  for (const v of vecs) {
    const pulls = leaders.map(c => {
      let p = 0;
      for (const [a, d] of Object.entries(v.effects || {})) if (a in mean) p += d * ((c.axes[a] || 0) - mean[a]);
      p += 1.5 * ((v.cand || {})[c.id] || 0);
      return p;
    });
    total += Math.max(...pulls) - Math.min(...pulls);
  }
  return total / vecs.length;
}

// How differently the leading candidates would answer q (1 = all the same). A question the leaders
// answer differently separates them directly, which matters most in short runs.
function answerKey(a) {
  if (a.optionId) return a.optionId;
  if (a.regionId) return a.regionId;
  if (a.value != null) return a.value > 0.33 ? 'R' : a.value < -0.33 ? 'L' : 'C';
  if (a.order) return a.order.slice(0, 2).join('>');
  if (a.cards) return Object.values(a.cards).map(c => (c.v === 'yes' ? 1 : 0)).join('');
  if (a.alloc) return Object.keys(a.alloc).sort().join('+');
  if (a.guess) return String(a.agree);
  return '';
}
export function leaderSplit(q, leaders, byIdMap) {
  return new Set(leaders.map(c => answerKey(predictAnswer(q, c, byIdMap)))).size;
}

export function createSelector({ bank, candidates, route, length, seed, seen = null }) {
  const rng = makeRng(seed);
  // Election night tells one story: the count, then either the loss or the victory.
  const outcomes = { loss: 0, victory: 0 };
  for (const q of bank) if (routeOk(q, route) && q.chapter === 'election_night' && q.phase in outcomes) outcomes[q.phase]++;
  const outcome = outcomes.loss && outcomes.victory
    ? (rng.next() < outcomes.victory / (outcomes.loss + outcomes.victory) ? 'victory' : 'loss')
    : (outcomes.victory ? 'victory' : outcomes.loss ? 'loss' : null);
  const other = outcome === 'victory' ? 'loss' : outcome === 'loss' ? 'victory' : null;
  // One outcome per run, in every chapter: a run that loses never also gets a victory question.
  const pool = bank.filter(q => routeOk(q, route) && !(other && q.phase === other));
  const finale = pool.find(q => q.finale) || null;
  const { quotas } = planQuotas(pool, route, length);
  const slots = [];
  for (const c of CHAPTERS) for (let k = 0; k < quotas[c]; k++) slots.push(c);
  // Phase plan for election night: count, then the outcome; the finale takes the very last slot.
  const phaseAt = new Array(slots.length).fill(null);
  {
    const en = slots.map((c, k) => (c === 'election_night' ? k : -1)).filter(k => k >= 0);
    // Outcome questions that share a topic cannot both be asked, so count distinct topics.
    const outQs = pool.filter(q => q.chapter === 'election_night' && q.phase === outcome);
    const outN = new Set(outQs.map(q => q.topic || q.id)).size;
    const hasFinale = finale && finale.chapter === 'election_night' && en.length;
    const body = hasFinale ? en.slice(0, -1) : en;
    const k = outcome ? Math.min(outN, 3, Math.max(1, Math.round(body.length * 0.25))) : 0;
    body.forEach((s, j) => { phaseAt[s] = j >= body.length - k ? outcome : 'count'; });
    if (hasFinale) phaseAt[en[en.length - 1]] = 'finale';
  }
  if (finale && finale.chapter !== 'election_night' && slots.length) phaseAt[slots.length - 1] = 'finale';

  const byId = Object.fromEntries(candidates.map(c => [c.id, c]));
  const byIdMap = new Map(candidates.map(c => [c.id, c]));
  const used = new Set();
  const history = [];
  const covered = new Set();
  const lev12Seen = new Set();
  const typeCount = {};
  const topicCount = {};
  const groupCount = {};
  const chapterTypeCount = {};
  let lastSwipe = -Infinity;
  const axisOf = new Map();
  let faithDone = false;
  let lastBomb = -Infinity, lastDraft = -Infinity;
  const topicCap = () => Math.max(1, Math.round((TOPIC_PER_50 * slots.length) / 50));
  const groupCap = () => Math.max(2, Math.round((GROUP_PER_50 * slots.length) / 50));
  const swipeCap = () => Math.max(1, Math.round((SWIPE_PER_50 * slots.length) / 50));
  const chapterSlots = ch => slots.filter(c => c === ch).length;
  // Special interactions: a quarter of a chapter at most; common ones (hold, slider, dilemma) 40%.
  const chapterTypeCap = (ch, type) => (type === 'choice' ? Infinity
    : type === 'whosaid' ? Math.max(1, Math.ceil(chapterSlots(ch) * 0.4)) // its questions sit mostly in one chapter
    : SPECIAL_TYPES.has(type) ? Math.max(1, Math.floor(chapterSlots(ch) * CHAPTER_TYPE_SHARE))
      : Math.max(2, Math.ceil(chapterSlots(ch) * 0.4)));
  const ax = q => { if (!axisOf.has(q.id)) axisOf.set(q.id, mainAxis(q)); return axisOf.get(q.id); };

  const sigFor = id => pool.filter(q => !used.has(q.id) && q.signature.includes(id) && !q.finale);
  const slotsLeftIn = (chapter, from) => { let n = 0; for (let k = from; k < slots.length; k++) if (slots[k] === chapter) n++; return n; };

  function excluded(q) {
    if ((q.excludes || []).some(id => used.has(id))) return true;
    if ((q.requires || []).some(id => !used.has(id))) return true;
    for (const h of history) if ((h.excludes || []).includes(q.id)) return true;
    return false;
  }

  // Hard rules: duplicates, excludes, requires, bombshell and draft spacing, the topic gap and cap, the
  // topic-group cap, the swipe cap. relax 1 drops the main-axis rules; relax 2 the type spacing rules;
  // relax 3 the topic-group gap; relax 4 the type caps (per chapter and per run). After that a slot is
  // filled from the nearest other chapter (chapter purity), and only then are the hard caps eased.
  // A slot is never dropped while the route has an unused question.
  function constraintsOk(q, i, relax, adaptive) {
    if (used.has(q.id) || excluded(q)) return false;
    if (q.tier === 'bombshell' && i - lastBomb < bombGap(slots.length)) return false;
    if (q.type === 'draft' && i - lastDraft < DRAFT_GAP) return false;
    if (q.topic) {
      if ((topicCount[q.topic] || 0) >= topicCap()) return false;
      for (let k = Math.max(0, history.length - (TOPIC_GAP - 1)); k < history.length; k++) if (history[k].topic === q.topic) return false;
      for (const g of groupsOf(q.topic)) {
        if ((groupCount[g] || 0) >= groupCap()) return false;
        if (relax < 3) for (let k = Math.max(0, history.length - (GROUP_GAP - 1)); k < history.length; k++) if (groupsOf(history[k].topic).includes(g)) return false;
      }
    }
    if (q.type === 'swipe' && (typeCount.swipe || 0) >= swipeCap()) return false;
    if (q.type === 'whosaid' && (typeCount.whosaid || 0) >= Math.round(slots.length * WHOSAID_MAX_SHARE)) return false;
    const ch = slots[i];
    if (relax < 4 && ((chapterTypeCount[ch] || {})[q.type] || 0) >= chapterTypeCap(ch, q.type)) return false;
    if (relax < 4 && TYPE_PER_50[q.type] && (typeCount[q.type] || 0) >= Math.max(1, Math.round((TYPE_PER_50[q.type] * slots.length) / 50))) return false;
    const prev = history[history.length - 1];
    const a = ax(q);
    if (relax < 1 && adaptive && history.length >= 2) {
      const h1 = history[history.length - 1], h2 = history[history.length - 2];
      if (a && h1.axis === a && h2.axis === a) return false;
    }
    if (relax < 1 && a && PERSONAL_AXES.has(a) && prev && prev.axis === a) return false;
    if (prev && NO_REPEAT_TYPES.has(q.type) && prev.type === q.type) return false; // never relaxed
    if (relax < 2 && SPECIAL_TYPES.has(q.type)) {
      for (let k = Math.max(0, history.length - (SPECIAL_GAP - 1)); k < history.length; k++) if (history[k].type === q.type) return false;
    }
    if (relax < 2 && q.type === 'swipe' && i - lastSwipe < SWIPE_GAP) return false;
    // Common types: never three in a row.
    if (relax < 2 && history.length >= 2 && history[history.length - 1].type === q.type && history[history.length - 2].type === q.type) return false;
    return true;
  }

  function phaseOk(q, i) {
    const ph = phaseAt[i];
    if (q.finale) return ph === 'finale';
    if (ph === 'finale') return false;
    if (slots[i] !== 'election_night' || !ph) return true;
    const qp = q.phase || 'count';
    return qp === ph;
  }

  // Which soft rule the last candidate list needed to relax, logged on the question it fills.
  let relaxedBy = null;
  const RELAX_LABEL = [null, null, null, 'group', 'type'];

  // Only ever the slot's own chapter.
  function candidatesFor(i, filter, adaptive) {
    const chapter = slots[i];
    relaxedBy = null;
    // relax 3 (topic-group spacing), then relax 4 (type caps); chapter purity goes after these, in pick().
    for (let relax = 0; relax < 5; relax++) {
      const list = pool.filter(q => q.chapter === chapter && (!filter || filter(q)) && phaseOk(q, i) && constraintsOk(q, i, relax, adaptive));
      // The device's seen-list is a hard preference: questions seen on earlier runs only when nothing unseen fits.
      if (seen && relax < 2) { const fresh = list.filter(q => !seen.has(q.id)); if (fresh.length) return fresh; }
      if (list.length) { relaxedBy = RELAX_LABEL[relax]; return list; }
    }
    // Election night ran out of the planned phase: allow any unused election night question but the finale.
    if (slots[i] === 'election_night' && phaseAt[i] !== 'finale') {
      const outcomeTaken = history.some(h => h.phase && h.phase === outcome);
      const list = pool.filter(q => q.chapter === chapter && !q.finale && (!filter || filter(q)) && (q.phase || 'count') !== other
        && !(outcomeTaken && (q.phase || 'count') === 'count') && constraintsOk(q, i, 2, adaptive));
      if (list.length) { relaxedBy = 'phase'; return list; }
    }
    return [];
  }

  // Last steps for a slot its own chapter cannot fill: relax chapter purity (the nearest chapter with a
  // question that fits, earlier chapters first on a tie, the same relax ladder), then the hard caps
  // (spacing and topic caps; duplicates, excludes, requires, the outcome and the finale still hold).
  function fillAnywhere(i, adaptive) {
    const here = CHAPTERS.indexOf(slots[i]);
    const outcomeTaken = history.some(h => h.phase && h.phase === outcome);
    // Election night keeps its story: no count after the outcome, no outcome borrowed early.
    const storyOk = q => !q.finale && q.phase !== other
      && !(q.chapter === 'election_night' && (outcomeTaken ? (q.phase || 'count') === 'count' : q.phase === outcome));
    const near = q => Math.abs(CHAPTERS.indexOf(q.chapter) - here) + (CHAPTERS.indexOf(q.chapter) > here ? 0.5 : 0);
    for (let relax = 0; relax < 5; relax++) {
      const list = pool.filter(q => q.chapter !== slots[i] && storyOk(q) && constraintsOk(q, i, relax, adaptive));
      if (list.length) { const d = Math.min(...list.map(near)); relaxedBy = 'chapter'; return list.filter(q => near(q) === d); }
    }
    const list = pool.filter(q => !used.has(q.id) && !excluded(q) && storyOk(q));
    if (list.length) { relaxedBy = 'hard'; return list; }
    return [];
  }

  function take(q, i, reason) {
    used.add(q.id);
    if (q.tier === 'bombshell') lastBomb = i;
    if (q.type === 'draft') lastDraft = i;
    for (const c of q.signature) covered.add(c);
    if (q.lev12) lev12Seen.add(q.lev12);
    if (q.faithQ) faithDone = true;
    if (q.topic) topicCount[q.topic] = (topicCount[q.topic] || 0) + 1;
    for (const g of groupsOf(q.topic)) groupCount[g] = (groupCount[g] || 0) + 1;
    typeCount[q.type] = (typeCount[q.type] || 0) + 1;
    const ch = slots[i];
    chapterTypeCount[ch] = chapterTypeCount[ch] || {};
    chapterTypeCount[ch][q.type] = (chapterTypeCount[ch][q.type] || 0) + 1;
    if (q.type === 'swipe') lastSwipe = i;
    history.push({ id: q.id, type: q.type, chapter: q.chapter, slotChapter: slots[i], tier: q.tier, topic: q.topic, excludes: q.excludes, axis: ax(q), phase: q.phase, reason, ...(relaxedBy ? { relaxed: relaxedBy } : {}) });
    relaxedBy = null;
    return prepareQuestion(q, route, byId);
  }

  const pickBy = (list, val) => list.slice().sort((a, b) => val(b) - val(a) || (a.id < b.id ? -1 : 1))[0];
  const seenPenalty = q => (seen && seen.has(q.id) ? 1.6 : 0);

  function next(ranking = []) {
    for (;;) {
      const i = history.length;
      if (i >= slots.length) return null;
      const q = pick(i, ranking);
      if (q) return q;
      // Only when the route has no unused question left at all (a bank smaller than the run): drop the
      // slot, and give a later chapter with questions to spare one more slot instead.
      const ch = slots[i];
      slots.splice(i, 1);
      phaseAt.splice(i, 1);
      const order = CHAPTERS.slice(CHAPTERS.indexOf(ch) + 1).filter(c => c !== 'election_night');
      const spare = order
        .map(c => ({ c, room: pool.filter(q => q.chapter === c && !used.has(q.id)).length - slotsLeftIn(c, i) }))
        .filter(x => x.room > 2)
        .sort((a, b) => b.room - a.room)[0];
      if (spare) {
        let at = -1;
        for (let k = i; k < slots.length; k++) if (slots[k] === spare.c) at = k;
        if (at >= 0) { slots.splice(at + 1, 0, spare.c); phaseAt.splice(at + 1, 0, null); }
      }
    }
  }

  function pick(i, ranking) {
    relaxedBy = null;
    const prev = history[history.length - 1];
    const chapter = slots[i];
    const remaining = slots.length - i;
    const adaptive = i >= sweepAt(slots.length);
    if (phaseAt[i] === 'finale') {
      const l = candidatesFor(i, null, adaptive);
      if (l.length) return take(l[0], i, 'finale');
    }
    const topN = coverTop(slots.length);
    const top8 = ranking.slice(0, topN);
    const uncovered = top8.filter(id => !covered.has(id) && sigFor(id).length);
    const watch = new Set(ranking.slice(topN, topN + 2).filter(id => !covered.has(id) && sigFor(id).length));
    const leftHere = slotsLeftIn(chapter, i);

    // Who-said-it schedule (in-chapter, alternating at most).
    const wsHave = typeCount.whosaid || 0;
    const wsTarget = Math.round(slots.length * WHOSAID_SHARE);
    const wsMax = Math.round(slots.length * WHOSAID_MAX_SHARE);
    const wsNeed = wsTarget - wsHave;
    const wsBehind = wsNeed > 0 && wsHave < wsMax;

    // The faith flag: one professed-versus-private question per run, forced in the last chapter
    // that still has one.
    const faithOwed = !faithDone && pool.some(q => q.faithQ && !used.has(q.id));
    if (faithOwed) {
      const lastFaithCh = Math.max(...pool.filter(q => q.faithQ && !used.has(q.id)).map(q => CHAPTERS.indexOf(q.chapter)));
      if (CHAPTERS.indexOf(chapter) === lastFaithCh && leftHere <= 2) {
        const l = candidatesFor(i, q => q.faithQ, adaptive);
        if (l.length) return take(pickBy(l, q => q.discrimination), i, 'faith');
      }
    }

    // Coverage: force a signature question here when the slots left in chapters that can still cover a
    // leader are about to run out.
    if (uncovered.length) {
      const urgent = uncovered.filter(id => {
        const chs = new Set(sigFor(id).map(q => q.chapter));
        if (!chs.has(chapter)) return false;
        let cap = 0;
        for (let k = i; k < slots.length; k++) if (chs.has(slots[k])) cap++;
        return cap <= uncovered.length + 2;
      });
      if (urgent.length) {
        const need = new Set(urgent);
        const l = candidatesFor(i, q => q.signature.some(id => need.has(id)), adaptive);
        if (l.length) {
          const q = pickBy(l, q => q.signature.filter(id => need.has(id)).length + 0.3 * q.signature.filter(id => uncovered.includes(id)).length + 0.1 * q.discrimination - 0.5 * seenPenalty(q));
          return take(q, i, `cover:${q.signature.filter(id => need.has(id)).join('+')}`);
        }
      }
    }

    // The one exception to chapter purity, logged in the history as borrow:<chapter>: a top-8 leader
    // who has no signature question left in any chapter still to come gets one from the nearest
    // chapter, placed at the end of a chapter (or when the run is about to end).
    if (uncovered.length && phaseAt[i] !== 'finale') {
      const later = new Set(slots.slice(i));
      const stranded = uncovered.filter(id => !sigFor(id).some(q => later.has(q.chapter)));
      if (stranded.length && (leftHere === 1 || remaining <= stranded.length + 2)) {
        const here = CHAPTERS.indexOf(chapter);
        const need = new Set(stranded);
        for (let relax = 0; relax < 3; relax++) {
          const l = pool.filter(q => q.signature.some(id => need.has(id)) && !q.finale && q.phase !== 'loss' && q.phase !== 'victory'
            && !(q.type === 'whosaid' && wsHave >= wsMax)
            && !(q.chapter === 'election_night' && history.some(h => h.phase === 'loss' || h.phase === 'victory'))
            && constraintsOk(q, i, relax, adaptive));
          if (l.length) {
            const q = pickBy(l, q => 2 * q.signature.filter(id => need.has(id)).length - 0.5 * Math.abs(CHAPTERS.indexOf(q.chapter) - here) + 0.1 * q.discrimination - 0.5 * seenPenalty(q));
            return take(q, i, `borrow:${q.chapter}:${q.signature.filter(id => need.has(id)).join('+')}`);
          }
        }
      }
    }

    const wsFull = wsHave >= wsMax;
    let list = candidatesFor(i, wsFull ? q => q.type !== 'whosaid' : null, adaptive);
    if (!list.length) list = candidatesFor(i, null, adaptive);
    if (!list.length) list = fillAnywhere(i, adaptive);
    if (!list.length) return null;
    const leaders = ranking.slice(0, 5).map(id => byId[id]).filter(Boolean);
    const uncSet = new Set(uncovered);
    let best = null, bestScore = -Infinity;
    for (const q of list) {
      let s;
      // Enough seeded noise that the same answers do not always draw the same question (playtest 2: E-025
      // at question 24 and F-003 at question 7 in almost every run).
      if (!adaptive) {
        s = SWEEP_DISC * q.discrimination + (q.tier === 'core' ? 0.5 : 0) + rng.next() * SWEEP_NOISE;
      } else {
        s = 1.2 * Math.min(3, splitScore(q, leaders)) + 0.3 * q.discrimination + rng.next() * 2.2;
        s += LEADER_SPLIT_W * (leaderSplit(q, leaders.slice(0, 3), byIdMap) - 1);
        s += 3 * q.signature.filter(id => uncSet.has(id)).length + q.signature.filter(id => watch.has(id)).length;
      }
      if (prev && prev.type === q.type) s -= 0.6;
      s -= VARIETY * (typeCount[q.type] || 0) / Math.max(1, i / TYPES_IN_PLAY);
      if (!typeCount[q.type] && i >= 2) s += 1.2;
      if (q.lev12 && !lev12Seen.has(q.lev12)) s += 0.8;
      if (faithOwed && q.faithQ && i >= 5) s += 2;
      if (wsBehind && q.type === 'whosaid') s += 6;
      s -= seenPenalty(q);
      if (s > bestScore) { bestScore = s; best = q; }
    }
    return take(best, i, adaptive ? 'adaptive' : 'sweep');
  }

  return {
    get total() { return slots.length; },
    quotas,
    slots,
    history,
    covered,
    lev12Seen,
    outcome,
    get faithDone() { return faithDone; },
    next,
    chapterAt: i => slots[i],
    isChapterStart: i => i === 0 || slots[i] !== slots[i - 1],
  };
}
