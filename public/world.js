/* Graph Valley — world construction.
 *
 * Turns a learning DAG into one continuous Monument Valley structure:
 * monuments on an integer grid, joined by axis-aligned causeways and
 * staircases that the avatar genuinely walks.
 */

import { P, bx, faceR, faceL, faceT, dome, shade, crenels, colonnade, stairs, deck, depthSort } from './iso.js';

/* Grid metrics. The wide corridor between footprints is what lets a causeway
 * be a real staircase rather than a hairline, and RISE is set above SPAN/2 so
 * that each layer lands higher on screen than the last: the journey reads as
 * a climb toward the summit rather than a row of towers. */
const SPAN = 15;   // cells between successive depth layers, along +x
const LANE = 9;    // cells between siblings inside a layer, along +y
const RISE = 10;   // levels gained per layer — the world visibly climbs
const FOOT = 7;    // nominal monument footprint, in cells
const FOOT_GOAL = 10;
const WALK = 2.6;  // causeway width

const VARIANTS = ['keep', 'twin', 'terrace', 'court', 'spire', 'bridgehouse'];

/* Stable hash so a topic always produces the same world. */
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}

/* ------------------------------- layout -------------------------------- */

export function layout(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const memo = new Map();
  const depth = (id, seen = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const n = byId.get(id);
    const d = n.deps.length ? 1 + Math.max(...n.deps.map((x) => depth(x, seen))) : 0;
    memo.set(id, d);
    return d;
  };

  const layers = new Map();
  for (const n of graph.nodes) {
    n.depth = depth(n.id);
    if (!layers.has(n.depth)) layers.set(n.depth, []);
    layers.get(n.depth).push(n);
  }

  // Keep siblings beside the parent they grew from, so causeways stay short
  // and the whole thing reads as one mass rather than a scatter.
  const laneOf = new Map();
  const maxDepth = Math.max(...layers.keys());
  for (let L = 0; L <= maxDepth; L++) {
    const arr = (layers.get(L) || []).slice();
    arr.sort((a, b) => {
      const pa = a.deps.length ? Math.min(...a.deps.map((d) => laneOf.get(d) ?? 0)) : 0;
      const pb = b.deps.length ? Math.min(...b.deps.map((d) => laneOf.get(d) ?? 0)) : 0;
      return pa - pb || a.id.localeCompare(b.id, undefined, { numeric: true });
    });
    arr.forEach((n, i) => {
      const h = hash(n.id + n.title);
      // vary the footprint so the skyline never falls into a grid rhythm
      const size = n.goal ? FOOT_GOAL : L === 0 ? FOOT + 1 : FOOT - 1 + ((h >>> 3) % 3);
      const lane = i - (arr.length - 1) / 2;
      laneOf.set(n.id, lane);
      n.W = size;
      n.D = size;
      n.gx = L * SPAN;
      n.gy = Math.round(lane * LANE) - (size - FOOT) / 2;
      // siblings sit at slightly different heights, so a layer is a terrace
      // rather than a flat shelf
      n.gz = L * RISE + (arr.length > 1 ? ((h >>> 17) % 5) - 2 : 0);
      n.tall = 0.8 + ((h >>> 5) % 60) / 100;    // per-monument height character
      n.root = 3 + ((h >>> 11) % 8);            // how far its foot reaches into the void
      n.footStyle = (h >>> 23) % 4;
      n.variant = n.goal ? 'temple' : L === 0 ? 'gate' : VARIANTS[h % VARIANTS.length];
      n.cy = n.gy + size / 2;                   // the walking lane runs through the middle
      n.fd = size / 2 - 1;                      // depth of each flank, either side of the lane
    });
  }
  graph.maxDepth = maxDepth;
  graph.minY = Math.min(...graph.nodes.map((n) => n.gy));
  return graph;
}

/* --------------------------- monument archetypes ------------------------ */
/* Every archetype keeps the strip y in (cy - 1, cy + 1) clear below z + 4 so
 * the avatar walks straight through; anything crossing the lane does so as an
 * arch or a bridge overhead. `f1`/`f2` are the two flanks, `FD` their depth. */

