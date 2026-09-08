/* Graph -> coarse-grid layout and orthogonal routing.
 *
 * This is the step that decides WHERE things go. It knows nothing about
 * geometry: it emits cell assignments and routes, and build.js turns those into
 * slices. Keeping the two apart is what lets check.mjs test the layout without
 * a renderer.
 *
 * Depth becomes the floor. A node at depth d sits at coarse column u = d*COL
 * and world height z = d*FLOOR, so prerequisites are literally lower and
 * behind. The spacing is load-bearing: it has to leave at least two free
 * columns between layers, because that is where the stairs and the lateral
 * dodges live.
 */

import { FLOOR, OPP, AXIS, HEADROOM, sideBetween, courtSockets } from './slices.js';

const ck = (c) => `${c.u},${c.v}`;
const NEIGHBOURS = [['+x', 1, 0], ['-x', -1, 0], ['+y', 0, 1], ['-y', 0, -1]];
const HUG = 40;   // cost of routing through a cell that touches someone else's court
export const GAP = 2;  // free coarse cells between courts, over and above their span

/* ------------------------------------------------------------- structure -- */

export function depths(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map();
  const walk = (id, seen = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return 0;                       // a cycle: treat as a root
    seen.add(id);
    const deps = (byId.get(id).deps || []).filter((d) => byId.has(d));
    const d = deps.length ? 1 + Math.max(...deps.map((x) => walk(x, seen))) : 0;
    memo.set(id, d);
    return d;
  };
  for (const n of nodes) n.depth = walk(n.id);
  return nodes;
}

/* A DAG usually states a prerequisite twice — "you need A" and "you need B,
 * which needs A". Building stone for both lays a redundant second walkway
 * beside a route that already exists, so only edges with no alternative path
 * get built. Unlocking would still use the full dependency set. */
export function transitiveReduction(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map(nodes.map((n) => [n.id, []]));
  for (const n of nodes) for (const d of n.deps || []) if (kids.has(d)) kids.get(d).push(n.id);

  const reachableWithout = (from, to) => {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      const u = stack.pop();
      for (const v of kids.get(u) || []) {
        if (u === from && v === to) continue;         // ignore the edge under test
        if (seen.has(v)) continue;
        if (v === to) return true;
        seen.add(v);
        stack.push(v);
      }
    }
    return false;
  };

  const out = [];
  for (const n of nodes) {
    for (const d of n.deps || []) {
      if (!byId.has(d)) continue;
      if (!reachableWithout(d, n.id)) out.push([d, n.id]);
    }
  }
  return out;
}

/* ---------------------------------------------------------------- cells --- */

/* Every court occupies a 2x2 block of cells.
 *
 * A 1x1 court has four sockets and so can carry at most four paths, which a hub
 * concept — five prerequisites, or four things that build on it — overruns. 2x2
 * has eight, and it fixes the proportions besides: at this spacing a 1x1 court
 * was a quarter the length of the walkway leading to it, so the world read as
 * corridors with occasional platforms rather than places with paths between.
 *
 * Nothing about the contract changes. A socket is still identified by (cell,
 * side), and the stitcher never learns how big the slice behind it is. */
export function assignSpans(nodes) {
  for (const n of nodes) n.span = 2;
  return 2;
}

/* Order the nodes within each layer.
 *
 * The lane a node gets decides how far its links have to travel, and long links
 * are what clog the grid — every cell a route passes through is a cell no other
 * route may use. So this is not cosmetics: it is the difference between a world
 * that routes and one that does not.
 *
 * The method is the standard one for layered graph drawing: sweep down ordering
 * each layer by the mean lane of its parents, sweep up ordering by the mean
 * lane of its children, repeat, and keep whichever sweep scored best. A single
 * downward pass cannot see that two siblings should swap because of where their
 * CHILDREN sit, which is exactly the case that used to wedge the router. */
function centred(i, n) { return i - Math.floor((n - 1) / 2); }

