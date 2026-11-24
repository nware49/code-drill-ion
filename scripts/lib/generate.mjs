// Growing the bank with Claude: propose new prompts, add answers to existing ones,
// then verify every answer before it can reach a pull request.
import { compilePrompt, judge, normalize } from '../../js/engine.js';
import { validatePrompt, MAX_LORE } from './validate.mjs';

export const CATEGORIES = [
  'unix', 'networking', 'web', 'cloud', 'tools', 'languages', 'data', 'algorithms', 'security',
  'design', 'hardware', 'theory', 'war stories', 'people', 'folklore', 'history',
];

const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['n', 't', 'l', 'alias', 'wiki'],
  properties: {
    n: { type: 'string', description: 'Canonical answer as players would recognize it.' },
    t: { type: 'integer', enum: [0, 1, 2, 3, 4, 5], description: 'Rarity tier, 0 (topsoil) to 5 (inner core).' },
    l: { type: 'string', description: 'One true, specific fact, at most 180 characters.' },
    alias: { type: 'array', items: { type: 'string' }, description: 'Other ways players type this same answer.' },
    wiki: { type: 'string', description: 'Exact English Wikipedia article title, or empty.' },
  },
};

const PROMPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'cat', 'd', 'q', 'hint', 'numeric', 'strip', 'answers', 'nope', 'traps'],
  properties: {
    id: { type: 'string', description: 'Short kebab-case id, unique in the bank.' },
    cat: { type: 'string', enum: CATEGORIES },
    d: { type: 'integer', enum: [1, 2, 3], description: '1 = most engineers can name five; 3 = niche.' },
    q: { type: 'string', description: 'The prompt, starting "Name ..." and ending with a period.' },
    hint: { type: 'string', description: 'Optional short clarification shown under the prompt, or empty.' },
    numeric: { type: 'boolean', description: 'True only when every answer is a number (ports, codes).' },
    strip: { type: 'array', items: { type: 'string' }, description: 'Words players often add that should be ignored, like "sort" or "algorithm".' },
    answers: { type: 'array', items: ANSWER_SCHEMA },
    nope: {
      type: 'array',
      description: 'Common wrong answers with a short reason.',
      items: { type: 'object', additionalProperties: false, required: ['typed', 'reason'], properties: { typed: { type: 'string' }, reason: { type: 'string' } } },
    },
    traps: {
      type: 'array',
      description: 'Two root questions: trivia whose single right answer is a famous (tier 0 or 1) answer in the list.',
      items: { type: 'object', additionalProperties: false, required: ['q', 'answer', 'lore'], properties: { q: { type: 'string' }, answer: { type: 'string' }, lore: { type: 'string' } } },
    },
  },
};

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['n', 'valid', 'lore_ok', 'fixed_lore', 'reason'],
        properties: {
          n: { type: 'string' },
          valid: { type: 'boolean', description: 'The answer genuinely satisfies the prompt.' },
          lore_ok: { type: 'boolean', description: 'Every claim in the lore is accurate.' },
          fixed_lore: { type: 'string', description: 'A corrected, accurate lore line when lore_ok is false, else empty.' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

export const SYSTEM_PROMPT = `You write content for Code Drill, a daily trivia game for software engineers.

Each prompt asks players to "Name ..." something (a sorting algorithm, an HTTP status code, a Turing Award winner). Players have 30 seconds and type any valid answer. Rarer valid answers score more, in six tiers named for layers of the Earth:
- 0 topsoil: the one to four answers almost everyone, and every autocomplete, says first
- 1 crust: common working knowledge
- 2 upper mantle: known to engineers who have shipped it and read the docs
- 3 lower mantle: specialist knowledge
- 4 outer core: deep cuts; you were there, or you read the postmortem
- 5 inner core: almost nobody would think of it

Accuracy matters more than volume. Include only answers that unambiguously satisfy the prompt. Each answer gets one lore line: a single specific, true fact (who, when, or why it matters), at most 180 characters, in plain English. No em dashes, no hype, no "fun fact". If you are not sure a detail is true, write a simpler statement you are sure of.

Aliases are other ways players type the same answer: abbreviations, alternate spellings, the name without a version suffix. Never give an alias that could also mean a different answer in the list. Case and punctuation are already ignored, so don't list those variants.

wiki is the exact title of the English Wikipedia article about that answer, or an empty string if there isn't one.`;

/** Turn a generated prompt into a bank prompt and repair what can be repaired automatically. */
export function toBankPrompt(gen, { existingIds = new Set(), date }) {
  let id = String(gen.id || gen.q).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'prompt';
  const base = id;
  for (let i = 2; existingIds.has(id); i++) id = `${base}-${i}`;
  const raw = {
    id,
    cat: gen.cat,
    d: gen.d,
    q: gen.q.trim().replace(/\s+/g, ' ').replace(/([^.?])$/, '$1.'),
    hint: gen.hint?.trim() || undefined,
    numeric: gen.numeric || undefined,
    strip: gen.strip?.filter(Boolean),
    status: 'live',
    added: date,
    answers: gen.answers.map((a) => cleanAnswer(a)),
    nope: Object.fromEntries((gen.nope ?? []).filter((x) => x.typed && x.reason).map((x) => [x.typed.trim(), x.reason.trim()])),
    traps: (gen.traps ?? []).map((t) => ({ q: t.q.trim(), answer: t.answer.trim(), l: t.lore?.trim() || undefined })),
  };
  return repairPrompt(raw);
}

function cleanAnswer(a) {
  const n = a.n.trim();
  const alias = [...new Set((a.alias ?? []).map((x) => x.trim()).filter((x) => x && normalize(x) !== normalize(n)))];
  return { n, t: a.t, l: shortenLore(a.l ?? ''), alias, wiki: a.wiki?.trim() || undefined, src: 'llm' };
}

function shortenLore(l) {
  const text = l.trim().replace(/\s+/g, ' ').replace(/—/g, ', ');
  if (text.length <= MAX_LORE) return text;
  const cut = text.slice(0, MAX_LORE);
  const end = cut.lastIndexOf('. ');
  return end > 40 ? cut.slice(0, end + 1) : '';
}

/**
 * Fix the mechanical problems generated content tends to have: duplicate answers, aliases
 * that collide with another answer, nope entries that hide answers, empty lore, root
 * questions that point at the wrong tier. Returns { prompt, fixes }.
 */
export function repairPrompt(raw) {
  const fixes = [];
  const p = { ...raw, answers: raw.answers.filter((a) => a.n && a.l) };
  if (p.answers.length < raw.answers.length) fixes.push(`dropped ${raw.answers.length - p.answers.length} answers without lore`);
  for (let pass = 0; pass < 4; pass++) {
    const compiled = compilePrompt(p);
    const owner = new Map();
    const dropAnswers = new Set();
    const dropAlias = new Map();
    for (const ans of compiled.answers) {
      if (owner.has(ans.key)) { dropAnswers.add(ans.n); continue; }
      owner.set(ans.key, ans.n);
    }
    for (const [form, list] of compiled.index) {
      const names = [...new Set(list.map((a) => a.n))];
      if (names.length < 2) continue;
      // Keep the form for the answer whose own name produces it; strip it from the others' aliases.
      const keeper = names.find((n) => normalize(n, p.strip ?? [], p.keep ?? '') === form) ?? names[0];
      for (const n of names) if (n !== keeper) dropAlias.set(n, [...(dropAlias.get(n) ?? []), form]);
    }
    if (!dropAnswers.size && !dropAlias.size) break;
    p.answers = p.answers
      .filter((a, i) => !dropAnswers.has(a.n) || p.answers.findIndex((b) => b.n === a.n) === i)
      .map((a) => (dropAlias.has(a.n)
        ? { ...a, alias: (a.alias ?? []).filter((x) => !dropAlias.get(a.n).includes(normalize(x, p.strip ?? [], p.keep ?? ''))) }
        : a));
    if (dropAnswers.size) fixes.push(`dropped duplicate answers: ${[...dropAnswers].join(', ')}`);
    if (dropAlias.size) fixes.push(`removed aliases shared between answers: ${[...dropAlias.keys()].join(', ')}`);
  }
  // Aliases that would be matched to something else, or never reach their own answer.
  const compiled = compilePrompt(p);
  p.answers = p.answers.map((a) => ({ ...a, alias: (a.alias ?? []).filter((x) => { const r = judge(compiled, x); return r.status === 'hit' && r.answer.n === a.n; }) }));
  for (const form of Object.keys(p.nope ?? {})) {
    if (compilePrompt(p).index.has(normalize(form, p.strip ?? [], p.keep ?? ''))) {
      delete p.nope[form];
      fixes.push(`removed nope entry "${form}" because it is a valid answer`);
    }
  }
  const before = (p.traps ?? []).length;
  p.traps = (p.traps ?? []).filter((t) => {
    const a = p.answers.find((x) => x.n === t.answer);
    return a && a.t <= 1;
  });
  if (p.traps.length < before) fixes.push(`dropped ${before - p.traps.length} root questions whose answer is missing or too obscure`);
  return { prompt: p, fixes };
}

/** Ask Claude for new prompts that don't duplicate the bank. Returns [{ prompt, fixes, errors }]. */
export async function proposePrompts({ llm, bank, count, date, answersPerPrompt = 120, log = () => {} }) {
  const results = [];
  const ids = new Set(bank.map((p) => p.id));
  const questions = bank.map((p) => `- ${p.q} (${p.cat})`);
  for (let i = 0; i < count; i++) {
    const avoid = [...questions, ...results.map((r) => `- ${r.prompt.q}`)].join('\n');
    const prompt = `Write one new prompt for the game, in a category or angle the bank covers least. It must have at least ${answersPerPrompt} valid answers spread across all six tiers, with most answers in tiers 2 to 5, two root questions, and a few common wrong answers in "nope".

These prompts already exist. Don't repeat them or ask for the same set of answers in different words:
${avoid}

Return {"prompts": [ ...exactly one prompt... ]}.`;
    log(`Proposing prompt ${i + 1} of ${count}...`);
    const { data } = await llm.json({ system: SYSTEM_PROMPT, prompt, schema: { type: 'object', additionalProperties: false, required: ['prompts'], properties: { prompts: { type: 'array', items: PROMPT_SCHEMA } } } });
    for (const gen of data.prompts.slice(0, 1)) {
      const { prompt: p, fixes } = toBankPrompt(gen, { existingIds: ids, date });
      ids.add(p.id);
      results.push({ prompt: p, fixes, errors: validatePrompt(p) });
    }
  }
  return results;
}

/** Ask Claude for more answers to an existing prompt. Returns the new answers (not yet merged). */
export async function expandPrompt({ llm, prompt, add = 60 }) {
  const existing = prompt.answers.map((a) => a.n).join('; ');
  const request = `Prompt: "${prompt.q}"${prompt.hint ? ` (${prompt.hint})` : ''}

It already accepts these answers. Do not repeat them or any spelling of them:
${existing}

Add up to ${add} more valid answers, favoring rarer ones (tiers 2 to 5). Return {"answers": [...]}.`;
  const { data } = await llm.json({ system: SYSTEM_PROMPT, prompt: request, schema: { type: 'object', additionalProperties: false, required: ['answers'], properties: { answers: { type: 'array', items: ANSWER_SCHEMA } } } });
  return data.answers.map((a) => cleanAnswer(a));
}

/** Second opinion on answers: drop invalid ones and fix inaccurate lore. Returns { kept, dropped, fixed }. */
export async function verifyAnswers({ llm, prompt, answers, chunk = 80 }) {
  const kept = [];
  const dropped = [];
  let fixed = 0;
  for (let i = 0; i < answers.length; i += chunk) {
    const part = answers.slice(i, i + chunk);
    const list = part.map((a, j) => `${j + 1}. ${a.n}: ${a.l}`).join('\n');
    const request = `You are fact-checking answers for the prompt "${prompt.q}". For each numbered answer, decide whether it genuinely satisfies the prompt, and whether every claim in its lore is accurate. If the lore is wrong but the answer is valid, write a corrected lore line under 180 characters. Be strict: when in doubt, mark it invalid.

${list}

Return {"verdicts": [...]} with one verdict per answer, in order, using the answer text as "n".`;
    const { data } = await llm.json({ system: SYSTEM_PROMPT, prompt: request, schema: VERDICT_SCHEMA, maxTokens: 32000 });
    const byName = new Map(data.verdicts.map((v) => [v.n, v]));
    part.forEach((a, j) => {
      const v = byName.get(a.n) ?? data.verdicts[j];
      if (!v || !v.valid) { dropped.push({ n: a.n, reason: v?.reason || 'not confirmed' }); return; }
      if (!v.lore_ok) {
        const l = shortenLore(v.fixed_lore ?? '');
        if (!l) { dropped.push({ n: a.n, reason: 'lore could not be confirmed' }); return; }
        fixed++;
        kept.push({ ...a, l });
        return;
      }
      kept.push(a);
    });
  }
  return { kept, dropped, fixed };
}

/**
 * Add answers to a prompt. An answer whose name already matches an existing answer is skipped;
 * a new answer keeps its place and only loses aliases that belong to another answer.
 */
export function mergeAnswers(prompt, additions) {
  const compiled = compilePrompt(prompt);
  const formOf = (x) => normalize(x, prompt.strip ?? [], prompt.keep ?? '');
  const added = [];
  const skipped = [];
  for (const a of additions) {
    const nameForm = formOf(a.n);
    if (compiled.index.has(nameForm) || added.some((b) => formOf(b.n) === nameForm)) {
      skipped.push(a.n);
      continue;
    }
    added.push(a);
  }
  const { prompt: merged, fixes } = repairPrompt({ ...prompt, answers: [...prompt.answers, ...added] });
  return { prompt: merged, added: merged.answers.length - prompt.answers.length, skipped, fixes };
}
