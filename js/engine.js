// code drillion: game engine.
// Pure logic only (no DOM), so it runs unchanged in the browser and under `node --test`.

export const PER_DRILL = 7;
export const REGULAR_PER_DRILL = 6;
export const EPOCH = { y: 2026, m: 10, d: 22 }; // Drill #1 = 22 Nov 2026 (month is 0-based)

// Depth tiers, named for the layers of the Earth. Rarer answers drill deeper.
export const TIERS = [
  { id: 0, key: 'topsoil', name: 'topsoil', sub: 'the autocomplete layer', pts: 10, emoji: '\u{1F916}',
    blurb: 'What everyone, and every model, says first.' },
  { id: 1, key: 'crust', name: 'crust', sub: 'solid ground', pts: 25, emoji: '\u{1FAA8}',
    blurb: 'Solid working knowledge.' },
  { id: 2, key: 'upper', name: 'upper mantle', sub: 'olivine and magma', pts: 40, emoji: '\u{1F7E7}',
    blurb: 'You have shipped it and read the docs.' },
  { id: 3, key: 'lower', name: 'lower mantle', sub: 'deep and slow', pts: 60, emoji: '\u{1F7E5}',
    blurb: 'Specialist knowledge.' },
  { id: 4, key: 'outer', name: 'outer core', sub: 'liquid iron', pts: 80, emoji: '\u{1F30B}',
    blurb: 'You were there, or you read the postmortem.' },
  { id: 5, key: 'inner', name: 'inner core', sub: 'solid iron', pts: 100, emoji: '\u{1F48E}',
    blurb: 'Below everything. Nobody expects it.' },
];
export const ROOT = { id: 'root', key: 'nether', name: 'the nether', sub: 'root, the one answer', pts: 100, emoji: '\u{1F511}' };
export const MISS_EMOJI = '\u{2B1C}';
export const BURN_EMOJI = '\u{1F4A5}';
export const MAX_DEPTH = REGULAR_PER_DRILL * TIERS[5].pts + ROOT.pts;

// Points become real depth, the way Krillion turns points into meters:
// a perfect 700-point drill reaches the center of the Earth.
export const EARTH_RADIUS_KM = 6371;
export const kmFor = (points) => Math.round((points * EARTH_RADIUS_KM) / MAX_DEPTH);
export const fmtKm = (km) => `${km.toLocaleString('en-US')} km`;

// Where a drill stops. Boundaries are the textbook seismic ones (continental crust about 35 km).
export const GEOLOGY = [
  { key: 'surface', name: 'the surface', to: 0, title: 'Still on the surface',
    line: 'Your drill never broke ground. Tomorrow, dig.' },
  { key: 'crust', name: 'the crust', to: 35, title: 'Scratching the crust',
    line: 'Continental crust is only about 35 km thick. Keep going.' },
  { key: 'upper', name: 'the upper mantle', to: 410, title: 'Into the upper mantle',
    line: 'Through the crust in a blink. The real heat is further down.' },
  { key: 'transition', name: 'the transition zone', to: 660, title: 'Stuck in the transition zone',
    line: 'Between 410 and 660 km, olivine is squeezed into denser minerals like blue ringwoodite. Autocompletes stall here a lot.' },
  { key: 'lower', name: 'the lower mantle', to: 2890, title: 'Grinding through the lower mantle',
    line: 'Over 2,000 km of bridgmanite, the most common mineral on Earth. Solid drilling.' },
  { key: 'outer', name: 'the outer core', to: 5150, title: 'Swimming in the outer core',
    line: 'Liquid iron at 4,000 to 5,000 °C. Its currents generate Earth’s magnetic field.' },
  { key: 'inner', name: 'the inner core', to: EARTH_RADIUS_KM - 1, title: 'Touching the inner core',
    line: 'Solid iron and nickel, about as hot as the surface of the Sun, held solid by pressure.' },
  { key: 'center', name: 'the center of the Earth', to: EARTH_RADIUS_KM, title: 'The center of the Earth',
    line: '6,371 km down. A perfect drill. There is nowhere deeper to go.' },
];

