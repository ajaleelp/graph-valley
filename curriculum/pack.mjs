/* Group knowledge components into walkable platforms.
 *
 * Deliberately pure and LLM-free. The model supplies domain knowledge — what
 * the atoms are, what they need, what people get wrong, and a proposed
 * grouping. Turning that into platforms is constrained partitioning: it must
 * respect the prerequisite order and the cognitive-load budget, and it must be
 * cheap to run again. Deferred packing and, later, adaptive re-packing are this
 * same function called with a larger `known` set.
 */

import { LEVELS } from './validate.mjs';

const rank = (l) => Math.max(0, LEVELS.indexOf(l));

/** Repeatedly take the available item of lowest original index. */
function orderStably(ids, depsOf) {
  const remaining = new Set(ids);
  const index = new Map(ids.map((id, i) => [id, i]));
  const placed = new Set();
  const out = [];

  while (remaining.size) {
    let pick = null;
    for (const id of remaining) {
      const ready = depsOf(id).every((d) => !remaining.has(d) || placed.has(d));
      if (ready && (pick === null || index.get(id) < index.get(pick))) pick = id;
    }
    if (pick === null) return { order: out, stuck: [...remaining] }; // a cycle
    remaining.delete(pick);
    placed.add(pick);
    out.push(pick);
  }
  return { order: out, stuck: [] };
}

/** Layers of atoms that depend on nothing outside the layers before them. */
function byDepth(live, needsOf) {
  const depth = new Map();
  const settle = (id, seen = new Set()) => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const deps = needsOf(id);
    const d = deps.length ? 1 + Math.max(...deps.map((k) => settle(k, seen))) : 0;
    depth.set(id, d);
    return d;
  };
  live.forEach((k) => settle(k.id));

  const layers = new Map();
  for (const k of live) {
    const d = depth.get(k.id);
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d).push(k.id);
  }

  return [...layers.keys()].sort((a, b) => a - b).map((d) => ({
    title: `Step ${d + 1}`,
    summary: '',
    kcs: layers.get(d),
  }));
}

