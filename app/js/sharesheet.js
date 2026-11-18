// The share sheet on the result screen: image preview in three sizes, a system Share button on phones,
// one button per platform, Instagram (download the story image), copy link, copy message, download.

import { SIZES, drawShareCard, canvasBlob } from './sharecard.js?v=055793d-1794987752';
import { buildMessage, shareUrls, X_LIMIT } from './share.js?v=055793d-1794987752';
import { portraitUrl, artUrl } from './art.js?v=055793d-1794987752';
import { reasonFor } from './scoring.js?v=055793d-1794987752';
import { haptic } from './feel.js?v=055793d-1794987752';

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const button = (label, cls = '') => { const b = h('button', `btn ${cls}`.trim()); b.type = 'button'; b.append(h('span', 'btn-label', label)); return b; };

export const PLATFORMS = [
  ['x', 'X'], ['facebook', 'Facebook'], ['whatsapp', 'WhatsApp'], ['telegram', 'Telegram'], ['reddit', 'Reddit'],
  ['linkedin', 'LinkedIn'], ['bluesky', 'Bluesky'], ['threads', 'Threads'], ['email', 'Email'], ['sms', 'Text message'],
];

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const isPhone = () => {
  try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; }
};

export function renderShareSheet(section, R) {
  const { profile, matches, cands, route, scores, reading } = R;
  // Messages and buttons carry the dossier link when there is one (#d=<code>), else the site.
  const shareCfg = R.link ? { ...R.shareCfg, url: R.link } : R.shareCfg;
  const siteUrl = R.shareCfg.url;
  // The archetype from the personality reading, once reading.json has given it a real name.
  const archetype = reading && reading.present && !reading.archetype?.fallback ? reading.archetype.name : null;
  const top = matches.slice(0, 5).map(m => ({ id: m.id, name: cands.get(m.id)?.name || m.id, pct: m.pct, party: cands.get(m.id)?.party }));
  const first = cands.get(matches[0].id);
  const verdict = shareCfg.verdicts[matches[0].id] || reasonFor(scores, first, matches[0].picks);
  const card = {
    top, cands, route, verdict, url: siteUrl, archetype,
    camp: profile.camp ? { short: profile.camp.short, name: profile.camp.name } : null,
    tem: { mach: scores.mach.value, narc: scores.narc.value, psych: scores.psych.value },
    art: { wide: artUrl('share_wide.webp'), tall: artUrl('share_tall.webp') },
    portraitUrl,
  };
  const result = { top, route, campName: profile.camp ? profile.camp.name : '', verdict, archetype };
  // One template per result, used for every platform; X, Threads and Bluesky get the capped text with hashtags.
  const pickR = Math.random();
  const message = buildMessage(result, shareCfg, { rng: () => pickR, hashtags: false });
  const shortMessage = buildMessage(result, shareCfg, { rng: () => pickR, hashtags: true, limit: X_LIMIT });
  const urls = shareUrls(message, shortMessage, shareCfg.url, 'My 2028 match, by the US Political Quiz');

  // ---- preview and size picker ----
  let kind = isPhone() ? 'story' : 'square';
  const canvases = {};
  const ready = {};
  const draw = k => {
    if (!ready[k]) { canvases[k] = document.createElement('canvas'); ready[k] = drawShareCard(canvases[k], k, card).catch(e => { console.warn('share card', e); return canvases[k]; }); }
    return ready[k];
  };
  const preview = h('div', 'share-preview');
  const sizes = h('div', 'share-sizes');
  sizes.setAttribute('role', 'radiogroup');
  sizes.setAttribute('aria-label', 'Image size');
  const show = async k => {
    kind = k;
    sizes.querySelectorAll('.pick').forEach(b => b.setAttribute('aria-checked', String(b.dataset.size === k)));
    const c = await draw(k);
    if (kind !== k) return;
    c.className = `share-canvas size-${k}`;
    preview.replaceChildren(c);
  };
  for (const [k, sz] of Object.entries(SIZES)) {
    const b = h('button', 'btn pick share-size');
    b.type = 'button';
    b.dataset.size = k;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `${sz.label}, ${sz.note}`);
    b.append(h('span', 'pick-main', sz.label), h('span', 'pick-sub', sz.note));
    b.addEventListener('click', () => { haptic('select'); show(k); });
    sizes.appendChild(b);
  }
  const fileOf = async k => {
    const blob = await canvasBlob(await draw(k));
    return new File([blob], `my-2028-match-${k}.png`, { type: 'image/png' });
  };

  const status = h('p', 'share-status');
  status.setAttribute('role', 'status');
  const say = (t, ok = true) => { status.textContent = t; status.classList.toggle('bad', !ok); haptic(ok ? 'commit' : 'error'); };

  // ---- system share (phones) ----
  const top1 = h('div', 'share-main');
  if (navigator.share) {
    const sys = button('Share', 'primary share-system');
    sys.addEventListener('click', async () => {
      try {
        const file = await fileOf(kind);
        const data = { text: message, title: 'US Political Quiz' };
        if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ ...data, files: [file] });
        else await navigator.share({ ...data, url: shareCfg.url });
        say('Shared.');
      } catch (e) { if (e?.name !== 'AbortError') say('Sharing did not work here. Use a button below.', false); }
    });
    top1.appendChild(sys);
  }

  // ---- platforms ----
  const grid = h('div', 'share-grid');
  const open = (key, url) => {
    if (key === 'email' || key === 'sms') { window.location.href = url; return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  const insta = button('Instagram', 'share-btn share-instagram');
  insta.dataset.platform = 'instagram';
  insta.addEventListener('click', async () => {
    const file = await fileOf('story');
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: message }); say('Shared.'); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    downloadBlob(file, file.name);
    say('Story image saved. Post it from the Instagram app, then add the link sticker.');
  });
  grid.appendChild(insta);
  for (const [key, label] of PLATFORMS) {
    const b = button(label, `share-btn share-${key}`);
    b.dataset.platform = key;
    b.dataset.href = urls[key];
    b.addEventListener('click', () => open(key, urls[key]));
    grid.appendChild(b);
  }

  // ---- copy and download ----
  const tools = h('div', 'share-tools');
  const copyLink = button('Copy link', 'share-tool');
  copyLink.addEventListener('click', async () => say((await copyText(shareCfg.url)) ? 'Link copied.' : 'Could not copy. The link is ' + shareCfg.url, true));
  const copyMsg = button('Copy message', 'share-tool');
  copyMsg.addEventListener('click', async () => say((await copyText(message)) ? 'Message copied.' : 'Could not copy the message.', true));
  const dl = button('Download image', 'primary share-tool share-download');
  dl.addEventListener('click', async () => { const f = await fileOf(kind); downloadBlob(f, f.name); say(`Saved ${f.name}.`); });
  tools.append(copyLink, copyMsg, dl);

  const msg = h('p', 'share-message', message);
  section.append(preview, sizes, top1, grid, tools, msg, status);
  show(kind);
  return { message, shortMessage, urls, draw, card };
}
