/* Flatten a syllabus down to the graph the renderers already consume.
 *
 * `public/` and `poc/` both read `{ id, title, summary, deps, goal }` and
 * nothing more. Keeping this projection means the curriculum work and the
 * renderer rebuild stay independent: neither renderer changes a line, and the
 * richer document is there the moment either is ready to use it.
 */

/* The journey's headline.
 *
 * The negotiate schema shows the goal as "she will be able to ...", and models
 * copy that phrasing straight into the statement — which then reads back to the
 * learner as the name of their own journey. Strip the scaffolding and the
 * trailing full stop; fall back to the topic when there is no goal at all.
 */
export function titleFor(doc) {
  const raw = String(doc.goal?.statement || '').trim();
  if (!raw) {
    const t = String(doc.topic || 'A journey').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const stripped = raw
    .replace(/^(?:the learner|she|he|they|you)\s+(?:will|should|can)\s+be able to\s+/i, '')
    .replace(/^(?:will|should|can)\s+be able to\s+/i, '')
    .replace(/\s*\.\s*$/, '')
    .trim();
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export function toGraph(doc) {
  const deps = new Map(doc.nodes.map((n) => [n.id, new Set()]));
  for (const e of doc.edges) deps.get(e.to)?.add(e.from);

  return {
    title: titleFor(doc),
    nodes: doc.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      summary: n.summary,
      deps: [...(deps.get(n.id) || [])],
      goal: !!n.goal,
    })),
  };
}
