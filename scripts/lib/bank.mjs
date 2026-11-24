// The answer bank on disk: one JSON file per prompt in bank/prompts/.
// Files are written one answer per line so a pull request that adds 200 answers is still reviewable.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROMPTS_DIR = join(ROOT_DIR, 'bank', 'prompts');
export const PUZZLES_DIR = join(ROOT_DIR, 'puzzles');

// Field order for prompt files and for each answer.
const PROMPT_KEYS = ['id', 'cat', 'd', 'q', 'hint', 'numeric', 'strip', 'keep', 'status', 'added', 'answers', 'nope', 'traps'];
const ANSWER_KEYS = ['n', 't', 'l', 'alias', 'k', 'wiki', 'views', 'src'];

function ordered(obj, keys) {
  const out = {};
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0 && k !== 'answers' && k !== 'traps')) continue;
    if (k === 'numeric' && v === false) continue;
    out[k] = v;
  }
  for (const k of Object.keys(obj)) if (!keys.includes(k) && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** Pretty JSON with one answer, alias list and trap per line. */
export function serializePrompt(prompt) {
  const p = ordered(prompt, PROMPT_KEYS);
  const lines = ['{'];
  const entries = Object.entries(p);
  entries.forEach(([key, value], i) => {
    const comma = i < entries.length - 1 ? ',' : '';
    if (key === 'answers' || key === 'traps') {
      const items = value.map((v) => JSON.stringify(key === 'answers' ? ordered(v, ANSWER_KEYS) : v));
      lines.push(`  ${JSON.stringify(key)}: [${items.length ? '\n' : ''}${items.map((s) => `    ${s}`).join(',\n')}${items.length ? '\n  ' : ''}]${comma}`);
    } else if (key === 'nope') {
      const nope = Object.entries(value);
      lines.push(`  "nope": {${nope.length ? '\n' : ''}${nope.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}${nope.length ? '\n  ' : ''}}${comma}`);
    } else {
      lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`);
    }
  });
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** Every prompt in the bank, sorted by id. Drafts are included; filter with isLive(). */
export function loadBank(dir = PROMPTS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const p = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (`${p.id}.json` !== f) throw new Error(`${f}: id "${p.id}" does not match the file name`);
      return p;
    });
}

export const isLive = (p) => (p.status ?? 'live') === 'live';

export function savePrompt(prompt, dir = PROMPTS_DIR) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${prompt.id}.json`);
  writeFileSync(file, serializePrompt(prompt));
  return file;
}

/** The compact bank the browser loads for practice drills and as a fallback. */
export function bankForClient(prompts) {
  return prompts.filter(isLive).map((p) => {
    const { status, added, ...rest } = p;
    return { ...rest, answers: p.answers.map(({ wiki, views, src, ...a }) => a) };
  });
}

export function loadPuzzleFiles(dir = PUZZLES_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

export function savePuzzle(puzzle, dir = PUZZLES_DIR) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${puzzle.date}.json`);
  const { prompts, ...meta } = puzzle;
  const body = [
    '{',
    ...Object.entries(meta).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`),
    '  "prompts": [',
    prompts.map((p) => serializePrompt(p).trimEnd().split('\n').map((l) => `    ${l}`).join('\n')).join(',\n'),
    '  ]',
    '}',
  ].join('\n');
  writeFileSync(file, `${body}\n`);
  return file;
}
