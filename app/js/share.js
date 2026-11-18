// Sharing: message text from data/share.json, platform share URLs. Pure (no DOM) so node can test it.
//
// The site URL lives in one place: data/share.json "url". While that is empty (nothing published yet)
// share links use the page's own address, so the quiz works wherever it is served.

// The quiz's own root address in a browser (the folder above /app/); a stand-in under node.
export function pageUrl() {
  try {
    if (typeof location !== 'undefined' && /^https?:/.test(location.protocol)) {
      return location.origin + location.pathname.replace(/app\/(index\.html)?$/, '').replace(/[^/]*$/, '');
    }
  } catch { /* not in a browser */ }
  return 'https://example.com/';
}
export const SITE_URL = pageUrl();
export const X_LIMIT = 280;

export const FALLBACK = {
  url: SITE_URL,
  templates: ['I got {name} ({pct}%) in the US Political Quiz. Camp: {camp}. {verdict} Who are you? {url}'],
  hashtags: ['USPoliticalQuiz', '2028Quiz'],
  verdicts: {},
  og: { title: 'US Political Quiz', description: 'Which 2028 candidate are you, really?' },
};
export const HASHTAGS_USED = 2; // the first two, on X, Threads and Bluesky only

export function normalizeShareConfig(j) {
  const c = j && typeof j === 'object' ? j : {};
  return {
    url: typeof c.url === 'string' && /^https?:\/\//.test(c.url) ? c.url : FALLBACK.url,
    templates: Array.isArray(c.templates) && c.templates.filter(t => typeof t === 'string' && t.trim()).length
      ? c.templates.filter(t => typeof t === 'string' && t.trim()) : FALLBACK.templates.slice(),
    hashtags: Array.isArray(c.hashtags) ? c.hashtags.filter(h => typeof h === 'string' && h.trim()).map(h => h.replace(/^#/, '')) : FALLBACK.hashtags.slice(),
    verdicts: c.verdicts && typeof c.verdicts === 'object' ? c.verdicts : {},
    og: { ...FALLBACK.og, ...(c.og && typeof c.og === 'object' ? c.og : {}) },
  };
}

export async function loadShareConfig(base = '../data/') {
  try {
    const r = await fetch(`${base}share.json`, { cache: 'no-cache' });
    if (!r.ok) return normalizeShareConfig(null);
    return normalizeShareConfig(await r.json());
  } catch { return normalizeShareConfig(null); }
}

// {name} {pct} {camp} {route} {top2} {verdict} {archetype} {url}; unknown keys are left out, spacing tidied.
export function fillTemplate(tpl, vars) {
  return String(tpl)
    .replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])))
    .replace(/[ \t]+/g, ' ')
    .replace(/ ([.,!?;:])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .trim();
}

export function shareVars(result, cfg) {
  const { top, route, campName, verdict, archetype } = result;
  const first = top[0] || {}, second = top[1] || {};
  return {
    name: first.name || '',
    pct: first.pct ?? '', // bare number: the templates write {pct}%
    camp: campName || '',
    route: route === 'dem' ? 'Democratic' : route === 'gop' ? 'Republican' : '',
    top2: second.name || '',
    verdict: (cfg.verdicts && cfg.verdicts[first.id]) || verdict || '',
    archetype: archetype || '', // the reading's archetype name, for templates that use {archetype}
    url: cfg.url,
  };
}

// The message: a random template (rng: () => 0..1). For X the whole text, link included, stays within
// 280 characters: other templates are tried first, then the verdict is dropped, then the text is cut.
export function buildMessage(result, cfg, { rng = Math.random, limit = Infinity, hashtags = false } = {}) {
  const vars = shareVars(result, cfg);
  const order = cfg.templates.map((t, i) => i);
  const start = Math.floor(rng() * order.length);
  const tried = order.slice(start).concat(order.slice(0, start)).map(i => cfg.templates[i]);
  const withUrl = t => (t.includes('{url}') ? t : `${t} {url}`);
  const tags = hashtags && cfg.hashtags.length ? ' ' + cfg.hashtags.slice(0, HASHTAGS_USED).map(h => `#${h}`).join(' ') : '';
  for (const variant of [vars, { ...vars, verdict: '' }]) {
    for (const t of tried) {
      const text = fillTemplate(withUrl(t), variant);
      if (text.length + tags.length <= limit) return text + tags;
      if (text.length <= limit) return text;
    }
  }
  // Last resort: cut the text before the link so the link survives whole.
  const text = fillTemplate(withUrl(tried[0]), { ...vars, verdict: '' });
  const url = cfg.url;
  const body = text.replace(url, '').trim();
  const room = Math.max(0, limit - url.length - 2);
  return `${body.length > room ? body.slice(0, Math.max(0, room - 1)).trimEnd() + '…' : body} ${url}`;
}

export function shareUrls(message, xMessage, url, subject = 'My 2028 match') {
  const e = encodeURIComponent;
  const noUrl = m => m.replace(url, '').replace(/\s+/g, ' ').trim();
  return {
    x: `https://twitter.com/intent/tweet?text=${e(xMessage)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`,
    whatsapp: `https://wa.me/?text=${e(message)}`,
    telegram: `https://t.me/share/url?url=${e(url)}&text=${e(noUrl(message))}`,
    reddit: `https://www.reddit.com/submit?url=${e(url)}&title=${e(noUrl(xMessage))}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}`,
    bluesky: `https://bsky.app/intent/compose?text=${e(xMessage)}`,
    threads: `https://www.threads.net/intent/post?text=${e(xMessage)}`,
    email: `mailto:?subject=${e(subject)}&body=${e(message)}`,
    sms: `sms:?&body=${e(message)}`,
  };
}
