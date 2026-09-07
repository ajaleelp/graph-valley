/* Backward design, stages 2–3: from a committed summit to the atoms.
 *
 * The model is asked for domain knowledge only — what the components are, what
 * each one needs, what people get wrong about it, and a proposed grouping.
 * Packing them into platforms is `pack`'s job, and judging the result is
 * `validate`'s. Nothing here decides how the world is shaped.
 */

import { LEVELS } from './validate.mjs';

/* A dozen-odd atoms, each with a label, prerequisites, two or three
 * misconceptions and a four-option check, runs comfortably past 3,000 tokens.
 * Budget for the largest decomposition the prompt permits, not the smallest —
 * a truncated response is unparseable, and costs a whole call to discover. */
/* Overridable, because some providers reserve max_tokens against the account
 * balance up front and refuse a large request outright — reported, unhelpfully,
 * as "no credits remaining". Lower it to fit a small balance; the truncation
 * warning will tell you when you have gone too low. */
export const DECOMPOSE_TOKENS = Number(process.env.DECOMPOSE_MAX_TOKENS) || 8000;

export const DECOMPOSE_SYSTEM =
  'You decompose a learning goal into its knowledge components. Output ONLY valid JSON. No markdown, no prose.';

export function decomposePrompt({ topic, goal, capstone, spine = 'concept', complaints = [] }) {
  const shape = spine === 'task'
    ? `This is a SKILL. Components are mostly procedures and the judgements that go with them. Group them into whole tasks the learner performs end to end, simplest version first.`
    : `This is a BODY OF KNOWLEDGE. Components are mostly concepts and principles. Group them into themes.`;

  const retry = complaints.length
    ? `\n\nYour previous attempt was rejected. Fix exactly these problems:\n${complaints
        .map((c) => `- [${c.code}] ${c.message}`)
        .join('\n')}\n`
    : '';

  return `Topic: "${topic}".
Goal: ${goal.statement}
The learner proves it by: ${capstone.prompt}

${shape}

Work BACKWARDS from the goal. List only what that goal actually needs — nothing
a learner could reach the goal without.

{"spine": "${spine}",
 "assumed": ["what a general adult audience already has — these are not taught"],
 "kcs": [{"id": "k1",
          "label": "one thing you either know or don't, in a short sentence",
          "type": "fact|concept|procedure|principle",
          "cluster": "the theme or task this belongs to",
          "level": "remember|understand|apply|analyze|evaluate|create",
          "requires": ["ids of components needed before this one"],
          "misconceptions": ["what people actually get wrong about this, 2-3 of them"],
          "check": {"kc": "k1", "level": "understand", "kind": "mcq",
                    "stem": "a question answerable only if you hold this component",
                    "options": ["...", "...", "...", "..."], "answerIndex": 0,
                    "distractorSource": [null, "the misconception each wrong option embodies", "...", "..."]}}],
 "clusters": [{"title": "2-5 words, concrete", "summary": "one sentence", "kcs": ["k1"]}],
 "capstoneRequires": ["ids of the components the capstone task actually exercises"]}

Rules:
- 6 to 16 components. "requires" must form a DAG. Every component must be
  something the goal genuinely needs.
- Every wrong option in a check must come from one of that component's own
  named misconceptions, quoted exactly. The correct option's slot is null.
- Clusters partition the components: every id appears in exactly one cluster.
- "capstoneRequires" names the components the capstone leans on directly. Every
  other component must be reachable from those through "requires" — anything
  that isn't, the goal does not need, so do not include it.
- No filler. No "Advanced Topics", no "Introduction to X".${retry}`;
}

/** Pull the first JSON object out of a model response. */
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

const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const arr = (v) => (Array.isArray(v) ? v : []);

export async function decompose({ topic, goal, capstone, spine = 'concept', llm, complaints = [] }) {
  const raw = await llm(
    DECOMPOSE_SYSTEM,
    decomposePrompt({ topic, goal, capstone, spine, complaints }),
    DECOMPOSE_TOKENS,
  );
  const body = extractJson(raw);
  if (!body || !Array.isArray(body.kcs) || !body.kcs.length) return null;

  // Light normalisation only: types, and references that point at nothing.
  // Everything else is a quality judgement, and that belongs to `validate`.
  const kcs = body.kcs
    .filter((k) => k && k.id != null)
    .map((k) => ({
      id: String(k.id),
      label: str(k.label, String(k.id)),
      type: ['fact', 'concept', 'procedure', 'principle'].includes(k.type) ? k.type : 'concept',
      cluster: str(k.cluster, str(k.label, String(k.id))),
      level: LEVELS.includes(k.level) ? k.level : 'understand',
      requires: arr(k.requires).map(String),
      misconceptions: arr(k.misconceptions).map(String),
      check: k.check && typeof k.check === 'object' ? { ...k.check, kc: String(k.id) } : null,
    }));

  const ids = new Set(kcs.map((k) => k.id));
  for (const k of kcs) {
    k.requires = [...new Set(k.requires.filter((d) => ids.has(d) && d !== k.id))];
  }

  // Which atoms the capstone leans on. This decides scope: everything reachable
  // from here is needed, and anything else is scope creep the validator rejects.
  // When the model does not say, fall back to the atoms nothing else requires —
  // the ends of every chain, which is where a capstone necessarily lands.
  const needed = new Set(kcs.flatMap((k) => k.requires));
  const declared = arr(body.capstoneRequires).map(String).filter((id) => ids.has(id));
  const capstoneRequires = declared.length ? declared : kcs.filter((k) => !needed.has(k.id)).map((k) => k.id);

  const clusters = arr(body.clusters)
    .map((c) => ({
      title: str(c?.title).trim(),
      summary: str(c?.summary),
      kcs: arr(c?.kcs).map(String).filter((id) => ids.has(id)),
    }))
    .filter((c) => c.title && c.kcs.length);

  return {
    topic,
    goal,
    capstone: { ...capstone, requires: capstoneRequires },
    spine: body.spine === 'task' ? 'task' : spine,
    assumed: arr(body.assumed).map(String),
    kcs,
    clusters,
  };
}