function orderLayers(nodes, reduced, maxDepth) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parents = new Map(nodes.map((n) => [n.id, []]));
  const children = new Map(nodes.map((n) => [n.id, []]));
  for (const [a, b] of reduced) { children.get(a).push(b); parents.get(b).push(a); }

  const layers = Array.from({ length: maxDepth + 1 }, () => []);
  for (const n of nodes) layers[n.depth].push(n);
  for (const l of layers) l.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

  const pos = new Map();
  const reindex = () => {
    for (const l of layers) l.forEach((n, i) => pos.set(n.id, centred(i, l.length)));
  };
  reindex();

  // Total link length, in lanes. Minimising it minimises the number of cells
  // routes have to reserve, which is the resource they compete for.
  const cost = () => reduced.reduce((s, [a, b]) => s + Math.abs(pos.get(a) - pos.get(b)), 0);

  const sortBy = (layer, rel) => {
    const bary = (n) => {
      const ns = rel.get(n.id);
      return ns.length ? ns.reduce((s, x) => s + pos.get(x), 0) / ns.length : pos.get(n.id);
    };
    const keyed = layer.map((n) => [bary(n), n]);
    keyed.sort((x, y) => x[0] - y[0] || String(x[1].id).localeCompare(String(y[1].id), undefined, { numeric: true }));
    return keyed.map((k) => k[1]);
  };

  let best = layers.map((l) => l.slice());
  let bestCost = cost();
  for (let sweep = 0; sweep < 8; sweep++) {
    if (sweep % 2 === 0) for (let d = 1; d <= maxDepth; d++) layers[d] = sortBy(layers[d], parents);
    else for (let d = maxDepth - 1; d >= 0; d--) layers[d] = sortBy(layers[d], children);
    reindex();
    const c = cost();
    if (c < bestCost) { bestCost = c; best = layers.map((l) => l.slice()); }
  }
  return best;
}

/* Place each node on the coarse grid, once the lanes are settled. */
export function placeNodes(nodes, reduced, maxDepth, step) {
  const layers = orderLayers(nodes, reduced, maxDepth);
  layers.forEach((layer, d) => {
    layer.forEach((n, i) => {
      const cell = { u: d * step, v: centred(i, layer.length) * step };
      n.cell = cell;
      n.z = d * FLOOR;
      n.cells = [];
      for (let du = 0; du < n.span; du++) for (let dv = 0; dv < n.span; dv++) n.cells.push({ u: cell.u + du, v: cell.v + dv });
      n.socketSlots = courtSockets(cell.u, cell.v, n.span);
    });
  });
  return maxDepth;
}

/* --------------------------------------------------------------- routing -- */

/* Shortest orthogonal route from one court's footprint to another's, with a
 * turn penalty so runs stay straight — straight cells are where stairs can go,
 * and a route that wanders is a route that cannot carry a flight of steps.
 *
 * `crossable` names cells already carrying a level walkway that this route is
 * allowed to pass over. Crossing is only legal straight through, perpendicular
 * to the path below, and costs enough that it stays a last resort.
 * Returns the intermediate cells only. */
