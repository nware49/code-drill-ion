// Runs scripts/review-puzzles.mjs against a mock GitHub API and checks the calls it makes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBank, isLive } from '../scripts/lib/bank.mjs';
import { planPuzzle } from '../scripts/lib/planner.mjs';
import { deadlineMarker } from '../scripts/lib/review.mjs';

const run = promisify(execFile);
const HOUR = 3600000;
const inTwoDays = new Date(Date.now() + 48 * HOUR).toISOString().slice(0, 10);
const puzzle = planPuzzle({ bank: loadBank().filter(isLive), date: inTwoDays }).puzzle;

function pr(number, { hoursAgo, labels = ['drill-puzzle', 'auto-approve'], date = inTwoDays }) {
  const created = new Date(Date.now() - hoursAgo * HOUR);
  return {
    number,
    state: 'open',
    title: `Puzzle for ${date}`,
    created_at: created.toISOString(),
    labels: labels.map((name) => ({ name })),
    head: { ref: `puzzle/${date}`, sha: `sha${number}` },
    body: `table\n${deadlineMarker(new Date(created.getTime() + 24 * HOUR), created)}`,
  };
}

async function mockGitHub(prs) {
  const calls = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      calls.push({ method: req.method, path: url.pathname, body: body ? JSON.parse(body) : null });
      const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(data === undefined ? '' : JSON.stringify(data)); };
      const p = url.pathname;
      let m;
      if (req.method === 'GET' && p === '/repos/o/r') return send(200, { default_branch: 'main' });
      if (req.method === 'GET' && p === '/repos/o/r/pulls') return send(200, prs);
      if (req.method === 'GET' && (m = /^\/repos\/o\/r\/pulls\/(\d+)$/.exec(p))) return send(200, prs.find((x) => x.number === +m[1]));
      if (req.method === 'GET' && /\/(comments|reviews)$/.test(p)) return send(200, []);
      if (req.method === 'GET' && /\/check-runs$/.test(p)) return send(200, { check_runs: [] });
      if (req.method === 'GET' && /\/contents\/puzzles\//.test(p)) return send(200, { content: Buffer.from(JSON.stringify(puzzle)).toString('base64') });
      if (req.method === 'DELETE' || p.endsWith('/dispatches')) return send(204);
      return send(200, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { calls, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

const env = (api, extra = {}) => ({ ...process.env, GITHUB_API_URL: api, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 'test', ...extra });

test('scheduled run merges only what is past its window, then deploys', async () => {
  const gh = await mockGitHub([pr(1, { hoursAgo: 25 }), pr(2, { hoursAgo: 3 }), pr(3, { hoursAgo: 30, labels: ['drill-puzzle', 'auto-approve', 'hold'] })]);
  try {
    const { stdout } = await run(process.execPath, ['scripts/review-puzzles.mjs', '--scheduled'], { env: env(gh.url) });
    const merges = gh.calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/merge')).map((c) => c.path);
    assert.deepEqual(merges, ['/repos/o/r/pulls/1/merge']);
    assert.ok(gh.calls.some((c) => c.path === '/repos/o/r/actions/workflows/pages.yml/dispatches'), 'deploy dispatched');
    assert.ok(gh.calls.some((c) => c.method === 'POST' && c.path === '/repos/o/r/issues/1/comments' && /auto-approved/.test(c.body.body)));
    assert.match(stdout, /#2 .*: wait/);
    assert.match(stdout, /#3 .*: wait \(on hold\)/);
  } finally {
    gh.close();
  }
});

test('a /swap comment from the owner asks the workflow to regenerate', async () => {
  const gh = await mockGitHub([pr(7, { hoursAgo: 2 })]);
  const dir = mkdtempSync(join(tmpdir(), 'drill-'));
  const eventPath = join(dir, 'event.json');
  const outputPath = join(dir, 'output.txt');
  writeFileSync(outputPath, '');
  writeFileSync(eventPath, JSON.stringify({
    issue: { number: 7, pull_request: {} },
    comment: { body: '/swap 2', user: { login: 'owner', type: 'User' }, author_association: 'OWNER', created_at: new Date().toISOString() },
  }));
  try {
    await run(process.execPath, ['scripts/review-puzzles.mjs', '--event'], { env: env(gh.url, { GITHUB_EVENT_NAME: 'issue_comment', GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath }) });
    const out = readFileSync(outputPath, 'utf8');
    assert.match(out, /rework=swap/);
    assert.match(out, /slot=2/);
    assert.match(out, new RegExp(`branch=puzzle/${inTwoDays}`));
    assert.ok(!gh.calls.some((c) => c.path.endsWith('/merge')), 'no merge on /swap');
  } finally {
    gh.close();
  }
});

test('an /approve comment merges immediately; a stranger is ignored', async () => {
  for (const [assoc, shouldMerge] of [['OWNER', true], ['NONE', false]]) {
    const gh = await mockGitHub([pr(9, { hoursAgo: 1 })]);
    const dir = mkdtempSync(join(tmpdir(), 'drill-'));
    const eventPath = join(dir, 'event.json');
    writeFileSync(eventPath, JSON.stringify({
      issue: { number: 9, pull_request: {} },
      comment: { body: '/approve', user: { login: 'someone', type: 'User' }, author_association: assoc, created_at: new Date().toISOString() },
    }));
    try {
      await run(process.execPath, ['scripts/review-puzzles.mjs', '--event'], { env: env(gh.url, { GITHUB_EVENT_NAME: 'issue_comment', GITHUB_EVENT_PATH: eventPath }) });
      assert.equal(gh.calls.some((c) => c.path.endsWith('/pulls/9/merge')), shouldMerge, assoc);
    } finally {
      gh.close();
    }
  }
});

test('a held puzzle whose date has passed is closed', async () => {
  const gh = await mockGitHub([pr(4, { hoursAgo: 80, date: '2020-01-01' })]);
  try {
    await run(process.execPath, ['scripts/review-puzzles.mjs', '--scheduled'], { env: env(gh.url) });
    assert.ok(gh.calls.some((c) => c.method === 'PATCH' && c.path === '/repos/o/r/pulls/4' && c.body.state === 'closed'));
    assert.ok(!gh.calls.some((c) => c.path.endsWith('/merge')));
  } finally {
    gh.close();
  }
});
