// Builds the game.
//   node scripts/build.mjs               dist/code-drillion.html, one self-contained file (works from file://)
//                                        dist/artifact.html, the same without the document wrapper
//   node scripts/build.mjs --site DIR    a static site for GitHub Pages: page, modules, bank/bank.json, puzzles/
// Only puzzles dated up to tomorrow (UTC) are published, so future answers aren't on the site early.
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadBank, bankForClient, loadPuzzleFiles, ROOT_DIR } from './lib/bank.mjs';
import { addDays } from './lib/planner.mjs';
import { parseArgs } from './lib/config.mjs';
import { posthogConfigScript } from './lib/posthog-config.mjs';

const args = parseArgs();
const read = (p) => readFileSync(join(ROOT_DIR, p), 'utf8');
const MODULES = ['js/posthog.js', 'js/engine.js', 'js/art.js', 'js/app.js'];

const cutoff = addDays(new Date().toISOString().slice(0, 10), 1);
const bank = bankForClient(loadBank());
const puzzles = loadPuzzleFiles().filter((p) => p.date <= cutoff);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;

if (args.site) {
  const out = join(ROOT_DIR, args.site);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'js'), { recursive: true });
  mkdirSync(join(out, 'bank'), { recursive: true });
  mkdirSync(join(out, 'puzzles'), { recursive: true });
  for (const f of ['index.html', 'styles.css', ...MODULES]) copyFileSync(join(ROOT_DIR, f), join(out, f));
  writeFileSync(join(out, 'js', 'posthog-config.js'), posthogConfigScript(ROOT_DIR));
  writeFileSync(join(out, 'bank', 'bank.json'), JSON.stringify(bank));
  for (const p of puzzles) writeFileSync(join(out, 'puzzles', `${p.date}.json`), JSON.stringify(p));
  writeFileSync(join(out, '.nojekyll'), '');
  console.log(`${args.site}: ${bank.length} prompts, ${puzzles.length} puzzles (through ${cutoff})`);
} else {
  const unmodule = (src) => src
    .replace(/^import\s[^;]*?from\s*['"][^'"]+['"];[ \t]*\n?/gm, '')
    .replace(/^export\s+(?=(?:const|let|function|class|async)\b)/gm, '');
  const js = MODULES.map((p) => `// ---- ${p}\n${unmodule(read(p))}`).join('\n');
  if (/^\s*(import|export)\s/m.test(js)) throw new Error('bundle still contains an import or export statement');
  if (/<\/script/i.test(js)) throw new Error('bundle contains </script, which would end the inline script early');

  // Embedded data must not be able to close the script tag or break on line separators.
  const safeJson = (value) => JSON.stringify(value)
    .replace(/</g, `${'\\'}u003c`)
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), `${'\\'}u2028`)
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), `${'\\'}u2029`);
  const data = `<script>window.DRILL_DATA = ${safeJson({ bank, puzzles: Object.fromEntries(puzzles.map((p) => [p.date, p])) })};</script>`;
  const posthogData = `<script>${posthogConfigScript(ROOT_DIR)}</script>`;

  const css = read('styles.css');
  const page = read('index.html')
    .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}</style>`)
    .replace('<script src="js/posthog-config.js"></script>', posthogData)
    .replace('<script type="module" src="js/app.js"></script>', () => `${data}\n<script type="module">\n${js}</script>`);
  if (page.includes('src="js/') || page.includes('href="styles.css"')) throw new Error('an external reference survived bundling');

  mkdirSync(join(ROOT_DIR, 'dist'), { recursive: true });
  writeFileSync(join(ROOT_DIR, 'dist', 'code-drillion.html'), page);
  const head = page.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/\s*<meta charset[^>]*>/, '')
    .replace(/\s*<meta name="viewport"[^>]*>/, '');
  const body = page.match(/<body>([\s\S]*?)<\/body>/)[1];
  writeFileSync(join(ROOT_DIR, 'dist', 'artifact.html'), `${head.trim()}\n${body.trim()}\n`);
  writeFileSync(join(ROOT_DIR, 'dist', 'bundle.check.mjs'), js.replace(/^const hot = [\s\S]*$/m, ''));
  console.log(`dist/code-drillion.html  ${kb(page)}  (${bank.length} prompts, ${puzzles.length} puzzles)`);
}