export function pack(spec, { known = new Set(), budget = 3, spine } = {}) {
  const problems = [];
  const shape = spine || spec.spine || 'concept';

  // 1. Everything already held drops out, and stops being a prerequisite.
  const live = spec.kcs.filter((k) => !known.has(k.id));
  const liveIds = new Set(live.map((k) => k.id));
  const byKc = new Map(live.map((k) => [k.id, k]));
  const needsOf = (id) => (byKc.get(id)?.requires || []).filter((d) => !known.has(d));

  // 2. Clusters are the proposed grouping; fall back to each atom's own label.
  const declared = spec.clusters?.length
    ? spec.clusters
    : [...new Map(spec.kcs.map((k) => [k.cluster || k.id, null])).keys()].map((title) => ({
        title,
        summary: '',
        kcs: spec.kcs.filter((k) => (k.cluster || k.id) === title).map((k) => k.id),
      }));

  const groups = declared
    .map((c) => ({ ...c, kcs: c.kcs.filter((id) => liveIds.has(id)) }))
    .filter((c) => c.kcs.length);

  // 3. Order the clusters. A cluster follows any cluster teaching what it needs.
  const clusterOf = new Map();
  groups.forEach((c) => c.kcs.forEach((id) => clusterOf.set(id, c.title)));

  const clusterDeps = new Map(
    groups.map((c) => [
      c.title,
      [...new Set(c.kcs.flatMap((id) => needsOf(id).map((d) => clusterOf.get(d))))]
        .filter((t) => t && t !== c.title),
    ]),
  );

  const titles = groups.map((c) => c.title);
  const ordered = orderStably(titles, (t) => clusterDeps.get(t) || []);

  // The grouping is a hint; the prerequisites are the fact. Clusters that wait
  // on each other cannot be laid out in any order that a learner could walk, so
  // when that happens the grouping is discarded and the atoms are regrouped by
  // how deep they sit in the prerequisite graph. A worse-titled world beats one
  // with no way into it.
  let sequence;
  if (ordered.stuck.length) {
    problems.push(`clusters depend on each other in a circle: ${ordered.stuck.join(', ')} — regrouped by prerequisite depth`);
    sequence = byDepth(live, needsOf);
  } else {
    sequence = ordered.order.map((t) => groups.find((c) => c.title === t));
  }

  // 4. Split any cluster that carries more than a platform may introduce.
  const nodes = [];
  for (const group of sequence) {
    const within = orderStably(group.kcs, (id) => needsOf(id).filter((d) => group.kcs.includes(d)));
    const inOrder = [...within.order, ...within.stuck];

    for (let i = 0; i < inOrder.length; i += budget) {
      const teaches = inOrder.slice(i, i + budget);
      const part = inOrder.length > budget ? ` (${Math.floor(i / budget) + 1})` : '';
      nodes.push(buildNode(nodes.length + 1, group, teaches, part, byKc, needsOf));
    }
  }

  // 4b. 4C/ID: across a task spine the support falls away, so the last whole
  //     task is performed unaided. A concept spine has no such progression.
  if (shape === 'task') {
    nodes.forEach((n, i) => {
      const third = i / Math.max(1, nodes.length - 1);
      const scaffold = third < 0.34 ? 'full' : third < 0.99 ? 'partial' : 'none';
      n.segments = n.segments.map((s) => (s.kind === 'apply' ? { ...s, scaffold } : s));
    });
  }

  // 5. Edges are a projection: whoever teaches it points at whoever needs it.
  const teacherOf = new Map();
  nodes.forEach((n) => n.teaches.forEach((k) => teacherOf.set(k, n.id)));

  const edges = [];
  for (const n of nodes) {
    for (const k of n.requires) {
      const from = teacherOf.get(k);
      if (from && from !== n.id) edges.push({ from, to: n.id, via: k, kind: 'and' });
    }
  }

  // 6. The summit is where the path ends.
  if (nodes.length) nodes[nodes.length - 1].goal = true;

  return { nodes, edges, problems };
}

/** Platform titles are signage. Models return them lower-cased about half the
 *  time, and a valley labelled "compilation process (1)" reads as a stub. */
const asLabel = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/* What to call a platform when its cluster had to be split.
 *
 * "Indian Government Structure (1)" and "(2)" tell a learner nothing about
 * which is which, and she is choosing between them from across a valley. When
 * a cluster is cut, name each piece after what it actually teaches — the atoms
 * are already short statements of one idea, which is exactly the right length
 * for the name of a place. */
function partTitle(group, teaches, byKc) {
  const first = byKc.get(teaches[0])?.label;
  if (!first) return asLabel(group.title);
  const words = String(first).replace(/[.:;]\s*$/, '').split(/\s+/);
  return asLabel(words.slice(0, 7).join(' ') + (words.length > 7 ? '…' : ''));
}

function buildNode(seq, group, teaches, part, byKc, needsOf) {
  const inside = new Set(teaches);
  const requires = [...new Set(teaches.flatMap(needsOf))].filter((d) => !inside.has(d));
  const level = LEVELS[Math.max(...teaches.map((id) => rank(byKc.get(id)?.level)))];

  return {
    id: `p${seq}`,
    title: part ? partTitle(group, teaches, byKc) : asLabel(group.title),
    summary: group.summary || byKc.get(teaches[0])?.label || group.title,
    goal: false,
    objective: { verb: 'understand', level },
    teaches,
    requires,
    segments: [
      { kind: 'activate', recalls: requires },
      { kind: 'demonstrate', workedExample: true },
      { kind: 'apply', scaffold: 'partial' },
    ],
    checks: teaches.map((id) => byKc.get(id).check).filter(Boolean),
  };
}