/* The mass below the deck. Four different feet, so ten monuments never read
 * as ten identical stalks on a shelf. */
function substructure(g, n) {
  const { gx: x, gy: y, gz: Z, W, D, root, footStyle } = n;
  bx(g, x, y, Z - 4, W, D, 4, 's', 't');                       // the mass under the deck
  if (footStyle === 0) {                                       // one slender root
    bx(g, x + 1, y + 1, Z - 8, W - 2, D - 2, 4, 's');
    bx(g, x + 2.5, y + 2.5, Z - 8 - root, W - 5, D - 5, root, 'n');
  } else if (footStyle === 1) {                                // broad stepped plinth
    bx(g, x + 0.6, y + 0.6, Z - 7, W - 1.2, D - 1.2, 3, 's');
    bx(g, x + 1.8, y + 1.8, Z - 10, W - 3.6, D - 3.6, 3, 's');
    bx(g, x + 2.9, y + 2.9, Z - 10 - root * 0.55, W - 5.8, D - 5.8, root * 0.55, 'n');
  } else if (footStyle === 2) {                                // twin legs
    bx(g, x + 1, y + 1, Z - 7.5, W - 2, D - 2, 3.5, 's');
    bx(g, x + 1.7, y + 1.7, Z - 7.5 - root, 1.7, 1.7, root, 'n');
    bx(g, x + W - 3.4, y + D - 3.4, Z - 7.5 - root * 0.65, 1.7, 1.7, root * 0.65, 'n');
  } else {                                                     // deep tapering spike
    bx(g, x + 1.3, y + 1.3, Z - 9.5, W - 2.6, D - 2.6, 5.5, 's');
    bx(g, x + 2.8, y + 2.8, Z - 9.5 - root * 1.5, W - 5.6, D - 5.6, root * 1.5, 'n');
  }
}

