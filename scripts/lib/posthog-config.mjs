import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function readDotEnv(root) {
  const path = join(root, '.env');
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/^(['"])(.*)\1$/, '$2')]),
  );
}

export function posthogConfig(root) {
  const env = { ...readDotEnv(root), ...process.env };
  return { key: env.PUBLIC_POSTHOG_PROJECT_TOKEN, host: env.PUBLIC_POSTHOG_HOST };
}

export function posthogConfigScript(root) {
  return `window.POSTHOG_CONFIG = ${JSON.stringify(posthogConfig(root))};\n`;
}
