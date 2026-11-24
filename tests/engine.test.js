import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize, digitsOf, editDistance, compilePrompt, compileTrap, judge, dailyPlan, practicePlan,
  materialize, dayNumber, dateForDay, shareText, depthOf, hex, rankFor, MAX_DEPTH, TIERS, PER_DRILL, autocompleteDepth,
  kmFor, fmtKm, layerAt, EARTH_RADIUS_KM, rng,
} from '../js/engine.js';
import { loadBank, isLive } from '../scripts/lib/bank.mjs';

const BANK = loadBank().filter(isLive);

const PROMPTS = BANK.map(compilePrompt);
const BY_ID = new Map(PROMPTS.map((p) => [p.id, p]));
const P = (id) => BY_ID.get(id);

/* ---------------- bank integrity ---------------- */

test('prompt ids are unique', () => {
  assert.equal(new Set(BANK.map((p) => p.id)).size, BANK.length);
});

test('every prompt is well formed', () => {
  for (const p of BANK) {
    assert.ok(p.q.endsWith('.'), `${p.id}: question should end with a period`);
    assert.ok(p.answers.length >= 12, `${p.id}: only ${p.answers.length} answers`);
    assert.ok(p.answers.some((a) => a.t === 0), `${p.id}: needs at least one autocomplete answer`);
    assert.ok(p.answers.some((a) => a.t === 5), `${p.id}: needs at least one ring -3 answer`);
    assert.ok((p.traps ?? []).length >= 1, `${p.id}: needs a root (trap) question`);
    for (const a of p.answers) {
      assert.ok(Number.isInteger(a.t) && a.t >= 0 && a.t <= 5, `${p.id}/${a.n}: bad tier ${a.t}`);
      assert.ok(a.l.length <= 220, `${p.id}/${a.n}: lore too long (${a.l.length})`);
      assert.ok(!/lorem|todo|tbd/i.test(a.l), `${p.id}/${a.n}: placeholder lore`);
    }
  }
});

