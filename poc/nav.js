/* The walkable graph.
 *
 * Monument Valley's navigation was a node graph laid over the walkable
 * surfaces, authored separately from the visual mesh — not derived from it.
 * Same here: every slice publishes its own handful of nav nodes and edges, with
 * a node sitting exactly at each of its open sockets.
 *
 * Joining is therefore automatic. Two slices that stitch put a nav node at the
 * same 3D point, so keying nodes by their rounded coordinates merges them. The
 * consequence worth stating: the nav graph is connected IF AND ONLY IF the
 * geometry is stitched. Walkability is not a separate thing that has to be kept
 * in sync with the world — it is the same fact, observed from the other side.
 */

const key = (p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;

export function navGraph() {
  return { pos: new Map(), adj: new Map(), tags: new Map() };
}

export function addNode(nav, p, tag) {
  const k = key(p);
  if (!nav.pos.has(k)) {
    nav.pos.set(k, { x: p.x, y: p.y, z: p.z });
    nav.adj.set(k, new Set());
    nav.tags.set(k, new Set());
  }
  if (tag) nav.tags.get(k).add(tag);
  return k;
}

export function addEdge(nav, a, b) {
  const ka = addNode(nav, a), kb = addNode(nav, b);
  if (ka === kb) return ka;
  nav.adj.get(ka).add(kb);
  nav.adj.get(kb).add(ka);
  return ka;
}

/* Shortest walk between two nav nodes, as a list of 3D points. Breadth-first:
 * every edge is one step onto an adjacent surface, so hops are the right cost. */
export function findWalk(nav, from, to) {
  const a = typeof from === 'string' ? from : key(from);
  const b = typeof to === 'string' ? to : key(to);
  if (!nav.adj.has(a) || !nav.adj.has(b)) return null;
  if (a === b) return [nav.pos.get(a)];

  const prev = new Map([[a, null]]);
  const q = [a];
  for (let i = 0; i < q.length; i++) {
    const u = q[i];
    for (const v of nav.adj.get(u)) {
      if (prev.has(v)) continue;
      prev.set(v, u);
      if (v === b) {
        const out = [];
        for (let c = v; c !== null; c = prev.get(c)) out.unshift(nav.pos.get(c));
        return out;
      }
      q.push(v);
    }
  }
  return null;
}

/* Every node reachable from a starting key. */
export function reachable(nav, from) {
  const a = typeof from === 'string' ? from : key(from);
  const seen = new Set([a]);
  const q = [a];
  for (let i = 0; i < q.length; i++) {
    for (const v of nav.adj.get(q[i]) || []) if (!seen.has(v)) { seen.add(v); q.push(v); }
  }
  return seen;
}

export const navKey = key;
