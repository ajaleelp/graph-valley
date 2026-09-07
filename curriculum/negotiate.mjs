/* Backward design, stage 1: settle the summit by conversation.
 *
 * A negotiated syllabus (Breen & Littlejohn): learner and system agree the
 * scope before anything is built. Two or three turns, no more — the product's
 * hook is "type a goal, walk the path", and a long intake dilutes it.
 *
 * What she says about her own prior knowledge is recorded as `priors` and is
 * NEVER treated as mastery. Self-report is asymmetrically miscalibrated —
 * weaker learners overestimate most — so a prior is a hypothesis for a short
 * check to confirm, which is v1.5's job, not this module's.
 */

export const MAX_TURNS = 3;

export const NEGOTIATE_SYSTEM =
  'You scope a learning goal by conversation. Output ONLY valid JSON. No markdown, no prose.';

export function negotiatePrompt({ topic, turns, forced }) {
  const so_far = turns.length
    ? `\nWhat she has told you so far:\n${turns.map((t) => `- ${t.text}`).join('\n')}\n`
    : '\n';

  const instruction = forced
    ? `You have used up your questions. You MUST commit now, using your best reading of what she wants.`
    : `If — and only if — a different answer would produce a materially different course, ask ONE short question. Otherwise commit.`;

  return `Someone said they want to learn: "${topic}".
${so_far}
${instruction}

Commit by fixing a GOAL — one concrete thing she will be able to DO — and a
CAPSTONE that would prove it. The goal is what bounds the course: "learn AI" is
unscopeable, "trace one token through a transformer and say why attention is
needed" is a finite syllabus.

Answer with exactly one of:
{"ask": "one short question, offering concrete alternatives"}
{"done": true,
 "spine": "concept" if this is a body of knowledge, "task" if it is a skill to perform,
 "goal": {"statement": "she will be able to ...", "level": "remember|understand|apply|analyze|evaluate|create", "audience": "who she is"},
 "capstone": {"prompt": "the task that would prove it", "rubric": ["what a good answer shows", "..."]},
 "priors": ["anything she said she already knows, in her own words"]}

Ask about scope, depth or purpose — never about learning styles.`;
}

function extractJson(text) {
  if (!text) return null;
  const t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    return null;
  }
}

const arr = (v) => (Array.isArray(v) ? v : []);

/** A goal we can proceed with when the model will not commit to one. */
function defaultCommitment(topic) {
  return {
    done: true,
    spine: 'concept',
    goal: {
      statement: `Explain how ${topic} works, well enough to walk someone else through one real example.`,
      level: 'apply',
      audience: 'a curious adult',
    },
    capstone: {
      prompt: `Walk someone through one real example of ${topic}, and say why each step follows.`,
      rubric: ['uses the right ideas', 'the steps follow', 'the result is checked'],
    },
    priors: [],
  };
}

export async function negotiate({ topic, turns = [], llm, maxTurns = MAX_TURNS }) {
  const forced = turns.length >= maxTurns;
  const body = extractJson(await llm(NEGOTIATE_SYSTEM, negotiatePrompt({ topic, turns, forced })));

  if (!body) return forced ? defaultCommitment(topic) : null;

  if (!body.done) {
    const ask = typeof body.ask === 'string' ? body.ask.trim() : '';
    if (ask && !forced) return { done: false, ask };
    return defaultCommitment(topic);
  }

  const statement = String(body.goal?.statement || '').trim();
  const prompt = String(body.capstone?.prompt || '').trim();
  if (!statement || !prompt) return forced ? defaultCommitment(topic) : null;

  return {
    done: true,
    spine: body.spine === 'task' ? 'task' : 'concept',
    goal: {
      statement,
      level: String(body.goal?.level || 'apply'),
      audience: String(body.goal?.audience || 'a curious adult'),
    },
    capstone: {
      prompt,
      rubric: arr(body.capstone?.rubric).map(String),
      requires: [],
    },
    priors: arr(body.priors).map(String),
  };
}
