// Share images, drawn to canvas in the quiz's look: brass on navy over the share art, Jacquard 24
// wordmark, Jersey 15 everywhere else. Three sizes plus the static link-preview image.
//   square 1080x1080 (feed posts), story 1080x1920 (stories), link 1200x630 (X, Facebook, LinkedIn)
// Missing art or portraits fall back to drawn panels, so a card always renders.

import { initials } from './art.js?v=13556fa-1795008148';

export const SIZES = {
  square: { w: 1080, h: 1080, label: 'Square', note: 'Feed posts' },
  story: { w: 1080, h: 1920, label: 'Story', note: 'Instagram, WhatsApp, TikTok' },
  link: { w: 1200, h: 630, label: 'Link card', note: 'X, Facebook, LinkedIn' },
};

const C = {
  navy: '#090D18', navy2: '#14213D', brass: '#D9A441', brass2: '#F2C66D', ox: '#7A1E22', ox2: '#A8322D',
  amber: '#F0A64A', parch: '#EFE5CC', smoke: '#8F88A3', ink: '#060405', trim: '#8a6a30', dem: '#1d2f5c', gop: '#5c1d1d',
};
const MARK = '"Jacquard 24", "Jersey 15", serif';
const BODY = '"Jersey 15", "Courier New", monospace';

const imgCache = new Map();
export function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (!imgCache.has(src)) {
    imgCache.set(src, new Promise(res => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = src;
    }));
  }
  return imgCache.get(src);
}

async function fontsReady() {
  try { await Promise.all([document.fonts.load(`120px ${MARK}`), document.fonts.load(`40px ${BODY}`)]); } catch { /* fallback fonts */ }
}

// ---- drawing helpers ---------------------------------------------------------------------------------
function cover(x, img, w, h, ax = 0.5, ay = 0.5) {
  if (!img) {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, C.navy2); g.addColorStop(1, C.navy);
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    return;
  }
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  x.drawImage(img, (w - dw) * ax, (h - dh) * ay, dw, dh);
}

function shade(x, w, h, stops, horizontal = false) {
  const g = horizontal ? x.createLinearGradient(0, 0, w, 0) : x.createLinearGradient(0, 0, 0, h);
  for (const [o, c] of stops) g.addColorStop(o, c);
  x.fillStyle = g; x.fillRect(0, 0, w, h);
}

// A hard-edged translucent navy panel behind text, with a thin trim line, in keeping with the pixel look.
function scrim(x, px, py, pw, ph, alpha = 0.8) {
  x.fillStyle = `rgba(9,13,24,${alpha})`;
  x.fillRect(px, py, pw, ph);
  x.fillStyle = 'rgba(138,106,48,.55)';
  x.fillRect(px, py, pw, 2); x.fillRect(px, py + ph - 2, pw, 2);
  x.fillRect(px, py, 2, ph); x.fillRect(px + pw - 2, py, 2, ph);
}

function frame(x, w, h, inset = 22) {
  x.fillStyle = C.brass;
  x.fillRect(inset, inset, w - 2 * inset, 6); x.fillRect(inset, h - inset - 6, w - 2 * inset, 6);
  x.fillRect(inset, inset, 6, h - 2 * inset); x.fillRect(w - inset - 6, inset, 6, h - 2 * inset);
  x.fillStyle = C.trim;
  const j = inset + 12;
  x.fillRect(j, j, w - 2 * j, 3); x.fillRect(j, h - j - 3, w - 2 * j, 3);
  x.fillRect(j, j, 3, h - 2 * j); x.fillRect(w - j - 3, j, 3, h - 2 * j);
}

function text(x, s, px, y, { size = 40, font = BODY, color = C.parch, align = 'left', shadow = true, spacing = 0 } = {}) {
  x.font = `${size}px ${font}`;
  x.textAlign = align;
  x.textBaseline = 'alphabetic';
  if ('letterSpacing' in x) x.letterSpacing = `${spacing}px`;
  if (shadow) { x.fillStyle = C.ink; x.fillText(s, px + Math.max(2, size / 16), y + Math.max(2, size / 16)); }
  x.fillStyle = color;
  x.fillText(s, px, y);
  if ('letterSpacing' in x) x.letterSpacing = '0px';
}

