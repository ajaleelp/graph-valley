/* Headless verification of the POC's claims. Run: node poc/check.mjs
 *
 * These are the assertions the design stands or falls on. Everything here runs
 * without a DOM, so a regression in the stitcher is caught by the checker
 * rather than by squinting at the renderer.
 */

import { build } from './build.js';
import { GRAPHS, randomGraph } from './graphs.js';
import { findWalk, reachable } from './nav.js';
import { plan, at, duration, traveller, HEIGHT, HALF } from './walk.js';
import { OPP, DELTA, socketPos, HEADROOM, AXIS, SLAB, INSET } from './slices.js';
import { order as frontOf } from './iso.js';

let pass = 0, fail = 0;
const failures = [];

function check(label, ok, detail = '') {
  if (ok) { pass++; return true; }
  fail++;
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}

function verify(name, graph) {
  const w = build(graph);

  // 1. The stitcher found nothing wrong: no orphan sockets, no height
  //    mismatches at any seam, no two slices in one cell.
  check(`${name}: builds clean`, w.problems.length === 0, w.problems.slice(0, 3).join('; '));

  // 2. Vocabulary: only the four templates are ever instantiated.
  const kinds = new Set(w.slices.map((s) => s.kind));
  check(`${name}: four templates only`,
    [...kinds].every((k) => ['court', 'straight', 'corner', 'crossing'].includes(k)), [...kinds].join(','));

  // 3. Seam invariant, re-derived independently of build(): every open socket
  //    faces an open socket at exactly the same height.
  const byCell = new Map();
  for (const s of w.slices) for (const c of s.cells) byCell.set(`${c.u},${c.v}`, s);
  let seamsOk = true, seamDetail = '';
  for (const s of w.slices) {
    for (const { u, v, side, z } of s.sockets) {
      const [du, dv] = DELTA[side];
      const n = byCell.get(`${u + du},${v + dv}`);
      const mate = n && n.sockets.find((k) => k.side === OPP[side] && k.u === u + du && k.v === v + dv);
      if (!mate || Math.abs(mate.z - z) > 1e-9) {
        seamsOk = false;
        seamDetail = `${s.id} ${side} @${z}`;
        break;
      }
      // and the two slices genuinely put a nav node at that shared point
      const p = socketPos(u, v, side, z);
      const key = `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
      if (!w.nav.pos.has(key)) { seamsOk = false; seamDetail = `no nav node at ${s.id} ${side}`; break; }
    }
  }
  check(`${name}: every seam flush`, seamsOk, seamDetail);

  // 4. Walkability: every court reachable from the first root, through the nav
  //    graph alone. This is the load-bearing one — it is only true if the
  //    geometry actually stitched.
  const start = w.courts.find((c) => c.depth === 0);
  const seen = reachable(w.nav, start.navKey);
  const unreachable = w.courts.filter((c) => !seen.has(c.navKey)).map((c) => c.id);
  check(`${name}: all ${w.courts.length} courts walkable`, unreachable.length === 0, unreachable.join(','));

  // ...and a concrete walk exists to the summit, not just set membership.
  const goal = w.courts.reduce((a, b) => (b.depth > a.depth ? b : a));
  const walk = findWalk(w.nav, start.navKey, goal.navKey);
  check(`${name}: a walk to the summit`, walk && walk.length > 1, walk ? '' : 'no path');

  // 5. Monotone climb: a route from a prerequisite to what it enables only ever
  //    goes up. You never descend to reach something that depends on you.
  let mono = true, monoDetail = '';
  for (const r of w.graph.routes) {
    const a = w.graph.byId.get(r.from), b = w.graph.byId.get(r.to);
    let z = a.z;
    for (const c of r.cells) {
      if (c.z0 !== z || c.z1 < c.z0) { mono = false; monoDetail = `${r.from}->${r.to}`; break; }
      z = c.z1;
    }
    if (mono && Math.abs(z - b.z) > 1e-9) { mono = false; monoDetail = `${r.from}->${r.to} ends ${z} not ${b.z}`; }
    if (!mono) break;
  }
  check(`${name}: routes climb, never descend`, mono, monoDetail);

  // 6. Crossings pass, they do not join. Both that there is headroom to walk
  //    under, and that the nav graph keeps the two paths apart — a crossing
  //    that accidentally connected them would be a shortcut through thin air.
  let crossOk = true, crossDetail = '';
  for (const s of w.slices.filter((q) => q.kind === 'crossing')) {
    const byAxis = { x: [], y: [] };
    for (const k of s.sockets) byAxis[AXIS[k.side]].push(k.z);
    const zx = byAxis.x[0], zy = byAxis.y[0];
    if (byAxis.x.length !== 2 || byAxis.y.length !== 2) { crossOk = false; crossDetail = `${s.id} is not two paths`; break; }
    // and she has to fit underneath it, not merely miss it
    if (Math.abs(zx - zy) - SLAB < HEIGHT) {
      crossOk = false;
      crossDetail = `${s.id} headroom ${(Math.abs(zx - zy) - SLAB).toFixed(2)} < traveller ${HEIGHT}`;
      break;
    }
    const kx = navKeyOf(socketPos(s.u, s.v, byAxis.x === byAxis.x ? '-x' : '-x', zx));
    const ky = navKeyOf(socketPos(s.u, s.v, '-y', zy));
    if (w.nav.adj.get(kx) && w.nav.adj.get(kx).has(ky)) { crossOk = false; crossDetail = `${s.id} joins its two paths`; break; }
  }
  check(`${name}: crossings clear and stay separate`, crossOk, crossDetail);

  // 7. No teleports. Nav nodes merge by coordinate, which is exactly what
  //    stitches two slices together — but it also means a coordinate collision
  //    between slices that are NOT neighbours would silently weld two distant
  //    parts of the world together and let the traveller step across the map.
  //    Every shared node must be one slice's own, or a socket between two
  //    orthogonally adjacent cells.
  const declaredBy = new Map();
  for (const s of w.slices) {
    for (const { p } of s.nav.nodes) {
      const k = navKeyOf(p);
      if (!declaredBy.has(k)) declaredBy.set(k, []);
      if (!declaredBy.get(k).includes(s)) declaredBy.get(k).push(s);
    }
  }
  let weld = null;
  for (const [k, owners] of declaredBy) {
    if (owners.length === 1) continue;
    if (owners.length > 2) { weld = `${k} claimed by ${owners.length} slices`; break; }
    const [a, b] = owners;
    const touching = a.cells.some((ca) => b.cells.some((cb) =>
      Math.abs(ca.u - cb.u) + Math.abs(ca.v - cb.v) === 1));
    if (!touching) { weld = `${a.id} and ${b.id} share ${k} but are not neighbours`; break; }
  }
  check(`${name}: no welded-together nav nodes`, !weld, weld || '');

  // 8. The motion itself, not just the destination: constant speed, exact
  //    endpoints, and no frame that jumps further than the shortest hop — which
  //    is what "moving cleanly" actually means.
  if (walk && walk.length > 1) {
    const pl = plan(walk);
    const frames = Math.max(1, Math.round(duration(pl.total) / 16.67));
    let jump = 0, prev = at(pl, 0), regress = 0;
    for (let f = 1; f <= frames; f++) {
      const q = at(pl, f / frames);
      const d = Math.hypot(q.x - prev.x, q.y - prev.y, q.z - prev.z);
      if (d > jump) jump = d;
      if (d < -1e-9) regress++;
      prev = q;
    }
    const ends = at(pl, 0), endz = at(pl, 1);
    check(`${name}: walk starts and ends exactly`,
      ends.x === walk[0].x && ends.z === walk[0].z
      && endz.x === walk[walk.length - 1].x && endz.z === walk[walk.length - 1].z);

    // She must never leave the polyline. Passing several nav nodes inside one
    // frame is fine — cutting a corner through open air is not.
    let strayed = 0;
    for (let f = 0; f <= frames; f++) {
      const q = at(pl, f / frames);
      let best = Infinity;
      for (let i = 1; i < walk.length; i++) best = Math.min(best, distToSegment(q, walk[i - 1], walk[i]));
      if (best > 1e-6) strayed++;
    }
    check(`${name}: never leaves the path`, strayed === 0, `${strayed} frames off it`);

    // A comfort bound rather than a correctness one: at 60fps a step this size
    // is about 36px on screen at full zoom.
    check(`${name}: no visible jump`, jump <= 1.5, `${jump.toFixed(3)} units in one frame`);
    check(`${name}: walk never goes backwards`, regress === 0, `${regress} frames`);
  }

  // 9. The traveller can be placed EXACTLY, everywhere she can stand.
  //
  //    The depth sort separates two boxes only when one lies entirely on the
  //    near side of the other along some axis. Where it cannot, the draw order
  //    falls back to an approximate key — which is how she came to sink into a
  //    flight of steps: the whole flight was one group, and it contained her.
  //    Every walkable position must leave her orderable against every group.
  let sunk = null, sunkAt = 0;
  for (const [, p] of w.nav.pos) {
    const her = traveller(p);
    const bad = w.groups.find((g) => frontOf(her, g) === 0);
    if (bad) {
      sunkAt++;
      if (!sunk) sunk = `at ${p.x},${p.y},${p.z} vs ${bad.slice || bad.kind}:${bad.part ?? ''} ${bad.id || ''}`;
    }
  }
  check(`${name}: traveller sortable everywhere`, !sunk, `${sunkAt} spot(s), e.g. ${sunk}`);

  // ...and the geometry has to leave room for her in the first place.
  check(`${name}: architecture clears the traveller`, HALF < INSET, `${HALF} >= ${INSET}`);

  return w;
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const L = dx * dx + dy * dy + dz * dz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / L)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t), p.z - (a.z + dz * t));
}

const navKeyOf = (p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;

console.log('--- authored graphs ---');
for (const [key, g] of Object.entries(GRAPHS)) {
  const w = verify(key, g);
  console.log(
    `  ${key.padEnd(10)} ${String(w.stats.courts).padStart(2)} courts  ` +
    `${String(w.stats.straights).padStart(2)} straights  ${String(w.stats.corners).padStart(2)} corners  ` +
    `${String(w.stats.crossings).padStart(2)} crossings  ` +
    `${String(w.stats.seams).padStart(3)} seams  ${String(w.stats.navNodes).padStart(3)} nav nodes  ` +
    `${String(w.stats.shapes).padStart(4)} shapes`,
  );
}

console.log('\n--- 200 random DAGs ---');
let worstProblems = null;
for (let seed = 1; seed <= 200; seed++) {
  const g = randomGraph(seed, 4 + (seed % 9));
  const w = verify(`random#${seed}`, g);
  if (w.problems.length && !worstProblems) worstProblems = { seed, problems: w.problems };
}
if (worstProblems) console.log(`  first failure: seed ${worstProblems.seed}: ${worstProblems.problems.join('; ')}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nfailures:');
  for (const f of failures.slice(0, 20)) console.log('  ' + f);
  process.exit(1);
}
