// Question bank helpers: validation, normalisation and the option vectors the selector uses.

export const TYPES = ['choice', 'hold', 'slider', 'pin', 'budget', 'rank', 'swipe', 'whosaid', 'dilemma', 'draft', 'sign', 'envelope'];

export const RANK_FACTORS = {
  5: [1, 0.6, 0.3, 0, -0.3],
  4: [1, 0.6, 0.3, -0.3], // four items: last place still counts as a rejection
  3: [1, 0.3, -0.3],
};
export function rankFactors(n) {
  if (RANK_FACTORS[n]) return RANK_FACTORS[n];
  const f = [];
  for (let i = 0; i < n; i++) f.push(1 - (1.3 * i) / Math.max(1, n - 1));
  return f;
}

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// Returns { ok, q, problems }. Fills defaults; never throws.
export function normalizeQuestion(raw, candidateIds = null) {
  const problems = [];
  if (!isObj(raw)) return { ok: false, problems: ['not an object'] };
  const q = { ...raw };
  if (!q.id) problems.push('missing id');
  if (!TYPES.includes(q.type)) problems.push(`unknown type ${q.type}`);
  q.route = q.route || 'both';
  q.tier = q.tier || 'core';
  q.chapter = q.chapter || 'primary';
  q.fx = Array.isArray(q.fx) ? q.fx.slice() : [];
  q.measure = Array.isArray(q.measure) ? q.measure.slice() : [];
  q.signature = Array.isArray(q.signature) ? q.signature.slice() : [];
  q.discrimination = Number.isFinite(q.discrimination) ? q.discrimination : 1;
  if (q.tier === 'bombshell' && !q.fx.includes('breaking')) q.fx.push('breaking');
  if (q.type === 'envelope' && !q.measure.includes('hesitation')) q.measure.push('hesitation');
  if (q.type === 'hold' && !q.measure.includes('holdStrength')) q.measure.push('holdStrength');
  if (q.type === 'swipe' && !q.measure.includes('speed')) q.measure.push('speed');

  const needOpts = ['choice', 'hold', 'budget', 'rank', 'dilemma', 'envelope', 'sign', 'whosaid'];
  if (needOpts.includes(q.type) && (!Array.isArray(q.options) || q.options.length < 2)) problems.push('needs options');
  if (q.type === 'slider' && !isObj(q.slider)) problems.push('needs slider');
  if (q.type === 'slider' && isObj(q.slider)) {
    // Some writers put the slider's extras at question level.
    q.slider = { steps: 5, ...q.slider };
    for (const k of ['candLeft', 'candRight', 'faithFlagLeft', 'faithFlagRight', 'centre']) if (q[k] && !q.slider[k]) q.slider[k] = q[k];
  }
  if (q.measure.includes('faithPrivate') || hasFaithFlag(q)) q.faithQ = true;
  if (q.type === 'pin' && (!Array.isArray(q.regions) || q.regions.length < 2)) problems.push('needs regions');
  if (q.type === 'swipe' && (!Array.isArray(q.cards) || q.cards.length < 1)) problems.push('needs cards');
  if (q.type === 'whosaid' && !q.quote) problems.push('needs quote');
  if (q.type === 'draft') {
    if (!Array.isArray(q.pool) && !Array.isArray(q.options)) problems.push('needs pool');
    else q.options = draftOptions(q);
    if (candidateIds) q.options = q.options.filter(o => candidateIds.has(o.id) || !q.pool);
    if (q.options.length < 2) problems.push('draft pool too small');
  }
  if (q.type === 'sign' && Array.isArray(q.options)) {
    const ids = q.options.map(o => o.id);
    if (!ids.includes('sign') || !ids.includes('veto')) problems.push('sign needs sign and veto options');
  }
  if (Array.isArray(q.options)) q.options = q.options.map((o, i) => ({ id: o.id ?? String.fromCharCode(97 + i), ...o }));
  return { ok: problems.length === 0, q, problems };
}

function hasFaithFlag(q) {
  return (q.options || []).some(o => o.faithFlag) || !!(q.slider && (q.slider.faithFlagLeft || q.slider.faithFlagRight)) || !!(q.faithFlagLeft || q.faithFlagRight);
}

// faithFlag comes as {professed, private} or as a gap string on sliders.
export function normalizeFaithFlag(f) {
  if (!f) return null;
  if (typeof f === 'object') return { professed: f.professed || null, private: f.private || null };
  if (f === 'professed_exceeds_private') return { professed: 'religious', private: 'secular' };
  if (f === 'private_exceeds_professed') return { professed: 'secular', private: 'religious' };
  if (f === 'religious' || f === 'secular') return { professed: f, private: f };
  return null;
}

function draftOptions(q) {
  if (Array.isArray(q.pool)) {
    return q.pool.map(id => {
      const given = (q.options || []).find(o => o.id === id) || {};
      const cand = { [id]: 2, ...(given.cand || {}) };
      const out = { id, label: given.label, effects: given.effects || {}, cand };
      // Receipts (ENDGAME_CONTRACT section 1) ride along on a draft pick; they never touch matching.
      if (given.receipt) { out.receipt = given.receipt; out.receiptWeight = given.receiptWeight; }
      return out;
    });
  }
  return q.options.map(o => ({ ...o, cand: o.cand || { [o.id]: 2 } }));
}

// Per-run adjustments that depend on the route: a draft with poolRoute "other" offers only the other
// party's candidates ("same" only your own).
export function prepareQuestion(q, route, byId) {
  if (q.type === 'draft' && q.poolRoute && route && byId) {
    const keep = q.options.filter(o => {
      const party = byId[o.id]?.party;
      return q.poolRoute === 'other' ? party && party !== route : party === route;
    });
    if (keep.length >= 2) return { ...q, options: keep };
  }
  return q;
}

export function routeOk(q, route) {
  return q.route === 'both' || q.route === route || !route;
}

// Every distinct thing a player can lean toward in a question, as {effects, cand}.
// Used by the selector to measure how much a question splits the current leaders.
export function optionVectors(q) {
  switch (q.type) {
    case 'slider': {
      const s = q.slider || {};
      const neg = {}, pos = {};
      for (const [a, v] of Object.entries(s.effects || {})) { neg[a] = -v; pos[a] = v; }
      return [{ effects: neg, cand: s.candLeft || {} }, { effects: pos, cand: s.candRight || {} }];
    }
    case 'pin': return (q.regions || []).map(r => ({ effects: r.effects || {}, cand: r.cand || {} }));
    case 'swipe': {
      const out = [];
      for (const c of q.cards || []) {
        out.push({ effects: c.yes || {}, cand: c.candYes || {} });
        out.push({ effects: c.no || {}, cand: c.candNo || {} });
      }
      return out;
    }
    case 'whosaid': {
      const out = (q.options || []).map(o => ({ effects: o.effects || {}, cand: o.cand || {} }));
      const agreeCand = q.agree?.cand || (q.answer ? { [q.answer]: 2 } : {});
      out.push({ effects: q.agree?.effects || {}, cand: agreeCand });
      out.push({ effects: q.disagree?.effects || {}, cand: q.disagree?.cand || {} });
      return out;
    }
    default:
      return (q.options || []).map(o => ({ effects: o.effects || {}, cand: o.cand || {} }));
  }
}

export function textLength(q) {
  let n = (q.prompt || '').length + (q.context || '').length + (q.quote || '').length;
  for (const o of q.options || []) n += (o.label || '').length;
  return n;
}
