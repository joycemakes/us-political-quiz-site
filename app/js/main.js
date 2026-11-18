// US Political Quiz: boot, title screen, the run loop, chapter cards and the hand-off to results.

import { loadData } from './data.js?v=c583357-1795003897';
import { createSelector, QUICK_LENGTH, FULL_LENGTH } from './selector.js?v=c583357-1795003897';
import { createScorer, applyAnswer, axisScores, matchCandidates, matchCamps } from './scoring.js?v=c583357-1795003897';
import { buildProfile } from './profile.js?v=c583357-1795003897';
import { CHAPTERS, CHAPTER_TITLE, CHAPTER_LINE } from './axes.js?v=c583357-1795003897';
import { routeOk } from './questions.js?v=c583357-1795003897';
import { installPress, haptic, setHaptics, getHaptics, runFx, typewriter, sleep, store, reducedMotion } from './feel.js?v=c583357-1795003897';
import { loadArtManifest, createArtSlot, artUrl, artVersion } from './art.js?v=c583357-1795003897';
import { billTitle } from './types.js?v=c583357-1795003897';
import { createWarMap, createGhosts } from './hud.js?v=c583357-1795003897';
import { renderAnswer } from './types.js?v=c583357-1795003897';
import { howFor, showCue, watchIdle } from './howto.js?v=c583357-1795003897';
import { swipeEnds } from './types.js?v=c583357-1795003897';
import { renderResults } from './results.js?v=c583357-1795003897';
import { newSeed } from './rng.js?v=c583357-1795003897';
import { loadShareConfig } from './share.js?v=c583357-1795003897';
import { getSound, setSound, sfx } from './sound.js?v=c583357-1795003897';
import { readingContext, buildReading } from './reading.js?v=c583357-1795003897';
import { playReveal } from './reveal.js?v=c583357-1795003897';
import { dossierFromRun, encodeDossier, decodeDossier, rebuildDossier, dossierLink, codeFromHash, fileNumber, minuteOf, tidyScores, tidyReads } from './dossier.js?v=c583357-1795003897';
import { pickTicket, pickExhibits, ticketView } from './endgame.js?v=c583357-1795003897';
import { renderVersus } from './versus.js?v=c583357-1795003897';

// Versus: this device's own finished file (its dossier code), and a file someone sent that is waiting to be
// compared once the player has one of their own ({ code, pending }).
const MINE_KEY = 'uspq.mine', VERSUS_KEY = 'uspq.versus';

const app = document.getElementById('app');
const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const fineSkip = () => { try { return window.matchMedia('(pointer: fine)').matches; } catch { return false; } };
const READY_GUARD_MS = 400;
// The run in progress (or just finished) is saved here after every answer, so closing the tab loses
// nothing. Replaying the saved answers through the seeded selector rebuilds the run exactly.
const SAVE_KEY = 'uspq.run';
// The seen-list keeps about three runs' worth, so replays keep rotating instead of running out of
// unseen questions after eight or nine runs and settling back into the same openings.
const SEEN_KEEP = 150;
const loadSave = () => {
  const v = store.get(SAVE_KEY, null);
  return v && v.v === 1 && Array.isArray(v.answers) && (v.route === 'dem' || v.route === 'gop') ? v : null;
};
const clearSave = () => { try { localStorage.removeItem(SAVE_KEY); } catch { /* private mode */ } };

const S = {
  data: null,
  route: store.get('uspq.route', 'dem'),
  // Quick is the default every visit (Chris, 18 Nov 2026); a saved run keeps its own length.
  length: QUICK_LENGTH,
  run: null,
};
// Test and debug handle (read-only use; the browser bot drives the real controls).
window.__quiz = S;

