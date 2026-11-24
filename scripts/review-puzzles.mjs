#!/usr/bin/env node
// Approval for puzzle and bank pull requests (rules in scripts/lib/review.mjs).
//   node scripts/review-puzzles.mjs --scheduled   merge what is due, close stale puzzles
//   node scripts/review-puzzles.mjs --event       handle the comment or review in GITHUB_EVENT_PATH
// Needs GITHUB_TOKEN and GITHUB_REPOSITORY. Writes rework=reroll|swap to GITHUB_OUTPUT when the
// workflow should regenerate a puzzle on its branch.
import { readFileSync, appendFileSync } from 'node:fs';
import { loadConfig, parseArgs } from './lib/config.mjs';
import { LABELS, decideScheduled, decideEvent, withDeadline } from './lib/review.mjs';
import { validatePuzzle } from './lib/validate.mjs';

const args = parseArgs();
const config = loadConfig();
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const API = process.env.GITHUB_API_URL || 'https://api.github.com';
if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required.');

async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path.startsWith('/repos') ? '' : `/repos/${repo}`}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`GitHub ${method} ${path} failed (${res.status}): ${data?.message ?? ''}`);
  return data;
}
const all = async (path) => {
  const out = [];
  for (let page = 1; page < 20; page++) {
    const batch = await gh(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
};

const comment = (n, text) => gh(`/issues/${n}/comments`, { method: 'POST', body: { body: text } });
const addLabel = (n, label) => gh(`/issues/${n}/labels`, { method: 'POST', body: { labels: [label] } });
const removeLabel = (n, label) => gh(`/issues/${n}/labels/${encodeURIComponent(label)}`, { method: 'DELETE' }).catch(() => null);
const isPuzzlePR = (pr) => pr.labels.some((l) => l.name === LABELS.puzzle);
const puzzleDateOf = (pr) => /^puzzle\/(\d{4}-\d{2}-\d{2})$/.exec(pr.head.ref)?.[1] ?? null;
const output = (pairs) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(pairs).map(([k, v]) => `${k}=${v}\n`).join(''));

async function checkState(sha) {
  const { check_runs: runs = [] } = await gh(`/commits/${sha}/check-runs?per_page=100`);
  if (runs.some((r) => r.status !== 'completed')) return 'pending';
  if (runs.some((r) => ['failure', 'cancelled', 'timed_out', 'action_required'].includes(r.conclusion))) return 'failed';
  return 'ok';
}

async function puzzleErrors(pr) {
  const date = puzzleDateOf(pr);
  if (!date) return [];
  try {
    const file = await gh(`/contents/puzzles/${date}.json?ref=${pr.head.sha}`);
    return validatePuzzle(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')));
  } catch (e) {
    return [`could not read puzzles/${date}.json (${e.message})`];
  }
}

async function merge(pr, reason) {
  await gh(`/pulls/${pr.number}/merge`, { method: 'PUT', body: { merge_method: 'squash', commit_title: `${pr.title} (#${pr.number})` } });
  await comment(pr.number, `Merged: ${reason}. The site redeploys in a few minutes.`);
  await gh(`/git/refs/heads/${encodeURIComponent(pr.head.ref)}`, { method: 'DELETE' }).catch(() => null);
  return true;
}

async function deploy() {
  const { default_branch: ref } = await gh(`/repos/${repo}`);
  await gh('/actions/workflows/pages.yml/dispatches', { method: 'POST', body: { ref } }).catch((e) => console.warn(`deploy dispatch: ${e.message}`));
}

async function hold(pr, reason) {
  if (pr.labels.some((l) => l.name === LABELS.hold)) return;
  await addLabel(pr.number, LABELS.hold);
  await comment(pr.number, `Auto-approval is on hold (${reason}). Comment \`/approve\` to publish, \`/release\` to restart the ${config.approvalHours}-hour timer${isPuzzlePR(pr) ? ', or `/reroll` / `/swap N` to change prompts' : ''}.`);
}

async function scheduled() {
  const today = new Date().toISOString().slice(0, 10);
  const prs = (await all('/pulls?state=open')).filter((pr) => pr.labels.some((l) => l.name === LABELS.puzzle || l.name === LABELS.bank));
  let merged = 0;
  for (const pr of prs) {
    const puzzleDate = puzzleDateOf(pr);
    const [comments, reviews] = await Promise.all([all(`/issues/${pr.number}/comments`), all(`/pulls/${pr.number}/reviews`)]);
    const checks = await checkState(pr.head.sha);
    const validationErrors = isPuzzlePR(pr) ? await puzzleErrors(pr) : [];
    const d = decideScheduled({ pr, comments, reviews, checks, now: new Date(), hours: config.approvalHours, today, puzzleDate, validationErrors });
    console.log(`#${pr.number} ${pr.title}: ${d.action} (${d.reason})`);
    if (d.action === 'merge') merged += await merge(pr, `auto-approved after ${d.reason}`) ? 1 : 0;
    else if (d.action === 'hold') await hold(pr, d.reason);
    else if (d.action === 'close') {
      await comment(pr.number, `Closing: ${d.reason}`);
      await gh(`/pulls/${pr.number}`, { method: 'PATCH', body: { state: 'closed' } });
      await gh(`/git/refs/heads/${encodeURIComponent(pr.head.ref)}`, { method: 'DELETE' }).catch(() => null);
    }
  }
  if (merged) await deploy();
}

async function event() {
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const name = process.env.GITHUB_EVENT_NAME;
  const number = payload.issue?.number ?? payload.pull_request?.number;
  if (!number || (name === 'issue_comment' && !payload.issue.pull_request)) return;
  const pr = await gh(`/pulls/${number}`);
  if (pr.state !== 'open' || !pr.labels.some((l) => l.name === LABELS.puzzle || l.name === LABELS.bank)) return;
  const kind = name === 'pull_request_review' ? 'review' : 'comment';
  const item = kind === 'review' ? payload.review : payload.comment;
  const d = decideEvent({ kind, item, isPuzzle: isPuzzlePR(pr) });
  if (!d) return;
  console.log(`#${number}: ${d.action}${d.reason ? ` (${d.reason})` : ''}`);
  if (d.action === 'merge') {
    const errs = isPuzzlePR(pr) ? await puzzleErrors(pr) : [];
    if (errs.length) return comment(number, `Not merging: the puzzle file is invalid.\n\n${errs.map((e) => `- ${e}`).join('\n')}`);
    await merge(pr, d.reason);
    await deploy();
  } else if (d.action === 'hold') {
    await hold(pr, d.reason);
  } else if (d.action === 'release') {
    const now = new Date();
    const at = new Date(now.getTime() + config.approvalHours * 3600000);
    await gh(`/pulls/${number}`, { method: 'PATCH', body: { body: withDeadline(pr.body, at, now) } });
    await removeLabel(number, LABELS.hold);
    await comment(number, `Auto-approval resumed. It will publish at ${at.toUTCString().replace(' GMT', ' UTC')} unless there's more feedback.`);
  } else if (d.action === 'rework') {
    await comment(number, d.mode === 'swap' ? `Swapping prompt ${d.slot}...` : 'Rerolling all six prompts...');
    output({ rework: d.mode, slot: d.slot ?? '', pr: number, branch: pr.head.ref, date: puzzleDateOf(pr) });
  } else if (d.action === 'reply') {
    await comment(number, d.text);
  }
}

if (args.scheduled) await scheduled();
else if (args.event) await event();
else throw new Error('Pass --scheduled or --event.');