/** The geological layer at a depth in km. */
export function layerAt(km) {
  return GEOLOGY.find((g) => km <= g.to) ?? GEOLOGY[GEOLOGY.length - 1];
}

// Answers that are wrong for every prompt, with a reason.
export const GLOBAL_NOPE = new Map([
  ['chatgpt', 'That is the autocomplete talking. Drill deeper.'],
  ['gpt', 'That is the autocomplete talking. Drill deeper.'],
  ['claude', 'Flattered, but that is the autocomplete talking. Drill deeper.'],
  ['copilot', 'That is the autocomplete talking. Drill deeper.'],
  ['gemini', 'That is the autocomplete talking. Drill deeper.'],
  ['llm', 'That is the autocomplete talking. Drill deeper.'],
  ['ai', 'That is the autocomplete talking. Drill deeper.'],
  ['stackoverflow', 'Closed as duplicate.'],
  ['google', 'No search engines on this rig.'],
  ['idk', 'Honest. Hit pass if you want to move on.'],
  ['idontknow', 'Honest. Hit pass if you want to move on.'],
  ['sudo', 'Permission granted. Still not in the bank.'],
  ['42', 'Right answer. Wrong question.'],
  ['helloworld', 'hello, world. Now name something.'],
]);

/* ------------------------------------------------------------------ */
/* Normalization and matching                                          */
/* ------------------------------------------------------------------ */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Reduce an answer to a comparable form: lowercase alphanumerics, with symbols spelled out. */
export function normalize(input, strip = [], keep = '') {
  const raw = String(input ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const drop = new RegExp(`[^a-z0-9${escapeRe(keep)}]`, 'g');
  let s = raw.replace(/[\u2018\u2019`\u00b4]/g, "'").replace(/[\u2212\u2013\u2014]/g, '-');
  s = s.replace(/'s\b/g, '');
  s = s.replace(/\+\+/g, 'pp').replace(/\+/g, 'plus').replace(/#/g, 'sharp').replace(/\*/g, 'star').replace(/&/g, 'and');
  const whole = s.replace(drop, '');
  for (const w of strip) {
    s = s.replace(new RegExp(`(^|[^a-z0-9])${escapeRe(w)}(?=$|[^a-z0-9])`, 'g'), '$1 ');
  }
  s = s.replace(/^\s*the\s+/, '');
  const out = s.replace(drop, '');
  // Symbol-only answers (an esolang called ><>) fall back to the raw text without spaces.
  return out || whole || raw.replace(/\s+/g, '');
}

/** For number-only prompts (ports, status codes, RFCs): the first run of digits, without leading zeros. */
export function digitsOf(input) {
  const m = String(input ?? '').match(/\d+/);
  if (!m) return '';
  return m[0].replace(/^0+(?=\d)/, '');
}

/** Optimal string alignment distance (Levenshtein plus adjacent transpositions), capped at max+1. */
export function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

const digitSignature = (s) => s.replace(/\D/g, '');

/** Compile a raw bank prompt into a prompt with lookup tables. */
export function compilePrompt(raw) {
  const strip = raw.strip ?? [];
  const keep = raw.keep ?? '';
  const numeric = !!raw.numeric;
  const formOf = (s) => (numeric ? digitsOf(s) : normalize(s, strip, keep));
  // Burn key: what makes two answers "the same answer" across the whole drill.
  // Unstripped, so "merge sort" and SQL's MERGE stay distinct; numbers are scoped to their prompt.
  const keyOf = (a) => a.k ?? (numeric ? `${raw.id}:${digitsOf(a.n)}` : normalize(a.n, [], keep));
  const answers = raw.answers.map((a) => {
    const key = keyOf(a);
    const forms = new Set([formOf(a.n), ...(a.alias ?? []).map(formOf)].filter(Boolean));
    return { n: a.n, t: a.t, l: a.l ?? '', key, forms };
  });
  const index = new Map();
  for (const ans of answers) {
    for (const f of ans.forms) {
      if (!index.has(f)) index.set(f, []);
      index.get(f).push(ans);
    }
  }
  const nope = new Map();
  for (const [k, msg] of Object.entries(raw.nope ?? {})) nope.set(formOf(k), msg);
  return {
    id: raw.id, q: raw.q, cat: raw.cat, d: raw.d ?? 2, numeric, strip, keep, answers, index, nope,
    traps: raw.traps ?? [], trap: false, hint: raw.hint ?? '',
  };
}

/** Build the single-answer "root" prompt from a regular prompt's trap definition. */
export function compileTrap(prompt, trapIndex) {
  const trap = prompt.traps[trapIndex];
  const target = prompt.answers.find((a) => a.n === trap.answer);
  if (!target) throw new Error(`Trap answer "${trap.answer}" not found in prompt ${prompt.id}`);
  const ans = { ...target, t: 'root', l: trap.l ?? target.l };
  const index = new Map([...ans.forms].map((f) => [f, [ans]]));
  return {
    id: `${prompt.id}#root${trapIndex}`, q: trap.q, cat: prompt.cat, d: 3, numeric: prompt.numeric,
    strip: prompt.strip, keep: prompt.keep, answers: [ans], index, nope: new Map(), traps: [], trap: true,
    targetId: prompt.id, hint: '',
  };
}

// Words people add around an answer ("noembed tag", "ls command", "quicksort algorithm").
// They are only dropped on a second pass, after the input failed to match as typed.
export const FILLER_WORDS = [
  'the', 'a', 'an', 'tag', 'tags', 'element', 'elements', 'html', 'command', 'cmd', 'keyword', 'module',
  'package', 'library', 'lib', 'framework', 'algorithm', 'algo', 'protocol', 'language', 'lang', 'pattern',
  'attack', 'vulnerability', 'law', 'rule', 'database', 'db', 'engine', 'editor', 'ide', 'distro',
  'distribution', 'service', 'function', 'cipher', 'computer', 'machine', 'bug', 'outage', 'signal',
  'instruction', 'set', 'isa', 'architecture', 'resource', 'kind', 'subcommand',
];
const FILLER_RE = new RegExp(`(^|[^a-z0-9])(?:${FILLER_WORDS.join('|')})(?=$|[^a-z0-9])`, 'g');
const withoutFiller = (input) => String(input ?? '').toLowerCase().replace(FILLER_RE, '$1 ');

/** Closest answers to a typed form within `limit` edits. */
function nearest(prompt, form, limit) {
  const sig = digitSignature(form);
  let best = limit + 1;
  let answers = new Set();
  for (const [f, list] of prompt.index) {
    if (digitSignature(f) !== sig || f.length < 4) continue;
    const dist = editDistance(form, f, limit);
    if (dist > limit) continue;
    if (dist < best) { best = dist; answers = new Set(list); }
    else if (dist === best) list.forEach((a) => answers.add(a));
  }
  return { dist: best, answers: [...answers] };
}

/** Near misses worth offering as "did you mean": a few edits away, or a prefix either way. */
function suggestionsFor(prompt, forms, burned) {
  const score = new Map();
  for (const form of forms) {
    if (!form || form.length < 4) continue;
    const loose = form.length >= 11 ? 4 : form.length >= 7 ? 3 : 2;
    const sig = digitSignature(form);
    for (const [f, list] of prompt.index) {
      if (f.length < 4 || digitSignature(f) !== sig) continue;
      let d = editDistance(form, f, loose);
      if (d > loose) {
        if (f.startsWith(form) || (f.length >= 5 && form.startsWith(f))) d = loose;
        else continue;
      }
      for (const a of list) {
        if (burned.has(a.key)) continue;
        if (!score.has(a) || d < score.get(a)) score.set(a, d);
      }
    }
  }
  const seen = new Set();
  return [...score].sort((x, y) => x[1] - y[1])
    .map(([a]) => a)
    .filter((a) => !seen.has(a.key) && seen.add(a.key))
    .slice(0, 2);
}

/**
 * Check a typed answer against a prompt.
 * burned: Map(answerKey -> where it was spent).
 * Returns { status, answer?, corrected?, at?, message?, suggestions? } where status is
 *   'hit'      accepted (corrected: true when a typo or filler word was fixed)
 *   'burned'   a valid answer that was already spent (use-after-free)
 *   'nope'     a known wrong answer, with a reason
 *   'suggest'  close to an answer but not close enough to accept: offer "did you mean"
 *   'miss' | 'empty'
 */
export function judge(prompt, input, burned = new Map()) {
  const formOf = (s) => (prompt.numeric ? digitsOf(s) : normalize(s, prompt.strip, prompt.keep));
  const form = formOf(input);
  if (!form) return { status: 'empty' };

  const resolve = (cands, corrected) => {
    const fresh = cands.find((a) => !burned.has(a.key));
    if (fresh) return { status: 'hit', answer: fresh, corrected };
    return { status: 'burned', answer: cands[0], at: burned.get(cands[0].key) };
  };

  // Exact, then a known wrong answer, then one or two typos (never for numbers).
  const attempt = (f, corrected) => {
    const exact = prompt.index.get(f);
    if (exact) return resolve(exact, corrected);
    if (prompt.nope.has(f)) return { status: 'nope', message: prompt.nope.get(f) };
    if (!prompt.numeric && f.length >= 5) {
      const near = nearest(prompt, f, f.length >= 9 ? 2 : 1);
      if (near.answers.length === 1) return resolve(near.answers, true);
    }
    return null;
  };

  const first = attempt(form, false);
  if (first) return first;

  let trimmed = '';
  if (!prompt.numeric) {
    trimmed = formOf(withoutFiller(input));
    if (trimmed && trimmed !== form) {
      const second = attempt(trimmed, true);
      if (second) return second;
    }
  }

  const globalForm = normalize(input);
  if (GLOBAL_NOPE.has(globalForm)) return { status: 'nope', message: GLOBAL_NOPE.get(globalForm) };

  if (!prompt.numeric) {
    const suggestions = suggestionsFor(prompt, [form, trimmed], burned);
    if (suggestions.length) return { status: 'suggest', suggestions };
  }
  return { status: 'miss' };
}

export const pointsFor = (answer) => (answer.t === 'root' ? ROOT.pts : TIERS[answer.t].pts);
export const tierOf = (answer) => (answer.t === 'root' ? ROOT : TIERS[answer.t]);

/* ------------------------------------------------------------------ */
/* Seeded randomness and daily drills                                  */
/* ------------------------------------------------------------------ */

export function hashString(str) {
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) ^ (h1 >>> 0);
}

export function rng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rand) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Drill number for a local calendar date. Drill #1 is EPOCH. */
export function dayNumber(date = new Date()) {
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const epoch = Date.UTC(EPOCH.y, EPOCH.m, EPOCH.d);
  return Math.max(1, Math.floor((today - epoch) / 86400000) + 1);
}