async function boot() {
  installPress(document);
  // Looping animations stop while the tab is hidden.
  const vis = () => document.documentElement.classList.toggle('paused', document.hidden);
  document.addEventListener('visibilitychange', vis);
  vis();
  app.innerHTML = '<div class="loading"><div class="wordmark">US Political Quiz</div><p class="eyebrow">Opening the file</p></div>';
  try {
    const [data, , shareCfg] = await Promise.all([loadData(), loadArtManifest(), loadShareConfig()]);
    S.shareCfg = shareCfg;
    S.data = data;
    S.cands = new Map(data.candidates.map(c => [c.id, c]));
  } catch (e) {
    app.innerHTML = '';
    app.appendChild(h('p', 'fatal', `Could not load the quiz data. Serve the project folder over http and open /app/. (${e.message})`));
    console.warn(e);
    return;
  }
  // A shared dossier link (#d=<code>) opens that dossier, read-only; pasting one later works too.
  window.addEventListener('hashchange', () => { const c = codeFromHash(location.hash); if (c) openShared(c); });
  const shared = codeFromHash(location.hash);
  if (shared) openShared(shared);
  else title();
}

// ---- a shared dossier ----------------------------------------------------------------------------
// Never touches this device's own saved run or seen-list.
const dropHash = () => { try { history.replaceState(null, '', location.pathname + location.search); } catch { /* file: */ } };
function openShared(code) {
  const { candidates, camps, reading } = S.data;
  const r = decodeDossier(code, { candidates, camps });
  if (!r.ok) { dropHash(); title({ notice: r.error }); return; }
  S.run = null;
  const rb = rebuildDossier(r.data, { candidates, camps, reading, bank: S.data.bank });
  const dossier = { code, link: dossierLink(code, S.shareCfg.url), file: fileNumber(code) };
  S.shared = { code, data: r.data, ...rb };
  const tv = ticketView(rb.ticket, S.data.endgame, S.cands);
  const reveal = { reading: rb.reading, matches: rb.matches, cands: S.cands, profile: rb.profile, scores: rb.scores, route: rb.route, shareCfg: S.shareCfg, link: dossier.link,
    exhibits: rb.exhibits, ticket: rb.ticket, ticketView: tv, endgame: S.data.endgame };
  // Versus: with a finished file of your own, compare; without one, the code waits for the end of your run.
  const mine = store.get(MINE_KEY, null);
  const versus = mine && mine !== code && decodeDossier(mine, { candidates, camps }).ok
    ? { label: 'Compare with your file', text: 'You have a file of your own on this device. Lay the two side by side.', onClick: () => showVersus(mine, code) }
    : null;
  app.innerHTML = '';
  const bd = h('div', 'backdrop');
  bd.dataset.bg = 'election_night';
  app.appendChild(bd);
  renderResults(app, {
    profile: rb.profile, matches: rb.matches, scores: rb.scores, cands: S.cands, camps, route: rb.route, length: rb.length, signals: rb.signals,
    shareCfg: S.shareCfg, reading: rb.reading, dossier, shared: true,
    exhibits: rb.exhibits, ticket: rb.ticket, ticketView: tv, endgame: S.data.endgame, versus,
    // Taking the quiz from someone's file remembers it, so the end of your run can offer the compare.
    onAgain: () => { if (!versus) store.set(VERSUS_KEY, { code, pending: true }); dropHash(); S.shared = null; title(); },
    onReplay: () => playReveal({ ...reveal, replay: true }),
  });
  window.scrollTo({ top: 0 });
}

