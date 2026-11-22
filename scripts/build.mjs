// Bundles the game into single self-contained HTML files:
//   dist/code-drillion.html  a complete page that works from file:// or any static host
//   dist/artifact.html       the same content without the document wrapper, for hosts that supply one
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const MODULES = [
  'js/engine.js',
  'js/bank/helpers.js',
  'js/bank/systems.js',
  'js/bank/languages.js',
  'js/bank/theory.js',
  'js/bank/lore.js',
  'js/bank/index.js',
  'js/app.js',
];

const unmodule = (src) => src
  .replace(/^import\s[^;]*?from\s*['"][^'"]+['"];[ \t]*\n?/gm, '')
  .replace(/^export\s+(?=(?:const|let|function|class|async)\b)/gm, '');

const js = MODULES.map((p) => `// ---- ${p}\n${unmodule(read(p))}`).join('\n');
if (/^\s*(import|export)\s/m.test(js)) throw new Error('bundle still contains an import or export statement');
if (/<\/script/i.test(js)) throw new Error('bundle contains </script, which would end the inline script early');

const css = read('styles.css');
const page = read('index.html')
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}</style>`)
  .replace('<script type="module" src="js/app.js"></script>', () => `<script type="module">\n${js}</script>`);
if (page.includes('src="js/') || page.includes('href="styles.css"')) throw new Error('an external reference survived bundling');

mkdirSync(new URL('dist/', root), { recursive: true });
writeFileSync(new URL('dist/code-drillion.html', root), page);

const head = page.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/\s*<meta charset[^>]*>/, '')
  .replace(/\s*<meta name="viewport"[^>]*>/, '');
const body = page.match(/<body>([\s\S]*?)<\/body>/)[1];
writeFileSync(new URL('dist/artifact.html', root), `${head.trim()}\n${body.trim()}\n`);
writeFileSync(new URL('dist/bundle.check.mjs', root), js.replace(/^const hot = [\s\S]*$/m, ''));

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`dist/code-drillion.html  ${kb(page)}`);
console.log(`dist/artifact.html       ${kb(head + body)}`);
