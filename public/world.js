/* Graph Valley — world construction.
 *
 * A dungeon-crawl trail dressed in Monument Valley's clothes: a chain of small
 * floating platforms, each carrying one piece of architecture, joined by plain
 * stone walkways and stairs. The trail snakes — left to right along a row, up
 * a flight of steps, then back the other way — so the world folds into a
 * compact shape instead of marching off to one side.
 *
 * An earlier version tried to make every node a whole monument, with a lane
 * through it, shared viaducts, switchback corridors and bypass routes. It read
 * as clutter, and nearly all the geometry went into the connections rather
 * than the places. Monument Valley is the register here, not a blueprint.
 */

import { P, bx, faceR, faceT, dome, shade, colonnade, sortShapes, depthSort } from './iso.js';

const FOOT = 9;        // platform size, in cells
const FOOT_GOAL = 12;
const STEP = 12;       // spacing between platforms along a row
const PER_ROW = 4;     // platforms before the trail turns and climbs
const TURN = 24;       // the row-change step, in each of x and y
const CLIMB = 50;      // levels gained on it — the flight between two floors.
                       // Rows are 32*(CLIMB-TURN) apart on screen, and that has
                       // to clear a whole platform (roughly 860px, deck to the
                       // tip of its root) or the trail folds back over itself
                       // and stops being traceable.
const LANE = 14;       // spacing between siblings within one depth layer

const WALK = 3;        // walkway width
const SLAB = 1.6;      // walkway thickness
const KERB = 0.5;
const KERB_H = 0.85;
const TREAD = 2;       // stair tread depth
const CLEAR = 1.2;     // half-width of the strip kept clear across a platform

const FEATURES = ['pillars', 'archway', 'obelisk', 'rotunda', 'terrace', 'court'];

/* Stable hash so a topic always produces the same world. */
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}

/* ------------------------------- layout -------------------------------- */

/* Where a depth layer sits on the trail.
 *
 * Within a row the step is (+STEP, -STEP, 0), which projects to pure screen
 * horizontal: the two axes' vertical components cancel exactly. The row change
 * is (+TURN, +TURN, +CLIMB), which projects to pure screen vertical for the
 * same reason. So the trail reads as level rows stacked up the screen, and the
 * serpentine keeps the whole world compact instead of unidirectional. */
function anchor(L) {
  const row = Math.floor(L / PER_ROW);
  const col = L % PER_ROW;
  const c = row % 2 === 0 ? col : PER_ROW - 1 - col;
  return { x: c * STEP + row * TURN, y: -c * STEP + row * TURN, z: row * CLIMB };
}

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

  const laneOf = new Map();
  const maxDepth = Math.max(...layers.keys());
  for (let L = 0; L <= maxDepth; L++) {
    const arr = (layers.get(L) || []).slice();
    // keep siblings beside the parent they grew from, so links stay short
    arr.sort((a, b) => {
      const pa = a.deps.length ? Math.min(...a.deps.map((d) => laneOf.get(d) ?? 0)) : 0;
      const pb = b.deps.length ? Math.min(...b.deps.map((d) => laneOf.get(d) ?? 0)) : 0;
      return pa - pb || a.id.localeCompare(b.id, undefined, { numeric: true });
    });
    const a = anchor(L);

    arr.forEach((n, i) => {
      const h = hash(n.id + n.title);
      const size = n.goal ? FOOT_GOAL : FOOT;
      const lane = i - (arr.length - 1) / 2;
      laneOf.set(n.id, lane);
      // Siblings step along (+1, +1), which is pure screen vertical: they stack
      // down the screen rather than fighting the direction the trail runs in.
      const off = Math.round(lane * LANE);
      n.W = size;
      n.D = size;
      n.gx = a.x + off - (size - FOOT) / 2;
      n.gy = a.y + off - (size - FOOT) / 2;
      // a level of wobble, so a row is never dead flat
      n.gz = a.z + (h % 3) - 1;
      n.cx = n.gx + size / 2;
      n.cy = n.gy + size / 2;
      n.root = 2 + (h >>> 7) % 4;
      n.tall = 0.85 + ((h >>> 5) % 40) / 100;
      n.feature = n.goal ? 'shrine' : L === 0 ? 'gate' : FEATURES[h % FEATURES.length];
      // Tall things go on the far half only. In this projection a mass on the
      // near half projects up and to the LEFT — straight over the middle of the
      // platform — and would hide whoever is standing there.
      n.fy = n.gy + 0.5;                       // far strip: anything may go here
      n.fd = n.cy - CLEAR - n.fy;
      n.ny = n.cy + CLEAR;                     // near strip: keep it low
      n.nd = n.gy + size - 0.5 - n.ny;
      n.mx = n.gx + 0.5;
      n.mw = size - 1;
    });
  }
  graph.maxDepth = maxDepth;
  return graph;
}

