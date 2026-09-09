/* RISK TEST 2 — a module is a small world. Do small worlds route cleanly and
 * compose on every screen, without needing the fold? */
import { build } from '../../world/build.js';
import { randomGraph } from '../../world/graphs.js';

const V = { desktop: [1440, 810], tablet: [834, 1112], phone: [390, 844] };
const stats = {};
for (const vn of Object.keys(V)) stats[vn] = { n: 0, problems: 0, folded: 0, asp: [], fill: [] };

// module-sized: 3 to 7 platforms
for (let seed = 1; seed <= 150; seed++) {
  const g = randomGraph(seed, 3 + (seed % 5));
  for (const [vn, vp] of Object.entries(V)) {
    const w = build(g, { viewport: vp });
    const s = stats[vn];
    s.n++;
    if (w.problems.length) s.problems++;
    if (w.graph.compose.plan.mode === 'band') s.folded++;
    s.asp.push(w.graph.compose.score.aspect);
    s.fill.push(w.graph.compose.score.fill);
  }
}
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log('150 module-sized worlds (3-7 platforms)\n');
console.log('viewport   routed clean   needed a fold   aspect (med/worst)   fill (med/worst)');
for (const [vn, s] of Object.entries(stats)) {
  console.log(`${vn.padEnd(10)} ${String(s.n - s.problems).padStart(3)}/${s.n}        `
    + `${String(Math.round(100 * s.folded / s.n)).padStart(3)}%            `
    + `${med(s.asp).toFixed(2)} / ${Math.max(...s.asp).toFixed(2)}          `
    + `${med(s.fill).toFixed(2)} / ${Math.min(...s.fill).toFixed(2)}`);
}
