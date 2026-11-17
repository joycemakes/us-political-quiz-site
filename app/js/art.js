// Art slots. Each question's `art` id loads art/<id>_wide.webp on landscape screens and
// art/<id>_tall.webp on portrait screens, re-chosen on resize. Missing art shows a styled
// placeholder that names the id. Pin regions are % polygons per version (region.poly.wide / .tall)
// in the PICTURE's own coordinates (0-100 across the full 1536x1024 or 1024x1536 image). The frame
// shows the picture with object-fit: cover, so polygons and taps are mapped through the visible crop.
// When a region has no polygon yet, it is laid out from its `where` text on a 3x3 grid.

export const ASPECT = { wide: 3 / 2, tall: 2 / 3 };
export const NOMINAL = { wide: [1536, 1024], tall: [1024, 1536] };

// The visible crop of an iw x ih picture shown with object-fit: cover in an fw x fh frame.
export function coverCrop(iw, ih, fw, fh) {
  const s = Math.max(fw / iw, fh / ih);
  const dw = iw * s, dh = ih * s;
  return { s, dw, dh, ox: (fw - dw) / 2, oy: (fh - dh) / 2 };
}
// Picture % -> frame pixels.
export function toFrame([px, py], crop) {
  return [crop.ox + (px / 100) * crop.dw, crop.oy + (py / 100) * crop.dh];
}
// Frame pixels -> picture % (for taps).
export function toPicture([fx, fy], crop) {
  return [((fx - crop.ox) / crop.dw) * 100, ((fy - crop.oy) / crop.dh) * 100];
}
export function pointInPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const ART_BASE = 'art/';
let manifest = null; // Set of files that exist, or null = unknown (probe by loading)

export async function loadArtManifest() {
  try {
    const r = await fetch(`${ART_BASE}manifest.json`, { cache: 'no-cache' });
    if (!r.ok) return;
    const j = await r.json();
    manifest = new Set(j.files || []);
  } catch { manifest = null; }
}
const mayExist = file => (manifest ? manifest.has(file) : true);
export const hasArt = (id, version) => !!id && mayExist(`${id}_${version}.webp`);
export const artUrl = file => (mayExist(file) ? ART_BASE + file : null);
const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1';

export function artVersion() {
  return window.innerWidth >= window.innerHeight ? 'wide' : 'tall';
}

const live = new Set();
let resizeTimer = null;
let lastVersion = null;
if (typeof window !== 'undefined') window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const v = artVersion();
    if (v === lastVersion) return;
    lastVersion = v;
    for (const s of [...live]) { if (!s.el.isConnected) live.delete(s); else s.update(); }
  }, 120);
});

// ---- where-text layout for pins ---------------------------------------------------
const CELLS = [];
for (const y of [22, 50, 78]) for (const x of [18, 50, 82]) CELLS.push({ x, y });

export function guessCell(where = '') {
  const w = where.toLowerCase();
  let x = 50, y = 50;
  if (/\bleft\b|left-hand/.test(w)) x = 18;
  else if (/\bright\b|right-hand/.test(w)) x = 82;
  if (/\btop\b|\bupper\b|far end|far back|back wall|\bbackground\b|\bceiling\b|\bsky\b|\babove\b/.test(w)) y = 22;
  else if (/\bbottom\b|\blower\b|\bforeground\b|\bfloor\b|\bbelow\b/.test(w)) y = 78;
  return { x, y };
}

export function layoutFromWhere(regions) {
  const taken = new Set();
  return regions.map(r => {
    const g = guessCell(r.where || r.label || '');
    const order = CELLS.map((c, i) => ({ i, d: (c.x - g.x) ** 2 + (c.y - g.y) ** 2 })).sort((a, b) => a.d - b.d);
    const cell = order.find(o => !taken.has(o.i)) || order[0];
    taken.add(cell.i);
    const c = CELLS[cell.i];
    return [[c.x - 15, c.y - 13], [c.x + 15, c.y - 13], [c.x + 15, c.y + 13], [c.x - 15, c.y + 13]];
  });
}

