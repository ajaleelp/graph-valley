/* Assertions a syllabus must satisfy.
 *
 * The point of this module: curriculum quality becomes something the server
 * *asserts*, not something a reviewer eyeballs. Every check here names a way a
 * generated syllabus can be wrong that "unique ids, acyclic, one goal" cannot
 * catch.
 */

/** Bloom's revised taxonomy, easiest first. Position is the comparison. */
export const LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
const rank = (l) => LEVELS.indexOf(l);

/** A junction wider than this cannot be read as a fork in the isometric world. */
export const MAX_BRANCH = 3;

export function validate(doc) {
  const errors = [];
  const fail = (code, message, subject) => errors.push({ code, message, subject });

  const byKc = new Map(doc.kcs.map((k) => [k.id, k]));
  const assumed = new Set(doc.assumed || []);

  // Which platform teaches each component — and whether two of them do.
  const teacherOf = new Map();
  for (const n of doc.nodes) {
    for (const k of n.teaches) {
      if (teacherOf.has(k)) {
        fail('kc-taught-twice', `${k} is taught by both ${teacherOf.get(k)} and ${n.id}`, k);
      } else {
        teacherOf.set(k, n.id);
      }
    }
  }

  // A hole: something is needed that nothing supplies.
  for (const n of doc.nodes) {
    for (const k of n.requires) {
      if (!teacherOf.has(k) && !assumed.has(k)) {
        fail('kc-untaught', `${n.id} requires ${k}, which no platform teaches and which is not an assumed entry skill`, k);
      }
    }
  }

  // Scope creep: everything taught must be something the capstone leans on,
  // directly or through the component prerequisite relation.
  const needed = new Set();
  const walk = (id) => {
    if (needed.has(id)) return;
    needed.add(id);
    for (const dep of byKc.get(id)?.requires || []) walk(dep);
  };
  for (const k of doc.capstone.requires) walk(k);
  for (const [k, owner] of teacherOf) {
    if (!needed.has(k)) fail('kc-unused', `${owner} teaches ${k}, which the capstone never needs`, k);
  }

  // Cognitive load: a platform may only introduce so much at once.
  const budget = doc.budget?.newKcs ?? 3;
  for (const n of doc.nodes) {
    if (n.teaches.length > budget) {
      fail('node-overloaded', `${n.id} introduces ${n.teaches.length} components; the budget is ${budget}`, n.id);
    }
  }

  // Exactly one summit, as before.
  const goals = doc.nodes.filter((n) => n.goal);
  if (goals.length !== 1) {
    fail('goal-not-unique', `expected exactly one summit, found ${goals.length}`, goals.map((n) => n.id).join(','));
  }

  // No circular prerequisites among components.
  const state = new Map(); // undefined | 'open' | 'done'
  const descend = (id, trail) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') {
      fail('kc-cycle', `components depend on each other in a circle: ${[...trail, id].join(' → ')}`, id);
      return;
    }
    state.set(id, 'open');
    for (const dep of byKc.get(id)?.requires || []) descend(dep, [...trail, id]);
    state.set(id, 'done');
  };
  for (const k of doc.kcs) descend(k.id, []);

  // Every taught component is examined, at a level it was actually taught at,
  // with distractors drawn from that component's named misconceptions.
  for (const n of doc.nodes) {
    const checks = n.checks || [];
    const nodeLevel = rank(n.objective?.level);

    for (const k of n.teaches) {
      if (!checks.some((c) => c.kc === k)) {
        fail('kc-unchecked', `${n.id} teaches ${k} but nothing checks it`, k);
      }
    }

    for (const c of checks) {
      if (rank(c.level) > nodeLevel) {
        fail('check-level-too-high', `a check on ${c.kc} asks for "${c.level}" but ${n.id} taught to "${n.objective?.level}"`, c.kc);
      }
      if (c.kind !== 'mcq') continue;

      const named = new Set(byKc.get(c.kc)?.misconceptions || []);
      c.options.forEach((_, i) => {
        if (i === c.answerIndex) return;
        const src = c.distractorSource?.[i];
        if (!src || !named.has(src)) {
          fail('distractor-unsourced', `option ${i} of the ${c.kc} check is not drawn from a named misconception`, c.kc);
        }
      });
    }
  }

  // Edges are a projection of teaches ∩ requires, and must stay one.
  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
  const successors = new Map(doc.nodes.map((n) => [n.id, new Set()]));
  const predecessors = new Map(doc.nodes.map((n) => [n.id, new Set()]));

  for (const e of doc.edges || []) {
    const from = nodeById.get(e.from);
    const to = nodeById.get(e.to);
    if (!from || !to) {
      fail('edge-not-derived', `edge ${e.from} → ${e.to} names a platform that does not exist`, e.via);
      continue;
    }
    if (!from.teaches.includes(e.via) || !to.requires.includes(e.via)) {
      fail('edge-not-derived', `edge ${e.from} → ${e.to} claims to carry ${e.via}, which ${e.from} does not teach or ${e.to} does not need`, e.via);
      continue;
    }
    successors.get(e.from).add(e.to);
    predecessors.get(e.to).add(e.from);

    if (rank(to.objective?.level) < rank(from.objective?.level)) {
      fail('level-regression', `${e.to} ("${to.objective?.level}") is easier than ${e.from} ("${from.objective?.level}") that leads to it`, e.to);
    }
  }

  // A junction with too many ways out cannot be read as a fork.
  for (const n of doc.nodes) {
    const out = successors.get(n.id).size;
    const into = predecessors.get(n.id).size;
    if (out > MAX_BRANCH) fail('branching-too-wide', `${n.id} forks ${out} ways; the world can render ${MAX_BRANCH}`, n.id);
    if (into > MAX_BRANCH) fail('branching-too-wide', `${n.id} is joined by ${into} paths; the world can render ${MAX_BRANCH}`, n.id);
  }

  return { ok: errors.length === 0, errors };
}