/* ------------------------------ platforms ------------------------------ */

/* An inlaid panel — a garden, a pool, a coloured court. Inset so a rim of
 * stone shows and the accent reads as set into the platform. */
function inlay(g, z, x0, y0, x1, y1, cls = 'a-t') {
  const i = 0.6;
  if (x1 - x0 <= 2 * i || y1 - y0 <= 2 * i) return;
  faceT(g, z, x0 + i, y0 + i, x1 - i, y1 - i, cls);
}

/* The floating slab every place stands on: a deck, a taper, and a root
 * reaching down into nothing. */
function plinth(g, n) {
  const { gx: x, gy: y, gz: Z, W, D, root } = n;
  bx(g, x, y, Z - 3, W, D, 3, 's', 't');
  bx(g, x + 1.6, y + 1.6, Z - 6, W - 3.2, D - 3.2, 3, 's');
  bx(g, x + 3.2, y + 3.2, Z - 6 - root, W - 6.4, D - 6.4, root, 'n');
}

/* A kerb on each corner. It gives the platform a clean edge without closing
 * off any of the four sides a path might arrive from. */
function rim({ back: B, front: F }, n) {
  const { gx: x, gy: y, gz: Z, W, D } = n;
  const c = 2.4;
  for (const [px, py, w, d, tgt] of [
    [x, y, c, KERB, B], [x, y, KERB, c, B],
    [x + W - c, y, c, KERB, B], [x + W - KERB, y, KERB, c, B],
    [x, y + D - KERB, c, KERB, F], [x, y + D - c, KERB, c, F],
    [x + W - c, y + D - KERB, c, KERB, F], [x + W - KERB, y + D - c, KERB, c, F],
  ]) bx(tgt, px, py, Z, w, d, KERB_H, 't');
}

/* One piece of architecture per platform. A deliberately small vocabulary: the
 * trail is the subject, and these just give each stop its own silhouette. */