// ---- title --------------------------------------------------------------------------------------
function title({ notice = '' } = {}) {
  S.run = null;
  app.innerHTML = '';
  const bd = h('div', 'backdrop title-backdrop');
  bd.dataset.bg = 'title';
  app.append(bd, h('div', 'fog'));
  const t = h('main', 'screen title-screen');
  const hero = h('div', 'title-hero');
  hero.append(
    h('div', 'live-row'),
    h('h1', 'wordmark', 'US Political Quiz'),
    h('div', 'title-quiz', 'The 2028 Race'),
    h('div', 'tagline', 'Which candidate are you, really?'),
    h('p', 'title-blurb', 'Twenty-three candidates want the White House. Answer like you mean it and find out which of them you already are.'),
  );
  hero.querySelector('.live-row').append(h('span', 'live', 'Live'), h('span', 'eyebrow', '23 candidates · 2028'));

  const group = (label, items, key, onPick) => {
    const g = h('div', 'choice-group');
    g.setAttribute('role', 'radiogroup');
    g.setAttribute('aria-label', label);
    g.appendChild(h('div', 'group-label', label));
    const row = h('div', 'group-row');
    for (const it of items) {
      const b = h('button', `btn pick ${it.cls || ''}`);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.value = String(it.value);
      b.append(h('span', 'pick-main', it.main), h('span', 'pick-sub', it.sub));
      b.setAttribute('aria-label', `${it.main}, ${it.sub}`);
      b.addEventListener('click', () => { S[key] = it.value; store.set(`uspq.${key}`, it.value); haptic('select'); sync(); onPick && onPick(); });
      row.appendChild(b);
    }
    // A radio group: one tab stop (the checked one), the arrow keys move the choice (sense check).
    const sync = () => row.querySelectorAll('.pick').forEach(x => { const on = x.dataset.value === String(S[key]); x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; });
    row.addEventListener('keydown', e => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      const all = [...row.querySelectorAll('.pick')];
      const i = Math.max(0, all.findIndex(x => x.dataset.value === String(S[key])));
      const nb = all[(i + dir + all.length) % all.length];
      nb.click();
      nb.focus();
    });
    g.appendChild(row);
    queueMicrotask(sync);
    return g;
  };
  const route = group('Your primary', [
    { value: 'dem', main: 'Democrat', sub: 'The donkey', cls: 'party-dem' },
    { value: 'gop', main: 'Republican', sub: 'The elephant', cls: 'party-gop' },
  ], 'route');
  const length = group('Length', [
    { value: QUICK_LENGTH, main: 'Quick', sub: `${QUICK_LENGTH} questions` },
    { value: FULL_LENGTH, main: 'Full Dossier', sub: `${FULL_LENGTH} questions` },
  ], 'length');

  const hap = h('button', 'btn switch-row');
  hap.type = 'button';
  hap.setAttribute('role', 'switch');
  hap.setAttribute('aria-label', 'Haptics');
  const syncHap = () => { hap.setAttribute('aria-checked', String(getHaptics())); hap.querySelector('.switch-state').textContent = getHaptics() ? 'On' : 'Off'; };
  hap.append(h('span', 'switch-label', 'Haptics'), h('span', 'switch-track'), h('span', 'switch-state', ''));
  hap.querySelector('.switch-track').appendChild(h('span', 'switch-knob'));
  hap.addEventListener('click', () => { setHaptics(!getHaptics()); syncHap(); });
  syncHap();
  const snd = h('button', 'btn switch-row');
  snd.type = 'button';
  snd.setAttribute('role', 'switch');
  snd.setAttribute('aria-label', 'Sound');
  const syncSnd = () => { snd.setAttribute('aria-checked', String(getSound())); snd.querySelector('.switch-state').textContent = getSound() ? 'On' : 'Off'; };
  snd.append(h('span', 'switch-label', 'Sound'), h('span', 'switch-track'), h('span', 'switch-state', ''));
  snd.querySelector('.switch-track').appendChild(h('span', 'switch-knob'));
  snd.addEventListener('click', () => { setSound(!getSound()); syncSnd(); });
  syncSnd();
  const toggles = h('div', 'toggle-row');
  toggles.append(hap, snd);

  const saved = loadSave();
  const begin = h('button', `btn ${saved ? '' : 'primary '}begin`);
  begin.type = 'button';
  begin.appendChild(h('span', 'btn-label', saved ? 'Start a new file' : 'Open the file'));
  begin.addEventListener('click', () => { haptic('commit'); clearSave(); startRun(); });
  const panel = h('div', 'title-panel');
  if (saved) {
    const n = saved.answers.length;
    const resume = h('button', 'btn primary resume');
    resume.type = 'button';
    resume.append(
      h('span', 'pick-main', saved.done ? 'See your result' : 'Continue your file'),
      h('span', 'pick-sub', `${saved.route === 'gop' ? 'Republican' : 'Democrat'} · ${saved.length === FULL_LENGTH ? 'Full Dossier' : saved.length === QUICK_LENGTH ? 'Quick' : `${saved.length} questions`} · ${saved.done ? `all ${n} answered` : `question ${n + 1} of ${saved.length}`}`),
    );
    resume.addEventListener('click', () => { haptic('commit'); startRun(saved); });
    const cont = h('div', 'choice-group resume-group');
    cont.append(h('div', 'group-label', 'Saved on this device'), resume);
    panel.append(cont);
  }
  // With a saved file, the pickers below are plainly for a new one (sense check: Continue said 48 while
  // the Length toggle showed Quick).
  if (saved) panel.append(h('div', 'new-file-label', 'Or start a new file with these settings'));
  panel.append(route, length, toggles, begin);
  if (notice) {
    const n = h('p', 'title-notice', notice);
    n.setAttribute('role', 'alert');
    hero.prepend(n);
  }
  t.append(hero, panel);
  app.appendChild(t);
}

