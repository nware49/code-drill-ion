// A thin Claude client for the bank pipeline: one call in, schema-checked JSON out.
// The SDK is imported lazily so tests and the site build never need it installed.
//
// Credentials, in order: ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN (local runs), then
// Workload Identity Federation. In GitHub Actions, federation trades a GitHub OIDC token
// for a short-lived Anthropic token, so the repository stores no API key.

import { randomUUID } from 'node:crypto';
import { ROOT_DIR } from './bank.mjs';
import { posthogConfig } from './posthog-config.mjs';

const ANTHROPIC_AUDIENCE = 'https://api.anthropic.com';
const isSet = (value) => Boolean(value?.trim());

/** Whether the environment holds a Claude credential: a key, a token, or federation settings. */
export function hasClaudeCredentials(env = process.env) {
  return isSet(env.ANTHROPIC_API_KEY) || isSet(env.ANTHROPIC_AUTH_TOKEN)
    || (isSet(env.ANTHROPIC_FEDERATION_RULE_ID) && isSet(env.ANTHROPIC_ORGANIZATION_ID));
}

/**
 * Asks GitHub Actions for a new OIDC token addressed to Anthropic. Each token can be
 * exchanged only once and lives about five minutes, so every exchange asks for a new one.
 */
export async function githubIdentityToken(env = process.env, fetchImpl = fetch) {
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set('audience', ANTHROPIC_AUDIENCE);
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
  if (!res.ok) throw new Error(`GitHub did not issue an identity token (HTTP ${res.status}).`);
  const { value } = await res.json();
  if (!value) throw new Error('GitHub returned an empty identity token.');
  return value;
}

/**
 * In GitHub Actions with federation settings and no key, a credentials provider that fetches
 * a fresh GitHub token for every exchange. The SDK's own file-based route rereads one token,
 * which fails once a job outlives its first Anthropic token. Otherwise undefined, so the SDK
 * resolves credentials itself.
 */
export async function githubActionsFederation(env = process.env) {
  const federation = isSet(env.ANTHROPIC_FEDERATION_RULE_ID) && isSet(env.ANTHROPIC_ORGANIZATION_ID);
  const explicit = isSet(env.ANTHROPIC_API_KEY) || isSet(env.ANTHROPIC_AUTH_TOKEN)
    || isSet(env.ANTHROPIC_IDENTITY_TOKEN_FILE) || isSet(env.ANTHROPIC_IDENTITY_TOKEN);
  if (!federation || explicit || env.GITHUB_ACTIONS !== 'true') return undefined;
  if (!isSet(env.ACTIONS_ID_TOKEN_REQUEST_URL)) {
    throw new Error('Federation is configured but GitHub issued no identity token. Add "id-token: write" to the workflow permissions.');
  }
  const { oidcFederationProvider } = await import('@anthropic-ai/sdk/lib/credentials/oidc-federation');
  return oidcFederationProvider({
    identityTokenProvider: () => githubIdentityToken(env),
    federationRuleId: env.ANTHROPIC_FEDERATION_RULE_ID.trim(),
    organizationId: env.ANTHROPIC_ORGANIZATION_ID.trim(),
    serviceAccountId: env.ANTHROPIC_SERVICE_ACCOUNT_ID?.trim() || undefined,
    workspaceId: env.ANTHROPIC_WORKSPACE_ID?.trim() || undefined,
    baseURL: env.ANTHROPIC_BASE_URL?.trim() || ANTHROPIC_AUDIENCE,
    fetch,
  });
}

/**
 * Returns { json({ system, prompt, schema, maxTokens }) -> { data, usage } }.
 * Uses streaming (outputs can be long), structured outputs for the JSON shape,
 * and server-side fallbacks so a refused request is retried on a fallback model.
 */
