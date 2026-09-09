/* The pipeline: goal → atoms → platforms → assertions, with one retry.
 *
 * The retry is the cheap half of quality control. When the validator rejects a
 * syllabus it says precisely what is wrong — a hole, a redundancy, a step too
 * big — and handing those complaints back to the model fixes most of them. Only
 * when that fails do we fall back, and the fallback emits the same schema, so
 * nothing downstream ever branches on where the syllabus came from.
 */

import { decompose } from './decompose.mjs';
import { pack } from './pack.mjs';
import { validate } from './validate.mjs';

const DEFAULT_BUDGET = 3;

/* A course is not a definition list, so it has a floor. But that floor belongs
 * to the COURSE, not to each of its modules: a module that teaches four atoms
 * well is a module, and rejecting it for being small is what drove every
 * well-scoped narrow goal into the fallback. `buildSyllabus` takes the floor as
 * an argument for that reason — the module builder passes MIN_MODULE_KCS. */
export const MIN_KCS = 6;
export const MIN_MODULE_KCS = 3;

/* The topic arrives capitalised from cleanTopic, and reads badly mid-sentence
 * ("Explain how How black holes work works"). One place decides the phrasing,
 * so the server, the dialogue's fallback and the offline generator agree. */

const midSentence = (topic) => {
  const t = String(topic || 'the subject').trim();
  return /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
};

/** "How black holes work" is already a clause; "Sourdough" needs a verb. */
const asClause = (topic) => {
  const t = midSentence(topic);
  return /^how\s+/i.test(t) ? t.replace(/^how\s+/i, '') : `${t} works`;
};

export function defaultGoalFor(topic) {
  return {
    statement: `Explain how ${asClause(topic)}, well enough to walk someone through one real example.`,
    level: 'apply',
    audience: 'a curious adult',
  };
}

export function defaultCapstoneFor(topic) {
  const subject = midSentence(topic).replace(/^(how|why)\s+/i, '');
  return {
    prompt: `Walk someone through one real example of ${subject}, and say why each step follows.`,
    rubric: ['uses the right ideas', 'the steps follow', 'the result is checked'],
    requires: [],
  };
}

export async function buildSyllabus({ topic, goal, capstone, spine = 'concept', llm, budget = DEFAULT_BUDGET, known = new Set(), minKcs = MIN_KCS }) {
  const attempts = [];

  if (llm) {
    for (const complaints of [[], null]) {
      const previous = attempts[attempts.length - 1];
      let spec;
      try {
        spec = await decompose({
          topic, goal, capstone, spine, llm,
          complaints: complaints === null ? previous?.errors || [] : complaints,
        });
      } catch (e) {
        // The call never reached the model. Asking again changes nothing, and
        // costs the learner another wait.
        console.warn('model call failed:', e.message);
        attempts.push({ errors: [{ code: 'call-failed', message: e.message }] });
        break;
      }

      if (spec) {
        const doc = assemble(spec, { budget, known, minKcs });
        const result = validate(doc);
        if (result.ok) {
          return { doc, source: attempts.length ? 'llm-retry' : 'llm', errors: [] };
        }
        attempts.push({ errors: result.errors });
      } else {
        attempts.push({ errors: [{ code: 'unparseable', message: 'the response was not usable JSON' }] });
      }
    }
  }

  const spec = fallbackSpec(topic, { goal, capstone, spine });
  const doc = assemble(spec, { budget, known, minKcs });
  return { doc, source: 'fallback', errors: attempts.flatMap((a) => a.errors) };
}

/** Pack a spec and fold the result into one document. */
export function assemble(spec, { budget = DEFAULT_BUDGET, known = new Set(), minKcs = MIN_KCS } = {}) {
  const { nodes, edges, problems } = pack(spec, { budget, known, spine: spec.spine });
  return {
    topic: spec.topic,
    spine: spec.spine,
    budget: { newKcs: budget },
    minKcs,
    goal: spec.goal,
    capstone: spec.capstone,
    assumed: spec.assumed || [],
    kcs: spec.kcs,
    clusters: spec.clusters,
    nodes,
    edges,
    problems,
  };
}

/* --------------------------- offline fallback --------------------------- */

/** A deterministic six-atom chain. Placeholder content, real structure. */
export function fallbackSpec(topic, { goal, capstone, spine = 'concept' } = {}) {
  const subject = String(topic || 'the subject').trim();
  const steps = [
    ['the vocabulary', 'understand', 'the words are interchangeable'],
    ['the pieces and what each is for', 'understand', 'the pieces work independently'],
    ['where it shows up in ordinary life', 'understand', 'it only matters to specialists'],
    ['how the pieces fit together', 'apply', 'order does not matter'],
    ['the rule that governs them', 'apply', 'the rule has no exceptions'],
    ['what happens when the rule is broken', 'apply', 'breaking it fails loudly and obviously'],
    ['reading a real example', 'apply', 'examples are always typical'],
    ['spotting a bad example', 'analyze', 'anything that looks right is right'],
    ['building one yourself', 'analyze', 'a working result means a correct method'],
  ];

  const kcs = steps.map(([label, level, wrong], i) => {
    const id = `k${i + 1}`;
    const misconception = `${wrong} — a common mistake about ${subject}`;
    return {
      id,
      label: `${subject}: ${label}`,
      type: i < 2 ? 'concept' : 'principle',
      cluster: ['Getting oriented', 'The rule underneath', 'Reading real ones', 'Doing it yourself'][Math.min(3, Math.floor(i / 2))],
      level,
      requires: i === 0 ? [] : [`k${i}`],
      misconceptions: [misconception],
      check: {
        kc: id,
        level,
        kind: 'mcq',
        stem: `Which is true of ${label} in ${subject}?`,
        options: ['the accurate statement', wrong, `${wrong}, but only sometimes`, 'none of these'],
        answerIndex: 0,
        distractorSource: [null, misconception, misconception, misconception],
      },
    };
  });

  return {
    topic: subject,
    spine,
    goal: goal || defaultGoalFor(subject),
    capstone: { ...(capstone?.prompt ? capstone : defaultCapstoneFor(subject)), requires: ['k9'] },
    assumed: [],
    kcs,
    clusters: [
      { title: 'Getting oriented', summary: `What ${subject} is made of, and where you meet it.`, kcs: ['k1', 'k2', 'k3'] },
      { title: 'The rule underneath', summary: `What ties ${subject} together, and what happens when it gives.`, kcs: ['k4', 'k5', 'k6'] },
      { title: 'Reading real ones', summary: `Telling a good example from a bad one.`, kcs: ['k7', 'k8'] },
      { title: 'Doing it yourself', summary: `Building one, start to finish.`, kcs: ['k9'] },
    ],
  };
}