export function dateForDay(day) {
  return new Date(EPOCH.y, EPOCH.m, EPOCH.d + (day - 1));
}

/** Order six regular prompts plus one root prompt whose answer hides among the first three. */
function arrange(chosen, rand) {
  const withTraps = chosen.filter((p) => p.traps.length > 0);
  const target = withTraps[Math.floor(rand() * withTraps.length)];
  const trapIndex = Math.floor(rand() * target.traps.length);
  const rest = shuffle(chosen.filter((p) => p !== target), rand).sort((a, b) => a.d - b.d);
  const slot = Math.floor(rand() * 3);
  rest.splice(slot, 0, target);
  return [...rest.map((p) => ({ id: p.id })), { id: target.id, trap: trapIndex }];
}

const dailyCache = new Map();

/** The plan for a daily drill: [{ id, trap? }]. Deterministic for a given bank and day. */
export function dailyPlan(prompts, day) {
  const cacheKey = `${prompts.length}:${day}`;
  if (dailyCache.has(cacheKey)) return dailyCache.get(cacheKey);
  const ids = prompts.map((p) => p.id).sort();
  const byId = new Map(prompts.map((p) => [p.id, p]));
  const window = Math.max(0, Math.floor(ids.length / REGULAR_PER_DRILL) - 1);
  const recent = [];
  let plan = null;
  for (let d = 1; d <= day; d++) {
    const rand = rng(`code-drillion:${d}`);
    const order = shuffle(ids, rand);
    const blocked = new Set(recent.flat());
    let chosen = order.filter((id) => !blocked.has(id)).slice(0, REGULAR_PER_DRILL);
    if (chosen.length < REGULAR_PER_DRILL) {
      chosen = chosen.concat(order.filter((id) => !chosen.includes(id))).slice(0, REGULAR_PER_DRILL);
    }
    recent.push(chosen);
    if (recent.length > window) recent.shift();
    if (d === day) plan = arrange(chosen.map((id) => byId.get(id)), rand);
  }
  dailyCache.set(cacheKey, plan);
  return plan;
}