export async function createClaude({ model = 'claude-opus-5-5', effort = 'high', env = process.env } = {}) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const credentials = await githubActionsFederation(env);
  const client = new Anthropic({ maxRetries: 4, ...(credentials && { credentials }) });
  const tracer = await aiTracer(env === process.env
    ? posthogConfig(ROOT_DIR)
    : { key: env.PUBLIC_POSTHOG_PROJECT_TOKEN, host: env.PUBLIC_POSTHOG_HOST });
  return {
    model,
    async json({ system, prompt, schema, maxTokens = 64000 }) {
      const params = {
        model,
        max_tokens: maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort, format: { type: 'json_schema', schema } },
        system,
        messages: [{ role: 'user', content: prompt }],
      };
      const started = Date.now();
      let message;
      try {
        message = await client.beta.messages.stream(params).finalMessage();
        tracer?.generation({ params, started, message });
      } catch (err) {
        tracer?.generation({ params, started, error: err });
        if (err instanceof Anthropic.AuthenticationError) {
          throw new Error('Claude API authentication failed. Check the federation variables, or the authentication history on the Workload identity page in the Claude Console (see README).');
        } else if (err instanceof Anthropic.BadRequestError) {
          throw new Error(`Claude API rejected the request: ${err.message}`);
        } else if (err instanceof Anthropic.RateLimitError) {
          throw new Error('Claude API rate limit hit after retries. Try again later or lower the batch size.');
        } else if (err instanceof Anthropic.APIError) {
          throw new Error(`Claude API error ${err.status ?? ''}: ${err.message}`);
        }
        throw err;
      }
      if (message.stop_reason === 'refusal') {
        throw new Error(`Claude declined this request (${message.stop_details?.category ?? 'no category'}).`);
      }
      if (message.stop_reason === 'max_tokens') {
        throw new Error('The response was cut off at max_tokens. Ask for fewer items per call.');
      }
      const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      try {
        return { data: JSON.parse(text), usage: message.usage };
      } catch {
        throw new Error('Claude returned text that is not valid JSON.');
      }
    },
    async shutdown() {
      await tracer?.shutdown();
    },
  };
}

/**
 * PostHog AI observability: one $ai_generation event per Claude call, one session per run.
 * Captured by hand because PostHog's Anthropic wrapper only covers client.messages, not the
 * beta API these calls use (server-side fallbacks), and on the beta API it would send its
 * own posthogTraceId field to Claude, which rejects the request.
 * Returns null when PostHog isn't configured.
 */
async function aiTracer({ key, host }) {
  if (!key || !host) return null;
  const { PostHog } = await import('posthog-node');
  const posthog = new PostHog(key, { host, requestTimeout: 3000, fetchRetryCount: 0 });
  const sessionId = randomUUID();
  return {
    generation({ params, started, message, error }) {
      const traceId = randomUUID();
      const usage = message?.usage ?? {};
      posthog.capture({
        distinctId: traceId,
        event: '$ai_generation',
        properties: {
          $process_person_profile: false,
          $ai_trace_id: traceId,
          $ai_session_id: sessionId,
          $ai_provider: 'anthropic',
          $ai_model: message?.model ?? params.model,
          $ai_input: [{ role: 'system', content: params.system }, ...params.messages],
          $ai_output_choices: message ? [{ role: 'assistant', content: message.content }] : [],
          $ai_input_tokens: usage.input_tokens,
          $ai_output_tokens: usage.output_tokens,
          $ai_cache_read_input_tokens: usage.cache_read_input_tokens,
          $ai_cache_creation_input_tokens: usage.cache_creation_input_tokens,
          $ai_max_tokens: params.max_tokens,
          $ai_latency: (Date.now() - started) / 1000,
          $ai_http_status: error ? (error.status ?? 0) : 200,
          $ai_is_error: Boolean(error),
          ...(error && { $ai_error: error.message }),
          ...(message && { $ai_stop_reason: message.stop_reason }),
        },
      });
    },
    shutdown: () => posthog.shutdown(3000).catch(() => {}),
  };
}
