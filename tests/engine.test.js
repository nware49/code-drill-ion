import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize, digitsOf, editDistance, compilePrompt, compileTrap, judge, dailyPlan, practicePlan,
  materialize, dayNumber, dateForDay, shareText, depthOf, hex, rankFor, MAX_DEPTH, TIERS, PER_DRILL, autocompleteDepth,
} from '../js/engine.js';
import { BANK } from '../js/bank/index.js';

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

test('the autocomplete baseline spends famous answers and often loses root', () => {
  // Drill #1: its sorting prompt's likeliest answer is Quicksort, which root needs.
  const day1 = materialize(dailyPlan(PROMPTS, 1), BY_ID);
  assert.equal(autocompleteDepth(day1), 60);
  let lostRoot = 0;
  for (let day = 1; day <= 200; day++) {
    const depth = autocompleteDepth(materialize(dailyPlan(PROMPTS, day), BY_ID));
    assert.ok(depth >= 60 && depth <= 175, `day ${day}: baseline ${depth}`);
    if (depth < 100) lostRoot++;
  }
  // Some roots target the second-most-famous answer, so the rival varies from drill to drill.
  assert.ok(lostRoot > 40 && lostRoot < 160, `autocomplete lost root ${lostRoot}/200 times`);
});

test('scoring and sharing', () => {
  assert.equal(MAX_DEPTH, 700);
  assert.equal(hex(415), '0x19F');
  assert.equal(rankFor(0).title, 'Surface dweller');
  assert.equal(rankFor(700).title, 'Ring −3');
  const results = [
    { status: 'hit', tier: 0, pts: 10 }, { status: 'hit', tier: 5, pts: 100 }, { status: 'timeout', pts: 0 },
    { status: 'hit', tier: 2, pts: 40 }, { status: 'pass', pts: 0 }, { status: 'hit', tier: 3, pts: 60 },
    { status: 'timeout', burnedTrap: true, pts: 0 },
  ];
  assert.equal(depthOf(results), 210);
  const text = shareText({ label: '#7', results });
  assert.match(text, /^code drillion #7 · depth 210\/700 \(0x0D2\)/);
  assert.match(shareText({ label: '#7', results, baseline: 60 }).split('\n')[0], / · \u{1F916} 60$/u);
  assert.equal([...text.split('\n')[1]].length, 7);
  assert.equal(TIERS.map((t) => t.pts).join(), '10,25,40,60,80,100');
});
