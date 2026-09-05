/* Graph Valley — world construction.
 *
 * Turns a learning DAG into one continuous Monument Valley structure:
 * monuments on an integer grid, joined by walled causeways and staircases
 * that the avatar genuinely walks.
 */

import { P, bx, faceR, faceL, faceT, dome, shade, crenels, colonnade, sortShapes, depthSort } from './iso.js';

/* Grid metrics.
 *
 * LANE is deliberately more than twice the footprint. Monument Valley reads as
 * a few large objects with sky between them; monuments that touch on screen
 * collapse into one unreadable mass however well each is modelled.
 *
 * SPAN and RISE are locked together by two requirements that pull in opposite
 * directions: the world only climbs up-screen when RISE > SPAN / 2, and the
 * staircase into the next layer only looks like architecture when its slope
 * stays near 1. Solving the pair is what forces a corridor roughly twice the
 * footprint — which is precisely why the connections between layers have to be
 * a single shared viaduct rather than one bridge per dependency, or the world
 * becomes mostly bridge.
 *
 * The trap in that pair is that a monument's own footprint contributes eleven
 * cells of run and no rise, which flattens the whole world: at RISE = 18 the
 * spine climbed 64px per layer against 1024px of travel, a 16:1 strip. So part
 * of every layer's climb happens INSIDE the monument, on a stepped ramp
 * through its lane. That splits the budget across two gentle staircases
 * instead of one steep one, lets RISE go half as high again, and walking up
 * through a building is the Monument Valley move anyway. */
const LANE = 26;   // cells between siblings inside a layer, along +y
const LANE_RISE = 8;  // levels climbed inside each monument, on its own ramp
const LANDING = 0.4;  // fraction of the lane that stays level, at the entry end

/* Every corridor is a different length, height and sideways step.
 *
 * Uniform spacing was as much of the "it only grows left to right" problem as
 * the direction itself: identical gaps and identical climbs turn a sequence of
 * monuments into beads on a string. These keep the stair slope roughly
 * constant (rise = LANE_RISE + 1.25 x usable run) while letting the rhythm
 * vary, so some monuments cluster and others stand well apart. */
const SPANS = [28, 32, 38];
const SPAN_WIDE = 20;   // a sideways corridor needs no long run along the spine
/* Alternating sideways steps, of differing size. Big enough that a corridor
 * often has more travel across the screen than along it, which is what lets
 * the next stretch of world head back the other way. */
const zigOf = (L) => (L % 2 ? 1 : -1) * (12 + (hash(`zig${L}`) % 3) * 4);
const dyOf = (L) => Math.abs(zigOf(L + 1) - zigOf(L));
const FOOT = 11;   // nominal monument footprint, in cells
const FOOT_GOAL = 14;

const WALK = 4;    // causeway width
const SLAB = 1.7;  // causeway thickness — heavy enough to read as stone
const KERB = 0.5;  // parapet thickness
const KERB_H = 0.85;
const LAND = 5.4;  // width of the shared viaduct that every path turns onto
const OUT = 1.2;   // how far a path leaves a deck before it reaches the viaduct
const TREAD = 2;   // stair tread depth, in cells