/** A practice drill from any seed. */
export function practicePlan(prompts, seed) {
  const rand = rng(`practice:${seed}`);
  const chosen = shuffle(prompts, rand).slice(0, REGULAR_PER_DRILL);
  return arrange(chosen, rand);
}

/** Turn a plan into playable compiled prompts. */
export function materialize(plan, promptById) {
  return plan.map((step) => {
    const p = promptById.get(step.id);
    if (!p) throw new Error(`Unknown prompt ${step.id}`);
    return step.trap === undefined ? p : compileTrap(p, step.trap);
  });
}

/* ------------------------------------------------------------------ */
/* Scoring and sharing                                                 */
/* ------------------------------------------------------------------ */

export const hex = (n) => `0x${n.toString(16).toUpperCase().padStart(3, '0')}`;

export function rankFor(depth) {
  return layerAt(kmFor(depth));
}

/** results: [{ status: 'hit' | 'timeout' | 'pass', tier?: number | 'root', burnedTrap?: boolean }] */
export function emojiFor(result) {
  if (result.status !== 'hit') return result.burnedTrap ? BURN_EMOJI : MISS_EMOJI;
  return result.tier === 'root' ? ROOT.emoji : TIERS[result.tier].emoji;
}

export function depthOf(results) {
  return results.reduce((sum, r) => sum + (r.pts ?? 0), 0);
}

/**
 * What a pure autocomplete scores on a drill: it always gives the likeliest unspent answer
 * (the first autocomplete-tier answer in the bank), so it usually spends root's answer early.
 */
export function autocompleteDepth(prompts) {
  const spent = new Set();
  let depth = 0;
  for (const p of prompts) {
    if (p.trap) {
      if (!spent.has(p.answers[0].key)) depth += ROOT.pts;
      continue;
    }
    const pick = p.answers.find((a) => a.t === 0 && !spent.has(a.key)) ?? p.answers.find((a) => !spent.has(a.key));
    if (!pick) continue;
    spent.add(pick.key);
    depth += pointsFor(pick);
  }
  return depth;
}

export function shareText({ label, results, url, baseline }) {
  const km = kmFor(depthOf(results));
  const vs = Number.isFinite(baseline) ? ` · \u{1F916} ${fmtKm(kmFor(baseline))}` : '';
  const lines = [
    `code drillion ${label} · ${fmtKm(km)} down, ${layerAt(km).name}${vs}`,
    results.map(emojiFor).join(''),
  ];
  if (url) lines.push(url);
  return lines.join('\n');
}
