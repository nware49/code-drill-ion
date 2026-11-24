// A thin Claude client for the bank pipeline: one call in, schema-checked JSON out.
// The SDK is imported lazily so tests and the site build never need it installed.

/**
 * Returns { json({ system, prompt, schema, maxTokens }) -> { data, usage } }.
 * Uses streaming (outputs can be long), structured outputs for the JSON shape,
 * and server-side fallbacks so a refused request is retried on a fallback model.
 */
export async function createClaude({ model = 'claude-opus-5-5', effort = 'high' } = {}) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ maxRetries: 4 });
  return {
    model,
    async json({ system, prompt, schema, maxTokens = 64000 }) {
      let message;
      try {
        const stream = client.beta.messages.stream({
          model,
          max_tokens: maxTokens,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort, format: { type: 'json_schema', schema } },
          system,
          messages: [{ role: 'user', content: prompt }],
        });
        message = await stream.finalMessage();
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) {
          throw new Error('Claude API authentication failed. Set the ANTHROPIC_API_KEY secret (see README).');
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
  };
}