const VARIANTS = ['keep', 'hall', 'ziggurat', 'rotunda', 'bridgehouse', 'terrace'];

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

  const laneOf = new Map();
  const maxDepth = Math.max(...layers.keys());

  /* A corridor between two single-monument layers with a long sideways run
   * climbs on that run instead of along the spine. */
  const wide = (L) => (layers.get(L) || []).length === 1
    && (layers.get(L + 1) || []).length === 1 && dyOf(L) >= 20;

  /* A sideways corridor needs only enough run along the spine to get clear of
   * the monument it left; keeping it short is what stops those stretches from
   * becoming enormous bridges. */
  const spanOf = (L) => (wide(L) ? SPAN_WIDE : SPANS[hash(`span${L}`) % SPANS.length]);

  /* How much a corridor climbs. Derived from the run it actually has, not
   * fixed per layer: a sideways corridor covers its ground on a different axis
   * from a straight one, and giving both the same rise would leave the
   * sideways ones sloping downhill on screen — screen height falls by 16px per
   * cell of travel in either horizontal axis, and only rises 32px per level. */
  const riseOf = (L) => (wide(L)
    ? LANE_RISE + Math.round(1.15 * dyOf(L))
    : LANE_RISE + Math.round(1.3 * (spanOf(L) - FOOT - OUT - LAND)));

  // cumulative, because each corridor has its own span and rise
  const ax = [0], az = [0];
  for (let L = 1; L <= maxDepth; L++) {
    ax[L] = ax[L - 1] + spanOf(L - 1);
    az[L] = az[L - 1] + riseOf(L - 1);
  }
  for (let L = 0; L <= maxDepth; L++) {
    const arr = (layers.get(L) || []).slice();
    // Keep siblings beside the parent they grew from, so causeways stay short
    // and the whole thing reads as one structure rather than a scatter.
    arr.sort((a, b) => {
      const pa = a.deps.length ? Math.min(...a.deps.map((d) => laneOf.get(d) ?? 0)) : 0;
      const pb = b.deps.length ? Math.min(...b.deps.map((d) => laneOf.get(d) ?? 0)) : 0;
      return pa - pb || a.id.localeCompare(b.id, undefined, { numeric: true });
    });

    // Footprint varies by LAYER, not by node. Every monument in a layer then
    // presents the same edge to the corridor, so all the paths leaving that
    // layer turn at exactly the same x and merge into one shared walkway
    // instead of near-missing each other by a cell.
    const layerFoot = L === 0 ? FOOT + 1 : FOOT - 1 + (hash(`layer${L}`) % 3);

    arr.forEach((n, i) => {
      const h = hash(n.id + n.title);
      const size = n.goal ? FOOT_GOAL : layerFoot;
      const lane = i - (arr.length - 1) / 2;
      laneOf.set(n.id, lane);
      n.W = size;
      n.D = size;
      n.gx = ax[L];
      // Layers step sideways by differing amounts, so the world snakes instead
      // of marching in one straight line. The corridors absorb it for free: a
      // viaduct already spans whatever lanes it has to reach.
      n.gy = Math.round(lane * LANE + zigOf(L)) - (size - FOOT) / 2;
      // Every monument in a layer shares one height, so the viaduct that
      // serves them all can be a single level deck. Variety comes from the
      // buildings, not from jittering the ground they stand on.
      n.gz = az[L];
      // A wide height range is the main thing left carrying the skyline now
      // that every deck in a layer sits level; without it a layer reads as a
      // row of equal blocks.
      n.tall = 0.7 + ((h >>> 5) % 90) / 100;
      n.root = 2 + ((h >>> 11) % 9);
      n.footStyle = (h >>> 23) % 4;
      n.variant = n.goal ? 'temple' : L === 0 ? 'gate' : VARIANTS[h % VARIANTS.length];

      // The walking lane runs through the middle of every monument along +x,
      // with a buildable flank either side of it.
      n.cy = n.gy + size / 2;
      n.ez = n.gz + LANE_RISE;             // the level you leave by
      n.lx = n.gx + size * LANDING;        // where the lane stops being level
      n.mx = n.gx + KERB;
      n.mw = size - 2 * KERB;
      n.f1y = n.gy + KERB;                 // flank on the -y side
      n.f2y = n.cy + WALK / 2;             // flank on the +y side
      n.fd = (size - WALK) / 2 - KERB;     // depth of each flank
    });
  }
  graph.maxDepth = maxDepth;
  graph.minY = Math.min(...graph.nodes.map((n) => n.gy));
  return graph;
}

/* --------------------------- monument archetypes ------------------------ */
/* Each archetype has a strict budget: one primary mass, one secondary element,
 * a few openings. Monument Valley is large simple volumes with generous blank
 * surfaces — a dozen small blocks per building is exactly what turns a
 * structure into rubble. Nothing intrudes into the lane below the height of an
 * arch, so the avatar can always walk straight through. */

function substructure(g, n) {
  const { gx: x, gy: y, gz: Z, W, D, root, footStyle } = n;
  bx(g, x, y, Z - 5, W, D, 5, 's', 't');                        // the deck mass
  if (footStyle === 0) {                                        // shallow stepped plinth
    bx(g, x + 1.2, y + 1.2, Z - 8.5, W - 2.4, D - 2.4, 3.5, 's');
    bx(g, x + 2.8, y + 2.8, Z - 11.5, W - 5.6, D - 5.6, 3, 'n');
  } else if (footStyle === 1) {                                 // one long tapering root
    bx(g, x + 1.4, y + 1.4, Z - 9, W - 2.8, D - 2.8, 4, 's');
    bx(g, x + 3, y + 3, Z - 9 - root, W - 6, D - 6, root, 'n');
    bx(g, x + 3.7, y + 3.7, Z - 11.6 - root, W - 7.4, D - 7.4, 2.6, 'n');
  } else if (footStyle === 2) {                                 // two uneven legs
    bx(g, x + 1, y + 1, Z - 8.5, W - 2, D - 2, 3.5, 's');
    bx(g, x + 2.2, y + 2.2, Z - 8.5 - root * 0.9, 2.2, 2.2, root * 0.9, 'n');
    bx(g, x + W - 4.4, y + D - 4.4, Z - 8.5 - root * 0.5, 2.2, 2.2, root * 0.5, 'n');
  } else {                                                      // broad three-tier base
    bx(g, x + 0.9, y + 0.9, Z - 8.5, W - 1.8, D - 1.8, 3.5, 's');
    bx(g, x + 2.4, y + 2.4, Z - 12, W - 4.8, D - 4.8, 3.5, 's');
    bx(g, x + 4, y + 4, Z - 12 - root * 0.6, W - 8, D - 8, root * 0.6, 'n');
  }
}

