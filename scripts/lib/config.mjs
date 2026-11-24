import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from './bank.mjs';

export const CONFIG_DEFAULTS = {
  lookaheadDays: 2,
  approvalHours: 24,
  noRepeatDays: 30,
  promptsPerDay: 6,
  minFreshPrompts: 12,
  newPromptsWhenShort: 6,
  model: 'claude-opus-5-5',
  effort: 'high',
  growth: { proposePrompts: 8, expandPrompts: 6, answersPerNewPrompt: 120, answersPerExpansion: 60, autoApprove: true },
};

export function loadConfig(file = join(ROOT_DIR, 'drill.config.json')) {
  const user = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return { ...CONFIG_DEFAULTS, ...user, growth: { ...CONFIG_DEFAULTS.growth, ...(user.growth ?? {}) } };
}

/** Parse --flag value / --flag=value / --switch arguments. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}