test('no typed form maps to two different answers within a prompt', () => {
  const problems = [];
  for (const p of PROMPTS) {
    for (const [form, list] of p.index) {
      if (new Set(list.map((a) => a.key)).size > 1) problems.push(`${p.id}: "${form}" -> ${list.map((a) => a.n).join(' | ')}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('burn keys are unique within a prompt', () => {
  for (const p of PROMPTS) {
    const keys = p.answers.map((a) => a.key);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(dupes, [], `${p.id}: duplicate keys`);
  }
});

test('"nope" entries never shadow a real answer', () => {
  const problems = [];
  for (const p of PROMPTS) for (const form of p.nope.keys()) if (p.index.has(form)) problems.push(`${p.id}: ${form}`);
  assert.deepEqual(problems, []);
});

test('every trap points at a famous answer that exists', () => {
  for (const p of PROMPTS) {
    p.traps.forEach((trap, i) => {
      const target = p.answers.find((a) => a.n === trap.answer);
      assert.ok(target, `${p.id} trap ${i}: "${trap.answer}" missing`);
      assert.ok(target.t <= 1, `${p.id} trap ${i}: "${trap.answer}" should be a tier 0-1 answer, is ${target.t}`);
      const root = compileTrap(p, i);
      assert.equal(root.answers.length, 1);
      assert.equal(root.answers[0].key, target.key, 'root answer must share the burn key');
      assert.match(trap.q, /[.?]["”']?$/, `${p.id} trap ${i}: punctuation`);
    });
  }
});

test('every canonical name and alias matches its own answer', () => {
  for (const raw of BANK) {
    const p = P(raw.id);
    for (const a of raw.answers) {
      for (const typed of [a.n, ...(a.alias ?? [])]) {
        const r = judge(p, typed);
        assert.equal(r.status, 'hit', `${p.id}: typing "${typed}" gave ${r.status}`);
        assert.equal(r.answer.n, a.n, `${p.id}: "${typed}" matched ${r.answer.n}, expected ${a.n}`);
      }
    }
  }
});

/* ---------------- normalization and matching ---------------- */

test('normalize spells out symbols and drops noise', () => {
  assert.equal(normalize('C++'), 'cpp');
  assert.equal(normalize('C#'), 'csharp');
  assert.equal(normalize('A*'), 'astar');
  assert.equal(normalize('  Node.js '), 'nodejs');
  assert.equal(normalize("Moore's Law", ['law']), 'moore');
  assert.equal(normalize('Gödel'), 'godel');
  assert.equal(normalize('git rebase', ['git']), 'rebase');
  assert.equal(normalize('The Merge Sort', ['sort']), 'merge');
  assert.equal(normalize('sort', ['sort']), 'sort', 'never strips down to nothing');
});

test('digitsOf pulls the first number', () => {
  assert.equal(digitsOf("418 I'm a teapot"), '418');
  assert.equal(digitsOf('RFC 2324'), '2324');
  assert.equal(digitsOf('port 0022'), '22');
  assert.equal(digitsOf('nope'), '');
});

test('editDistance handles transpositions and caps', () => {
  assert.equal(editDistance('quicksort', 'quikcsort'), 1);
  assert.equal(editDistance('heapsort', 'heapsort'), 0);
  assert.equal(editDistance('abc', 'xyz12345', 2), 3);
});

test('judge: exact, alias, strip and possessives', () => {
  assert.equal(judge(P('sorting'), 'quick sort').answer.n, 'Quicksort');
  assert.equal(judge(P('sorting'), 'TIMSORT').answer.n, 'Timsort');
  assert.equal(judge(P('git'), 'git bisect').answer.n, 'bisect');
  assert.equal(judge(P('laws'), "Hyrum's Law").answer.n, "Hyrum's law");
  assert.equal(judge(P('graph-algos'), 'a star').answer.n, 'A*');
  assert.equal(judge(P('old-langs'), 'Plankalkul').answer.n, 'Plankalkül');
});

test('judge: fuzzy matching corrects small typos only', () => {
  const r = judge(P('sorting'), 'quciksort');
  assert.equal(r.status, 'hit');
  assert.equal(r.corrected, true);
  assert.equal(judge(P('sorting'), 'zzzzzzzz').status, 'miss');
  // digits must agree, so SHA-2 never autocorrects to SHA-1 or SHA-3
  assert.equal(judge(P('hashes'), 'sha-7').status, 'miss');
});

test('judge: filler words around an answer are dropped on a second pass', () => {
  assert.equal(judge(P('dead-html'), 'noembed tag').answer.n, '<noembed>');
  assert.equal(judge(P('dead-html'), '<noembed> element').answer.n, '<noembed>');
  assert.equal(judge(P('dead-html'), 'noembed tag').corrected, true);
  assert.equal(judge(P('two-letter'), 'the ls command').answer.n, 'ls');
  assert.equal(judge(P('signals'), 'SIGKILL signal').answer.n, 'SIGKILL');
  assert.equal(judge(P('sorting'), 'quicksort').corrected, false, 'clean input is not marked corrected');
});

test('judge: near misses get "did you mean" suggestions, never a silent accept', () => {
  const partial = judge(P('dead-html'), 'noemb');
  assert.equal(partial.status, 'suggest');
  assert.deepEqual(partial.suggestions.map((a) => a.n), ['<noembed>']);
  const twoTypos = judge(P('dead-html'), 'nombde');
  assert.equal(twoTypos.status, 'suggest');
  assert.equal(twoTypos.suggestions[0].n, '<noembed>');
  assert.ok(judge(P('dead-html'), 'nombde').suggestions.length <= 2);
  assert.equal(judge(P('dead-html'), 'qwertyuiop').status, 'miss');
  assert.equal(judge(P('ports'), '2222').status, 'miss', 'numbers never get suggestions');
  const noembed = judge(P('dead-html'), 'noembed').answer;
  const spent = judge(P('dead-html'), 'noemb', new Map([[noembed.key, { q: 1, name: '<noembed>' }]]));
  assert.notEqual(spent.status === 'suggest' && spent.suggestions.some((a) => a.n === '<noembed>'), true, 'spent answers are not suggested');
});

test('judge: random junk is never accepted on any prompt', () => {
  const rand = rng('junk');
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  for (const p of [...PROMPTS, ...PROMPTS.flatMap((x) => x.traps.map((_, i) => compileTrap(x, i)))]) {
    for (let k = 0; k < 120; k++) {
      let w = '';
      const len = 5 + Math.floor(rand() * 8);
      for (let i = 0; i < len; i++) w += letters[Math.floor(rand() * 26)];
      const r = judge(p, w);
      assert.notEqual(r.status, 'hit', `${p.id}: "${w}" was accepted as ${r.answer?.n}`);
    }
  }
});

test('judge: numeric prompts read the number', () => {
  assert.equal(judge(P('http'), "418 I'm a teapot").answer.n, '418');
  assert.equal(judge(P('rfc'), 'RFC 1149').answer.n, '1149');
  assert.equal(judge(P('ports'), '65536').status, 'nope');
  assert.equal(judge(P('ports'), 'ssh').status, 'empty');
});

test('judge: burned answers are refused with where they were spent', () => {
  const quick = judge(P('sorting'), 'quicksort').answer;
  const burned = new Map([[quick.key, 2]]);
  const r = judge(P('sorting'), 'qsort', burned);
  assert.equal(r.status, 'burned');
  assert.equal(r.at, 2);
});

test('judge: burn keys collide across prompts only for the same answer', () => {
  const dijkstraPerson = judge(P('turing'), 'Dijkstra').answer;
  const dijkstraAlgo = judge(P('graph-algos'), 'Dijkstra').answer;
  assert.equal(dijkstraPerson.key, dijkstraAlgo.key);
  const mergeSort = judge(P('sorting'), 'merge sort').answer;
  const sqlMerge = judge(P('sql'), 'MERGE').answer;
  assert.notEqual(mergeSort.key, sqlMerge.key);
  const port500 = judge(P('ports'), '500').answer;
  const http500 = judge(P('http'), '500').answer;
  assert.notEqual(port500.key, http500.key);
});

test('judge: nope messages and global nopes', () => {
  assert.equal(judge(P('turing'), 'Alan Turing').status, 'nope');
  assert.match(judge(P('sorting'), 'ChatGPT').message, /autocomplete/);
  assert.equal(judge(P('editors'), 'Cursor').status, 'hit', 'real answers beat global nopes');
});

test('root accepts an answer already spent on an earlier prompt', () => {
  const sorting = P('sorting');
  const quick = judge(sorting, 'quicksort').answer;
  const spent = new Map([[quick.key, { q: 2, name: 'Quicksort' }]]);
  assert.equal(judge(sorting, 'quicksort', spent).status, 'burned', 'regular prompts still refuse reuse');
  const root = compileTrap(sorting, 0);
  const r = judge(root, 'quicksort', spent);
  assert.equal(r.status, 'hit');
  assert.equal(r.answer.n, 'Quicksort');
  assert.equal(judge(root, 'quikcsort', spent).status, 'hit', 'typos still autocorrect on root');
});

test('trap prompts accept only the one answer', () => {
  const sorting = P('sorting');
  const root = compileTrap(sorting, 0);
  assert.equal(judge(root, 'quicksort').status, 'hit');
  assert.equal(judge(root, 'merge sort').status, 'miss');
});

/* ---------------- daily drills ---------------- */

test('dayNumber starts at 1 on the epoch and counts local days', () => {
  assert.equal(dayNumber(new Date(2026, 10, 22, 0, 1)), 1);
  assert.equal(dayNumber(new Date(2026, 10, 22, 23, 59)), 1);
  assert.equal(dayNumber(new Date(2026, 10, 23, 0, 0)), 2);
  assert.equal(dayNumber(new Date(2027, 0, 1)), 41);
  assert.equal(dayNumber(new Date(2020, 0, 1)), 1, 'clamps before the epoch');
  assert.equal(dayNumber(dateForDay(100)), 100);
});

test('daily plans are deterministic and well shaped', () => {
  for (let day = 1; day <= 400; day++) {
    const plan = dailyPlan(PROMPTS, day);
    assert.equal(plan.length, PER_DRILL);
    const regular = plan.slice(0, 6);
    assert.equal(new Set(regular.map((s) => s.id)).size, 6, `day ${day}: duplicate prompt`);
    assert.ok(regular.every((s) => s.trap === undefined));
    const root = plan[6];
    assert.ok(root.trap !== undefined, `day ${day}: last step must be the root prompt`);
    const pos = regular.findIndex((s) => s.id === root.id);
    assert.ok(pos >= 0 && pos <= 2, `day ${day}: trap target at position ${pos}`);
    assert.deepEqual(dailyPlan(PROMPTS, day), plan);
    assert.equal(materialize(plan, BY_ID).length, PER_DRILL);
  }
});

test('prompts do not repeat within the recency window', () => {
  const window = Math.floor(PROMPTS.length / 6) - 1;
  const days = [];
  for (let day = 1; day <= 365; day++) days.push(dailyPlan(PROMPTS, day).slice(0, 6).map((s) => s.id));
  for (let i = 0; i < days.length; i++) {
    for (let j = Math.max(0, i - window); j < i; j++) {
      const overlap = days[i].filter((id) => days[j].includes(id));
      assert.deepEqual(overlap, [], `day ${i + 1} repeats day ${j + 1}`);
    }
  }
});

test('practice plans vary by seed', () => {
  const a = JSON.stringify(practicePlan(PROMPTS, 'a'));
  const b = JSON.stringify(practicePlan(PROMPTS, 'b'));
  assert.notEqual(a, b);
  assert.equal(JSON.stringify(practicePlan(PROMPTS, 'a')), a);
});

/* ---------------- scoring ---------------- */

test('the autocomplete baseline gives topsoil answers and always gets root', () => {
  for (let day = 1; day <= 200; day++) {
    assert.equal(autocompleteDepth(materialize(dailyPlan(PROMPTS, day), BY_ID)), 160, `day ${day}`);
  }
});

test('scoring and sharing', () => {
  assert.equal(MAX_DEPTH, 700);
  assert.equal(hex(415), '0x19F');
  assert.equal(rankFor(0).title, 'Still on the surface');
  assert.equal(rankFor(700).key, 'center');
  assert.equal(rankFor(699).key, 'inner');
  assert.equal(rankFor(60).key, 'transition', 'the usual autocomplete baseline stalls in the transition zone');
  const results = [
    { status: 'hit', tier: 0, pts: 10 }, { status: 'hit', tier: 5, pts: 100 }, { status: 'timeout', pts: 0 },
    { status: 'hit', tier: 2, pts: 40 }, { status: 'pass', pts: 0 }, { status: 'hit', tier: 3, pts: 60 },
    { status: 'timeout', pts: 0 },
  ];
  assert.equal(depthOf(results), 210);
  const text = shareText({ label: '#7', results });
  assert.equal(text.split('\n')[0], 'code drillion #7 · 1,911 km down, the lower mantle');
  assert.match(shareText({ label: '#7', results, baseline: 60 }).split('\n')[0], / · \u{1F916} 546 km$/u);
  assert.equal([...text.split('\n')[1]].length, 7);
  assert.equal(TIERS.map((t) => t.pts).join(), '10,25,40,60,80,100');
  assert.equal(TIERS.map((t) => t.name).join(), 'topsoil,crust,upper mantle,lower mantle,outer core,inner core');
});

test('points convert to real depth, and a perfect drill reaches the center of the Earth', () => {
  assert.equal(kmFor(0), 0);
  assert.equal(kmFor(MAX_DEPTH), EARTH_RADIUS_KM);
  assert.equal(kmFor(415), 3777);
  assert.equal(fmtKm(3777), '3,777 km');
  assert.equal(layerAt(0).key, 'surface');
  assert.equal(layerAt(35).key, 'crust');
  assert.equal(layerAt(36).key, 'upper');
  assert.equal(layerAt(660).key, 'transition');
  assert.equal(layerAt(2890).key, 'lower');
  assert.equal(layerAt(2891).key, 'outer');
  assert.equal(layerAt(5151).key, 'inner');
  assert.equal(layerAt(6371).key, 'center');
});