/* The stepped ramp that carries the lane up through a monument.
 *
 * Level for the first stretch, then a flight of steps to the exit dock. Each
 * step is a block standing ON the deck rather than a floating tread, so it
 * never intersects the mass beneath it and the depth sort stays acyclic.
 *
 * She arrives at the entry, walks the whole ramp, and waits at the top. That
 * is not just staging: in this projection a mass on the near flank projects up
 * to five and a half cells to the LEFT of where it stands, so anything tall
 * beside the lane blots out the lane next to it. The one spot inside a
 * monument that nothing can ever stand in front of is the top of the ramp, at
 * its outward edge — which is also where you would wait if you were about to
 * leave. */
function laneRamp(g, n) {
  const { gx: x, gz: Z, cy, W, lx } = n;
  const y0 = cy - WALK / 2;
  const len = x + W - lx;
  const steps = Math.max(2, Math.round(len / TREAD));
  const t = len / steps, dz = LANE_RISE / steps;
  const walk = [{ x, y: cy, z: Z }, { x: lx, y: cy, z: Z }];
  for (let i = 0; i < steps; i++) {
    bx(g, lx + i * t, y0, Z, t, WALK, (i + 1) * dz, 't');
    walk.push({ x: lx + (i + 1) * t, y: cy, z: Z + (i + 1) * dz });
  }
  // low walls either side, so it reads as a processional stair rather than a
  // stack of blocks left in the courtyard
  for (let i = 0; i < steps; i++) {
    const top = Z + (i + 1) * dz;
    bx(g, lx + i * t, y0, top, t, KERB, KERB_H, 's');
    bx(g, lx + i * t, y0 + WALK - KERB, top, t, KERB, KERB_H, 's');
  }
  return walk;
}

/* The parapet around a deck. This is what gives every monument a clean
 * silhouette and a legible footprint; without it the decks of neighbouring
 * monuments run together as one pale plane. Broken at both docks so the path
 * can enter and leave. */
function parapet({ back: B, front: F }, n) {
  const { gx: x, gy: y, gz: Z, W, D } = n;
  const y0 = n.cy - WALK / 2, y1 = n.cy + WALK / 2;
  bx(B, x, y, Z, W, KERB, KERB_H, 't');                               // -y edge
  bx(B, x, y + KERB, Z, KERB, y0 - y - KERB, KERB_H, 't');            // -x edge, far run
  bx(B, x + W - KERB, y + KERB, Z, KERB, y0 - y - KERB, KERB_H, 't'); // +x edge, far run
  bx(F, x, y + D - KERB, Z, W, KERB, KERB_H, 't');                    // +y edge
  bx(F, x, y1, Z, KERB, y + D - y1 - KERB, KERB_H, 't');              // -x edge, near run
  bx(F, x + W - KERB, y1, Z, KERB, y + D - y1 - KERB, KERB_H, 't');   // +x edge, near run
}

/* An inlaid panel on top of a terrace — a garden, a pool, a coloured court.
 * Inset from the edges so a rim of stone still shows: an accent that runs to
 * the edge of its block reads as a painted lid, not as something set into
 * the stone, and at this saturation that is the difference between one
 * deliberate colour note and a slab of orange. */
function inlay(g, z, x0, y0, x1, y1, cls = 'a-t') {
  const i = 0.75;
  if (x1 - x0 <= 2 * i || y1 - y0 <= 2 * i) return;
  faceT(g, z, x0 + i, y0 + i, x1 - i, y1 - i, cls);
}

