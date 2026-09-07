/* Builders for syllabus documents in tests and checks.
 *
 * These produce a *valid* document by default; each test perturbs exactly one
 * thing, so a failure names the assertion under test rather than a typo three
 * fields away.
 */

export function kc(id, requires = [], over = {}) {
  return {
    id,
    label: `atom ${id}`,
    type: 'concept',
    requires,
    misconceptions: [`${id} is confused with something else`],
    ...over,
  };
}

export function check(kcId, level, over = {}) {
  return {
    kc: kcId,
    level,
    kind: 'mcq',
    stem: `what about ${kcId}?`,
    options: ['right', 'wrong a', 'wrong b', 'wrong c'],
    answerIndex: 0,
    distractorSource: [
      null,
      `${kcId} is confused with something else`,
      `${kcId} is confused with something else`,
      `${kcId} is confused with something else`,
    ],
    ...over,
  };
}

export function node(id, { teaches = [], requires = [], level = 'understand', goal = false } = {}, over = {}) {
  return {
    id,
    title: `platform ${id}`,
    summary: `what ${id} is for`,
    goal,
    objective: { verb: 'describe', level },
    teaches,
    requires,
    segments: [
      { kind: 'activate', recalls: requires },
      { kind: 'demonstrate', workedExample: true },
      { kind: 'apply', scaffold: 'partial' },
    ],
    checks: teaches.map((k) => check(k, level)),
    ...over,
  };
}

/** A two-platform syllabus: n1 teaches k1, n2 teaches k2 which needs k1. */
export function syllabus(over = {}) {
  return {
    topic: 'a test topic',
    spine: 'concept',
    budget: { newKcs: 3 },
    goal: { statement: 'do the thing', level: 'apply', audience: 'anyone' },
    capstone: { prompt: 'now do it', requires: ['k2'], rubric: ['does the thing'] },
    assumed: [],
    kcs: [kc('k1'), kc('k2', ['k1'])],
    nodes: [
      node('n1', { teaches: ['k1'], requires: [], level: 'understand' }),
      node('n2', { teaches: ['k2'], requires: ['k1'], level: 'apply', goal: true }),
    ],
    edges: [{ from: 'n1', to: 'n2', via: 'k1' }],
    ...over,
  };
}

/* --- pack inputs: what decompose hands over --------------------------- */

/** A knowledge component as decompose emits it: it carries its own check. */
export function atom(id, { requires = [], cluster = id, level = 'understand' } = {}, over = {}) {
  const misconception = `${id} is confused with something else`;
  return {
    id,
    label: `atom ${id}`,
    type: 'concept',
    cluster,
    level,
    requires,
    misconceptions: [misconception],
    check: {
      kc: id,
      level,
      kind: 'mcq',
      stem: `what about ${id}?`,
      options: ['right', 'wrong a', 'wrong b', 'wrong c'],
      answerIndex: 0,
      distractorSource: [null, misconception, misconception, misconception],
    },
    ...over,
  };
}

/** Group titles, in the order decompose proposed them. */
export function cluster(title, kcs, summary = `what ${title} is for`) {
  return { title, summary, kcs };
}
