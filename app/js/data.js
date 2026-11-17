// Loads candidates, the ideology camps and every question file named in
// data/questions/index.json. A file that is missing or fails to parse is skipped.

import { normalizeQuestion } from './questions.js';

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

export async function loadData(base = '../data/') {
  const [cj, campsJson, manifest] = await Promise.all([
    getJson(`${base}candidates.json`),
    getJson(`${base}camps.json`).catch(() => ({ camps: [] })),
    getJson(`${base}questions/index.json`).catch(() => ({ files: ['_sample.json'] })),
  ]);
  const candidates = cj.candidates || [];
  const candIds = new Set(candidates.map(c => c.id));
  const files = (manifest.files || []).slice();
  // The engine's test set loads only on request.
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('sample') === '1' && !files.includes('_sample.json')) files.push('_sample.json');
  const report = [];
  const seen = new Set();
  const bank = [];
  const loaded = await Promise.all(files.map(f => getJson(`${base}questions/${f}`).then(j => ({ f, j }), e => ({ f, err: e.message }))));
  for (const { f, j, err } of loaded) {
    if (err) { report.push({ file: f, ok: false, error: err }); continue; }
    const list = Array.isArray(j) ? j : j.questions || [];
    const skipped = [];
    let n = 0;
    for (const raw of list) {
      const { ok, q, problems } = normalizeQuestion(raw, candIds);
      if (!ok) { skipped.push({ id: raw?.id, problems }); continue; }
      if (seen.has(q.id)) { skipped.push({ id: q.id, problems: ['duplicate id'] }); continue; }
      seen.add(q.id);
      q.source = f;
      bank.push(q);
      n++;
    }
    report.push({ file: f, ok: true, count: n, skipped });
    if (skipped.length) console.warn(`[quiz] ${f}: skipped ${skipped.length}`, skipped);
  }
  return { candidates, camps: campsJson.camps || [], bank, report };
}