/* Archetypes draw into three targets rather than one group.
 *
 * They also follow one compositional rule: the tall mass goes on the FAR
 * flank, the near flank stays low. Anything over about three levels on the
 * near side covers the traveller completely now that she is properly occluded,
 * and a foreground you cannot see past is worse than a symmetrical one.
 *
 * `B` is the far flank (-y), `F` the near flank (+y), `A` anything that spans
 * the lane overhead. Splitting them this way is what lets the traveller be
 * occluded properly: the near flank's bounding box lies entirely on her near
 * side, so the depth sort knows to draw it over her, and an arch lies entirely
 * above her, so she walks under it. While a monument was a single group its
 * box contained her and no axis could separate them — which is exactly why she
 * appeared to fly over the world instead of moving through it. */
const ARCH = {
  /* The start: two heavy pylons you walk between, under a lintel. */
  gate({ back: B, front: F, span: A }, n) {
    const { mx, mw, f1y, f2y, fd, gz: Z } = n;
    const h = 8 * n.tall, w = 3.2, px = mx + mw * 0.42;
    shade(B, px, f1y, Z, w, fd); shade(F, px, f2y, Z, w, fd);
    bx(B, px, f1y, Z, w, fd, h);
    bx(F, px, f2y, Z, w, fd, h);
    crenels(B, px, f1y, Z + h, w, fd, 'x');
    crenels(F, px, f2y, Z + h, w, fd, 'x');
    bx(A, px, f1y + fd, Z + h, w, WALK, 1.5, 's', 'a');           // lintel over the lane
    faceR(B, px + w, f1y + 0.8, Z + 0.4, f1y + fd - 0.8, Z + 4.4);
    faceR(F, px + w, f2y + 0.8, Z + 0.4, f2y + fd - 0.8, Z + 4.4);
    bx(F, mx + mw - 4, f2y, Z, 4, fd, 2.2);                       // garden terrace
    inlay(F, Z + 2.2, mx + mw - 4, f2y, mx + mw, f2y + fd);
  },

  /* One tall solid tower with a buttress, and a low terrace opposite it. */
  keep({ back: B, front: F }, n) {
    const { mx, mw, f1y, f2y, fd, gz: Z } = n;
    const h = 13 * n.tall;
    shade(B, mx, f1y, Z, 6.2, fd);
    bx(B, mx, f1y, Z, 4.4, fd, h);
    crenels(B, mx, f1y, Z + h, 4.4, fd, 'x');
    for (const u of [0.3, 0.55, 0.78]) faceR(B, mx + 4.4, f1y + 0.9, Z + h * u, f1y + fd - 0.9, Z + h * u + 2);
    faceL(B, f1y + fd, mx + 0.9, Z + h * 0.42, mx + 3.5, Z + h * 0.6);
    bx(B, mx + 4.4, f1y, Z, 1.8, fd, h * 0.45);                   // buttress
    bx(F, mx + mw - 5.5, f2y, Z, 5.5, fd, 2.6);
    inlay(F, Z + 2.6, mx + mw - 5.5, f2y, mx + mw, f2y + fd);
  },

  /* A full-width colonnade under a heavy entablature, facing a blank wall. */
  hall({ back: B, front: F }, n) {
    const { mx, mw, f1y, f2y, fd, gz: Z } = n;
    shade(B, mx, f1y, Z, mw, fd);
    colonnade(B, mx, f1y, Z, mw, fd, 6 * n.tall, 5);
    bx(F, mx, f2y, Z, mw, fd, 2.2);                               // the low wall opposite
    faceR(F, mx + mw, f2y + 1, Z + 0.5, f2y + fd - 1, Z + 1.8);
    bx(F, mx, f2y + fd - KERB, Z + 2.2, mw, KERB, 0.9, 's');      // its coping
    inlay(F, Z + 2.2, mx, f2y, mx + mw - 3, f2y + fd);
  },

  /* Four clean diminishing tiers with an accent block at the summit. */
  ziggurat({ back: B, front: F }, n) {
    const { mx, mw, f1y, f2y, fd, gz: Z } = n;
    const u = 2.6 * n.tall;
    shade(B, mx, f1y, Z, mw, fd);
    bx(B, mx, f1y, Z, mw, fd, u);
    bx(B, mx + 1.6, f1y, Z + u, mw - 3.2, fd, u);
    bx(B, mx + 3.2, f1y + 0.4, Z + 2 * u, mw - 6.4, fd - 0.8, u);
    bx(B, mx + 4.2, f1y + 0.8, Z + 3 * u, mw - 8.4, fd - 1.6, 2.4, 'a');
    faceR(B, mx + mw, f1y + 0.9, Z + 0.5, f1y + fd - 0.9, Z + u - 0.5);
    bx(F, mx, f2y, Z, mw, fd, 1.4);                               // low bench opposite
    inlay(F, Z + 1.4, mx, f2y, mx + mw, f2y + fd);
  },

  /* A domed drum on a plinth, with broad steps opposite. */
  rotunda({ back: B, front: F }, n) {
    const { mx, mw, f1y, f2y, fd, gz: Z } = n;
    const h = 5 * n.tall, cx = mx + mw / 2, cy = f1y + fd / 2;
    shade(B, cx - 3.4, f1y, Z, 6.8, fd);
    bx(B, cx - 3.4, f1y, Z, 6.8, fd, 1.4);                        // plinth
    bx(B, cx - 2.4, f1y + 0.4, Z + 1.4, 4.8, fd - 0.8, h);        // drum
    faceR(B, cx + 2.4, cy - 1, Z + 2, cy + 1, Z + 4.4);
    dome(B, cx, cy, Z + 1.4 + h, 2.3);
    bx(B, cx - 0.45, cy - 0.45, Z + 3.7 + h, 0.9, 0.9, 2.2, 'a'); // finial
    for (let i = 0; i < 3; i++) bx(F, mx + i * (mw / 3), f2y, Z, mw / 3, fd, 1.2 + i * 1.2);
  },

  /* Two towers straddling the lane, joined by an arch you walk under. */
  bridgehouse({ back: B, front: F, span: A }, n) {
    const { mx, mw, f1y, f2y, fd, gz: Z } = n;
    const h = 10 * n.tall, w = 3.4, px = mx + mw / 2 - w / 2;
    shade(B, px, f1y, Z, w, fd); shade(F, px, f2y, Z, w, fd);
    bx(B, px, f1y, Z, w, fd, h);
    bx(F, px, f2y, Z, w, fd, h);
    bx(A, px, f1y + fd, Z + h, w, WALK, 1.8, 's', 'a');           // the arch
    crenels(B, px, f1y, Z + h + 1.8, w, fd, 'x');
    crenels(F, px, f2y, Z + h + 1.8, w, fd, 'x');
    faceR(B, px + w, f1y + 0.9, Z + h * 0.34, f1y + fd - 0.9, Z + h * 0.34 + 2.2);
    faceR(F, px + w, f2y + 0.9, Z + h * 0.54, f2y + fd - 0.9, Z + h * 0.54 + 2.2);
    bx(B, mx + mw - 3.4, f1y, Z, 3.4, fd, 2.4);
    inlay(B, Z + 2.4, mx + mw - 3.4, f1y, mx + mw, f1y + fd);
  },

  /* Three broad garden terraces climbing along the lane. */
  terrace({ back: B, front: F }, n) {
    const { mx, mw, f1y, f2y, fd, gz: Z } = n;
    const w = mw / 3;
    for (let i = 0; i < 3; i++) {
      const h = (1.6 + i * 1.7) * n.tall;
      bx(B, mx + i * w, f1y, Z, w, fd, h);
      inlay(B, Z + h, mx + i * w, f1y, mx + (i + 1) * w, f1y + fd);
      bx(B, mx + i * w, f1y + fd - KERB, Z + h, w, KERB, 0.7, 's');  // terrace edge
    }
    bx(F, mx, f2y, Z, mw, fd, 2.2);                               // long wall opposite
    bx(F, mx, f2y + fd - KERB, Z + 2.2, mw, KERB, 0.9, 's');
    faceL(F, f2y + fd, mx + 1.2, Z + 0.6, mx + 4, Z + 1.8);
  },

  /* The summit: a colonnaded podium, a grand arch over the lane, a dome. */
  temple({ back: B, front: F, span: A }, n) {
    const { mx, mw, f1y, f2y, fd, cy, gz: Z } = n;
    const px = mx + mw / 2 - 1.4;
    bx(B, mx, f1y, Z, mw, fd, 1.6, 's', 't');
    bx(F, mx, f2y, Z, mw, fd, 1.6, 's', 't');
    shade(B, mx, f1y, Z + 1.6, mw, fd); shade(F, mx, f2y, Z + 1.6, mw, fd);
    colonnade(B, mx, f1y, Z + 1.6, mw, fd, 6, 5);
    colonnade(F, mx, f2y, Z + 1.6, mw, fd, 6, 5);
    bx(B, px, f1y, Z, 2.8, fd, 13);                               // grand arch piers
    bx(F, px, f2y, Z, 2.8, fd, 13);
    bx(A, px, f1y + fd, Z + 13, 2.8, WALK, 1.8, 's', 'a');        // lintel
    bx(A, px - 0.5, f1y + fd - 0.5, Z + 14.8, 3.8, WALK + 1, 2.2); // drum
    dome(A, px + 1.4, cy, Z + 17, 2.6);
    bx(A, px + 0.9, cy - 0.5, Z + 19.6, 1, 1, 2.4, 'a');          // finial
  },
};