export function routeCells(fromCells, toCells, blocked, bounds, nearCourt = null, hug = 0, crossable = null) {
  const fromSet = new Set(fromCells.map(ck));
  const toSet = new Set(toCells.map(ck));
  const inside = (u, v) => u >= bounds.u0 && u <= bounds.u1 && v >= bounds.v0 && v <= bounds.v1;
  const crossAxis = (u, v) => (crossable ? (crossable.get(`${u},${v}`) || {}).axis : undefined);
  const free = (u, v, axis) => {
    if (!inside(u, v) || fromSet.has(`${u},${v}`)) return false;
    const k = `${u},${v}`;
    if (!blocked.has(k) || toSet.has(k)) return true;
    const ca = crossAxis(u, v);
    return ca !== undefined && ca !== axis;         // may pass over, perpendicular only
  };

  const STEP = 10, TURN = 7, CROSS = 55;
  const hugCost = (u, v) => (hug && nearCourt && nearCourt.has(`${u},${v}`)
    && !fromSet.has(`${u},${v}`) && !toSet.has(`${u},${v}`) ? hug : 0);
  const enter = (u, v) => STEP + hugCost(u, v) + (crossAxis(u, v) !== undefined && blocked.has(`${u},${v}`) ? CROSS : 0);

  const dist = new Map(), prev = new Map(), open = [];
  for (const c of fromCells) {
    for (const [side, du, dv] of NEIGHBOURS) {
      const u = c.u + du, v = c.v + dv;
      if (!free(u, v, AXIS[side])) continue;
      const k = `${u},${v},${side}`;
      if (dist.has(k)) continue;
      dist.set(k, enter(u, v)); prev.set(k, null); open.push(k);
    }
  }

  let goal = null;
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist.get(open[i]) < dist.get(open[bi])) bi = i;
    const k = open.splice(bi, 1)[0];
    const [us, vs, side] = k.split(',');
    const u = +us, v = +vs;
    if (toSet.has(`${u},${v}`)) { goal = k; break; }
    // A cell we are only passing OVER must be left the way we entered it: the
    // path below owns the other axis.
    const bridging = blocked.has(`${u},${v}`) && crossAxis(u, v) !== undefined;
    for (const [s2, du, dv] of NEIGHBOURS) {
      if (s2 === OPP[side]) continue;                // never double back
      if (bridging && s2 !== side) continue;
      const nu = u + du, nv = v + dv;
      if (!free(nu, nv, AXIS[s2])) continue;
      const nk = `${nu},${nv},${s2}`;
      const nd = dist.get(k) + enter(nu, nv) + (s2 === side ? 0 : TURN);
      if (dist.has(nk) && dist.get(nk) <= nd) continue;
      dist.set(nk, nd); prev.set(nk, k);
      if (!open.includes(nk)) open.push(nk);
    }
  }
  if (!goal) return null;

  const cells = [];
  for (let k = goal; k !== null; k = prev.get(k)) {
    const [us, vs] = k.split(',');
    cells.unshift({ u: +us, v: +vs });
  }
  const end = cells.pop();                           // the destination court cell
  if (!cells.length) return null;                    // adjacent courts: no room for stairs
  const start = fromCells.find((c) => Math.abs(c.u - cells[0].u) + Math.abs(c.v - cells[0].v) === 1);
  return { cells, entry: sideBetween(start, cells[0]), exit: sideBetween(end, cells[cells.length - 1]) };
}

/* --------------------------------------------------------------- assembly -- */

/* All ways to choose k of n indices, capped so a long route cannot blow up. */
function choose(items, k, cap = 400) {
  const out = [];
  const walk = (i, acc) => {
    if (out.length >= cap) return;
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let j = i; j < items.length; j++) { acc.push(items[j]); walk(j + 1, acc); acc.pop(); }
  };
  walk(0, []);
  return out;
}

/* Turn a routed edge into a list of slice specs. Each intermediate cell learns
 * which sides it enters and leaves by, which decides straight vs corner; then
 * the climb is handed out — one flight per floor gained.
 *
 * Where the route passes over another, the flights also have to be placed so
 * the two paths clear each other, so this searches placements rather than just
 * spreading them: `crossAt` maps a cell index to the height of the path below. */