const ARCH = {
  gate(g, n) {
    const { gx: x, gy: y, gz: Z, W, D } = n;
    const FD = n.fd, y2 = y + D - FD, h = 7 * n.tall;
    shade(g, x, y, Z, 2.4, FD); shade(g, x, y2, Z, 2.4, FD);
    bx(g, x, y, Z, 2.4, FD, h); crenels(g, x, y, Z + h, 2.4, FD, 'x');
    bx(g, x, y2, Z, 2.4, FD, h); crenels(g, x, y2, Z + h, 2.4, FD, 'x');
    bx(g, x, y + FD, Z + h, 2.4, D - 2 * FD, 1.1, 's', 'a');    // lintel over the lane
    faceR(g, x + 2.4, y + 0.6, Z + 0.4, y + FD - 0.6, Z + 3.4);
    faceR(g, x + 2.4, y2 + 0.6, Z + 0.4, y2 + FD - 0.6, Z + 3.4);
    bx(g, x + W - 3, y, Z, 3, FD, 2);
    faceT(g, Z + 2, x + W - 3, y, x + W, y + FD, 'a-t');        // garden
    bx(g, x + W - 3.6, y2 + FD - 1.4, Z, 3.6, 1.4, 1.4);
  },

  keep(g, n) {
    const { gx: x, gy: y, gz: Z, W, D } = n;
    const FD = n.fd, y2 = y + D - FD, h = 10 * n.tall;
    shade(g, x, y, Z, 5, FD);
    bx(g, x, y, Z, 3.4, FD, h); crenels(g, x, y, Z + h, 3.4, FD, 'x');
    for (const u of [0.34, 0.58, 0.8]) faceR(g, x + 3.4, y + 0.7, Z + h * u, y + FD - 0.7, Z + h * u + 1.5);
    faceL(g, y + FD, x + 0.7, Z + h * 0.46, x + 2.7, Z + h * 0.62);
    bx(g, x + 3.4, y, Z, 1.6, FD, h * 0.5);                     // buttress
    bx(g, x + W - 3, y2, Z, 3, FD, 3.6);
    faceT(g, Z + 3.6, x + W - 3, y2, x + W, y2 + FD, 'a-t');
    bx(g, x, y2 + FD - 1.5, Z, 3.6, 1.5, 1.4);
  },

  twin(g, n) {
    const { gx: x, gy: y, gz: Z, W, D } = n;
    const FD = n.fd, y2 = y + D - FD, h = 9.5 * n.tall;
    shade(g, x + 0.8, y, Z, 2.4, FD); shade(g, x + 3.8, y2, Z, 2.4, FD);
    bx(g, x + 0.8, y, Z, 2.4, FD, h); crenels(g, x + 0.8, y, Z + h, 2.4, FD, 'x');
    bx(g, x + 3.8, y2, Z, 2.4, FD, h * 0.62); crenels(g, x + 3.8, y2, Z + h * 0.62, 2.4, FD, 'x');
    bx(g, x + 0.9, y, Z + h, 2.2, D, 1, 's', 't');              // high bridge across the lane
    faceR(g, x + 3.2, y + 0.7, Z + h * 0.5, y + FD - 0.7, Z + h * 0.5 + 1.7);
    bx(g, x + 4, y, Z, 2, 2, 1.2);
    faceT(g, Z + 1.2, x + 4, y, x + 6, y + 2, 'a-t');
    bx(g, x, y2 + FD - 1.6, Z, 3, 1.6, 1.5);
  },

  terrace(g, n) {
    const { gx: x, gy: y, gz: Z, W, D } = n;
    const FD = n.fd, y2 = y + D - FD;
    for (let i = 0; i < 3; i++) {                                // stepped garden tiers
      const h = (1.2 + i * 1.3) * n.tall, w = W / 3;
      bx(g, x + i * w, y, Z, w, FD, h);
      faceT(g, Z + h, x + i * w, y, x + (i + 1) * w, y + FD, 'a-t');
    }
    shade(g, x, y2, Z, W, FD);
    colonnade(g, x, y2, Z, W, FD, 4.6 * n.tall, 4);
    faceT(g, Z + 4.6 * n.tall + 0.7, x, y2, x + W, y2 + FD, 'a-t');
  },

  court(g, n) {
    const { gx: x, gy: y, gz: Z, W, D } = n;
    const FD = n.fd, y2 = y + D - FD;
    bx(g, x, y, Z, W, FD, 1.4);                                  // sunken courtyard
    faceT(g, Z + 1.4, x + 0.8, y + 0.6, x + W - 0.8, y + FD - 0.6, 'k-t');
    for (const px of [0, W - 1]) bx(g, x + px, y + 0.3, Z + 1.4, 1, FD - 0.6, 2.6 * n.tall);
    shade(g, x + 1, y2, Z, W - 2.4, FD);
    colonnade(g, x + 1, y2, Z, W - 2.4, FD, 4 * n.tall, 3);      // domed pavilion
    dome(g, x + 1 + (W - 2.4) / 2, y2 + FD / 2, Z + 4 * n.tall + 0.7, 1.35);
    bx(g, x + 0.6 + (W - 2.4) / 2, y2 + FD / 2 - 0.4, Z + 4 * n.tall + 2.1, 0.8, 0.8, 1.3, 'a');
  },

  spire(g, n) {
    const { gx: x, gy: y, gz: Z, W, D } = n;
    const FD = n.fd, y2 = y + D - FD, u = n.tall;
    shade(g, x, y2, Z, W, FD); shade(g, x, y, Z, W, FD);
    bx(g, x, y2, Z, W, FD, 2.4 * u);                             // ziggurat
    bx(g, x + 1.2, y2, Z + 2.4 * u, W - 2.4, FD, 2.4 * u);
    bx(g, x + 2.4, y2 + 0.3, Z + 4.8 * u, W - 4.8, FD - 0.6, 3.4 * u);
    bx(g, x + 2.9, y2 + 0.6, Z + 8.2 * u, W - 5.8, FD - 1.2, 2.2, 'a');   // finial
    bx(g, x, y, Z, 1.5, FD, 5.4 * u);                            // arcade
    bx(g, x + W - 1.5, y, Z, 1.5, FD, 5.4 * u);
    bx(g, x, y, Z + 5.4 * u, W, FD, 1.1, 's', 't');
    faceR(g, x + 1.5, y + 0.6, Z + 0.3, y + FD - 0.6, Z + 4 * u);
  },

  bridgehouse(g, n) {
    const { gx: x, gy: y, gz: Z, W, D } = n;
    const FD = n.fd, y2 = y + D - FD, h = 8 * n.tall;
    shade(g, x + 2.3, y, Z, 2.4, FD); shade(g, x + 2.3, y2, Z, 2.4, FD);
    bx(g, x + 2.3, y, Z, 2.4, FD, h);
    bx(g, x + 2.3, y2, Z, 2.4, FD, h);
    bx(g, x + 2.3, y + FD, Z + h, 2.4, D - 2 * FD, 1.4, 's', 'a'); // arch over the lane
    crenels(g, x + 2.3, y, Z + h + 1.4, 2.4, FD, 'x');
    crenels(g, x + 2.3, y2, Z + h + 1.4, 2.4, FD, 'x');
    faceR(g, x + 4.7, y + 0.7, Z + h * 0.42, y + FD - 0.7, Z + h * 0.42 + 1.8);
    bx(g, x, y2, Z, 2.3, FD, 2.4);
    bx(g, x + W - 2.6, y, Z, 2.6, FD, 3.8);
    faceT(g, Z + 3.8, x + W - 2.6, y, x + W, y + FD, 'a-t');
    bx(g, x, y, Z, 2.3, FD, 1.3);
    faceT(g, Z + 1.3, x, y, x + 2.3, y + FD, 'a-t');
  },

  temple(g, n) {
    const { gx: x, gy: y, gz: Z, W, D } = n;                     // W = D = 9
    const FD = n.fd, y2 = y + D - FD;
    bx(g, x, y, Z, W, FD, 1.2, 's', 't');
    bx(g, x, y2, Z, W, FD, 1.2, 's', 't');
    colonnade(g, x, y + 0.6, Z + 1.2, W, FD - 1.2, 5, 5);
    colonnade(g, x, y2 + 0.6, Z + 1.2, W, FD - 1.2, 5, 5);
    shade(g, x + 3.4, y, Z + 1.2, 2.2, FD); shade(g, x + 3.4, y2, Z + 1.2, 2.2, FD);
    bx(g, x + 3.4, y, Z, 2.2, FD, 11);                           // grand arch piers
    bx(g, x + 3.4, y2, Z, 2.2, FD, 11);
    bx(g, x + 3.4, y + FD, Z + 11, 2.2, D - 2 * FD, 1.5, 's', 'a');
    bx(g, x + 3.1, y + FD - 0.3, Z + 12.5, 2.8, D - 2 * FD + 0.6, 1.7);  // drum
    dome(g, x + 4.5, y + D / 2, Z + 14.2, 1.9);
    bx(g, x + 4.15, y + D / 2 - 0.35, Z + 16, 0.7, 0.7, 1.9, 'a');       // finial
  },
};