/* ------------------------------- causeways ------------------------------ */
/* A path is built from named pieces — runs, landings and staircases — rather
 * than raw slabs. Every turn lands on a square platform and every run carries
 * a parapet, so a route reads as designed architecture instead of planks
 * crossing in mid-air. */

function walled(g, x, y, z, w, d, axis) {
  bx(g, x, y, z - SLAB, w, d, SLAB, 't');
  if (axis === 'x') {
    bx(g, x, y, z, w, KERB, KERB_H, 's');
    bx(g, x, y + d - KERB, z, w, KERB, KERB_H, 's');
  } else {
    bx(g, x, y, z, KERB, d, KERB_H, 's');
    bx(g, x + w - KERB, y, z, KERB, d, KERB_H, 's');
  }
}

/* A flat run along +x. Returns its walkable centre line. */
function runX(g, x, cy, z, len) {
  if (len <= 0.01) return [];
  walled(g, x, cy - WALK / 2, z, len, WALK, 'x');
  return [{ x, y: cy, z }, { x: x + len, y: cy, z }];
}

/* A flat run along y, in either direction. */
function runY(g, cx, yA, yB, z) {
  const len = Math.abs(yB - yA);
  if (len <= 0.01) return [];
  walled(g, cx - WALK / 2, Math.min(yA, yB), z, WALK, len, 'y');
  return [{ x: cx, y: yA, z }, { x: cx, y: yB, z }];
}