export function planRoute(from, to, cells, entryFrom, exitFrom, crossAt = new Map()) {
  const chain = [entryFrom, ...cells, exitFrom];
  const plan = cells.map((c, i) => {
    const entry = sideBetween(c, chain[i]);
    const exit = sideBetween(c, chain[i + 2]);
    return { u: c.u, v: c.v, from: entry, to: exit, straight: OPP[entry] === exit };
  });

  const need = to.depth - from.depth;
  const dir = Math.sign(need) || 1;
  // A crossing cell has to be level: you cannot bridge over something on a
  // flight of steps and stay flush at both edges.
  const usable = (i) => !crossAt.has(i);
  const straights = plan.map((p, i) => i).filter((i) => plan[i].straight && usable(i));
  const corners = plan.map((p, i) => i).filter((i) => !plan[i].straight && usable(i));
  const pool = straights.concat(corners);

  const heights = (stairs) => {
    let z = from.z;
    return plan.map((p, i) => {
      const z0 = z;
      const z1 = stairs.has(i) ? z + FLOOR * dir : z;
      z = z1;
      return { z0, z1 };
    });
  };
  const clears = (hs) => {
    let worst = Infinity;
    for (const [i, other] of crossAt) worst = Math.min(worst, Math.abs(hs[i].z0 - other));
    return worst;
  };
  // Flights spread evenly through the route read best; that is the tie-break,
  // not the requirement.
  const ideal = (k) => Math.round(((k + 0.5) / Math.max(1, need)) * (pool.length - 1));
  const spread = (combo) => combo.reduce((s, idx, k) => s + Math.abs(pool.indexOf(idx) - ideal(k)), 0);

  let best = null;
  if (need <= 0 || !pool.length) {
    best = { stairs: new Set(), placed: 0 };
  } else {
    for (const combo of choose(pool, Math.min(need, pool.length))) {
      const stairs = new Set(combo);
      const c = clears(heights(stairs));
      if (c < HEADROOM) continue;
      const score = spread(combo);
      if (!best || score < best.score) best = { stairs, placed: stairs.size, score };
    }
    // Nothing satisfied the crossings: fall back to an even spread and let the
    // caller report the clearance failure rather than silently building it.
    if (!best) {
      const stairs = new Set(choose(pool, Math.min(need, pool.length))[0] || []);
      best = { stairs, placed: stairs.size };
    }
  }

  const hs = heights(best.stairs);
  plan.forEach((p, i) => { p.z0 = hs[i].z0; p.z1 = hs[i].z1; });
  return { plan, endZ: hs.length ? hs[hs.length - 1].z1 : from.z, need, placed: best.placed, clearance: clears(hs) };
}

/* ------------------------------------------------------------------ main -- */

/* One routing attempt: lay every edge in the given order, reserving cells as we
 * go. Returns which edges could not be laid. */
function attempt(order, byId, bounds, wide, hug, allowCross) {
  const blocked = new Set();
  for (const n of byId.values()) for (const c of n.cells) blocked.add(ck(c));
  const halo = new Set();
  for (const n of byId.values()) {
    for (const c of n.cells) {
      for (const [, du, dv] of NEIGHBOURS) {
        const k = `${c.u + du},${c.v + dv}`;
        if (!blocked.has(k)) halo.add(k);
      }
    }
  }

  const routes = [];
  const failed = [];
  const problems = [];
  const crossings = [];
  // cells carrying a level straight, and therefore available to bridge over
  const crossable = new Map();
  const owner = new Map();                           // cell -> { route, index }

  const lay = (fromId, toId, b) => {
    const a = byId.get(fromId), z = byId.get(toId);
    const r = routeCells(a.cells, z.cells, blocked, b, halo, hug, allowCross ? crossable : null);
    if (!r) return false;

    const crossAt = new Map();
    r.cells.forEach((c, i) => {
      const under = crossable.get(ck(c));
      if (under) crossAt.set(i, under.z);
    });

    const first = r.cells[0], last = r.cells[r.cells.length - 1];
    const entryFrom = a.cells.find((c) => Math.abs(c.u - first.u) + Math.abs(c.v - first.v) === 1);
    const exitFrom = z.cells.find((c) => Math.abs(c.u - last.u) + Math.abs(c.v - last.v) === 1);
    const { plan, endZ, need, placed, clearance } = planRoute(a, z, r.cells, entryFrom, exitFrom, crossAt);
    if (crossAt.size && clearance < HEADROOM) return false;   // no headroom: try another way
    if (placed < need) problems.push(`route ${fromId} -> ${toId} could not place ${need - placed} flight(s)`);
    if (Math.abs(endZ - z.z) > 1e-9) problems.push(`route ${fromId} -> ${toId} ends at z=${endZ}, court is at z=${z.z}`);

    const route = { from: fromId, to: toId, cells: plan, entrySide: r.entry, exitSide: r.exit };
    routes.push(route);
    plan.forEach((p, i) => {
      const k = `${p.u},${p.v}`;
      const under = crossable.get(k);
      if (under) {                                   // this cell becomes a crossing
        const o = owner.get(k);
        o.route.cells[o.index].cross = true;
        p.cross = true;
        crossings.push({
          u: p.u, v: p.v,
          lo: under.z < p.z0 ? { ...under } : { from: p.from, to: p.to, z: p.z0 },
          hi: under.z < p.z0 ? { from: p.from, to: p.to, z: p.z0 } : { ...under },
        });
        crossable.delete(k);                         // one crossing per cell
        return;
      }
      blocked.add(k);
      owner.set(k, { route, index: i });
      if (p.straight && p.z0 === p.z1) crossable.set(k, { axis: AXIS[p.from], z: p.z0, from: p.from, to: p.to });
    });
    return true;
  };

  for (const [f, t] of order) {
    // A route that cannot thread the tight grid gets a second try with the
    // walls pushed out: it takes a longer way round rather than not existing.
    if (!lay(f, t, bounds) && !lay(f, t, wide)) failed.push([f, t]);
  }
  return { routes, failed, problems, crossings };
}