const FEATURE = {
  gate({ back: B, front: F, span: A }, n) {
    const { mx, mw, fy, fd, ny, nd, gz: Z } = n;
    const h = 5.5 * n.tall, w = 1.9;
    shade(B, mx, fy, Z, w, fd);
    bx(B, mx, fy, Z, w, fd, h);
    bx(B, mx + mw - w, fy, Z, w, fd, h);
    bx(A, mx, fy, Z + h, mw, fd, 0.9);
    faceR(B, mx + w, fy + 0.5, Z + 0.3, fy + fd - 0.5, Z + 2.6);
    bx(F, mx + mw * 0.28, ny, Z, mw * 0.44, nd, 1.1);
    inlay(F, Z + 1.1, mx + mw * 0.28, ny, mx + mw * 0.72, ny + nd);
  },

  pillars({ back: B, front: F }, n) {
    const { mx, mw, fy, fd, ny, nd, gz: Z } = n;
    const h = 6 * n.tall, w = 1.8;
    shade(B, mx, fy, Z, w, fd); shade(B, mx + mw - w, fy, Z, w, fd);
    for (const px of [mx, mx + mw - w]) {
      bx(B, px, fy, Z, w, fd, h);
      bx(B, px - 0.3, fy - 0.2, Z + h, w + 0.6, fd + 0.4, 0.8);    // capital
    }
    bx(F, mx + mw * 0.3, ny, Z, mw * 0.4, nd, 0.9);
    inlay(F, Z + 0.9, mx + mw * 0.3, ny, mx + mw * 0.7, ny + nd);
  },

  archway({ back: B, span: A }, n) {
    const { mx, mw, fy, fd, gz: Z } = n;
    const h = 5 * n.tall, w = 1.7, px = mx + mw / 2;
    shade(B, mx, fy, Z, mw, fd);
    bx(B, mx, fy, Z, w, fd, h);
    bx(B, px - w / 2, fy, Z, w, fd, h);
    bx(B, mx + mw - w, fy, Z, w, fd, h);
    bx(A, mx, fy, Z + h, mw, fd, 1);
    inlay(A, Z + h + 1, mx + mw * 0.32, fy, mx + mw * 0.68, fy + fd);
  },

  obelisk({ back: B, front: F }, n) {
    const { mx, mw, fy, fd, ny, nd, gz: Z } = n;
    const u = 3 * n.tall, cx = mx + mw * 0.62;
    shade(B, cx - 1.9, fy, Z, 3.8, fd);
    bx(B, cx - 1.9, fy, Z, 3.8, fd, 1.2);
    bx(B, cx - 1.3, fy + 0.3, Z + 1.2, 2.6, fd - 0.6, u);
    bx(B, cx - 0.8, fy + 0.6, Z + 1.2 + u, 1.6, fd - 1.2, u * 0.8);
    bx(B, cx - 0.45, fy + fd / 2 - 0.45, Z + 1.2 + u * 1.8, 0.9, 0.9, 1.6, 'a');
    bx(F, mx, ny, Z, mw * 0.45, nd, 1.4);
    inlay(F, Z + 1.4, mx, ny, mx + mw * 0.45, ny + nd);
  },

  rotunda({ back: B, front: F }, n) {
    const { mx, mw, fy, fd, ny, nd, gz: Z } = n;
    const h = 3.4 * n.tall, cx = mx + mw / 2, cy = fy + fd / 2;
    shade(B, cx - 2.6, fy, Z, 5.2, fd);
    bx(B, cx - 2.6, fy, Z, 5.2, fd, 1);                            // plinth
    bx(B, cx - 1.9, fy + 0.3, Z + 1, 3.8, fd - 0.6, h);            // drum
    faceR(B, cx + 1.9, cy - 0.8, Z + 1.6, cy + 0.8, Z + h);
    dome(B, cx, cy, Z + 1 + h, 1.9);
    bx(B, cx - 0.4, cy - 0.4, Z + 2.9 + h, 0.8, 0.8, 1.5, 'a');    // finial
    bx(F, mx, ny, Z, mw, nd * 0.5, 0.9);
  },

  terrace({ back: B, front: F }, n) {
    const { mx, mw, fy, fd, ny, nd, gz: Z } = n;
    const w = mw / 2;
    for (let i = 0; i < 2; i++) {
      const h = (1.4 + i * 1.8) * n.tall;
      bx(B, mx + i * w, fy, Z, w, fd, h);
      if (i) inlay(B, Z + h, mx + i * w, fy, mx + (i + 1) * w, fy + fd);
      bx(B, mx + i * w, fy + fd - KERB, Z + h, w, KERB, 0.6, 's');
    }
    bx(F, mx, ny + nd - 0.9, Z, mw, 0.9, 1.2);                     // low wall
  },

  court({ back: B, front: F }, n) {
    const { mx, mw, fy, fd, ny, nd, gz: Z } = n;
    bx(B, mx, fy, Z, mw, 0.9, 1.6);                                // walls on three sides
    bx(B, mx, fy, Z, 0.9, fd, 1.6);
    bx(B, mx + mw - 0.9, fy, Z, 0.9, fd, 1.6);
    faceT(B, Z, mx + 0.9, fy + 0.9, mx + mw - 0.9, fy + fd, 'k-t');
    for (const px of [mx, mx + mw - 1.6]) bx(B, px, fy, Z + 1.6, 1.6, 1.6, 1.6 * n.tall);
    bx(F, mx + mw * 0.3, ny, Z, mw * 0.4, nd, 1);
    inlay(F, Z + 1, mx + mw * 0.3, ny, mx + mw * 0.7, ny + nd);
  },

  /* The summit: bigger, and the only stop on the trail allowed to be tall. */
  shrine({ back: B, front: F, span: A }, n) {
    const { mx, mw, fy, fd, ny, nd, cx, cy, gz: Z } = n;
    const h = 8, w = 2.2;
    bx(B, mx, fy, Z, mw, fd, 1.2, 's', 't');
    bx(F, mx, ny, Z, mw, nd, 1.2, 's', 't');
    shade(B, mx, fy, Z + 1.2, mw, fd);
    colonnade(B, mx, fy, Z + 1.2, mw, fd, h, 4);
    for (const px of [mx, mx + mw - w]) bx(F, px, ny, Z + 1.2, w, nd, 1.8);
    bx(A, cx - 2.4, fy + fd, Z + h + 2.4, 4.8, ny - fy - fd, 1.6, 's', 'a');
    dome(A, cx, cy, Z + h + 4, 2.4);
    bx(A, cx - 0.5, cy - 0.5, Z + h + 6.4, 1, 1, 2.2, 'a');
  },
};

