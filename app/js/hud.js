// HUD: the war-room map progress bar and the ghost leaderboard.

const NS = 'http://www.w3.org/2000/svg';

// Tile-grid map of the 50 states plus DC (col, row).
const TILES = {
  AK: [0, 0], ME: [10, 0], VT: [9, 1], NH: [10, 1],
  WA: [0, 2], ID: [1, 2], MT: [2, 2], ND: [3, 2], MN: [4, 2], IL: [5, 2], WI: [6, 2], MI: [7, 2], NY: [8, 2], RI: [9, 2], MA: [10, 2],
  OR: [0, 3], NV: [1, 3], WY: [2, 3], SD: [3, 3], IA: [4, 3], IN: [5, 3], OH: [6, 3], PA: [7, 3], NJ: [8, 3], CT: [9, 3],
  CA: [0, 4], UT: [1, 4], CO: [2, 4], NE: [3, 4], MO: [4, 4], KY: [5, 4], WV: [6, 4], VA: [7, 4], MD: [8, 4], DE: [9, 4],
  AZ: [1, 5], NM: [2, 5], KS: [3, 5], AR: [4, 5], TN: [5, 5], NC: [6, 5], SC: [7, 5], DC: [8, 5],
  OK: [3, 6], LA: [4, 6], MS: [5, 6], AL: [6, 6], GA: [7, 6],
  HI: [0, 7], TX: [3, 7], FL: [8, 7],
};
// Roughly the primary calendar, then the rest of the map.
const ORDER = ['IA', 'NH', 'NV', 'SC', 'MI', 'AL', 'AR', 'CA', 'CO', 'ME', 'MA', 'MN', 'NC', 'OK', 'TN', 'TX', 'UT', 'VT', 'VA',
  'GA', 'MS', 'WA', 'AZ', 'FL', 'IL', 'KS', 'OH', 'MO', 'ID', 'ND', 'NY', 'PA', 'CT', 'DE', 'RI', 'MD', 'WI', 'IN', 'NE', 'WV',
  'KY', 'OR', 'LA', 'MT', 'NJ', 'NM', 'SD', 'DC', 'HI', 'AK', 'WY'];

export function createWarMap() {
  const el = document.createElement('div');
  el.className = 'warmap';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 110 80');
  svg.setAttribute('width', '92');
  svg.setAttribute('height', '67');
  svg.setAttribute('aria-hidden', 'true');
  const rects = {};
  for (const [st, [c, r]] of Object.entries(TILES)) {
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', c * 10 + 0.5);
    rect.setAttribute('y', r * 10 + 0.5);
    rect.setAttribute('width', 9);
    rect.setAttribute('height', 9);
    rect.classList.add('tile');
    svg.appendChild(rect);
    rects[st] = rect;
  }
  const label = document.createElement('div');
  label.className = 'warmap-label';
  el.append(svg, label);
  let lastLit = 0;
  return {
    el,
    // done questions out of total. One state per question on a 50 run, one per two on a 100 run.
    set(done, total) {
      const lit = total ? Math.round((done / total) * ORDER.length) : 0;
      ORDER.forEach((st, i) => {
        const r = rects[st];
        r.classList.toggle('lit', i < lit);
        r.classList.toggle('next', i === lit && done < total);
        r.classList.toggle('flash', i < lit && i >= lastLit);
      });
      lastLit = lit;
      label.textContent = `${Math.min(done + 1, total)} / ${total}`;
      el.setAttribute('aria-label', `Question ${Math.min(done + 1, total)} of ${total}`);
    },
  };
}

// ---- ghost leaderboard --------------------------------------------------------------------
function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// A dim bust silhouette whose head, hair and shoulders vary by candidate, so a change of leader shows.
export function silhouetteSVG(id) {
  const h = hash(id || 'x');
  const headR = 7 + (h % 3);
  const shoulder = 15 + ((h >> 3) % 5);
  const hair = (h >> 6) % 4;
  const neck = 3 + ((h >> 9) % 2);
  const hy = 14;
  let hairPath = '';
  if (hair === 1) hairPath = `<path d="M${20 - headR} ${hy - 1} Q20 ${hy - headR - 5} ${20 + headR} ${hy - 1} Z"/>`;
  if (hair === 2) hairPath = `<path d="M${20 - headR - 1} ${hy + 6} Q${20 - headR - 2} ${hy - headR - 3} 20 ${hy - headR - 1} Q${20 + headR + 2} ${hy - headR - 3} ${20 + headR + 1} ${hy + 6} Z"/>`;
  if (hair === 3) hairPath = `<rect x="${20 - headR}" y="${hy - headR - 2}" width="${headR * 2}" height="4"/>`;
  return `<svg viewBox="0 0 40 44" width="40" height="44" aria-hidden="true"><g class="ghost-fill">${hairPath}<circle cx="20" cy="${hy}" r="${headR}"/>` +
    `<rect x="${20 - neck / 2}" y="${hy + headR - 1}" width="${neck}" height="4"/>` +
    `<path d="M${20 - shoulder} 44 Q${20 - shoulder} ${hy + headR + 4} 20 ${hy + headR + 3} Q${20 + shoulder} ${hy + headR + 4} ${20 + shoulder} 44 Z"/></g></svg>`;
}

// A blacked-out cut of the candidate's own portrait (art/silhouettes/<id>.png, made by
// tools/make-silhouettes.py): hair and shoulders hint at who it is without showing a face. Falls back
// to the drawn bust when the cut is missing.
export function silhouetteEl(id, cls = 'ghost-img') {
  const wrap = document.createElement('span');
  wrap.className = `${cls}-wrap`;
  const img = document.createElement('img');
  img.className = cls;
  img.alt = '';
  img.width = 44; img.height = 44;
  img.decoding = 'async';
  img.onerror = () => { wrap.innerHTML = silhouetteSVG(id).replace('<svg ', '<svg width="44" height="48" '); };
  img.src = `art/silhouettes/${id}.png`;
  wrap.appendChild(img);
  return wrap;
}

export function createGhosts() {
  const el = document.createElement('div');
  el.className = 'ghosts';
  el.setAttribute('aria-label', 'Your three closest matches, hidden until the end');
  const slots = [0, 1, 2].map(i => {
    const s = document.createElement('div');
    s.className = `ghost g${i + 1}`;
    s.innerHTML = `<div class="ghost-sil"></div><span class="ghost-plaque"><span class="ghost-rank">${i + 1}</span></span>`;
    el.appendChild(s);
    return s;
  });
  let current = [];
  return {
    el,
    set(top3) {
      top3.forEach((id, i) => {
        if (current[i] === id) return;
        const s = slots[i];
        s.querySelector('.ghost-sil').replaceChildren(silhouetteEl(id));
        if (current.length) { s.classList.remove('shift'); void s.offsetWidth; s.classList.add('shift'); }
      });
      current = top3.slice();
    },
  };
}
