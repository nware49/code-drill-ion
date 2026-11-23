// code drillion: browser UI. All game rules live in engine.js; this file renders and keeps state.
import {
  TIERS, ROOT, MAX_DEPTH, compilePrompt, judge, pointsFor, dailyPlan, practicePlan, materialize,
  dayNumber, dateForDay, hex, rankFor, depthOf, shareText, rng, shuffle, autocompleteDepth,
  kmFor, fmtKm, layerAt,
} from './engine.js';
import { BANK } from './bank/index.js';
import { DrillScene, badgeURL } from './art.js';

const SUGGEST_URL = 'https://github.com/nware49/code-drill-ion/issues/new';
const STORE_KEY = 'code-drillion:v1';
const SECONDS = 30;
const SECONDS_EXTENDED = 45;
const SHARE_URL = document.querySelector('meta[name="drill:share-url"]')?.content?.trim() || '';

const PROMPTS = BANK.map(compilePrompt);
const PROMPT_BY_ID = new Map(PROMPTS.map((p) => [p.id, p]));
const BANK_ANSWERS = PROMPTS.reduce((n, p) => n + p.answers.length, 0);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tierClass = (t) => (t === 'root' ? 'troot' : Number.isInteger(t) ? `t${t}` : 'tmiss');
const tierName = (t) => (t === 'root' ? ROOT.name : TIERS[t].name);
const tierSub = (t) => (t === 'root' ? ROOT.sub : TIERS[t].sub);
const tierArt = (t) => (t === 'root' ? ROOT.key : TIERS[t].key);
const fmtDay = (day) => dateForDay(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'];
const countOf = (n, word) => `${NUMBER_WORDS[n] ?? n} ${word}${n === 1 ? '' : 's'}`;

/* ------------------------------------------------------------------ */
/* Storage. Browser storage can be missing or throw; the game still runs from memory. */
/* ------------------------------------------------------------------ */

const freshStore = () => ({ v: 1, days: {}, archive: {}, practice: null, settings: { extended: false, theme: '' } });
let store = freshStore();

function readStore(fallback) {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.v === 1) return { ...freshStore(), ...parsed, settings: { ...freshStore().settings, ...parsed.settings } };
    }
  } catch { /* private mode or blocked storage */ }
  return fallback && fallback.v === 1 ? fallback : freshStore();
}
function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* keep going in memory */ }
}

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */

let game = null;   // the persisted record of the drill being played
let items = [];    // its compiled prompts
let timerId = 0;
let log = [];
let view = 'home';
let sceneSynced = false; // false right after a drill is loaded, so the rig jumps instead of drilling
const scenes = {};

const secondsPerPrompt = () => (store.settings.extended ? SECONDS_EXTENDED : SECONDS);
const spentMap = () => new Map(game.spent);
const isLast = () => game.idx >= items.length - 1;

function newRecord(mode, day, plan, seed) {
  return { mode, day, seed, plan, idx: 0, results: [], spent: [], deadline: null, seconds: secondsPerPrompt(), phase: 'answer', startedAt: Date.now() };
}

function attach(record) {
  try {
    items = materialize(record.plan, PROMPT_BY_ID);
  } catch {
    return false; // the bank changed under a saved drill
  }
  game = record;
  log = [];
  sceneSynced = false;
  return true;
}

function startDaily() {
  const day = dayNumber();
  let rec = store.days[day];
  if (!rec || !attach(rec)) {
    rec = newRecord('daily', day, dailyPlan(PROMPTS, day));
    store.days[day] = rec;
    attach(rec);
    persist();
  }
  enter();
}

function startArchive(day) {
  if (store.days[day]?.phase === 'done') { attach(store.days[day]); enter(); return; }
  let rec = store.archive[day];
  if (!rec || !attach(rec)) {
    rec = newRecord('archive', day, dailyPlan(PROMPTS, day));
    store.archive[day] = rec;
    attach(rec);
    persist();
  }
  enter();
}

