/* Assemble a world: layout -> slices -> geometry + nav graph.
 *
 * DOM-free on purpose, so check.mjs can run the whole pipeline headless and
 * assert the invariants without a renderer.
 */

import { depthSort, sortShapes, boundsOf } from './iso.js';
import { court, straight, corner, crossing, socketPos, OPP, DELTA, FLOOR, CELL } from './slices.js';
import { layout } from './layout.js';
import { navGraph, addNode, addEdge, navKey } from './nav.js';

const FEATURES = ['pillars', 'blocks', 'obelisk', 'drum'];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function build(graph) {
  const L = layout(graph);
  const problems = L.problems.slice();

  // Which sides each court has to open. A court's sockets are derived from the
  // routes that actually arrive, never fixed in advance — that is what lets one
  // template serve as start, waypoint, fork and summit.
  const open = new Map(L.nodes.map((n) => [n.id, []]));
  const seenSocket = new Map(L.nodes.map((n) => [n.id, new Set()]));
  const claim = (id, u, v, side) => {
    const k = `${u},${v},${side}`;
    if (seenSocket.get(id).has(k)) return;
    seenSocket.get(id).add(k);
    open.get(id).push({ u, v, side });
  };
  for (const r of L.routes) {
    const a = L.byId.get(r.from), b = L.byId.get(r.to);
    const first = r.cells[0], last = r.cells[r.cells.length - 1];
    const ac = a.cells.find((c) => Math.abs(c.u - first.u) + Math.abs(c.v - first.v) === 1);
    const bc = b.cells.find((c) => Math.abs(c.u - last.u) + Math.abs(c.v - last.v) === 1);
    claim(r.from, ac.u, ac.v, r.entrySide);
    claim(r.to, bc.u, bc.v, r.exitSide);
  }

  const goalIds = new Set(L.nodes.filter((n) => n.depth === L.maxDepth).map((n) => n.id));
  const slices = [];

  // Deal features round-robin rather than hashing them. A hash on sequential
  // ids clumps — one world came out with five of seven courts identical — and
  // the whole point of giving each concept its own silhouette is that you can
  // tell one platform from another at a glance.
  const middles = L.nodes
    .filter((n) => !goalIds.has(n.id) && n.depth > 0)
    .sort((a, b) => a.depth - b.depth || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  const featureOf = new Map(middles.map((n, i) => [n.id, FEATURES[i % FEATURES.length]]));

  for (const n of L.nodes) {
    const h = hash(n.id + (n.title || ''));
    const sides = open.get(n.id);
    const cap = n.span * 4;
    if (sides.length > cap) problems.push(`court ${n.id} needs ${sides.length} sockets; a ${n.span}x${n.span} court has ${cap}`);
    n.feature = goalIds.has(n.id) ? 'summit' : n.depth === 0 ? 'gate' : featureOf.get(n.id);
    slices.push(court({
      u: n.cell.u, v: n.cell.v, z: n.z, open: sides, span: n.span,
      feature: n.feature, id: n.id, tall: 0.8 + ((h >>> 13) % 50) / 100,
    }));
  }

  for (const r of L.routes) {
    r.cells.forEach((c, i) => {
      if (c.cross) return;                            // emitted once, as a crossing
      const spec = { u: c.u, v: c.v, from: c.from, to: c.to, z0: c.z0, z1: c.z1, id: `${r.from}>${r.to}:${i}` };
      slices.push(c.straight ? straight(spec) : corner(spec));
    });
  }

  // One slice carries both paths where a route bridges another.
  for (const x of L.crossings) slices.push(crossing({ ...x, id: `cross:${x.u},${x.v}` }));

  /* ---- stitch: verify every seam, and join the nav graph through it ------ */

  const byCell = new Map();
  for (const s of slices) {
    for (const c of s.cells) {
      const k = `${c.u},${c.v}`;
      if (byCell.has(k)) problems.push(`two slices claim cell ${k}: ${byCell.get(k).id} and ${s.id}`);
      else byCell.set(k, s);
    }
  }

  // The seam check. Every open socket must face an open socket at exactly the
  // same height; anything else is a step you cannot walk up or a gap you would
  // fall through. This is the invariant the whole design rests on.
  const seams = [];
  for (const s of slices) {
    for (const { u, v, side, z } of s.sockets) {
      const [du, dv] = DELTA[side];
      const n = byCell.get(`${u + du},${v + dv}`);
      if (!n) { problems.push(`${s.id} has an open ${side} socket onto empty space`); continue; }
      const mate = n.sockets.find((k) => k.side === OPP[side] && k.u === u + du && k.v === v + dv);
      if (!mate) { problems.push(`${s.id} opens ${side} onto ${n.id}, which is closed there`); continue; }
      if (Math.abs(mate.z - z) > 1e-9) {
        problems.push(`seam ${s.id}|${n.id} at ${side}: heights ${z} vs ${mate.z}`);
        continue;
      }
      if (du > 0 || dv > 0) seams.push({ a: s.id, b: n.id, side, z, at: socketPos(u, v, side, z) });
    }
  }

  /* ---- nav graph -------------------------------------------------------- */

  const nav = navGraph();
  for (const s of slices) {
    for (const { p, tag } of s.nav.nodes) addNode(nav, p, tag);
    for (const [a, b] of s.nav.edges) addEdge(nav, a, b);
  }
  // Nothing else to do: two stitched slices already put a nav node at the same
  // socket position, so merging by coordinate joined them.

  /* ---- scene ------------------------------------------------------------ */

  // Every walkable surface is a destination, not just the courts. Each link
  // slice stamps a representative nav node onto its groups so the viewer can
  // turn a click on a walkway into a walk to that spot — which is how Monument
  // Valley behaves, and it removes the dead zones where a bridge drawn in front
  // of a platform swallowed the click meant for it.
  for (const s of slices) {
    if (s.kind === 'court' || !s.nav.nodes.length) continue;
    const cx = s.u * CELL + CELL / 2, cy = s.v * CELL + CELL / 2;
    // nearest the cell centre, and where two paths cross, the upper one — that
    // is the surface you can actually see and therefore the one you clicked.
    const pick = s.nav.nodes.map((n) => n.p).sort((a, b) =>
      (Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)) || (b.z - a.z))[0];
    const climbs = s.sockets.length >= 2 && Math.abs(s.sockets[0].z - s.sockets[1].z) > 1e-9;
    const label = s.kind === 'crossing' ? 'the crossing'
      : s.kind === 'corner' ? 'the turn'
      : climbs ? 'the stairs' : 'the walkway';
    for (const g of s.groups) { g.navAt = pick; g.navLabel = label; }
  }

  const groups = slices.flatMap((s) => s.groups);
  for (const g of groups) sortShapes(g);

  const courts = L.nodes.map((n) => {
    const s = slices.find((q) => q.kind === 'court' && q.id === n.id);
    return { ...n, stand: s.stand, navKey: navKey(s.stand), sockets: s.sockets.length };
  });

  return {
    graph: L, slices, groups, nav, courts, problems, seams,
    bounds: boundsOf(groups),
    stats: {
      courts: courts.length,
      straights: slices.filter((s) => s.kind === 'straight').length,
      corners: slices.filter((s) => s.kind === 'corner').length,
      crossings: slices.filter((s) => s.kind === 'crossing').length,
      shapes: groups.reduce((a, g) => a + g.shapes.length, 0),
      navNodes: nav.pos.size,
      seams: seams.length,
    },
  };
}

/* The draw order, recomputed each frame so the traveller can be sorted among
 * the architecture rather than always painted on top of it. */
export function order(world, extra = []) {
  return depthSort(world.groups.concat(extra));
}

export { FLOOR, CELL };