// Wide and tall are different compositions, so a region never borrows the other version's polygon.
// strict: regions without a polygon for this version get null (no tap area); otherwise the where-text
// layout stands in (placeholder pictures and tests).
export function regionPolys(regions, version, strict = false) {
  const auto = strict ? [] : layoutFromWhere(regions);
  return regions.map((r, i) => {
    const p = r.poly && r.poly[version];
    return Array.isArray(p) && p.length >= 3 ? p : strict ? null : auto[i];
  });
}

const centroid = poly => {
  const n = poly.length;
  return [poly.reduce((t, p) => t + p[0], 0) / n, poly.reduce((t, p) => t + p[1], 0) / n];
};

// ---- the slot -----------------------------------------------------------------------
// opts: { regions, onRegion(region), kind: 'scene'|'pin'|'envelope' }
export function createArtSlot(id, opts = {}) {
  const el = document.createElement('figure');
  el.className = `art-slot art-${opts.kind || 'scene'}`;
  el.dataset.art = id;
  const frame = document.createElement('div');
  frame.className = 'art-frame';
  el.appendChild(frame);
  let svg = null;
  let natural = null; // [w, h] of the loaded picture; nominal size until it loads
  let polys = [];
  const slot = { el, frame, update, setGrade, version: null, regionAt };

  function placeholder(version, file) {
    frame.querySelector('img')?.remove();
    let ph = frame.querySelector('.art-ph');
    if (!ph) { ph = document.createElement('div'); ph.className = 'art-ph'; frame.prepend(ph); }
    ph.innerHTML = '';
    const a = document.createElement('div'); a.className = 'art-ph-id'; a.textContent = id;
    const b = document.createElement('div'); b.className = 'art-ph-sub'; b.textContent = `${version} art to come \u00b7 ${file}`;
    // File names only in debug builds (?debug=1).
    if (!opts.quiet && DEBUG) ph.append(a, b);
    // Until the scene's own art arrives, the chapter backdrop sits behind the label.
    if (opts.chapter) ph.style.setProperty('--ph-bg', `url("${new URL(`${ART_BASE}bg/${opts.chapter}_${version}.webp`, document.baseURI).href}")`);
    frame.classList.add('is-placeholder');
  }

  function update() {
    const version = artVersion();
    lastVersion = version;
    slot.version = version;
    el.style.setProperty('--ar', String(ASPECT[version]));
    el.dataset.version = version;
    const file = `${id}_${version}.webp`;
    natural = NOMINAL[version];
    if (!mayExist(file)) placeholder(version, file);
    else {
      let img = frame.querySelector('img');
      if (!img) { img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; frame.prepend(img); }
      img.onload = () => {
        frame.querySelector('.art-ph')?.remove();
        frame.classList.remove('is-placeholder');
        if (img.naturalWidth && img.naturalHeight) natural = [img.naturalWidth, img.naturalHeight];
        if (opts.regions) drawRegions(slot.version);
      };
      img.onerror = () => placeholder(version, file);
      img.src = ART_BASE + file;
    }
    if (opts.regions) drawRegions(version);
  }

  function crop() {
    const fw = frame.clientWidth || 1, fh = frame.clientHeight || 1;
    const [iw, ih] = natural || NOMINAL[slot.version || 'wide'];
    return { fw, fh, ...coverCrop(iw, ih, fw, fh) };
  }

  // Which region a tap at frame pixels (x, y) lands in, mapped through the crop.
  function regionAt(x, y) {
    const p = toPicture([x, y], crop());
    const i = polys.findIndex(poly => poly && pointInPoly(p, poly));
    return i >= 0 ? opts.regions[i] : null;
  }

  function drawRegions(version) {
    svg?.remove();
    frame.querySelectorAll('.pin-marker').forEach(m => m.remove());
    // Tap areas only for regions traced for this version of the picture; the rest are answered from the
    // list. With none traced the picture is just a picture (playtest 2: the 3x3 guess put the cruiser's
    // tap area on the payphone; borrowing the other version's polygon overlapped C-059 regions).
    polys = regionPolys(opts.regions, version, true);
    const traced = polys.some(Boolean);
    frame.classList.toggle('no-taps', !traced);
    el.dataset.traced = traced ? (polys.every(Boolean) ? '1' : 'part') : '0';
    opts.onTraced?.(el.dataset.traced);
    if (!traced) return;
    const NS = 'http://www.w3.org/2000/svg';
    const c = crop();
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${c.fw} ${c.fh}`);
    svg.classList.add('pin-layer');
    opts.regions.forEach((r, i) => {
      if (!polys[i]) return;
      const g = document.createElementNS(NS, 'g');
      g.classList.add('pin-region');
      g.dataset.region = r.id;
      const p = document.createElementNS(NS, 'polygon');
      p.setAttribute('points', polys[i].map(pt => toFrame(pt, c).map(n => n.toFixed(1)).join(',')).join(' '));
      g.appendChild(p);
      const t = document.createElementNS(NS, 'title');
      t.textContent = r.label || r.id;
      g.appendChild(t);
      svg.appendChild(g);
    });
    frame.appendChild(svg);
    // Numbered markers as HTML so they stay square; kept inside the visible crop.
    frame.querySelectorAll('.pin-marker').forEach(m => m.remove());
    opts.regions.forEach((r, i) => {
      if (!polys[i]) return;
      const [cx, cy] = toFrame(centroid(polys[i]), c);
      const m = document.createElement('span');
      m.className = 'pin-marker';
      m.dataset.region = r.id;
      m.append(Object.assign(document.createElement('b'), { textContent: String(i + 1) }));
      // Numbers only: the legend under the picture carries the full labels.
      // Tags point away from the nearer edge and stop short of the next marker on the same row.
      const left = cx > c.fw * 0.6;
      if (left) m.classList.add('tag-left');
      let room = left ? cx - 24 : c.fw - cx - 24;
      opts.regions.forEach((r2, j) => {
        if (j === i || !polys[j]) return;
        const [x2, y2] = toFrame(centroid(polys[j]), c);
        if (Math.abs(y2 - cy) > 30) return;
        const dx = left ? cx - x2 : x2 - cx;
        if (dx > 0) room = Math.min(room, dx - 36);
      });
      m.style.setProperty('--tagw', `${Math.max(0, Math.min(150, room - 17))}px`);
      if (room - 17 < 44) m.classList.add('no-tag');
      m.style.left = `${Math.max(18, Math.min(c.fw - 18, cx))}px`;
      m.style.top = `${Math.max(18, Math.min(c.fh - 18, cy))}px`;
      frame.appendChild(m);
    });
  }

  function setGrade(g) { el.dataset.grade = g || ''; }

  if (opts.regions && opts.onRegion) {
    frame.addEventListener('click', e => {
      const marker = e.target.closest('.pin-marker');
      let r = marker ? opts.regions.find(x => x.id === marker.dataset.region) : null;
      if (!r && polys.length) {
        const b = frame.getBoundingClientRect();
        r = regionAt(e.clientX - b.left, e.clientY - b.top);
      }
      if (r) opts.onRegion(r, marker);
      else opts.onMiss?.();
    });
    if (typeof ResizeObserver !== 'undefined') {
      let last = '';
      new ResizeObserver(() => {
        const k = `${frame.clientWidth}x${frame.clientHeight}`;
        if (k !== last && el.isConnected) { last = k; drawRegions(slot.version); }
      }).observe(frame);
    }
  }
  update();
  live.add(slot);
  return slot;
}

// ---- portraits --------------------------------------------------------------------------
export function initials(name = '') {
  const parts = name.replace(/\b(Jr|Sr|II|III)\.?$/i, '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0], last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export function portraitEl(cand, cls = '') {
  const el = document.createElement('div');
  el.className = `portrait party-${cand?.party || 'x'} ${cls}`;
  const ini = document.createElement('span');
  ini.className = 'portrait-ini';
  ini.textContent = initials(cand?.name);
  el.appendChild(ini);
  const file = `portraits/${cand?.id}.webp`;
  if (cand && mayExist(file)) {
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.onload = () => el.classList.add('has-img');
    img.onerror = () => img.remove();
    img.src = ART_BASE + file;
    el.appendChild(img);
  }
  return el;
}

export function portraitUrl(id) {
  const file = `portraits/${id}.webp`;
  return mayExist(file) ? ART_BASE + file : null;
}