function startPractice() {
  const seed = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const rec = newRecord('practice', null, practicePlan(PROMPTS, seed), seed);
  store.practice = rec;
  attach(rec);
  persist();
  enter();
}

function enter() {
  if (game.phase === 'done') showResults();
  else showPlay();
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

function showView(name) {
  view = name;
  for (const v of ['home', 'play', 'results']) $(`view-${v}`).hidden = v !== name;
  window.scrollTo({ top: 0 });
}

function goHome() {
  stopTimer();
  renderHome();
  showView('home');
}

function drillLabel(rec) {
  if (rec.mode === 'practice') return 'Practice drill';
  if (rec.mode === 'archive') return `Drill #${rec.day} replay`;
  return `Drill #${rec.day}`;
}

/* ---------- home ---------- */

function renderHome() {
  const day = dayNumber();
  const rec = store.days[day];
  $('home-meta').textContent = `Drill #${day} · ${fmtDay(day)}`;
  const btn = $('start-daily');
  const status = $('home-status');
  if (rec?.phase === 'done') {
    const depth = depthOf(rec.results);
    btn.textContent = `See drill #${day} results`;
    const km = kmFor(depth);
    status.innerHTML = `Today you reached <b>${fmtKm(km)}</b>, ${esc(layerAt(km).name)}. Next drill in <b data-countdown>${countdown()}</b>.`;
  } else if (rec) {
    btn.textContent = `Resume drill #${day}`;
    status.innerHTML = `In progress: prompt <b>${Math.min(rec.idx + 1, 7)}</b> of 7. The clock kept running while you were away.`;
  } else {
    btn.textContent = `Start drill #${day}`;
    status.textContent = 'Same seven prompts for everyone today. One attempt.';
  }
}

/* ---------- play ---------- */

function showPlay() {
  showView('play');
  renderPlay();
  if (game.phase === 'answer') $('answer').focus({ preventScroll: true });
  else $('next-btn')?.focus({ preventScroll: true });
}

function renderPlay() {
  const prompt = items[game.idx];
  $('q-count').textContent = `${drillLabel(game)} · prompt ${game.idx + 1} of ${items.length}`;
  $('q-cat').textContent = prompt.cat;
  $('root-flag').hidden = !prompt.trap;
  $('q-text').textContent = prompt.q;
  $('q-hint').textContent = prompt.hint || '';

  const input = $('answer');
  input.inputMode = prompt.numeric ? 'numeric' : 'text';
  input.placeholder = prompt.numeric ? 'a number' : 'type an answer';

  renderCore();
  renderSpent();
  renderLog();

  const answering = game.phase === 'answer';
  $('answer-zone').hidden = !answering;
  $('reveal').hidden = answering;
  if (answering) {
    input.value = '';
    if (!game.deadline) {
      game.seconds = secondsPerPrompt();
      game.deadline = Date.now() + game.seconds * 1000;
      persist();
    }
    startTimer();
  } else {
    stopTimer();
    renderClock(null);
    renderReveal();
  }
}

function startTimer() {
  stopTimer();
  const tick = () => {
    const left = game.deadline - Date.now();
    if (left <= 0) {
      renderClock(0);
      resolvePrompt('timeout');
      return;
    }
    renderClock(left);
  };
  tick();
  if (game.phase === 'answer') timerId = window.setInterval(tick, 100);
}
function stopTimer() {
  if (timerId) window.clearInterval(timerId);
  timerId = 0;
}
function renderClock(left) {
  const clock = $('q-clock');
  const bar = $('timebar-fill');
  if (left === null) {
    clock.className = 'clock stopped';
    $('q-secs').textContent = String(Math.max(0, Math.ceil((game.results[game.idx]?.left ?? 0) / 1000)));
    bar.style.transform = 'scaleX(0)';
    bar.parentElement.classList.remove('low');
    return;
  }
  const total = (game.seconds || SECONDS) * 1000;
  const secs = Math.ceil(left / 1000);
  $('q-secs').textContent = String(secs);
  const low = secs <= 5;
  clock.className = low ? 'clock low' : 'clock';
  bar.parentElement.classList.toggle('low', low);
  bar.style.transform = `scaleX(${Math.max(0, Math.min(1, left / total))})`;
}

function addLog(typed, msgHtml, cls) {
  log.push({ typed, msgHtml, cls });
  log = log.slice(-4);
  renderLog();
}
function renderLog() {
  $('log').innerHTML = log
    .map((e) => `<li class="${e.cls}"><span class="typed">${esc(e.typed)}</span><span class="msg">${e.msgHtml}</span></li>`)
    .join('');
}

function suggestLink(typed, prompt) {
  const title = `Answer suggestion: "${typed.trim()}"`;
  const body = `Prompt: ${prompt.q}\nSuggested answer: ${typed.trim()}\nWhy it counts:\n`;
  const href = `${SUGGEST_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  return `<a href="${esc(href)}" target="_blank" rel="noopener">Think it counts?</a>`;
}

function onSubmit(event) {
  event.preventDefault();
  if (!game || game.phase !== 'answer') return;
  const input = $('answer');
  const typed = input.value;
  const prompt = items[game.idx];
  const verdict = judge(prompt, typed, spentMap());

  if (verdict.status === 'hit') {
    resolvePrompt('hit', verdict.answer, { typed: typed.trim(), corrected: verdict.corrected });
    return;
  }
  if (verdict.status === 'empty') {
    addLog(typed || ' ', prompt.numeric ? 'Numbers only for this one.' : 'Type an answer first.', 'empty');
  } else if (verdict.status === 'burned') {
    addLog(typed, `Use-after-free. You spent ${esc(verdict.at.name)} on prompt ${verdict.at.q}.`, 'burned');
  } else if (verdict.status === 'nope') {
    addLog(typed, esc(verdict.message), 'nope');
  } else {
    addLog(typed, `Not in the bank. Try another. ${suggestLink(typed, prompt)}`, 'miss');
  }
  input.value = '';
  const shell = $('answer-form');
  shell.classList.remove('shake');
  void shell.offsetWidth;
  shell.classList.add('shake');
  input.focus();
}

function resolvePrompt(kind, answer, extra = {}) {
  if (!game || game.phase !== 'answer') return;
  stopTimer();
  const prompt = items[game.idx];
  const left = Math.max(0, game.deadline - Date.now());
  let result;
  if (kind === 'hit') {
    result = { status: 'hit', tier: answer.t, pts: pointsFor(answer), name: answer.n, key: answer.key, typed: extra.typed, corrected: !!extra.corrected, left };
    game.spent.push([answer.key, { q: game.idx + 1, name: answer.n }]);
  } else {
    const target = prompt.trap ? prompt.answers[0] : null;
    const spentAt = target ? spentMap().get(target.key) : null;
    result = { status: kind, pts: 0, left: 0, burnedTrap: !!spentAt, spentAt: spentAt?.q ?? null, spentName: spentAt?.name ?? null };
  }
  game.results[game.idx] = result;
  game.phase = 'reveal';
  game.deadline = null;
  persist();
  renderPlay();
  $('next-btn')?.focus({ preventScroll: true });
}

function nextPrompt() {
  if (!game || game.phase !== 'reveal') return;
  if (isLast()) {
    game.phase = 'done';
    game.finishedAt = Date.now();
    persist();
    showResults();
    return;
  }
  game.idx += 1;
  game.phase = 'answer';
  game.deadline = null;
  log = [];
  persist();
  renderPlay();
  window.scrollTo({ top: 0 });
  $('answer').focus({ preventScroll: true });
}

/* ---------- reveal ---------- */

function loreFor(prompt, key) {
  return prompt.answers.find((a) => a.key === key)?.l ?? '';
}

/** One deep answer from each of the lowest layers, so players see what each depth looks like. */
function deeperCuts(prompt, exceptKey) {
  const rand = rng(`cuts:${prompt.id}:${game.seed ?? game.day ?? ''}`);
  const picks = [];
  for (const t of [5, 4, 3, 2]) {
    const pool = shuffle(prompt.answers.filter((a) => a.t === t && a.key !== exceptKey && a.l), rand);
    if (pool.length) picks.push(pool[0]);
    if (picks.length === 3) break;
  }
  return picks;
}

function cutsHtml(prompt, exceptKey) {
  const cuts = deeperCuts(prompt, exceptKey);
  if (!cuts.length) return '';
  return `<div class="cuts">
    <p class="label">Deeper answers · ${prompt.answers.length} in the bank</p>
    <ul class="cut-list">${cuts.map((a) => `<li class="cut"><span class="tier ${tierClass(a.t)}">${esc(tierName(a.t))}</span><span class="cut-name">${esc(a.n)}</span><span class="cut-lore">${esc(a.l)}</span></li>`).join('')}</ul>
  </div>`;
}

function autoSaidHtml(prompt) {
  const auto = prompt.answers.filter((a) => a.t === 0).map((a) => a.n);
  return `<p class="auto-said"><span class="label">Autocomplete would say</span><span>${auto.map(esc).join(' · ')}</span></p>`;
}

function resultCardHtml(prompt, r) {
  if (r.status === 'hit') {
    const t = r.tier;
    const lore = loreFor(prompt, r.key);
    const typedNote = r.corrected ? `<small>autocorrected from “${esc(r.typed)}”</small>` : '';
    const rootNote = prompt.trap ? '<p class="hit-note">Root access. You saved the famous answer for when it counted.</p>' : '';
    return `<div class="hit art ${tierClass(t)}">
      <img class="hit-art" src="${badgeURL(tierArt(t), 84)}" alt="">
      <div class="hit-body">
        <div class="hit-top"><span class="tier ${tierClass(t)}">${esc(tierName(t))} · ${esc(tierSub(t))}</span><span class="hit-pts">+${r.pts}<small>${fmtKm(kmFor(r.pts))} deeper</small></span></div>
        <p class="hit-answer">${esc(r.name)}${typedNote}</p>
        ${lore ? `<p class="hit-lore">${esc(lore)}</p>` : ''}
        ${rootNote}
      </div>
    </div>`;
  }
  const head = r.status === 'timeout' ? 'SIGALRM · out of time' : 'Passed';
  let body = '';
  if (prompt.trap) {
    const a = prompt.answers[0];
    body += `<p class="hit-answer">${esc(a.n)}<small>the one right answer</small></p>`;
    if (r.burnedTrap) body += `<p class="hit-note alarm">You spent it on prompt ${r.spentAt}. Use-after-free.</p>`;
    if (a.l) body += `<p class="hit-lore">${esc(a.l)}</p>`;
  }
  return `<div class="hit tmiss">
    <div class="hit-top"><span class="tier tmiss">${head}</span><span class="hit-pts">+0</span></div>
    ${body}
  </div>`;
}

function renderReveal() {
  const prompt = items[game.idx];
  const r = game.results[game.idx];
  let html = resultCardHtml(prompt, r);
  if (!prompt.trap) html += autoSaidHtml(prompt) + cutsHtml(prompt, r.key);
  html += `<div class="reveal-actions">
    <button class="btn primary" id="next-btn" type="button">${isLast() ? 'See results' : 'Next prompt'}</button>
    <span class="fine">or press Enter</span>
  </div>`;
  $('reveal').innerHTML = html;
}

/* ---------- core sample ---------- */

function segments(results) {
  let cum = 0;
  const segs = [];
  results.forEach((r, i) => {
    if (r && r.pts > 0) {
      segs.push({ start: cum / MAX_DEPTH, size: r.pts / MAX_DEPTH, r, i });
      cum += r.pts;
    }
  });
  return { segs, depth: cum };
}

function segHtml(s, minLabel, fresh = false) {
  const title = `Prompt ${s.i + 1}: ${s.r.name}, ${tierName(s.r.tier)}, ${s.r.pts} points`;
  return `<div class="seg ${tierClass(s.r.tier)}${fresh ? ' fresh' : ''}" style="--start:${s.start};--size:${s.size}" title="${esc(title)}">${s.r.pts >= minLabel ? s.r.pts : ''}</div>`;
}

function describeDepth(results) {
  const { depth } = segments(results);
  const parts = results.map((r, i) => (r ? `prompt ${i + 1}: ${r.status === 'hit' ? `${r.name}, ${tierName(r.tier)}, ${r.pts}` : '0'}` : null)).filter(Boolean);
  const km = kmFor(depth);
  return `${depth} of ${MAX_DEPTH} points, ${fmtKm(km)} down in ${layerAt(km).name}${parts.length ? `. ${parts.join('; ')}` : ''}`;
}

function renderCore() {
  const { depth } = segments(game.results);
  const km = kmFor(depth);
  $('depth-num').textContent = km.toLocaleString('en-US');
  $('depth-sub').textContent = `${layerAt(km).name} \u00b7 ${depth} pts`;
  $('scene-wrap').setAttribute('aria-label', describeDepth(game.results));
  scenes.play?.setDepth(km, { animate: sceneSynced });
  sceneSynced = true;

  $('core-cells').innerHTML = items.map((p, i) => {
    const r = game.results[i];
    const cls = r ? (r.status === 'hit' ? `${tierClass(r.tier)} done` : 'tmiss done') : (i === game.idx ? 'now' : '');
    const what = r ? (r.status === 'hit' ? `${tierName(r.tier)}, ${r.pts} points` : 'no points') : (i === game.idx ? 'current' : 'to come');
    return `<li class="cell ${cls}"><span class="sr">Prompt ${i + 1}${p.trap ? ' (root)' : ''}: ${what}</span><b aria-hidden="true">${p.trap ? 'R' : i + 1}</b><span aria-hidden="true">${r ? r.pts : ''}</span></li>`;
  }).join('');
}

function renderSpent() {
  const box = $('freed');
  box.hidden = game.spent.length === 0;
  $('freed-list').innerHTML = game.spent.map(([, s]) => `<span class="spent" title="Spent on prompt ${s.q}">${esc(s.name)}</span>`).join(' ');
}

/* ---------- results ---------- */

function showResults() {
  stopTimer();
  showView('results');
  const results = game.results;
  const depth = depthOf(results);
  const rank = rankFor(depth);
  const hits = results.filter((r) => r?.status === 'hit');
  const belowAuto = hits.filter((r) => r.tier !== 0 && r.tier !== 'root').length;

  const scoredNote = game.mode === 'daily' ? fmtDay(game.day) : 'unscored';
  $('res-label').textContent = `${drillLabel(game)} · ${scoredNote}`;
  const km = kmFor(depth);
  $('res-num').textContent = km.toLocaleString('en-US');
  $('res-pts').textContent = String(depth);
  $('res-hex').textContent = hex(depth);
  $('res-rank').textContent = rank.title;
  $('res-line').textContent = `${rank.line} ${belowAuto === 0 ? 'None of your answers got below the topsoil, where the autocomplete lives.' : `${countOf(belowAuto, 'answer')} got below the topsoil, where the autocomplete lives.`}`;

  const base = autocompleteDepth(items);
  const diff = depth - base;
  const why = base < ROOT.pts
    ? ' It always gives the likeliest answer, so it spent root\u2019s answer on an earlier prompt.'
    : ' It kept root\u2019s answer this time.';
  const baseKm = kmFor(base);
  const gap = Math.abs(km - baseKm);
  const verdict = diff > 0 ? `You drilled <b>${fmtKm(gap)}</b> deeper.` : diff === 0 ? 'A dead heat.' : `That\u2019s <b>${fmtKm(gap)}</b> deeper than you.`;
  $('res-vs').innerHTML = `The autocomplete stopped at <b>${fmtKm(baseKm)}</b>, in ${esc(layerAt(baseKm).name)}.${why} ${verdict}`;

  const scene = scenes.results;
  if (scene) {
    $('res-scene').setAttribute('aria-label', `Cross-section of the Earth. Your drill reached ${fmtKm(km)}, ${layerAt(km).name}. The autocomplete stopped at ${fmtKm(baseKm)}.`);
    scene.setCaption([['you', '600', 10], [fmtKm(km), '600', 12]]);
    scene.setGhost(baseKm, [['autocomplete', '600', 10], [fmtKm(baseKm), '500', 11]]);
    scene.setDepth(0, { animate: false });
    window.setTimeout(() => scene.setDepth(km, { duration: 1600 + Math.min(1600, km * 0.25) }), 250);
  }

  const label = game.mode === 'practice' ? 'practice' : `#${game.day}`;
  $('share-text').textContent = shareText({ label, results, url: SHARE_URL, baseline: base });
  $('share-status').textContent = '';

  const { segs } = segments(results);
  const scale = [0, 100, 200, 300, 400, 500, 600, 700].map((n) => `<span>${n === 700 ? '700 pts' : n}</span>`).join('');
  const mark = `<span class="mark" style="--at:${base / MAX_DEPTH}"><span>autocomplete \u00b7 ${base} pts</span></span>`;
  $('res-core').innerHTML = `<div class="hbar" role="img" aria-label="${esc(`${describeDepth(results)}. The autocomplete reached ${base}.`)}">${segs.map((s) => segHtml(s, 40, true)).join('')}${mark}</div><div class="hbar-scale" aria-hidden="true">${scale}</div>`;

  $('recap').innerHTML = items.map((prompt, i) => {
    const r = results[i] ?? { status: 'pass', pts: 0 };
    const answerCell = r.status === 'hit'
      ? `<span class="rc-a">${esc(r.name)}</span>`
      : `<span class="rc-a none">${r.status === 'timeout' ? 'out of time' : 'passed'}</span>`;
    const tierCell = r.status === 'hit'
      ? `<span class="tier ${tierClass(r.tier)}">${esc(tierName(r.tier))}</span>`
      : `<span class="tier tmiss">${r.burnedTrap ? 'use-after-free' : 'no depth'}</span>`;
    const more = prompt.trap
      ? resultCardHtml(prompt, r)
      : `${r.status === 'hit' && loreFor(prompt, r.key) ? `<p class="hit-lore">${esc(loreFor(prompt, r.key))}</p>` : ''}${autoSaidHtml(prompt)}${cutsHtml(prompt, r.key)}`;
    return `<li><details>
      <summary>
        <span class="rc-n">${prompt.trap ? 'R' : i + 1}</span>
        <span class="rc-q">${esc(prompt.q)}</span>
        ${answerCell}
        <span class="rc-t">${tierCell}</span>
        <span class="rc-p">${r.pts}</span>
      </summary>
      <div class="more">${more}</div>
    </details></li>`;
  }).join('');

  renderNextDrill();
  $('share-btn').focus({ preventScroll: true });
}

function countdown() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const s = Math.max(0, Math.floor((next - now) / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function renderNextDrill() {
  const el = $('next-drill');
  if (game?.mode === 'daily' && game.day === dayNumber()) el.innerHTML = `Next drill in <b data-countdown>${countdown()}</b>`;
  else el.innerHTML = `Today’s drill is #${dayNumber()}.`;
}

async function copyShare() {
  const text = $('share-text').textContent;
  const status = $('share-status');
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = 'Copied to clipboard.';
  } catch {
    const range = document.createRange();
    range.selectNodeContents($('share-text'));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    status.textContent = 'Copy was blocked here. The text is selected, so copy it by hand.';
  }
}

/* ------------------------------------------------------------------ */
/* Dialogs: help, stats, archive                                       */
/* ------------------------------------------------------------------ */

function openDialog(dlg) {
  if (typeof dlg.showModal === 'function') {
    if (!dlg.open) dlg.showModal();
  } else {
    dlg.setAttribute('open', '');
  }
}
function closeDialog(dlg) {
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
}

function renderHelp() {
  const art = (key) => `<span class="mini-art" style="background-image:url(${badgeURL(key, 28)})"></span>`;
  const rows = TIERS.map((t) => `<li class="t${t.id}">${art(t.key)}<span class="tier t${t.id}">${esc(t.name)} · ${esc(t.sub)}</span><span>${t.pts}</span></li>`);
  rows.push(`<li class="troot">${art(ROOT.key)}<span class="tier troot">the nether · root, the seventh prompt</span><span>${ROOT.pts}</span></li>`);
  $('help-ladder').innerHTML = rows.join('');
  $('opt-extended').checked = !!store.settings.extended;
}

function computeStats() {
  const today = dayNumber();
  const done = Object.values(store.days).filter((g) => g && g.mode === 'daily' && g.phase === 'done');
  const depths = done.map((g) => depthOf(g.results));
  const isDone = (d) => store.days[d]?.phase === 'done';
  let streak = 0;
  let d = isDone(today) ? today : today - 1;
  while (d >= 1 && isDone(d)) { streak++; d--; }
  let longest = 0;
  let run = 0;
  for (let i = 1; i <= today; i++) { run = isDone(i) ? run + 1 : 0; longest = Math.max(longest, run); }
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, root: 0, miss: 0 };
  for (const g of done) for (const r of g.results) {
    if (!r) continue;
    if (r.status === 'hit') counts[r.tier] += 1;
    else counts.miss += 1;
  }
  return {
    played: done.length,
    streak,
    longest,
    best: depths.length ? Math.max(...depths) : 0,
    avg: depths.length ? Math.round(depths.reduce((a, b) => a + b, 0) / depths.length) : 0,
    counts,
  };
}

function renderStats() {
  const s = computeStats();
  const kpi = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  $('kpis').innerHTML = kpi('Drills played', s.played) + kpi('Current streak', s.streak) + kpi('Longest streak', s.longest) + kpi('Best depth', s.best);

  const rows = [...TIERS.map((t) => ({ cls: `t${t.id}`, name: t.name, n: s.counts[t.id] })),
    { cls: 'troot', name: 'root', n: s.counts.root },
    { cls: 'tmiss', name: 'no answer', n: s.counts.miss }];
  const max = Math.max(1, ...rows.map((r) => r.n));
  $('tier-dist').innerHTML = s.played
    ? `<ul class="meters">${rows.map((r) => `<li class="meter ${r.cls}"><span class="tier ${r.cls}">${esc(r.name)}</span><span class="track" role="img" aria-label="${esc(r.name)}: ${r.n}"><i style="width:${(r.n / max) * 100}%"></i></span><b>${r.n}</b></li>`).join('')}</ul>
       <p class="fine">Average depth ${s.avg}. Daily drills only.</p>`
    : '<p class="empty">Finish today’s drill to see where your answers land.</p>';

  const today = dayNumber();
  const past = [];
  for (let d = today - 1; d >= 1; d--) {
    const daily = store.days[d];
    const replay = store.archive[d];
    let note = 'Not played';
    if (daily?.phase === 'done') note = `Depth ${depthOf(daily.results)}`;
    else if (replay?.phase === 'done') note = `Replay depth ${depthOf(replay.results)}`;
    else if (replay) note = 'Replay in progress';
    past.push(`<li><button type="button" data-archive="${d}"><span>#${d} · ${esc(fmtDay(d))}</span><small>${note}</small></button></li>`);
  }
  $('archive').innerHTML = past.length ? past.join('') : '<li class="empty">Drill #1 is today. Past drills will collect here.</li>';
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

let themeTouched = false;
const THEME_LABEL = { '': 'follow system', light: 'light', dark: 'dark' };
function applyTheme() {
  const t = store.settings.theme;
  const root = document.documentElement;
  if (t) { root.dataset.theme = t; themeTouched = true; }
  else if (themeTouched) { delete root.dataset.theme; }
  $('toggle-theme').setAttribute('aria-label', `Color theme: ${THEME_LABEL[t] ?? 'follow system'}`);
}
function cycleTheme() {
  const order = ['', 'light', 'dark'];
  store.settings.theme = order[(order.indexOf(store.settings.theme) + 1) % order.length];
  persist();
  applyTheme();
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function wire() {
  $('brand').addEventListener('click', goHome);
  $('start-daily').addEventListener('click', startDaily);
  $('start-practice').addEventListener('click', startPractice);
  $('res-practice').addEventListener('click', startPractice);
  $('res-home').addEventListener('click', goHome);
  $('answer-form').addEventListener('submit', onSubmit);
  $('pass-btn').addEventListener('click', () => resolvePrompt('pass'));
  $('share-btn').addEventListener('click', copyShare);
  $('toggle-theme').addEventListener('click', cycleTheme);

  $('reveal').addEventListener('click', (e) => {
    if (e.target.closest('#next-btn')) nextPrompt();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || view !== 'play' || game?.phase !== 'reveal') return;
    if (e.target.closest('button, a, summary, input, textarea, select')) return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    nextPrompt();
  });

  $('open-help').addEventListener('click', () => { renderHelp(); openDialog($('dlg-help')); });
  $('open-stats').addEventListener('click', () => { renderStats(); openDialog($('dlg-stats')); });
  for (const dlg of document.querySelectorAll('dialog')) {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) closeDialog(dlg);
    });
  }
  $('opt-extended').addEventListener('change', (e) => {
    store.settings.extended = e.target.checked;
    persist();
  });
  $('archive').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-archive]');
    if (!btn) return;
    closeDialog($('dlg-stats'));
    startArchive(Number(btn.dataset.archive));
  });

  window.setInterval(() => {
    for (const el of document.querySelectorAll('[data-countdown]')) el.textContent = countdown();
    if (view === 'home' && !$('home-meta').textContent.startsWith(`Drill #${dayNumber()} `)) renderHome();
  }, 1000);
}