/* The square platform every turn pivots on. */
function landing(g, cx, cy, z) {
  bx(g, cx - LAND / 2, cy - LAND / 2, z - SLAB, LAND, LAND, SLAB, 't');
  return [{ x: cx, y: cy, z }];
}

/* An ascending staircase along +x, climbing `rise` levels over `len` cells.
 *
 * Treads are two cells deep and carry no parapet. A stair built from one-cell
 * treads with a stepped rail either side is a sawtooth: from any distance it
 * dissolves into fuzz. Monument Valley's staircases are a handful of big bare
 * blocks, and reading clearly at a glance matters more here than realism. */
function stairX(g, x, cy, z0, len, rise) {
  const n = Math.max(2, Math.round(len / TREAD));
  const t = len / n, dz = rise / n;
  const y0 = cy - WALK / 2;
  const walk = [];
  for (let i = 0; i < n; i++) {
    const top = z0 + (i + 1) * dz;
    bx(g, x + i * t, y0, top - SLAB - dz, t, WALK, SLAB + dz, 't');
    walk.push({ x: x + (i + 0.5) * t, y: cy, z: top });
  }
  return walk;
}

/* A parapet run broken by openings, so a viaduct can have a proper rail
 * everywhere except where a path joins it. */
function railWithGaps(g, x, y0, y1, z, gaps) {
  let cur = y0;
  for (const [a, b] of gaps.slice().sort((p, q) => p[0] - q[0])) {
    if (a > cur + 0.05) bx(g, x, cur, z, KERB, a - cur, KERB_H, 's');
    cur = Math.max(cur, b);
  }
  if (y1 > cur + 0.05) bx(g, x, cur, z, KERB, y1 - cur, KERB_H, 's');
}

/* The same staircase running along y instead. Travelling +y moves left across
 * the screen, so a corridor that climbs this way carries that stretch of the
 * world back the other way — which is what turns a row of monuments into a
 * switchback rather than a march. */
function stairY(g, cx, yFrom, yTo, z0, rise) {
  const dir = Math.sign(yTo - yFrom) || 1;
  const len = Math.abs(yTo - yFrom);
  const n = Math.max(2, Math.round(len / TREAD));
  const t = len / n, dz = rise / n;
  const x0 = cx - WALK / 2;
  const walk = [];
  for (let i = 0; i < n; i++) {
    const top = z0 + (i + 1) * dz;
    const y = dir > 0 ? yFrom + i * t : yFrom - (i + 1) * t;
    bx(g, x0, y, top - SLAB - dz, WALK, t, SLAB + dz, 't');
    walk.push({ x: cx, y: yFrom + dir * (i + 0.5) * t, z: top });
  }
  return walk;
}

/* One corridor: everything between two adjacent layers.
 *
 * The naive thing is a separate bridge per dependency, and it is what made
 * earlier versions read as a lattice of planks rather than a place — a ten
 * node graph produced ten full-length viaducts stacked through the same gap.
 * Instead each corridor gets ONE shared viaduct running across the lanes: a
 * short spur off each departing deck, and one staircase climbing into each
 * arriving one. Geometry is per corridor, but each edge still gets its own
 * walkable centre line through it. */