export function layout(graph) {
  const nodes = graph.nodes.map((n) => ({ ...n, deps: (n.deps || []).slice() }));
  depths(nodes);
  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  const reduced = transitiveReduction(nodes);
  const maxSpan = assignSpans(nodes);

  // Two free columns between layers, whatever the widest court is. One is not
  // enough: every route between two layers would have to thread the same
  // column, and routes reserve cells from each other.
  const step = GAP + maxSpan;
  placeNodes(nodes, reduced, maxDepth, step);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const us = nodes.flatMap((n) => n.cells.map((c) => c.u));
  const vs = nodes.flatMap((n) => n.cells.map((c) => c.v));
  const bounds = {
    u0: Math.min(...us) - 2, u1: Math.max(...us) + 2,
    v0: Math.min(...vs) - 3, v1: Math.max(...vs) + 3,
  };
  // Only a little slack. Given more, a blocked route answers with an enormous
  // loop out into the void rather than bridging something in its way.
  const wide = { u0: bounds.u0 - 3, u1: bounds.u1 + 3, v0: bounds.v0 - 3, v1: bounds.v1 + 3 };

  // Short hops first: they lock in tight routes before the long ones start
  // detouring around them.
  const len = (p, q) => Math.abs(p.cell.u - q.cell.u) + Math.abs(p.cell.v - q.cell.v);
  let order = reduced.slice().sort((a, b) =>
    len(byId.get(a[0]), byId.get(a[1])) - len(byId.get(b[0]), byId.get(b[1])));

  /* RIP-UP AND RETRY.
   *
   * Routes reserve whole cells, so a greedy pass can wall off the plane: three
   * early routes ring a court and the fourth has nowhere left to go. Ordering
   * heuristics only make that rarer, never impossible, so borrow the standard
   * answer from PCB autorouting — throw the attempt away, promote the edge that
   * failed to the front of the queue, and lay everything again. */
  let best = attempt(order, byId, bounds, wide, HUG, true);
  for (let pass = 0; pass < 10 && best.failed.length; pass++) {
    const promoted = new Set(best.failed.map(([f, t]) => `${f}>${t}`));
    order = order.slice().sort((a, b) =>
      (promoted.has(`${a[0]}>${a[1]}`) ? 0 : 1) - (promoted.has(`${b[0]}>${b[1]}`) ? 0 : 1));
    const next = attempt(order, byId, bounds, wide, HUG, true);
    if (next.failed.length < best.failed.length) best = next;
    if (!best.failed.length) break;
  }

  const problems = best.problems.slice();
  for (const [f, t] of best.failed) problems.push(`no route ${f} -> ${t}`);

  return {
    nodes, byId, routes: best.routes, crossings: best.crossings,
    maxDepth, step, bounds: wide, problems,
  };
}