// ---- the run -------------------------------------------------------------------------------------
async function startRun(saved = null) {
  const params = new URLSearchParams(location.search);
  const devBank = params.has('only') || params.has('q');
  if (saved && devBank) saved = null;
  const seed = saved ? saved.seed >>> 0 : params.has('seed') ? Number(params.get('seed')) >>> 0 : newSeed();
  const route = saved ? saved.route : S.route;
  const runLength = saved ? saved.length : S.length;
  const { candidates } = S.data;
  // Dev aid: ?only=pin,sign plays just those types; ?q=A-009 puts one question first.
  let bank = S.data.bank;
  if (params.get('only')) { const keep = new Set(params.get('only').split(',')); bank = bank.filter(q => keep.has(q.type)); }
  if (params.get('q')) { const f = bank.find(q => q.id === params.get('q')); if (f) bank = [{ ...f, chapter: 'announcement', route: 'both', tier: 'core' }].concat(bank.filter(q => q !== f)); }
  const seenList = saved ? saved.seen || [] : store.get('uspq.seen', []);
  const seen = new Set(seenList);
  const sel = createSelector({ bank, candidates, route, length: runLength, seed, seen });
  const sc = createScorer();
  const run = { seed, sel, sc, route, length: runLength, index: 0, current: null, log: [], seenTypes: new Set() };
  S.run = run;
  const live = () => S.run === run;
  // revealSeen: the win reveal has been watched to the end, so See your result opens the dossier.
  const save = { v: 1, seed, route, length: runLength, seen: seenList, answers: [], done: false, revealSeen: !!(saved && saved.revealSeen) };
  const persist = () => { if (!devBank && live()) store.set(SAVE_KEY, save); };
  const replay = saved ? saved.answers : [];
  run.save = save;
  run.persist = persist;
  if (!saved) persist();

  app.innerHTML = '';
  const backdrop = h('div', 'backdrop');
  app.appendChild(backdrop);
  const stage = h('main', 'screen run-screen');
  const hud = h('header', 'hud');
  const map = createWarMap();
  const ghosts = createGhosts();
  const mid = h('div', 'hud-mid');
  const chapterLbl = h('div', 'hud-chapter');
  const qLbl = h('div', 'hud-q');
  mid.append(chapterLbl, qLbl);
  // Exit to title: the saved file stays, so it can be continued or a new one opened (was Start over).
  const quit = h('button', 'hud-quit', 'Exit to title');
  quit.type = 'button';
  quit.addEventListener('click', () => { haptic('select'); title(); });
  const speaker = h('button', 'hud-sound');
  speaker.type = 'button';
  const syncSpeaker = () => { speaker.setAttribute('aria-pressed', String(!getSound())); speaker.setAttribute('aria-label', getSound() ? 'Sound on. Tap to mute.' : 'Sound off. Tap to turn on.'); speaker.dataset.on = getSound() ? '1' : '0'; };
  speaker.addEventListener('click', () => { setSound(!getSound()); syncSpeaker(); });
  syncSpeaker();
  hud.append(map.el, mid, quit, speaker, ghosts.el);
  const banner = h('div', 'breaking');
  banner.hidden = true;
  banner.append(h('span', 'breaking-tag', 'Breaking'), h('span', 'breaking-text'));
  const candles = h('div', 'candle-overlay');
  candles.setAttribute('aria-hidden', 'true');
  candles.append(h('span', 'candle l'), h('span', 'candle r'));
  const body = h('div', 'q-wrap');
  stage.append(hud, banner, body, candles);
  app.appendChild(stage);
  run.stage = stage;

  let total = sel.total;
  let rank = matchCandidates(sc, candidates, run.route).map(r => r.id);
  ghosts.set(rank.slice(0, 3));
  map.set(0, total);

  for (let i = 0; ; i++) {
    const q = sel.next(rank);
    if (!q) break;
    run.index = i;
    total = sel.total;
    let answer;
    if (i < replay.length) {
      // Rebuilding a saved run: the same seed and answers give the same questions. If the bank has
      // changed since (a new deploy), the save no longer fits, so a fresh file starts instead.
      if (!replay[i] || replay[i].id !== q.id) {
        console.warn(`[quiz] saved run no longer fits at question ${i + 1}; starting a new file`);
        clearSave();
        return startRun();
      }
      answer = replay[i].a || {};
      run.seenTypes.add(q.type);
    } else {
      backdrop.dataset.bg = sel.chapterAt(i);
      if (sel.isChapterStart(i)) await chapterCard(sel.chapterAt(i), stage);
      if (!live()) return;
      chapterLbl.textContent = CHAPTER_TITLE[sel.chapterAt(i)] || '';
      qLbl.textContent = `Question ${i + 1} of ${total}`;
      map.set(i, total);
      answer = await askQuestion(q, { body, stage, banner, fresh: i === 0 });
      if (!live()) return;
    }
    const why = sel.history[i]?.reason || '';
    if (why.startsWith('borrow:')) console.info(`[quiz] ${q.id} borrowed from ${q.chapter} for coverage (${why})`);
    const summary = applyAnswer(sc, q, answer);
    run.log.push({ id: q.id, type: q.type, summary });
    save.answers.push({ id: q.id, a: answer });
    if (i >= replay.length) persist();
    // The device's seen-list grows as you play, not only when a run finishes, so a run you abandon
    // still steers the next one toward questions you have not had (Chris, 18 Nov 2026).
    if (i >= replay.length && !devBank) {
      const prevSeen = store.get('uspq.seen', []);
      if (!prevSeen.includes(q.id)) store.set('uspq.seen', prevSeen.concat(q.id).slice(-SEEN_KEEP));
    }
    rank = matchCandidates(sc, candidates, run.route).map(r => r.id);
    if (i >= replay.length - 1) ghosts.set(rank.slice(0, 3));
  }
  if (!live()) return;
  map.set(total, total);
  save.done = true;
  persist();
  finish(run);
}

