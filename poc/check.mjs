/* Headless verification of the POC's claims. Run: node poc/check.mjs
 *
 * These are the assertions the design stands or falls on. Everything here runs
 * without a DOM, so a regression in the stitcher is caught by the checker
 * rather than by squinting at the renderer.
 */

import { build } from './build.js';
import { GRAPHS, randomGraph } from './graphs.js';
import { findWalk, reachable } from './nav.js';
import { OPP, DELTA, socketPos, HEADROOM, AXIS } from './slices.js';

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
    if (Math.abs(zx - zy) < HEADROOM) { crossOk = false; crossDetail = `${s.id} clearance ${Math.abs(zx - zy)}`; break; }
    const kx = navKeyOf(socketPos(s.u, s.v, byAxis.x === byAxis.x ? '-x' : '-x', zx));
    const ky = navKeyOf(socketPos(s.u, s.v, '-y', zy));
    if (w.nav.adj.get(kx) && w.nav.adj.get(kx).has(ky)) { crossOk = false; crossDetail = `${s.id} joins its two paths`; break; }
  }
  check(`${name}: crossings clear and stay separate`, crossOk, crossDetail);

  return w;
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