/* -------------------------------- paths -------------------------------- */

/* One run of walkway along one axis, in either direction, level or stepped.
 * This single function replaced a corridor builder, a switchback builder and a
 * bypass builder: the trail only ever goes one way at a time. */
function run(g, axis, from, to, cross, z0, z1) {
  const len = Math.abs(to - from);
  if (len < 0.05) return [];
  const dir = Math.sign(to - from) || 1;
  const dz = z1 - z0;
  const c0 = cross - WALK / 2;
  const pt = (u, z) => (axis === 'x'
    ? { x: from + dir * u, y: cross, z }
    : { x: cross, y: from + dir * u, z });

  if (Math.abs(dz) < 0.05) {                        // level: one slab, two kerbs
    const a = Math.min(from, to);
    const w = axis === 'x' ? len : WALK;
    const d = axis === 'x' ? WALK : len;
    const x0 = axis === 'x' ? a : c0;
    const y0 = axis === 'x' ? c0 : a;
    bx(g, x0, y0, z0 - SLAB, w, d, SLAB, 't');
    if (axis === 'x') {
      bx(g, x0, y0, z0, w, KERB, KERB_H, 's');
      bx(g, x0, y0 + WALK - KERB, z0, w, KERB, KERB_H, 's');
    } else {
      bx(g, x0, y0, z0, KERB, d, KERB_H, 's');
      bx(g, x0 + WALK - KERB, y0, z0, KERB, d, KERB_H, 's');
    }
    return [pt(0, z0), pt(len, z0)];
  }

  // Stepped. A layer-skipping link can be far steeper than a normal one, and
  // a steep flight built from full-depth treads reads as four giant blocks;
  // narrowing the tread keeps each step a sensible size on screen.
  const tread = Math.abs(dz / len) > 1.6 ? 1 : TREAD;
  const n = Math.max(2, Math.round(len / tread));
  const t = len / n, h = dz / n;
  const walk = [];
  for (let i = 0; i < n; i++) {
    const top = z0 + (i + 1) * h;
    const u = dir > 0 ? from + i * t : from - (i + 1) * t;
    const thick = SLAB + Math.abs(h);
    if (axis === 'x') bx(g, u, c0, top - thick, t, WALK, thick, 't');
    else bx(g, c0, u, top - thick, WALK, t, thick, 't');
    walk.push(pt((i + 1) * t, top));
  }
  return walk;
}

/* A small square platform where a path turns. */
function landing(g, cx, cy, z) {
  const s = WALK + 1.4;
  bx(g, cx - s / 2, cy - s / 2, z - SLAB, s, s, SLAB, 't');
  return [{ x: cx, y: cy, z }];
}

/* Join two platforms: out of the facing edge, along the longer axis, turn on a
 * landing, then in. Any rise happens on the long leg. */