function chapterCard(chapter, stage) {
  return new Promise(resolve => {
    const n = CHAPTERS.indexOf(chapter);
    const card = h('div', 'chapter-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', CHAPTER_TITLE[chapter]);
    const candlesRow = h('div', 'candle-row');
    candlesRow.append(h('span', 'candle'), h('span', 'candle'), h('span', 'candle'));
    candlesRow.setAttribute('aria-hidden', 'true');
    card.append(
      candlesRow,
      h('div', 'chapter-num', `Chapter ${ROMAN[n] || ''}`),
      h('h2', 'chapter-title'),
      h('p', 'chapter-line'),
      h('div', 'chapter-tap', fineSkip() ? 'Click or press a key to skip' : 'Tap to skip'),
    );
    const inner = h('div', 'chapter-inner panel');
    inner.append(...card.childNodes);
    card.appendChild(inner);
    // The chapter's own art behind the card, when it has landed.
    const art = artUrl(`chapter-${chapter}_${artVersion()}.webp`);
    if (art) card.style.setProperty('--chapter-art', `url("${new URL(art, document.baseURI).href}")`);
    stage.appendChild(card);
    haptic('light');
    (async () => {
      await typewriter(card.querySelector('.chapter-title'), CHAPTER_TITLE[chapter] || chapter, { maxMs: 700 }).done;
      typewriter(card.querySelector('.chapter-line'), CHAPTER_LINE[chapter] || '', { maxMs: 1000 });
    })();
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey);
      card.classList.add('out');
      setTimeout(() => { card.remove(); resolve(); }, reducedMotion() ? 0 : 280);
    };
    card.addEventListener('pointerdown', go);
    card.addEventListener('click', go);
    const onKey = e => { if (!['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) go(); };
    window.addEventListener('keydown', onKey);
    setTimeout(go, 2200);
  });
}

async function askQuestion(q, { body, stage, banner, fresh }) {
  body.innerHTML = '';
  const wrap = h('article', `q q-${q.type}`);
  wrap.dataset.qid = q.id;
  wrap.dataset.type = q.type;
  if (q.tier === 'bombshell') wrap.classList.add('bombshell');
  const artHost = h('div', 'q-art');
  const text = h('div', 'q-text');
  const ctxEl = h('p', 'q-context', q.context || '');
  // The banner, the bill and the who-said-it reveal carry the context on those questions.
  if (!q.context || q.fx.includes('breaking') || q.type === 'whosaid' || (q.type === 'sign' && billTitle(q) === q.context)) ctxEl.hidden = true;
  const prompt = h('h2', 'q-prompt');
  text.append(ctxEl, prompt);
  const answer = h('div', 'q-answer');
  const hasArt = !!q.art || q.type === 'pin' || q.type === 'envelope';
  if (hasArt) wrap.classList.add('has-art');
  wrap.append(text, artHost, answer);
  body.appendChild(wrap);
  window.scrollTo({ top: 0, behavior: 'auto' });
  // Envelope scenes always get a stage to play out on; without their own art, the chapter backdrop.
  if ((q.art || q.type === 'envelope') && q.type !== 'pin') artHost.appendChild(createArtSlot(q.art || `scene-${q.id}`, { kind: q.type === 'envelope' ? 'envelope' : 'scene', chapter: q.chapter, quiet: !q.art }).el);
  if (!hasArt) artHost.hidden = true;

  // The answers show at once, dimmed, while the text types on; the first tap finishes the typing.
  const fine = (() => { try { return window.matchMedia('(pointer: fine)').matches; } catch { return false; } })();
  const firstOfType = !S.run.seenTypes.has(q.type);
  S.run.seenTypes.add(q.type);
  const how = h('p', 'how');
  how.setAttribute('role', 'note');
  answer.appendChild(how);
  wrap.classList.add('typing');
  // The line types first; a renderer may then replace it with something more specific (pins, budgets).
  typewriter(how, howFor(q, { fine, ends: q.type === 'swipe' ? swipeEnds(q) : null }), { maxMs: 900 });
  const pending = renderAnswer(q, { el: answer, artHost, cands: S.cands, stage, chapter: q.chapter, firstOfType, how, fine });
  if (fresh) {
    const note = h('p', 'hud-note', 'The three shadows up top are your closest matches so far.');
    stage.querySelector('.hud')?.after(note);
    setTimeout(() => note.remove(), 9000);
  }
  fitToScreen(wrap, artHost);
  const intro = runFx(q, { stage, banner });
  let promptText = q.prompt || '';
  // The hint under a hold says how; Hold to commit. in a prompt (at either end) adds nothing.
  promptText = promptText.replace(/^\s*hold to commit\.?\s*/i, '').replace(/\s*hold to commit\.?\s*$/i, '').trim();
  // The hint under a hold says how to hold, so a prompt that says it too drops its copy (sense check).
  if (q.type === 'hold') promptText = promptText.replace(/\s*Press and hold your answer[^.]*\.?\s*$/i, '').trim() || promptText;
  if (!promptText && q.context) { promptText = q.context; ctxEl.hidden = true; }
  // Screen readers: after each answer, focus moves to the new question's heading, which carries its full
  // text at once (the visible text types on).
  prompt.tabIndex = -1;
  prompt.setAttribute('aria-label', [ctxEl.hidden ? '' : q.context, promptText].filter(Boolean).join(' '));
  if (!fresh) prompt.focus({ preventScroll: true });
  // Context, then prompt, type on; the controls arrive when the prompt has finished (a tap finishes it).
  if (!ctxEl.hidden && q.context) await typewriter(ctxEl, q.context, { maxMs: 1200 }).done;
  await typewriter(prompt, promptText, { maxMs: 1800 }).done;
  await intro;
  S.run.current = { q, el: wrap };
  // Input guard: nothing counts for 500 ms after the question is ready, and a tap only counts if its
  // pointerdown started on this question (so a double tap on the last screen cannot answer this one).
  const armedAt = performance.now() + READY_GUARD_MS;
  let downHere = false;
  const early = () => performance.now() < armedAt;
  wrap.addEventListener('pointerdown', e => { if (early()) { e.stopPropagation(); e.preventDefault(); return; } downHere = true; }, true);
  for (const ev of ['pointerup', 'click']) {
    wrap.addEventListener(ev, e => {
      const keyboard = ev === 'click' && e.detail === 0;
      if (early() || (!downHere && !keyboard)) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }
  wrap.classList.add('ready');
  wrap.classList.remove('typing');
  fitToScreen(wrap, artHost);
  // A demo the first time a type appears; a nudge when idle.
  let stopCue = () => {};
  if (firstOfType) setTimeout(() => { if (!wrap.classList.contains('leaving')) stopCue = showCue(q.type, wrap); }, 300);
  const stopIdle = watchIdle(q.type, wrap, how);
  const res = await pending;
  stopIdle();
  stopCue();
  wrap.classList.add('leaving');
  await sleep(reducedMotion() ? 0 : 140);
  return res;
}

// Phones: everything needed to answer fits on screen. Pictures give up height first (down to 120 px),
// and the commit button is sticky at the bottom (CSS) for whatever still does not fit.
function fitToScreen(wrap, artHost) {
  const slot = artHost.querySelector('.art-slot:not(.art-pin)');
  if (!slot) return;
  const fit = () => {
    if (!wrap.isConnected) return;
    slot.style.removeProperty('--scene-h');
    const over = document.documentElement.scrollHeight - window.innerHeight;
    const fh = slot.querySelector('.art-frame')?.getBoundingClientRect().height || 0;
    if (over > 0 && fh > 0) slot.style.setProperty('--scene-h', `${Math.max(120, Math.floor(fh - over - 4))}px`);
  };
  setTimeout(fit, 60);
  setTimeout(fit, 400);
}

async function finish(run) {
  // Remember what this device has seen so replays prefer fresh questions (the last SEEN_KEEP ids).
  const prevSeen = store.get('uspq.seen', []);
  const ids = run.sel.history.map(x => x.id);
  store.set('uspq.seen', prevSeen.filter(id => !ids.includes(id)).concat(ids).slice(-SEEN_KEEP));
  const { candidates, camps } = S.data;
  // Values tidied to 1e-9 (dossier.js) so this page and its shared link agree at band edges.
  const scores = tidyScores(axisScores(run.sc));
  const matches = matchCandidates(run.sc, candidates, run.route);
  // The time is kept to the minute, the same as in the dossier code, so a shared link rebuilds the same dossier.
  const t = minuteOf(Math.floor(Date.now() / 1000));
  const profile = buildProfile({ scores, matches, camps, route: run.route, scorerFlags: run.sc.flags, campRows: matchCamps(run.sc, camps, candidates) });
  const reading = buildReading(S.data.reading, readingContext({ scores, signals: run.sc.signals, reads: tidyReads(run.sc.reads), matches, route: run.route }));
  // The endgame: Exhibits A, B, C from the receipts the answers fired, and the ticket from the match list.
  const exhibits = pickExhibits(run.sc.receipts);
  const ticket = pickTicket({ matches, scores, route: run.route, candidates });
  const tv = ticketView(ticket, S.data.endgame, S.cands);
  // The shareable dossier: the result packed into a USQ2 code and a link (app/js/dossier.js).
  let dossier = null;
  try {
    const enc = encodeDossier(dossierFromRun({ route: run.route, length: run.sel.history.length, t, scores, matches, reads: run.sc.reads, signals: run.sc.signals, flags: run.sc.flags, ticket, exhibits, campRows: matchCamps(run.sc, camps, candidates) }),
      { candidates, camps, reading: S.data.reading, bank: S.data.bank });
    if (!enc.exact) console.info(`[quiz] dossier link rebuilds with ${enc.off} small difference(s) from this page`);
    dossier = { code: enc.code, link: dossierLink(enc.code, S.shareCfg.url), file: fileNumber(enc.code) };
    store.set(MINE_KEY, enc.code);
  } catch (e) { console.warn('[quiz] could not make a dossier link', e); }
  run.result = { scores, matches, profile, reading, dossier, exhibits, ticket };
  run.stage.classList.remove('fx-night', 'fx-candles');
  const reveal = { reading, matches, cands: S.cands, profile, scores, route: run.route, shareCfg: S.shareCfg, link: dossier?.link,
    exhibits, ticket, ticketView: tv, endgame: S.data.endgame };
  const live = () => S.run === run;

  const showDossier = () => {
    app.innerHTML = '';
    const bd = h('div', 'backdrop');
    bd.dataset.bg = 'election_night';
    app.appendChild(bd);
    // A file someone sent, waiting for this one: offer the compare (it stays offered on the dossier).
    const waiting = store.get(VERSUS_KEY, null);
    const theirs = waiting && waiting.code && dossier && waiting.code !== dossier.code && decodeDossier(waiting.code, { candidates, camps }).ok ? waiting.code : null;
    const versus = theirs ? {
      label: 'Compare with their file',
      text: waiting.pending ? `Your file is done. Lay it beside the one you were sent, File No. ${fileNumber(theirs)}.` : `Compare again with File No. ${fileNumber(theirs)}.`,
      onClick: () => { store.set(VERSUS_KEY, { code: theirs, pending: false }); showVersus(dossier.code, theirs); },
    } : null;
    const out = renderResults(app, {
      profile, matches, scores, cands: S.cands, camps, route: run.route, length: run.sel.history.length, signals: run.sc.signals, shareCfg: S.shareCfg, reading, dossier,
      exhibits, ticket, ticketView: tv, endgame: S.data.endgame, versus,
      onAgain: () => { clearSave(); title(); },
      // Replay the reveal over the dossier; closing it comes back to the same place on the page.
      onReplay: () => playReveal({ ...reveal, replay: true }),
    });
    run.result.shown = !!out;
    window.scrollTo({ top: 0 });
  };

  // A run reopened with See your result goes straight to the dossier once its reveal has been
  // watched (the dossier has Replay the reveal); otherwise the reveal plays first.
  if (run.save?.revealSeen) { showDossier(); return; }
  app.innerHTML = '';
  const bd = h('div', 'backdrop');
  bd.dataset.bg = 'election_night';
  app.appendChild(bd);
  await playReveal(reveal);
  if (!live()) return;
  run.save.revealSeen = true;
  run.persist();
  showDossier();
}

// ---- versus: two files side by side ---------------------------------------------------------------------
function showVersus(mineCode, theirCode) {
  const { candidates, camps, reading, bank, endgame } = S.data;
  const a = decodeDossier(mineCode, { candidates, camps }), b = decodeDossier(theirCode, { candidates, camps });
  if (!a.ok || !b.ok) { title({ notice: (a.ok ? b : a).error }); return; }
  const side = (code, d) => { const rb = rebuildDossier(d, { candidates, camps, reading, bank }); return { rb, ticketView: ticketView(rb.ticket, endgame, S.cands), file: fileNumber(code) }; };
  S.run = null;
  app.innerHTML = '';
  const bd = h('div', 'backdrop');
  bd.dataset.bg = 'election_night';
  app.appendChild(bd);
  const host = h('div', 'versus-host');
  app.appendChild(host);
  renderVersus(host, side(mineCode, a.data), side(theirCode, b.data), {
    endgame, cands: S.cands,
    onTheirs: () => { try { history.replaceState(null, '', `${location.pathname}${location.search}#d=${theirCode}`); } catch { /* file: */ } openShared(theirCode); },
    onMine: () => { dropHash(); const saved = loadSave(); if (saved && saved.done) startRun(saved); else openShared(mineCode); },
  });
}

boot();
