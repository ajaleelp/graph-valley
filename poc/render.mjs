/* Render a world to a standalone SVG file, with no browser involved.
 *
 *   node poc/render.mjs [graph] [out.svg]
 *
 * Useful for eyeballing geometry deterministically, and for putting a picture
 * of a world in front of someone without asking them to run a server.
 */

import { writeFile } from 'node:fs/promises';
import { build } from './build.js';
import { GRAPHS } from './graphs.js';
import { P, depthSort } from './iso.js';
import { traveller } from './walk.js';
import { CELL } from './slices.js';

const PALETTE = {
  bg: '#eae4da', ink: '#4a4034',
  's-t': '#f2ece2', 's-l': '#d8cdbe', 's-r': '#c0b3a2',
  't-t': '#fbf6ed', 't-l': '#e3d8c9', 't-r': '#cdc0af',
  'n-t': '#b5a897', 'n-l': '#9a8d7c', 'n-r': '#82766a',
  'a-t': '#f0a35e', 'a-l': '#d98b47', 'a-r': '#bd7434',
  'body-t': '#3a8580', 'body-l': '#2f6f6b', 'body-r': '#255a57',
  'head-t': '#f5e2c8', 'head-l': '#e2ccae', 'head-r': '#cbb193',
  'brim-t': '#d4623f', 'brim-l': '#b95034', 'brim-r': '#9c4029',
};

export function toSVG(world, { labels = true, nav = false, at = null, pad = 60 } = {}) {
  const b = world.bounds;
  const W = b.x1 - b.x0 + pad * 2, H = b.y1 - b.y0 + pad * 2;
  const FONT = Math.max(15, Math.round(W / 90));
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W)}" height="${Math.round(H)}" viewBox="${b.x0 - pad} ${b.y0 - pad} ${W} ${H}">`);
  out.push(`<rect x="${b.x0 - pad}" y="${b.y0 - pad}" width="${W}" height="${H}" fill="${PALETTE.bg}"/>`);
  out.push('<style>' + Object.entries(PALETTE).filter(([k]) => k.includes('-'))
    .map(([k, v]) => `.${k}{fill:${v}}`).join('') +
    `text{font:600 ${FONT}px ui-sans-serif,system-ui,sans-serif;fill:${PALETTE.ink}}` +
    '.nav line{stroke:#2f6f6b;stroke-width:2;opacity:.5}.nav circle{fill:#2f6f6b;opacity:.8}' +
    '</style>');

  const extra = at ? [traveller(at)] : [];
  for (const g of depthSort(world.groups.concat(extra))) {
    for (const s of g.shapes) {
      if (s.cls.startsWith('shadow')) {
        if (s.cls === 'shadow-t') out.push(`<polygon points="${s.pts}" fill="#6b5c48" opacity="0.16"/>`);
        continue;
      }
      out.push(`<polygon class="${s.cls}" points="${s.pts}"/>`);
    }
  }

  if (nav) {
    out.push('<g class="nav">');
    const seen = new Set();
    for (const [k, adj] of world.nav.adj) {
      const a = world.nav.pos.get(k), pa = P(a.x, a.y, a.z);
      for (const j of adj) {
        const key = k < j ? `${k}|${j}` : `${j}|${k}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const q = world.nav.pos.get(j), pb = P(q.x, q.y, q.z);
        out.push(`<line x1="${pa.x.toFixed(1)}" y1="${pa.y.toFixed(1)}" x2="${pb.x.toFixed(1)}" y2="${pb.y.toFixed(1)}"/>`);
      }
      out.push(`<circle cx="${pa.x.toFixed(1)}" cy="${pa.y.toFixed(1)}" r="3"/>`);
    }
    out.push('</g>');
  }

  if (labels) {
    for (const c of world.courts) {
      const p = P(c.stand.x, c.stand.y + c.span * (CELL / 2), c.stand.z);
      const text = c.title || c.id;
      const w = text.length * FONT * 0.56 + FONT;
      out.push(`<g><rect x="${(p.x - w / 2).toFixed(1)}" y="${(p.y + 6).toFixed(1)}" width="${w.toFixed(1)}" height="${FONT * 1.5}" rx="5" fill="#fdfaf4" stroke="#ddd2c2"/>` +
        `<text x="${p.x.toFixed(1)}" y="${(p.y + 6 + FONT * 1.1).toFixed(1)}" text-anchor="middle">${text}</text></g>`);
    }
  }

  out.push('</svg>');
  return out.join('\n');
}

const [, , key = 'diamond', file = `poc-${key}.svg`] = process.argv;
if (!GRAPHS[key]) {
  console.error(`unknown graph "${key}". try: ${Object.keys(GRAPHS).join(', ')}`);
  process.exit(1);
}
const world = build(GRAPHS[key]);
if (world.problems.length) console.error('problems:\n  ' + world.problems.join('\n  '));
// --at <courtId> stands the traveller on that platform, sorted into the scene
// exactly as the viewer would place her.
const ai = process.argv.indexOf('--at');
const where = ai > 0 ? world.courts.find((c) => c.id === process.argv[ai + 1]) : null;
await writeFile(file, toSVG(world, {
  labels: true,
  nav: process.argv.includes('--nav'),
  at: where ? where.stand : null,
}));
console.log(`${file}  ${world.stats.courts} courts, ${world.stats.straights + world.stats.corners + world.stats.crossings} link slices, ${world.stats.shapes} polygons`);