function link(a, b, out) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  const xFirst = Math.abs(dx) >= Math.abs(dy);
  const leg = (name) => {
    const g = {
      kind: 'leg', name, from: a.id, to: b.id, shapes: [],
      x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity,
    };
    out.groups.push(g);
    return g;
  };

  const exitX = dx >= 0 ? a.gx + a.W : a.gx;
  const exitY = dy >= 0 ? a.gy + a.D : a.gy;
  const inX = dx >= 0 ? b.gx : b.gx + b.W;
  const inY = dy >= 0 ? b.gy : b.gy + b.D;
  const back = WALK / 2 + 0.7;                      // step clear of the landing

  // Where the two legs start and end, and how long each is. The climb is
  // shared between them in proportion: putting all of it on the first leg
  // turned the flight between two floors into a ladder.
  const aFrom = xFirst ? exitX : exitY;
  const aTo = xFirst ? b.cx : b.cy;
  const bFrom = (xFirst ? a.cy : a.cx) + Math.sign(xFirst ? dy : dx) * back;
  const bTo = xFirst ? inY : inX;
  const l1 = Math.abs(aTo - aFrom);
  const l2 = Math.abs(dy) > 0.05 || Math.abs(dx) > 0.05 ? Math.abs(bTo - bFrom) : 0;
  const zMid = a.gz + (b.gz - a.gz) * (l1 + l2 > 0.05 ? l1 / (l1 + l2) : 1);

  const walk = [{ x: a.cx, y: a.cy, z: a.gz }];
  const g1 = leg('out');

  if (xFirst) {
    walk.push(...run(g1, 'x', aFrom, aTo, a.cy, a.gz, zMid));
    if (Math.abs(dy) > 0.05) {
      const g2 = leg('in');
      walk.push(...landing(g2, b.cx, a.cy, zMid));
      walk.push(...run(g2, 'y', bFrom, bTo, b.cx, zMid, b.gz));
    }
  } else {
    walk.push(...run(g1, 'y', aFrom, aTo, a.cx, a.gz, zMid));
    if (Math.abs(dx) > 0.05) {
      const g2 = leg('in');
      walk.push(...landing(g2, a.cx, b.cy, zMid));
      walk.push(...run(g2, 'x', bFrom, bTo, b.cy, zMid, b.gz));
    }
  }
  walk.push({ x: b.cx, y: b.cy, z: b.gz });
  out.edges.push({ from: a.id, to: b.id, walk });
}

/* -------------------------------- scene -------------------------------- */

/* Which dependencies deserve a path of their own. A DAG usually states a
 * prerequisite twice — "you need A" and "you need B, which needs A" — and
 * building stone for both lays a second walkway beside a route that already
 * exists. Only edges with no alternative path get built; unlocking still uses
 * the full dependency set. */
function reduce(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map(nodes.map((n) => [n.id, []]));
  for (const n of nodes) for (const d of n.deps) if (kids.has(d)) kids.get(d).push(n.id);

  const reachableWithout = (from, to) => {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      const u = stack.pop();
      for (const v of kids.get(u) || []) {
        if (u === from && v === to) continue;   // ignore the edge under test
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
    for (const d of n.deps) {
      if (!byId.has(d)) continue;
      if (!reachableWithout(d, n.id)) out.push([byId.get(d), n]);
    }
  }
  return out;
}

const same = (p, q) =>
  Math.abs(p.x - q.x) < 0.02 && Math.abs(p.y - q.y) < 0.02 && Math.abs(p.z - q.z) < 0.02;

export function buildScene(graph) {
  const groups = [];
  const edges = [];
  const out = { groups, edges };

  const part = (n, name) => ({
    kind: 'node', nodeId: n.id, part: name, shapes: [],
    x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity,
  });

  for (const n of graph.nodes) {
    // Pieces whose boxes are separable along one axis — below the deck, the far
    // half, the near half, and anything spanning overhead — so the depth sort
    // can place the traveller correctly among them.
    const T = {
      base: part(n, 'base'), back: part(n, 'back'),
      front: part(n, 'front'), span: part(n, 'span'),
    };
    plinth(T.base, n);
    rim(T, n);
    (FEATURE[n.feature] || FEATURE.pillars)(T, n);
    for (const g of Object.values(T)) if (g.shapes.length) groups.push(g);
    n.stand = { x: n.cx, y: n.cy, z: n.gz };
    n.anchor = P(n.gx + n.W, n.gy + n.D, n.gz - 3);   // south corner, for the label
  }

  for (const [a, b] of reduce(graph.nodes)) link(a, b, out);

  // Where the trail forks: the stretch every onward path shares. She walks out
  // that far and asks there, rather than deciding it on the doorstep.
  const outgoing = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const e of edges) outgoing.get(e.from).push(e.walk);
  for (const n of graph.nodes) {
    const ws = outgoing.get(n.id);
    if (ws.length < 2) continue;
    const cap = Math.min(...ws.map((w) => w.length));
    let i = 1;
    while (i < cap && ws.every((w) => same(w[i], ws[0][i]))) i++;
    if (i > 1) {
      n.junctionWalk = ws[0].slice(0, i);
      n.junction = n.junctionWalk[i - 1];
    }
  }

  for (const g of groups) sortShapes(g);
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
