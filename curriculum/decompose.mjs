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
/* Overridable, because max_tokens is reserved against the per-minute token
 * allowance, not just consumed: a run of five topics at 8k each reserves 40k
 * against a Free-tier budget of 60k/min, and the 429 that follows is reported
 * as a billing problem rather than a rate limit. Lower it when the account's
 * tier is tight; the truncation warning says when you have gone too low. */
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

The goal is pitched at "${goal.level || 'apply'}", so the components the capstone
leans on must reach "${goal.level || 'apply'}" too. Earlier components may sit
lower, but a course of nothing but "understand" does not arrive at an "analyze"
goal. Set each component's "level" to what that component actually demands.

{"spine": "${spine}",
 "assumed": ["what a general adult audience already has — these are not taught"],
 "kcs": [{"id": "k1",
          "label": "one thing you either know or don't, in a short sentence",
          "type": "fact|concept|procedure|principle",
          "cluster": "the theme or task this belongs to",
          "level": "remember|understand|apply|analyze|evaluate|create",
          "requires": ["ids of components needed before this one"],
          "misconceptions": ["what people actually get wrong about this, 2-3 of them"],
          "check": {"level": "understand",
                    "stem": "a question answerable only if you hold this component",
                    "correct": "the right answer",
                    "wrong": [{"text": "a wrong answer", "because": "the misconception it embodies, quoted from this component's list"},
                              {"text": "...", "because": "..."},
                              {"text": "...", "because": "..."}]}}],
 "clusters": [{"title": "2-5 words naming the IDEA, readable on its own", "summary": "one sentence", "kcs": ["k1"]}],
 "capstoneRequires": ["ids of the components the capstone task actually exercises"]}

Rules:
- 6 to 16 components. "requires" must form a DAG. Every component must be
  something the goal genuinely needs.
- Give exactly three "wrong" options. Each carries, right beside it, the
  misconception it embodies — quoted from that same component's list. Two wrong
  options may embody the same misconception. Do not order or number them; where
  the right answer sits is decided afterwards.
- Clusters partition the components: every id appears in exactly one cluster.
- A cluster title is shown to the learner as the name of a place she walks to,
  with no other context. "Significance" and "Structure" are useless there —
  significance of what? Name the idea: "What the Preamble promises", "Two
  houses of Parliament". Never a bare role word.
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

/* Where the right answer sits is ours to decide, not the model's: every check
 * in the first live run came back with answerIndex 0, which makes the whole
 * thing guessable without reading the question. Deterministic in the atom's id
 * so a re-run produces the same paper. */
function seatFrom(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/* The model writes each wrong option next to the misconception it embodies.
 * A parallel array of indices asked it to hold positional correspondence
 * across two lists, and it numbered the options instead — every time. */
function readCheck(raw, kc) {
  if (!raw || typeof raw !== 'object') return null;

  const wrong = arr(raw.wrong)
    .map((w) => ({ text: str(w?.text).trim(), because: str(w?.because).trim() }))
    .filter((w) => w.text);

  // Already in the flat form (an older fixture, or a model that ignored us).
  if (!wrong.length) {
    return arr(raw.options).length ? { ...raw, kc: kc.id } : null;
  }

  const correct = str(raw.correct).trim();
  if (!correct) return null;

  // Wrong options in the order given, with the right answer slotted in at a
  // seat derived from the atom's id.
  const seat = seatFrom(kc.id) % (wrong.length + 1);
  const options = wrong.map((w) => w.text);
  const distractorSource = wrong.map((w) => (kc.misconceptions.includes(w.because) ? w.because : null));

  options.splice(seat, 0, correct);
  distractorSource.splice(seat, 0, null);

  // The atom's level is the claim about what it teaches; a check cannot ask
  // for more than that. Models set the two independently and inconsistently.
  const asked = LEVELS.includes(raw.level) ? raw.level : kc.level;
  const level = LEVELS.indexOf(asked) > LEVELS.indexOf(kc.level) ? kc.level : asked;

  return {
    answerIndex: seat,
    kc: kc.id,
    level,
    kind: 'mcq',
    stem: str(raw.stem),
    options,
    distractorSource,
  };
}

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
      check: null,
    }));

  // Checks are read after the atom exists, so a wrong option can be matched
  // against that atom's own misconceptions.
  kcs.forEach((k, i) => { k.check = readCheck(body.kcs[i]?.check, k); });

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
