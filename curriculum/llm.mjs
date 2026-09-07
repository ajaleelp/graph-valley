/* Talking to a model.
 *
 * Kept out of server.mjs so anything — the curriculum checker's --live mode
 * included — can borrow it without booting an HTTP listener.
 */

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export const hasKey = () => !!(ANTHROPIC_KEY || OPENAI_KEY);

export const describeModel = () =>
  (ANTHROPIC_KEY && `Anthropic (${ANTHROPIC_MODEL})`) ||
  (OPENAI_KEY && `OpenAI (${OPENAI_MODEL})`) ||
  'none — demo mode (set ANTHROPIC_API_KEY or OPENAI_API_KEY)';

/* Throws on transport failure rather than returning null. A call that never
 * reached the model is a different fact from a model that answered badly, and
 * collapsing the two made a dead API report itself as unparseable JSON — and
 * got retried, which no amount of asking again was going to fix. */
export async function llm(system, user, maxTokens = 2200) {
  if (ANTHROPIC_KEY) return await anthropic(system, user, maxTokens);
  if (OPENAI_KEY) return await openai(system, user, maxTokens);
  return null;
}

async function anthropic(system, user, max_tokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
  const data = await res.json();
  if (data.stop_reason === 'max_tokens') {
    console.warn(`  model response hit the ${max_tokens}-token ceiling and was cut off`);
  }
  return (data.content || []).map((b) => b.text || '').join('\n');
}

async function openai(system, user, max_tokens) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${OPENAI_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (data.choices?.[0]?.finish_reason === 'length') {
    console.warn(`  model response hit the ${max_tokens}-token ceiling and was cut off`);
  }
  return data.choices?.[0]?.message?.content || '';
}
