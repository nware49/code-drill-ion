// Claude credentials: the API-key check, and Workload Identity Federation from GitHub Actions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { hasClaudeCredentials, githubIdentityToken, githubActionsFederation, createClaude } from '../scripts/lib/claude.mjs';

const FEDERATION = {
  ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_test',
  ANTHROPIC_ORGANIZATION_ID: '00000000-0000-0000-0000-000000000000',
  ANTHROPIC_SERVICE_ACCOUNT_ID: 'svac_test',
  ANTHROPIC_WORKSPACE_ID: 'wrkspc_test',
};

test('credentials are a key, a token, or both federation IDs; blanks do not count', () => {
  assert.equal(hasClaudeCredentials({}), false);
  assert.equal(hasClaudeCredentials({ ANTHROPIC_API_KEY: '  ' }), false);
  assert.equal(hasClaudeCredentials({ ANTHROPIC_API_KEY: 'sk-ant-x' }), true);
  assert.equal(hasClaudeCredentials({ ANTHROPIC_AUTH_TOKEN: 'tok' }), true);
  assert.equal(hasClaudeCredentials({ ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_x' }), false);
  assert.equal(hasClaudeCredentials(FEDERATION), true);
});

test('the GitHub identity token is requested for the Anthropic audience', async () => {
  let seen;
  const fakeFetch = async (url, init) => {
    seen = { url: new URL(url), auth: init.headers.authorization };
    return new Response(JSON.stringify({ value: 'jwt-abc' }));
  };
  const env = { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://gh.example/token?api-version=2.0', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'req' };
  assert.equal(await githubIdentityToken(env, fakeFetch), 'jwt-abc');
  assert.equal(seen.url.searchParams.get('audience'), 'https://api.anthropic.com');
  assert.equal(seen.url.searchParams.get('api-version'), '2.0');
  assert.equal(seen.auth, 'Bearer req');
  await assert.rejects(githubIdentityToken(env, async () => new Response('no', { status: 403 })), /HTTP 403/);
});

test('federation is used only in Actions, with both IDs, and without a key', async () => {
  const actions = { ...FEDERATION, GITHUB_ACTIONS: 'true', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://gh.example/t?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'r' };
  assert.equal(await githubActionsFederation({ ...FEDERATION }), undefined, 'outside Actions the SDK resolves credentials');
  assert.equal(await githubActionsFederation({ ...actions, ANTHROPIC_API_KEY: 'sk-ant-x' }), undefined, 'a key takes priority');
  assert.equal(await githubActionsFederation({ GITHUB_ACTIONS: 'true' }), undefined, 'no federation settings');
  await assert.rejects(
    githubActionsFederation({ ...FEDERATION, GITHUB_ACTIONS: 'true' }),
    /id-token: write/,
    'a workflow without the permission gets a clear error',
  );
});

test('each token exchange presents a fresh GitHub token (real SDK, fake servers)', async (t) => {
  try {
    await import('@anthropic-ai/sdk');
  } catch {
    t.skip('@anthropic-ai/sdk is not installed');
    return;
  }
  const github = [];
  const exchanges = [];
  const messages = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/github/token') {
        github.push({ audience: url.searchParams.get('audience'), auth: req.headers.authorization });
        res.end(JSON.stringify({ value: `jwt-${github.length}` }));
      } else if (url.pathname === '/v1/oauth/token') {
        exchanges.push(JSON.parse(body));
        // A 10-second token is inside the SDK's refresh margin, so every request exchanges again.
        res.end(JSON.stringify({ access_token: `sk-ant-oat01-test-${exchanges.length}`, token_type: 'Bearer', expires_in: 10 }));
      } else if (url.pathname.startsWith('/v1/messages')) {
        messages.push(req.headers.authorization);
        res.statusCode = 400;
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'fake server stops here' } }));
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const savedBaseURL = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = base;
  t.after(() => {
    if (savedBaseURL === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = savedBaseURL;
  });

  const env = {
    ...FEDERATION,
    GITHUB_ACTIONS: 'true',
    ACTIONS_ID_TOKEN_REQUEST_URL: `${base}/github/token?api-version=2.0`,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
    ANTHROPIC_BASE_URL: base,
  };
  const claude = await createClaude({ env });
  const call = () => claude.json({ system: 's', prompt: 'p', schema: { type: 'object' } });
  await assert.rejects(call, /fake server stops here/);
  await assert.rejects(call, /fake server stops here/);

  assert.equal(github.length, 2, 'one GitHub token per exchange');
  for (const g of github) {
    assert.equal(g.audience, 'https://api.anthropic.com');
    assert.equal(g.auth, 'Bearer request-token');
  }
  assert.deepEqual(exchanges.map((e) => e.assertion), ['jwt-1', 'jwt-2'], 'no GitHub token is exchanged twice');
  assert.deepEqual(exchanges[0], {
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: 'jwt-1',
    federation_rule_id: 'fdrl_test',
    organization_id: '00000000-0000-0000-0000-000000000000',
    service_account_id: 'svac_test',
    workspace_id: 'wrkspc_test',
  });
  assert.deepEqual(messages, ['Bearer sk-ant-oat01-test-1', 'Bearer sk-ant-oat01-test-2']);
});