/** Tier badges on the home ladder, and the three drilling scenes. */
function paintArt() {
  for (const el of document.querySelectorAll('[data-badge]')) el.style.backgroundImage = `url(${badgeURL(el.dataset.badge, 40)})`;
  scenes.home = new DrillScene($('home-scene'), { mode: 'ladder', rows: () => [...document.querySelectorAll('#strata .stratum')] });
  scenes.play = new DrillScene($('play-scene'), { mode: 'follow' });
  scenes.results = new DrillScene($('res-scene'), { mode: 'full', labels: true });
  // One orchestrated moment on arrival: the rig drills from the grass down to the inner core.
  window.setTimeout(() => scenes.home.setDepth(6200, { duration: 3200 }), 400);
}

function boot(data = {}) {
  store = readStore(data.store);
  applyTheme();
  wire();
  $('bank-note').textContent = `Answers are checked against a hand-built bank of ${BANK_ANSWERS.toLocaleString()} answers across ${PROMPTS.length} prompts, and every answer carries a line of history. Rarity is editorial: ranked by hand by how unlikely an engineer, or a model, would be to say it first.`;
  renderHome();
  paintArt();

  // Pick up a drill that was interrupted mid-prompt.
  const today = store.days[dayNumber()];
  const resumable = [today, store.practice].find((g) => g && g.phase !== 'done' && (g.mode !== 'practice' || data.view === 'play'));
  if (resumable && attach(resumable)) {
    enter();
  } else {
    showView('home');
  }
}

const hot = window.claude?.hot;
hot?.snapshot?.(() => ({ store, view }));
if (hot?.ready) hot.ready((data) => boot(data ?? {}));
else boot(hot?.data ?? {});
