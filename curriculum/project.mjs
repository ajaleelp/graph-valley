/* Flatten a syllabus down to the graph the renderers already consume.
 *
 * `public/` and `poc/` both read `{ id, title, summary, deps, goal }` and
 * nothing more. Keeping this projection means the curriculum work and the
 * renderer rebuild stay independent: neither renderer changes a line, and the
 * richer document is there the moment either is ready to use it.
 */

export function toGraph(doc) {
  const deps = new Map(doc.nodes.map((n) => [n.id, new Set()]));
  for (const e of doc.edges) deps.get(e.to)?.add(e.from);

  return {
    title: doc.goal?.statement || doc.topic || 'A journey',
    nodes: doc.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      summary: n.summary,
      deps: [...(deps.get(n.id) || [])],
      goal: !!n.goal,
    })),
  };
}