function corridor(L, es, out) {
  const sources = [...new Set(es.map((e) => e[0]))];
  const targets = [...new Set(es.map((e) => e[1]))];
  const a0 = sources[0];
  // A single hop with a long sideways run climbs on the sideways leg instead,
  // which sends that stretch of the world back across the screen.
  if (sources.length === 1 && targets.length === 1
      && Math.abs(targets[0].cy - a0.cy) >= 16) return switchback(a0, targets[0], out);
  const z = a0.ez;                       // paths leave a monument at its top step
  const vx = a0.gx + a0.W + OUT;         // west face of the viaduct
  const vc = vx + LAND / 2;              // its centre line
  const ve = vx + LAND;                  // its east face

  const ys = [...sources, ...targets].map((n) => n.cy);
  const y0 = Math.min(...ys) - WALK / 2;
  const y1 = Math.max(...ys) + WALK / 2;

  const leg = (name, from, to) => {
    const g = {
      kind: 'leg', name, from, to, shapes: [],
      x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity,
    };
    out.groups.push(g);
    return g;
  };

  // the shared viaduct, railed except where paths join it
  const gv = leg('viaduct', a0.id, targets[0].id);
  bx(gv, vx, y0, z - SLAB, LAND, y1 - y0, SLAB, 't');
  railWithGaps(gv, vx, y0, y1, z, sources.map((n) => [n.cy - WALK / 2, n.cy + WALK / 2]));
  railWithGaps(gv, ve - KERB, y0, y1, z, targets.map((n) => [n.cy - WALK / 2, n.cy + WALK / 2]));
  bx(gv, vx, y0, z, LAND, KERB, KERB_H, 's');            // end caps
  bx(gv, vx, y1 - KERB, z, LAND, KERB, KERB_H, 's');

  // a short spur off each departing deck
  const spurEnd = new Map();
  for (const a of sources) {
    const g = leg('spur', a.id, a.id);
    const len = vx - (a.gx + a.W);
    if (len > 0.01) walled(g, a.gx + a.W, a.cy - WALK / 2, z, len, WALK, 'x');
    spurEnd.set(a.id, [a.stand, { x: vc, y: a.cy, z }]);
    // where the onward paths actually diverge — the traveller walks out here
    // to ask which way, rather than deciding it on the doorstep
    a.junction = { x: vc, y: a.cy, z };
    a.junctionWalk = spurEnd.get(a.id);
  }

  // one staircase climbing into each arriving deck
  const stairIn = new Map();
  for (const b of targets) {
    const g = leg('stair', a0.id, b.id);
    const len = Math.max(TREAD, b.gx - ve);
    const pts = stairX(g, ve, b.cy, z, len, b.gz - z);
    // ...and on through the monument itself, up its ramp to where she waits
    stairIn.set(b.id, [{ x: vc, y: b.cy, z }, { x: ve, y: b.cy, z }, ...pts, ...b.laneWalk]);
  }

  // each dependency's own route through the shared stone
  for (const [a, b] of es) {
    out.edges.push({
      from: a.id, to: b.id,
      walk: [
        ...spurEnd.get(a.id),
        { x: vc, y: b.cy, z },              // along the viaduct
        ...stairIn.get(b.id),
      ],
    });
  }
}

/* One hop, climbing on a long staircase that runs across the screen rather
 * than along it. Same pieces as a corridor — spur, landing, stair, landing,
 * run in — only the stair is turned ninety degrees. */
function switchback(a, b, out) {
  const z = a.ez;
  const vc = a.gx + a.W + OUT + LAND / 2;
  const leg = (name) => {
    const g = {
      kind: 'leg', name, from: a.id, to: b.id, shapes: [],
      x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity,
    };
    out.groups.push(g);
    return g;
  };
  const walk = [a.stand];

  const g1 = leg('spur');
  walk.push(...runX(g1, a.gx + a.W, a.cy, z, OUT));
  walk.push(...landing(g1, vc, a.cy, z));

  const dir = Math.sign(b.cy - a.cy) || 1;
  const g2 = leg('climb');
  walk.push(...stairY(g2, vc, a.cy + dir * (LAND / 2), b.cy, z, b.gz - z));

  const g3 = leg('in');
  walk.push(...landing(g3, vc, b.cy, b.gz));
  walk.push(...runX(g3, vc + LAND / 2, b.cy, b.gz, Math.max(1, b.gx - vc - LAND / 2)));
  walk.push(...b.laneWalk);

  out.edges.push({ from: a.id, to: b.id, walk });
}