function wrap(x, s, maxW, size, font = BODY) {
  x.font = `${size}px ${font}`;
  const words = String(s || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const wd of words) {
    const t = line ? `${line} ${wd}` : wd;
    if (x.measureText(t).width > maxW && line) { lines.push(line); line = wd; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

// Fit text to a width by shrinking, down to a floor.
function fitSize(x, s, maxW, size, min, font = BODY) {
  let z = size;
  for (; z > min; z -= 2) { x.font = `${z}px ${font}`; if (x.measureText(s).width <= maxW) break; }
  return z;
}

function para(x, s, px, y, maxW, size, lines = 2, opts = {}) {
  let z = size;
  let ls = wrap(x, s, maxW, z, opts.font);
  while (ls.length > lines && z > size * 0.7) { z -= 2; ls = wrap(x, s, maxW, z, opts.font); }
  if (ls.length > lines) { ls = ls.slice(0, lines); ls[lines - 1] = ls[lines - 1].replace(/\s*\S*$/, '') + '…'; }
  ls.forEach((l, i) => text(x, l, px, y + i * z * 1.15, { ...opts, size: z }));
  return y + ls.length * z * 1.15;
}

function portrait(x, img, cand, px, py, size, border = 8) {
  x.fillStyle = C.ink; x.fillRect(px - border - 4, py - border - 4, size + 2 * border + 8, size + 2 * border + 8);
  x.fillStyle = C.brass; x.fillRect(px - border, py - border, size + 2 * border, size + 2 * border);
  x.fillStyle = C.brass2; x.fillRect(px - border, py - border, size + 2 * border, Math.max(2, border / 3));
  x.fillStyle = cand?.party === 'gop' ? C.gop : C.dem; x.fillRect(px, py, size, size);
  if (img) {
    x.imageSmoothingEnabled = size < img.width;
    x.drawImage(img, px, py, size, size);
    x.imageSmoothingEnabled = false;
  } else {
    text(x, initials(cand?.name || '?'), px + size / 2, py + size * 0.62, { size: size * 0.42, align: 'center' });
  }
}

// A small brass dial: value -2..2 on a half circle, label under it.
function dial(x, cx, cy, r, value, label) {
  x.lineWidth = Math.max(4, r / 7);
  x.strokeStyle = C.trim;
  x.beginPath(); x.arc(cx, cy, r, Math.PI, 2 * Math.PI); x.stroke();
  x.strokeStyle = C.brass2; x.lineWidth = Math.max(2, r / 16);
  for (let k = 0; k <= 4; k++) {
    const a = Math.PI + (k / 4) * Math.PI;
    x.beginPath(); x.moveTo(cx + Math.cos(a) * (r - r / 4), cy + Math.sin(a) * (r - r / 4)); x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); x.stroke();
  }
  const a = Math.PI * 1.5 + (Math.max(-2, Math.min(2, value || 0)) / 2) * (Math.PI / 2);
  x.strokeStyle = C.ox2; x.lineWidth = Math.max(4, r / 9);
  x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85); x.stroke();
  x.fillStyle = C.brass; x.fillRect(cx - r / 8, cy - r / 8, r / 4, r / 4);
  text(x, label, cx, cy + r * 0.62, { size: Math.max(16, r * 0.42), color: C.smoke, align: 'center', spacing: 2 });
}

function trio(x, cx, cy, r, gap, tem) {
  dial(x, cx - gap, cy, r, tem.mach, 'MACH');
  dial(x, cx, cy, r, tem.narc, 'NARC');
  dial(x, cx + gap, cy, r, tem.psych, 'PSYCH');
}

const hostOf = url => String(url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');

// ---- the cards -----------------------------------------------------------------------------------------
// card: { top: [{id, name, pct, party}], cands: Map, camp: {short, name}, verdict, route, tem: {mach, narc, psych}, url,
//         art: {wide, tall}, portraitUrl(id) }
export async function drawShareCard(canvas, kind, card) {
  await fontsReady();
  const { w, h } = SIZES[kind];
  canvas.width = w; canvas.height = h;
  const x = canvas.getContext('2d');
  x.imageSmoothingEnabled = false;
  // With a reading, the type leads (drawTypeCard); without one, the match-led card below.
  if (card.archetype) return drawTypeCard(canvas, kind, card);
  const [bgWide, bgTall, p0, ...rest] = await Promise.all([
    loadImage(card.art.wide), loadImage(card.art.tall),
    ...card.top.slice(0, 5).map(m => loadImage(card.portraitUrl(m.id))),
  ]);
  const first = card.top[0];
  const c0 = card.cands.get(first.id) || first;
  const routeName = card.route === 'dem' ? 'DEMOCRATIC PRIMARY' : 'REPUBLICAN PRIMARY';
  const host = hostOf(card.url);
  const laneLine = card.camp ? `CAMP: ${card.camp.short.toUpperCase()}` : '';

  if (kind === 'square') {
    cover(x, bgWide, w, h, 1, 0.5);
    shade(x, w, h, [[0, 'rgba(9,13,24,.96)'], [0.55, 'rgba(9,13,24,.82)'], [1, 'rgba(9,13,24,.35)']], true);
    shade(x, w, h, [[0, 'rgba(9,13,24,0)'], [0.62, 'rgba(9,13,24,.15)'], [1, 'rgba(9,13,24,.92)']]);
    frame(x, w, h);
    text(x, 'US Political Quiz', 70, 150, { size: fitSize(x, 'US Political Quiz', 940, 112, 60, MARK), font: MARK, color: C.brass2 });
    text(x, `THE 2028 RACE · ${routeName}`, 74, 200, { size: 30, color: C.smoke, spacing: 3 });
    portrait(x, p0, c0, 74, 250, 330);
    text(x, 'MY 2028 MATCH', 450, 290, { size: 30, color: C.smoke, spacing: 4 });
    const ns = fitSize(x, first.name, 560, 64, 40);
    const nl = wrap(x, first.name, 560, ns);
    nl.slice(0, 2).forEach((l, i) => text(x, l, 450, 360 + i * ns * 1.05, { size: ns }));
    text(x, `${first.pct}%`, 446, 560, { size: 170, color: C.brass2 });
    para(x, card.verdict, 74, 660, 930, 40, 2, { color: C.amber });
    if (laneLine) text(x, laneLine, 74, 760, { size: 32, color: C.parch, spacing: 3 });
    // The archetype, right-aligned on the lane row, in whatever room the lane line leaves.
    if (card.archetype) {
      x.font = `32px ${BODY}`;
      const laneEnd = laneLine ? 74 + x.measureText(laneLine).width + laneLine.length * 3 + 36 : 74;
      const arch = card.archetype.toUpperCase();
      const room = 1006 - laneEnd;
      const z = fitSize(x, arch, room, 34, 22);
      x.font = `${z}px ${BODY}`;
      if (x.measureText(arch).width + arch.length * 2 <= room) text(x, arch, 1006, 760, { size: z, color: C.brass2, align: 'right', spacing: 2 });
    }
    card.top.slice(1, 5).forEach((m, i) => {
      const y = 784 + i * 46;
      portrait(x, rest[i], card.cands.get(m.id) || m, 74, y, 40, 3);
      text(x, `${i + 2}  ${m.name}`, 132, y + 33, { size: 32 });
      text(x, m.pct < 25 ? 'under 25' : `${m.pct}%`, 620, y + 33, { size: 32, color: C.brass, align: 'right' });
    });
    trio(x, 850, 872, 62, 140 * 0.95, card.tem);
    text(x, host, w / 2, h - 40, { size: 26, color: C.parch, align: 'center', spacing: 2 });
  } else if (kind === 'story') {
    cover(x, bgTall || bgWide, w, h, bgTall ? 0.5 : 1, 0.5);
    shade(x, w, h, [[0, 'rgba(9,13,24,.9)'], [0.45, 'rgba(9,13,24,.7)'], [0.7, 'rgba(9,13,24,.82)'], [1, 'rgba(9,13,24,.96)']]);
    frame(x, w, h);
    text(x, 'US Political Quiz', w / 2, 230, { size: fitSize(x, 'US Political Quiz', 960, 150, 70, MARK), font: MARK, color: C.brass2, align: 'center' });
    text(x, `THE 2028 RACE · ${routeName}`, w / 2, 300, { size: 36, color: C.smoke, align: 'center', spacing: 4 });
    portrait(x, p0, c0, (w - 520) / 2, 360, 520, 10);
    scrim(x, 60, 920, w - 120, 922, 0.74);
    text(x, 'MY 2028 MATCH', w / 2, 980, { size: 38, color: C.smoke, align: 'center', spacing: 6 });
    text(x, first.name, w / 2, 1070, { size: fitSize(x, first.name, 920, 84, 52), align: 'center' });
    text(x, `${first.pct}%`, w / 2, 1270, { size: 230, color: C.brass2, align: 'center' });
    if (card.archetype) {
      // Room for the archetype: the verdict keeps two lines (shrinking to fit), the archetype sits under it.
      para(x, card.verdict, w / 2, 1352, 900, 44, 2, { color: C.amber, align: 'center' });
      text(x, card.archetype.toUpperCase(), w / 2, 1478, { size: fitSize(x, card.archetype.toUpperCase(), 900, 44, 30), color: C.brass2, align: 'center', spacing: 4 });
    } else {
      const lines = wrap(x, card.verdict, 900, 46).slice(0, 3);
      lines.forEach((l, i) => text(x, l, w / 2, 1360 + i * 54, { size: 46, color: C.amber, align: 'center' }));
    }
    if (laneLine) text(x, laneLine, w / 2, 1540, { size: 38, align: 'center', spacing: 4 });
    card.top.slice(1, 5).forEach((m, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const px = 90 + col * 470, py = 1590 + row * 70;
      portrait(x, rest[i], card.cands.get(m.id) || m, px, py, 48, 3);
      text(x, `${i + 2} ${m.name}`, px + 66, py + 38, { size: fitSize(x, `${i + 2} ${m.name}`, 290, 34, 24) });
      text(x, m.pct < 25 ? '<25' : `${m.pct}%`, px + 440, py + 38, { size: 34, color: C.brass, align: 'right' });
    });
    trio(x, w / 2, 1800, 50, 200, card.tem);
    text(x, host, w / 2, h - 50, { size: 30, align: 'center', spacing: 2 });
  } else {
    cover(x, bgWide, w, h, 1, 0.55);
    shade(x, w, h, [[0, 'rgba(9,13,24,.97)'], [0.62, 'rgba(9,13,24,.85)'], [1, 'rgba(9,13,24,.35)']], true);
    frame(x, w, h, 16);
    scrim(x, 380, 40, 790, 500, 0.8);
    portrait(x, p0, c0, 60, 120, 300, 8);
    text(x, 'US Political Quiz', 400, 112, { size: fitSize(x, 'US Political Quiz', 760, 84, 44, MARK), font: MARK, color: C.brass2 });
    text(x, 'MY 2028 MATCH', 404, 160, { size: 26, color: C.smoke, spacing: 4 });
    text(x, first.name, 400, 222, { size: fitSize(x, first.name, 560, 58, 36) });
    text(x, `${first.pct}%`, 396, 350, { size: 132, color: C.brass2 });
    trio(x, 1010, 290, 44, 100, card.tem);
    para(x, card.verdict, 400, 412, 740, 32, 2, { color: C.amber });
    if (laneLine) text(x, laneLine, 400, 512, { size: 26, spacing: 3 });
    const others = card.top.slice(1, 5).map((m, i) => `${i + 2} ${m.name.replace(/ Jr\.?$/, '').split(' ').slice(-1)[0]} ${m.pct < 25 ? '<25' : m.pct + '%'}`);
    [others.slice(0, 2).join('  '), others.slice(2).join('  ')].forEach((l, i) => text(x, l, 60, 474 + i * 32, { size: fitSize(x, l, 320, 26, 16), color: C.smoke }));
    text(x, `THE 2028 RACE · ${host}`, 60, h - 34, { size: 24, spacing: 2 });
  }
  return canvas;
}

// ---- the type-led cards (ENDGAME_CONTRACT section 3): the archetype and its line lead, the match follows -----
// A tall card picture in a brass frame; without the picture, the night backdrop and the type's initial.
function artBox(x, img, bg, name, px, py, bw, bh) {
  x.fillStyle = C.ink; x.fillRect(px - 12, py - 12, bw + 24, bh + 24);
  x.fillStyle = C.brass; x.fillRect(px - 8, py - 8, bw + 16, bh + 16);
  x.fillStyle = C.brass2; x.fillRect(px - 8, py - 8, bw + 16, 3);
  x.save();
  x.beginPath(); x.rect(px, py, bw, bh); x.clip();
  const pic = img || bg;
  if (pic) {
    const s = Math.max(bw / pic.width, bh / pic.height);
    x.imageSmoothingEnabled = true;
    x.drawImage(pic, px + (bw - pic.width * s) / 2, py + (bh - pic.height * s) / 2, pic.width * s, pic.height * s);
    x.imageSmoothingEnabled = false;
  } else { x.fillStyle = C.navy2; x.fillRect(px, py, bw, bh); }
  if (!img) {
    x.fillStyle = 'rgba(9,13,24,.62)'; x.fillRect(px, py, bw, bh);
    const ch = String(name || '?').replace(/^the\s+/i, '').charAt(0).toUpperCase();
    text(x, ch, px + bw / 2, py + bh * 0.62, { size: bw * 0.62, font: MARK, color: C.brass2, align: 'center' });
  }
  x.restore();
}

function centerPara(x, s, cx, y, maxW, size, lines, color) {
  let z = size, ls = wrap(x, s, maxW, z);
  while (ls.length > lines && z > size * 0.7) { z -= 2; ls = wrap(x, s, maxW, z); }
  if (ls.length > lines) { ls = ls.slice(0, lines); ls[lines - 1] = ls[lines - 1].replace(/\s*\S*$/, '') + '…'; }
  ls.forEach((l, i) => text(x, l, cx, y + i * z * 1.18, { size: z, color, align: 'center' }));
  return y + ls.length * z * 1.18;
}

function nameLines(x, s, maxW, size, min, maxLines = 2) {
  let z = size, ls = wrap(x, s, maxW, z, MARK);
  while ((ls.length > maxLines || ls.some(l => (x.font = `${z}px ${MARK}`, x.measureText(l).width > maxW))) && z > min) { z -= 4; ls = wrap(x, s, maxW, z, MARK); }
  return { z, ls: ls.slice(0, maxLines) };
}

async function drawTypeCard(canvas, kind, card) {
  const { w, h } = SIZES[kind];
  const x = canvas.getContext('2d');
  x.imageSmoothingEnabled = false;
  const [bgWide, bgTall, typeImg, p0] = await Promise.all([
    loadImage(card.art.wide), loadImage(card.art.tall), loadImage(card.typeArt), loadImage(card.portraitUrl(card.top[0].id)),
  ]);
  const first = card.top[0];
  const c0 = card.cands.get(first.id) || first;
  const routeName = card.route === 'dem' ? 'DEMOCRATIC PRIMARY' : 'REPUBLICAN PRIMARY';
  const host = hostOf(card.url);
  const pct = first.pct < 25 ? 'under 25%' : `${first.pct}%`;
  const typeName = card.archetype;

  if (kind === 'square') {
    cover(x, bgWide, w, h, 1, 0.5);
    shade(x, w, h, [[0, 'rgba(9,13,24,.95)'], [0.6, 'rgba(9,13,24,.85)'], [1, 'rgba(9,13,24,.6)']], true);
    shade(x, w, h, [[0.6, 'rgba(9,13,24,0)'], [1, 'rgba(9,13,24,.92)']]);
    frame(x, w, h);
    text(x, 'US Political Quiz', 70, 140, { size: fitSize(x, 'US Political Quiz', 940, 100, 56, MARK), font: MARK, color: C.brass2 });
    text(x, `THE 2028 RACE · ${routeName}`, 74, 186, { size: 28, color: C.smoke, spacing: 3 });
    artBox(x, typeImg, bgTall, typeName, 74, 236, 330, 495);
    text(x, 'MY TYPE', 450, 276, { size: 30, color: C.smoke, spacing: 5 });
    const { z, ls } = nameLines(x, typeName, 560, 104, 56);
    ls.forEach((l, i) => text(x, l, 446, 276 + z * 0.95 * (i + 1), { size: z, font: MARK, color: C.win || C.brass2 }));
    const ty = 276 + z * 0.95 * ls.length + 56;
    para(x, card.tagline, 450, ty, 560, 42, 4, { color: C.amber });
    // The closest match, second.
    scrim(x, 60, 770, w - 120, 210, 0.82);
    text(x, 'CLOSEST MATCH', 90, 818, { size: 28, color: C.smoke, spacing: 4 });
    portrait(x, p0, c0, 90, 840, 116, 5);
    text(x, first.name, 236, 900, { size: fitSize(x, first.name, 420, 54, 34) });
    text(x, pct, 236, 960, { size: 54, color: C.brass2 });
    trio(x, 830, 905, 52, 116, card.tem);
    text(x, host, w / 2, h - 40, { size: 26, color: C.parch, align: 'center', spacing: 2 });
  } else if (kind === 'story') {
    cover(x, bgTall || bgWide, w, h, bgTall ? 0.5 : 1, 0.5);
    shade(x, w, h, [[0, 'rgba(9,13,24,.9)'], [0.4, 'rgba(9,13,24,.72)'], [0.62, 'rgba(9,13,24,.86)'], [1, 'rgba(9,13,24,.97)']]);
    frame(x, w, h);
    text(x, 'US Political Quiz', w / 2, 200, { size: fitSize(x, 'US Political Quiz', 960, 150, 70, MARK), font: MARK, color: C.brass2, align: 'center' });
    text(x, `THE 2028 RACE · ${routeName}`, w / 2, 262, { size: 34, color: C.smoke, align: 'center', spacing: 4 });
    artBox(x, typeImg, bgTall, typeName, (w - 440) / 2, 320, 440, 660);
    text(x, 'MY TYPE', w / 2, 1060, { size: 38, color: C.smoke, align: 'center', spacing: 6 });
    const { z, ls } = nameLines(x, typeName, 940, 130, 70);
    ls.forEach((l, i) => text(x, l, w / 2, 1060 + z * 0.95 * (i + 1), { size: z, font: MARK, color: C.brass2, align: 'center' }));
    const ty = 1060 + z * 0.95 * ls.length + 60;
    centerPara(x, card.tagline, w / 2, ty, 900, 46, 3, C.amber);
    scrim(x, 60, 1500, w - 120, 300, 0.8);
    text(x, 'CLOSEST MATCH', w / 2, 1556, { size: 34, color: C.smoke, align: 'center', spacing: 5 });
    portrait(x, p0, c0, 110, 1590, 150, 6);
    text(x, first.name, 300, 1660, { size: fitSize(x, first.name, 620, 60, 36) });
    text(x, pct, 300, 1736, { size: 66, color: C.brass2 });
    trio(x, 860, 1720, 46, 104, card.tem);
    text(x, host, w / 2, h - 50, { size: 30, align: 'center', spacing: 2 });
  } else {
    cover(x, bgWide, w, h, 1, 0.55);
    shade(x, w, h, [[0, 'rgba(9,13,24,.97)'], [0.65, 'rgba(9,13,24,.86)'], [1, 'rgba(9,13,24,.5)']], true);
    frame(x, w, h, 16);
    artBox(x, typeImg, bgTall, typeName, 64, 70, 300, 450);
    text(x, 'US Political Quiz', 410, 100, { size: fitSize(x, 'US Political Quiz', 720, 70, 40, MARK), font: MARK, color: C.brass2 });
    text(x, 'MY TYPE', 414, 150, { size: 24, color: C.smoke, spacing: 4 });
    const { z, ls } = nameLines(x, typeName, 720, 92, 48);
    ls.forEach((l, i) => text(x, l, 410, 150 + z * 0.95 * (i + 1), { size: z, font: MARK, color: C.brass2 }));
    const ty = 150 + z * 0.95 * ls.length + 46;
    para(x, card.tagline, 414, ty, 720, 32, 3, { color: C.amber });
    text(x, `CLOSEST MATCH: ${first.name.toUpperCase()} · ${pct.toUpperCase()}`, 414, 520, { size: fitSize(x, `CLOSEST MATCH: ${first.name.toUpperCase()} · ${pct}`, 720, 26, 18), color: C.parch, spacing: 2 });
    text(x, `THE 2028 RACE · ${host}`, 64, h - 34, { size: 24, spacing: 2 });
  }
  return canvas;
}

// The static link preview for the site (the same for everyone): title art, wordmark, the question.
export async function drawOgImage(canvas, { titleArt, url, line = 'Which 2028 candidate are you?' }) {
  await fontsReady();
  const w = 1200, h = 630;
  canvas.width = w; canvas.height = h;
  const x = canvas.getContext('2d');
  x.imageSmoothingEnabled = false;
  cover(x, await loadImage(titleArt), w, h, 0.5, 0.45);
  shade(x, w, h, [[0, 'rgba(9,13,24,.9)'], [0.5, 'rgba(9,13,24,.6)'], [1, 'rgba(9,13,24,.15)']], true);
  shade(x, w, h, [[0.55, 'rgba(9,13,24,0)'], [1, 'rgba(9,13,24,.85)']]);
  frame(x, w, h, 16);
  text(x, 'US Political Quiz', 70, 200, { size: fitSize(x, 'US Political Quiz', 1060, 150, 80, MARK), font: MARK, color: C.brass2 });
  text(x, 'THE 2028 RACE', 76, 270, { size: 54, spacing: 10 });
  text(x, '23 CANDIDATES · ONE VERDICT', 76, 330, { size: 36, color: C.ox2, spacing: 8 });
  para(x, line, 76, 440, 640, 52, 2, { color: C.amber });
  text(x, hostOf(url), 76, h - 50, { size: 28, color: C.parch, spacing: 2 });
  return canvas;
}

export function canvasBlob(canvas) {
  return new Promise(res => canvas.toBlob(b => res(b), 'image/png'));
}
