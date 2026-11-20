// Undecided: a short sorting round of plain questions on the issues that divide the parties, played before
// the run for a player who does not know which primary is theirs (Chris, 20 Nov 2026). The answers place
// them in the Democratic or Republican primary; the run then plays exactly as if they had picked it.
// Content: data/sorter.json (lean: negative = Democratic side, positive = Republican side).

import { makeRng } from './rng.js?v=c75380f-1795191132';

// Each question becomes a plain choice question the normal renderer can play. Per run (seeded), each
// question's scale runs either way round, so neither side always sits first.
export function sortQuestions(sorter, seed) {
  if (!sorter || !Array.isArray(sorter.questions)) return [];
  const rng = makeRng((seed ^ 0x5eed5) >>> 0);
  return sorter.questions.map(q => asChoice(q, rng));
}

export function tiebreakQuestion(sorter, seed) {
  if (!sorter || !sorter.tiebreak) return null;
  return asChoice(sorter.tiebreak, makeRng((seed ^ 0x7b7b) >>> 0));
}

function asChoice(q, rng) {
  const options = (q.options || []).map((o, i) => ({ id: o.id ?? String.fromCharCode(97 + i), label: o.label, lean: Number(o.lean) || 0, effects: {} }));
  // The options stay a scale (firm, moderate, moderate, firm); which end comes first is a coin flip.
  options.sort((x, y) => x.lean - y.lean);
  if (rng.next() < 0.5) options.reverse();
  return {
    id: q.id, type: 'choice', chapter: 'announcement', route: 'both', tier: 'core', fx: [], measure: [], signature: [],
    topic: q.topic || '', context: q.context || '', prompt: q.prompt || '', options, sorter: true,
  };
}

// answers: [{ id, a: { optionId } }]. Returns { route, score, max, band } once decided, or { tie: true }
// when the main questions come out level and the tiebreak has not been answered yet.
export function sortResult(sorter, answers) {
  const byId = new Map();
  for (const q of sorter?.questions || []) byId.set(q.id, q);
  if (sorter?.tiebreak) byId.set(sorter.tiebreak.id, sorter.tiebreak);
  let score = 0, max = 0, tb = 0;
  for (const { id, a } of answers || []) {
    const q = byId.get(id);
    if (!q) continue;
    const o = (q.options || []).find(x => x.id === a?.optionId);
    const lean = Number(o?.lean) || 0;
    if (sorter.tiebreak && id === sorter.tiebreak.id) { tb = lean; continue; }
    score += lean;
    max += Math.max(...(q.options || []).map(x => Math.abs(Number(x.lean) || 0)), 0);
  }
  if (score === 0 && !tb) return { tie: true, score, max };
  const route = (score || tb) < 0 ? 'dem' : 'gop';
  // How firmly: a share of the most lopsided score possible. Level scores settled by the tiebreak are a near call.
  const share = max ? Math.abs(score) / max : 0;
  const band = share >= 0.5 ? 'strong' : share >= 0.2 ? 'lean' : 'barely';
  return { route, score, max, band, tiebreak: score === 0 };
}

export function sortResultText(sorter, res) {
  const t = sorter?.result?.[res.route]?.[res.band];
  if (t) return t;
  const party = res.route === 'gop' ? 'Republican' : 'Democratic';
  return res.band === 'strong' ? `Your answers put you clearly in the ${party} primary.`
    : res.band === 'lean' ? `On balance, your answers put you in the ${party} primary.`
      : `A near call, but your answers put you in the ${party} primary.`;
}