/* A dependency that jumps more than one layer cannot use the corridors, so it
 * gets its own route: out to a lane behind the world, along it above
 * everything in between, then back in. It climbs on its two long sideways
 * legs — those are the only stretches with enough run for a gentle stair, now
 * that a skipped layer can mean a rise of forty levels or more. Rare once the
 * graph is reduced. */
function bypass(a, b, minY, out) {
  const z0 = a.ez;
  // The further it has to climb, the further out it swings: the sideways legs
  // are the only run it has, so their length has to scale with the rise or a
  // five-layer skip turns into a ladder.
  const laneY = minY - 14 - Math.min(Math.max(0, b.gz - z0) * 0.5, 70);
  const vc = a.gx + a.W + OUT + LAND / 2;
  const mid = z0 + (b.gz - z0) * 0.5;
  const leg = (name) => {
    const g = {
      kind: 'leg', name, from: a.id, to: b.id, shapes: [],
      x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity,
    };
    out.groups.push(g);
    return g;
  };
  const walk = [a.stand];

  const g1 = leg('spur');
  walk.push(...runX(g1, a.gx + a.W, a.cy, z0, OUT));
  walk.push(...landing(g1, vc, a.cy, z0));

  const g2 = leg('climb');                       // out to the back lane, climbing
  walk.push(...stairY(g2, vc, a.cy - LAND / 2, laneY, z0, mid - z0));
  walk.push(...landing(g2, vc, laneY, mid));

  const g3 = leg('bypass');                      // over everything in between
  const run = Math.max(2, b.gx - LAND / 2 - vc - LAND / 2);
  walk.push(...runX(g3, vc + LAND / 2, laneY, mid, run));
  const cx = vc + LAND / 2 + run;
  walk.push(...landing(g3, cx, laneY, mid));

  const g4 = leg('return');                      // back into the lane, climbing
  walk.push(...stairY(g4, cx, laneY + LAND / 2, b.cy, mid, b.gz - mid));
  walk.push(...landing(g4, cx, b.cy, b.gz));

  const g5 = leg('in');
  walk.push(...runX(g5, cx + LAND / 2, b.cy, b.gz, Math.max(1, b.gx - cx - LAND / 2)));
  walk.push(...b.laneWalk);
  out.edges.push({ from: a.id, to: b.id, walk });
}

/* -------------------------------- scene -------------------------------- */

/* Which dependencies deserve a causeway of their own.
 *
 * A DAG usually states a prerequisite twice: "you need A" and "you need B,
 * which needs A". Building stone for both means a second bridge that runs the
 * whole length of the world alongside a route that already exists — the single
 * biggest source of clutter. So we draw the transitive reduction: an edge is
 * built only when there is no other path between its ends. Unlocking still
 * uses the full dependency set; this only decides what gets carved. */
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

export function buildScene(graph) {
  const groups = [];
  const edges = [];
  const out = { groups, edges };

  // Monuments first: a path leaves a deck at the top of that monument's own
  // ramp, so the ramps have to exist before anything can be routed off them.
  const part = (n, part) => ({
    kind: 'node', nodeId: n.id, part, shapes: [],
    x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity,
  });

  for (const n of graph.nodes) {
    // Four pieces whose bounding boxes are separable along one axis: the mass
    // below the deck, the far flank, the lane itself, the near flank, and
    // whatever spans the lane overhead. The depth sort can then place the
    // traveller correctly among them.
    const T = { base: part(n, 'base'), back: part(n, 'back'), lane: part(n, 'lane'),
      front: part(n, 'front'), span: part(n, 'span') };
    substructure(T.base, n);
    parapet(T, n);
    n.laneWalk = laneRamp(T.lane, n);
    n.stand = n.laneWalk[n.laneWalk.length - 1];
    (ARCH[n.variant] || ARCH.keep)(T, n);
    for (const g of Object.values(T)) if (g.shapes.length) groups.push(g);
    n.anchor = P(n.gx + n.W, n.gy + n.D, n.gz - 5); // the south corner of its mass
  }

  // Adjacent-layer dependencies share one viaduct per corridor; anything that
  // jumps further gets its own route around the back.
  const byCorridor = new Map();
  for (const [a, b] of reduce(graph.nodes)) {
    if (b.depth - a.depth === 1) {
      if (!byCorridor.has(a.depth)) byCorridor.set(a.depth, []);
      byCorridor.get(a.depth).push([a, b]);
    } else {
      bypass(a, b, graph.minY, out);
    }
  }
  for (const [L, es] of byCorridor) corridor(L, es, out);

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