/* ------------------------------- causeways ------------------------------ */

/* Route A -> B as axis-aligned legs: step out of A along +x, cross to B's
 * lane in the corridor between layers, then climb into B. Edges that skip a
 * layer detour behind the world so they never spear an intervening monument. */
function causeway(a, b, k, minY) {
  const legs = [];
  const walk = [];
  const zA = a.gz, zB = b.gz;
  const ax = a.gx + a.W, bEdge = b.gx;
  const skip = b.depth - a.depth > 1;
  const outLen = 1 + (k % 2);            // stagger so parallel routes miss each other
  const crossY = skip ? minY - 5 : b.cy;

  const leg = (name) => {
    const g = {
      kind: 'leg', edge: `${a.id}>${b.id}`, from: a.id, to: b.id, name, shapes: [],
      x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity,
    };
    legs.push(g);
    return g;
  };

  // 1. step out of A, flat, along +x
  const g1 = leg('out');
  walk.push(...deck(g1, ax, a.cy - WALK / 2, zA, outLen, WALK));
  let cx = ax + outLen;

  // 2. cross to the target lane along y, inside the corridor between layers
  if (Math.abs(crossY - a.cy) > 0.01) {
    const g2 = leg('cross');
    const y0 = Math.min(a.cy, crossY) - WALK / 2;
    const len = Math.abs(crossY - a.cy) + WALK;
    deck(g2, cx - WALK / 2, y0, zA, WALK, len);
    const steps = Math.max(2, Math.round(len / 2));
    for (let i = 1; i <= steps; i++) walk.push({ x: cx, y: a.cy + (crossY - a.cy) * (i / steps), z: zA });
  }

  // 3. layer-skipping edges climb behind the world, run past it, and drop
  //    back into the destination lane
  let zc = zA;
  if (skip) {
    const run = Math.max(3, bEdge - cx - 3);
    const g3 = leg('bypass');
    const climb = Math.max(2, Math.min(run - 1, Math.round(Math.abs(zB + 3 - zA) / 1.4)));
    const dz = (zB + 3 - zA) / climb;
    walk.push(...stairs(g3, cx, crossY - WALK / 2, zA, 'x', climb, WALK, dz));
    zc = zA + climb * dz;
    if (run > climb) walk.push(...deck(g3, cx + climb, crossY - WALK / 2, zc, run - climb, WALK));
    cx += run;
    const g4 = leg('return');
    const y0 = Math.min(b.cy, crossY) - WALK / 2;
    const len = Math.abs(b.cy - crossY) + WALK;
    deck(g4, cx - WALK / 2, y0, zc, WALK, len);
    const steps = Math.max(2, Math.round(len / 2));
    for (let i = 1; i <= steps; i++) walk.push({ x: cx, y: crossY + (b.cy - crossY) * (i / steps), z: zc });
  }

  // 4. climb into B
  const inLen = Math.max(1, Math.round(bEdge - cx));
  const g5 = leg('in');
  const dz = (zB - zc) / inLen;
  if (Math.abs(dz) < 0.02) {
    walk.push(...deck(g5, cx, b.cy - WALK / 2, zB, inLen, WALK));
  } else if (dz > 0) {
    walk.push(...stairs(g5, cx, b.cy - WALK / 2, zc, 'x', inLen, WALK, dz));
  } else {
    // descending: build from the low end so the treads still face upward,
    // then walk the run in the opposite order
    stairs(g5, cx, b.cy - WALK / 2, zB, 'x', inLen, WALK, -dz);
    for (let i = 0; i < inLen; i++) walk.push({ x: cx + i + 0.5, y: b.cy, z: zc + dz * i });
  }
  walk.push({ x: b.gx + b.W / 2, y: b.cy, z: zB });
  return { legs, walk };
}

/* -------------------------------- scene -------------------------------- */

export function buildScene(graph) {
  const groups = [];
  const edges = [];
  let k = 0;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const n of graph.nodes) {
    for (const dep of n.deps) {
      const a = byId.get(dep);
      if (!a) continue;
      const { legs, walk } = causeway(a, n, k++, graph.minY);
      groups.push(...legs);
      edges.push({ from: a.id, to: n.id, walk });
    }
  }

  for (const n of graph.nodes) {
    const g = {
      kind: 'node', nodeId: n.id, shapes: [],
      x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity,
    };
    substructure(g, n);
    (ARCH[n.variant] || ARCH.keep)(g, n);
    groups.push(g);
    n.stand = { x: n.gx + n.W / 2, y: n.cy, z: n.gz };
    n.anchor = P(n.gx + n.W, n.gy + n.D, n.gz - 4); // the south corner of its mass
  }

  const sorted = depthSort(groups);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of groups) {
    for (const X of [g.x0, g.x1]) for (const Y of [g.y0, g.y1]) for (const Z of [g.z0, g.z1]) {
      const p = P(X, Y, Z);
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
  }
  return { groups: sorted, edges, bounds: { x0, y0, x1, y1 } };
}
