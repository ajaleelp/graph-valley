/* The slice library.
 *
 * THE SOCKET CONTRACT
 * -------------------
 * The world is a coarse grid of square cells, CELL fine units on a side. Every
 * slice occupies exactly one cell and exposes up to four SOCKETS, one at the
 * midpoint of each cell edge, each either closed or open at a specific height.
 *
 *     Two slices stitch iff their facing sockets are both open
 *     and at the same height.
 *
 * Three consequences, and they are the whole reason for doing it this way:
 *
 *  1. SEAMLESSNESS IS AN INVARIANT, not something you eyeball. Matching socket
 *     heights means flush walking surfaces, and check.mjs asserts it.
 *
 *  2. WALKABILITY IS THE SAME FACT. Each slice puts a nav node exactly at each
 *     open socket, so stitched slices share a nav node by coordinate. The nav
 *     graph is connected iff the geometry is stitched.
 *
 *  3. FACE SUPPRESSION FALLS OUT FOR FREE. A vertical face at an open, matched
 *     socket is interior and must not be drawn, or every cell boundary shows a
 *     dark band. Only the +x and +y faces are ever drawn, so the slice holding
 *     the '+x' / '+y' socket owns the shared plane and suppresses it.
 *
 * The vocabulary is four templates. `court` is a place; `straight` and `corner`
 * are the connective tissue; `crossing` lets one path pass over another. A
 * stair is NOT a template — it is a straight whose sockets sit at different
 * heights.
 */

import { group, bx, faceT } from './iso.js';

export const CELL = 8;      // fine grid units per coarse cell
export const FLOOR = 4;     // levels gained per depth layer
export const WALK = 3;      // walkway width
export const SLAB = 1.2;    // walkway thickness
export const DECK = 2.6;    // court deck thickness
export const CLEAR = 1.6;   // half-width of the lane kept clear across a court
export const TREADS = 5;    // treads on a straight flight, flush at both ends

export const SIDES = ['-x', '+x', '-y', '+y'];
export const OPP = { '-x': '+x', '+x': '-x', '-y': '+y', '+y': '-y' };
export const DELTA = { '-x': [-1, 0], '+x': [1, 0], '-y': [0, -1], '+y': [0, 1] };
export const AXIS = { '-x': 'x', '+x': 'x', '-y': 'y', '+y': 'y' };
export const SIGN = { '-x': -1, '+x': 1, '-y': -1, '+y': 1 };

export const sideBetween = (a, b) =>
  b.u > a.u ? '+x' : b.u < a.u ? '-x' : b.v > a.v ? '+y' : '-y';

export const cellOrigin = (u, v) => ({ x: u * CELL, y: v * CELL });

/* The one place a socket's position is defined. Everything stitches through
 * this function, so two slices agreeing on (cell, side, z) agree exactly. */
export function socketPos(u, v, side, z) {
  const { x, y } = cellOrigin(u, v);
  const h = CELL / 2;
  if (side === '-x') return { x, y: y + h, z };
  if (side === '+x') return { x: x + CELL, y: y + h, z };
  if (side === '-y') return { x: x + h, y, z };
  return { x: x + h, y: y + CELL, z };
}

/* Which drawn faces of a full-width walkway are interior, given its two open
 * sides. Only walkways use this: see the note in court() for why a deck must
 * keep its faces. */
/* Which drawn faces of a full-width walkway are interior, given its two open
 * sides. Only walkways use this — see court() for why a deck keeps its faces. */
const skipFor = (sides) => (sides.includes('+x') ? 'r' : '') + (sides.includes('+y') ? 'l' : '');

/* ------------------------------------------------------------------ court -- */

/* Architecture sits in the four corners of the deck only. That is not a style
 * choice: it is what keeps all four socket lanes clear, so any court can accept
 * a path from any side without the geometry having to know which. The two far
 * corners may be tall; the two near ones stay low, because in this projection a
 * mass on the near half projects up and to the LEFT, straight over the middle
 * of the deck, and would hide whoever is standing there. */
/* Where architecture may stand.
 *
 * A court has a socket at the midpoint of every boundary cell edge, and each
 * one needs a clear lane through to the middle of the deck. So the buildable
 * ground is what is left between those lanes: for a 1x1 court that is the two
 * corners, for a 2x2 court the two corners and a wide slot between them. This
 * is derived from the socket contract rather than chosen, which is why a court
 * can accept a path on any side without the architecture ever having to know.
 *
 * Masses come within LANE_HALF of a lane's centre rather than clearing its full
 * width — a column standing at the edge of a walkway reads as a gatepost, and
 * the traveller walks the centreline. */
const LANE_HALF = 1.0;

/* How far the architecture stands back from the deck's edge. It must exceed the
 * traveller's half-width, or a court's masses overlap her when she is standing
 * on that edge's socket and the sort can no longer separate her from them. */
export const INSET = 0.9;

function massSlots(span) {
  const S = span * CELL;
  const out = [];
  let x = 0;
  for (let c = 0; c < span; c++) {
    out.push([x, c * CELL + CELL / 2 - LANE_HALF]);
    x = c * CELL + CELL / 2 + LANE_HALF;
  }
  out.push([x, S]);
  return out.map(([a, b]) => [a + INSET, b - INSET]).filter(([a, b]) => b - a > 0.9);
}

/* The far strip may be tall; the near strip stays low. That is not taste: in
 * this projection a mass on the near half projects up and to the LEFT, straight
 * over the middle of the deck, and would hide whoever is standing there. */
const FEATURE = {
  gate(B, F, A, c) {
    const h = 5 * c.tall;
    for (const [a, b] of c.far) c.mass(B, a, b, c.fy, c.fd, 0, h);
    c.mass(A, INSET, c.S - INSET, c.fy, c.fd, h, 0.9, 's', 't');   // lintel
    for (const [a, b] of c.near) c.mass(F, a, b, c.ny, c.nd, 0, 0.8);
  },
  pillars(B, F, A, c) {
    const h = 5.5 * c.tall;
    for (const [a, b] of c.far) {
      c.mass(B, a + 0.25, b - 0.25, c.fy + 0.25, c.fd - 0.5, 0, h);
      c.mass(B, a, b, c.fy, c.fd, h, 0.7);                          // capital
    }
    for (const [a, b] of c.near) c.mass(F, a, b, c.ny, c.nd, 0, 0.9);
  },
  blocks(B, F, A, c) {
    const h = 3.4 * c.tall;
    for (const [a, b] of c.far) {
      c.mass(B, a, b, c.fy, c.fd, 0, h);
      c.mass(B, a + 0.45, b - 0.45, c.fy + 0.45, c.fd - 0.9, h, h * 0.55);
    }
    for (const [a, b] of c.near) c.mass(F, a, b, c.ny, c.nd * 0.6, 0, 1.2);
  },
  obelisk(B, F, A, c) {
    const h = 6.5 * c.tall;
    c.far.forEach(([a, b], i) => {
      if (i === c.far.length - 1) {
        c.mass(B, a, b, c.fy, c.fd, 0, 1.1);
        c.mass(B, a + 0.6, b - 0.6, c.fy + 0.6, c.fd - 1.2, 1.1, h);
        c.mass(B, a + 0.9, b - 0.9, c.fy + 0.9, c.fd - 1.8, 1.1 + h, 1.1, 'a');
      } else c.mass(B, a, b, c.fy, c.fd, 0, 1.6);
    });
    for (const [a, b] of c.near) c.mass(F, a, b, c.ny, c.nd, 0, 0.8);
  },
  drum(B, F, A, c) {
    const h = 4.2 * c.tall;
    for (const [a, b] of c.far) {
      c.mass(B, a, b, c.fy, c.fd, 0, 1.2);
      c.mass(B, a + 0.5, b - 0.5, c.fy + 0.5, c.fd - 1, 1.2, h);
      c.mass(B, a + 0.2, b - 0.2, c.fy + 0.2, c.fd - 0.4, 1.2 + h, 0.6, 'a');
    }
    for (const [a, b] of c.near) c.mass(F, a + 0.4, b - 0.4, c.ny, c.nd, 0, 0.7);
  },
  /* The summit. Taller towers, an accent floor, and a mass floating over the
   * middle — high enough to walk under, so it blocks no lane. */
  summit(B, F, A, c) {
    const h = 8;
    for (const [a, b] of c.far) {
      c.mass(B, a, b, c.fy, c.fd, 0, h);
      c.mass(B, a - 0.3, b + 0.3, c.fy - 0.3, c.fd + 0.6, h, 0.9, 's', 'a');
    }
    for (const [a, b] of c.near) {
      c.mass(F, a, b, c.ny, c.nd, 0, h * 0.45);
      c.mass(F, a - 0.3, b + 0.3, c.ny - 0.3, c.nd + 0.6, h * 0.45, 0.8, 's', 'a');
    }
    c.mass(A, c.S / 2 - 1.6, c.S / 2 + 1.6, c.S / 2 - 1.6, 3.2, h + 3.4, 1.4, 'a');
  },
};

export function court(spec) {
  const { u, v, z, open, feature = 'pillars', id, tall = 1, span = 1 } = spec;
  const { x, y } = cellOrigin(u, v);
  const S = span * CELL;                        // footprint in fine units
  const base = group('slice', { slice: 'court', part: 'base', id, u, v });
  const back = group('slice', { slice: 'court', part: 'back', id, u, v });
  const front = group('slice', { slice: 'court', part: 'front', id, u, v });
  const spanG = group('slice', { slice: 'court', part: 'span', id, u, v });

  // Deck, taper and root. The deck spans the whole footprint, so every one of
  // its edges is already at the socket height: a court accepts a path from any
  // side without needing extra geometry.
  //
  // No face suppression here, unlike a walkway. A court's deck is DECK thick
  // and a walkway only SLAB, so where the two meet the deck's edge genuinely
  // shows below the bridge. Suppressing it would delete the platform's whole
  // right-hand side to hide a junction that is supposed to be visible.
  bx(base, x, y, z - DECK, S, S, DECK, 's', 't');
  bx(base, x + 1.4, y + 1.4, z - DECK - 2.2, S - 2.8, S - 2.8, 2.2, 's');
  bx(base, x + 2.8, y + 2.8, z - DECK - 4.8, S - 5.6, S - 5.6, 2.6, 'n');

  // The far strip runs along the low-y edge, the near strip along the high-y
  // edge, and the band between them stays clear for the +-x lanes.
  const slots = massSlots(span);
  const strip = CELL / 2 - LANE_HALF - INSET;
  const ctx = {
    S, tall, far: slots, near: slots,
    fy: INSET, fd: strip,
    ny: S - INSET - strip, nd: strip,
    // place a mass in world coordinates from deck-relative bounds
    mass: (g, a, b, y0, d, dz, h, mat = 's', top = mat) =>
      (b - a > 0.05 && d > 0.05 ? bx(g, x + a, y + y0, z + dz, b - a, d, h, mat, top) : null),
  };
  (FEATURE[feature] || FEATURE.pillars)(back, front, spanG, ctx);
  if (feature === 'summit') faceT(base, z, x + 2.6, y + 2.6, x + S - 2.6, y + S - 2.6, 'a-t');

  // Nav: the centre, plus one node per open socket, spoked to the centre. The
  // deck is solid, so a spoke is always a walkable straight line.
  const centre = { x: x + S / 2, y: y + S / 2, z };
  const nav = { nodes: [{ p: centre, tag: `court:${id}` }], edges: [] };
  const sockets = [];
  for (const o of open) {
    const p = socketPos(o.u, o.v, o.side, z);
    nav.nodes.push({ p });
    nav.edges.push([centre, p]);
    sockets.push({ u: o.u, v: o.v, side: o.side, z });
  }

  const cells = [];
  for (let du = 0; du < span; du++) for (let dv = 0; dv < span; dv++) cells.push({ u: u + du, v: v + dv });

  return {
    kind: 'court', u, v, id, span, cells,
    groups: [base, back, front, spanG].filter((g) => g.solids.length),
    sockets, nav, stand: centre,
  };
}

/* Every outward-facing cell edge of a footprint: the sockets a court COULD
 * open. A 1x1 court has four; a 2x2 has eight. Nothing else about the contract
 * changes, which is the point — a socket is identified by (cell, side), and
 * that identity does not care how big the slice behind it is. */
export function courtSockets(u, v, span) {
  const out = [];
  for (let du = 0; du < span; du++) for (let dv = 0; dv < span; dv++) {
    if (du === 0) out.push({ u: u + du, v: v + dv, side: '-x' });
    if (du === span - 1) out.push({ u: u + du, v: v + dv, side: '+x' });
    if (dv === 0) out.push({ u: u + du, v: v + dv, side: '-y' });
    if (dv === span - 1) out.push({ u: u + du, v: v + dv, side: '+y' });
  }
  return out;
}

/* --------------------------------------------------------------- straight -- */

/* A walkway straight across the cell. If the two sockets sit at different
 * heights it is a flight of steps instead — TREADS treads, arranged so the
 * surface is flush with z0 at the entry edge AND flush with z1 at the exit
 * edge. That flushness is the whole point: it is what lets the socket contract
 * be stated as an equality rather than an approximation.
 *
 * TREADS = 5 fixes FLOOR = 4: four risers of one level each across an 8-cell
 * span. That in turn makes CELL*TH === FLOOR*TZ (128 === 128), so a depth layer
 * advances PURE HORIZONTALLY on screen while climbing in world space. */
export function straight(spec) {
  const { u, v, from, to, z0, z1, id } = spec;
  const { x, y } = cellOrigin(u, v);
  const groups = [];
  const axis = AXIS[from];
  const c0 = (axis === 'x' ? y : x) + (CELL - WALK) / 2;   // near edge of the lane
  const a0 = axis === 'x' ? x : y;                          // low end of the run
  const skip = skipFor([from, to]);

  /* Each tread is its OWN group. That is not tidiness: the depth sort separates
   * two boxes only when one lies entirely on the near side of the other along
   * some axis, and a single group spanning the whole flight contains the
   * traveller outright — no axis separates them, so the sort cannot say whether
   * she is in front of the steps or behind them, and she sinks into the stairs.
   * One box per tread gives her a surface whose top is exactly her feet. */
  const put = (lo, len, top, thick, sk, part) => {
    const g = group('slice', { slice: 'straight', id, u, v, part });
    groups.push(g);
    return axis === 'x'
      ? bx(g, lo, c0, top - thick, len, WALK, thick, 's', 't', sk)
      : bx(g, c0, lo, top - thick, WALK, len, thick, 's', 't', sk);
  };

  const nav = { nodes: [], edges: [] };
  const pA = socketPos(u, v, from, z0);
  const pB = socketPos(u, v, to, z1);

  if (Math.abs(z1 - z0) < 1e-9) {
    put(a0, CELL, z0, SLAB, skip, 0);                      // one solid, no seams
    nav.nodes.push({ p: pA }, { p: pB });
    nav.edges.push([pA, pB]);
    return { kind: 'straight', u, v, id, cells: [{ u, v }], groups, sockets: [{ u, v, side: from, z: z0 }, { u, v, side: to, z: z1 }], nav };
  }

  // Rising. Tread i runs from the entry edge; heights step linearly so tread 0
  // is flush at z0 and tread TREADS-1 is flush at z1.
  const T = CELL / TREADS;
  const d = (z1 - z0) / (TREADS - 1);
  const up = SIGN[to] > 0;                                 // travelling toward +axis?
  let prev = pA;
  for (let i = 0; i < TREADS; i++) {
    const off = up ? i * T : CELL - (i + 1) * T;
    const top = z0 + i * d;
    // The tread touching the '+' edge owns the face at that socket, so it is
    // interior; the risers between treads stay, because they are the steps.
    const sk = (up && i === TREADS - 1) || (!up && i === 0) ? skip : '';
    put(a0 + off, T, top, SLAB + Math.abs(d), sk, i);
    const p = axis === 'x'
      ? { x: a0 + off + T / 2, y: c0 + WALK / 2, z: top }
      : { x: c0 + WALK / 2, y: a0 + off + T / 2, z: top };
    nav.nodes.push({ p });
    nav.edges.push([prev, p]);
    prev = p;
  }
  nav.edges.push([prev, pB]);
  nav.nodes.push({ p: pA }, { p: pB });
  return { kind: 'straight', u, v, id, cells: [{ u, v }], groups, sockets: [{ u, v, side: from, z: z0 }, { u, v, side: to, z: z1 }], nav };
}

/* ----------------------------------------------------------------- corner -- */

/* A turn: an arm in from one edge, a landing at the cell centre, an arm out to
 * an adjacent edge.
 *
 * Rising corners exist, but the router avoids them — it puts stairs on straight
 * cells wherever it can, because a bent flight reads worse. They are here so
 * that an awkwardly routed edge degrades instead of failing. */
export function corner(spec) {
  const { u, v, from, to, z0, z1, id } = spec;
  const { x, y } = cellOrigin(u, v);
  const groups = [];
  const g = group('slice', { slice: 'corner', id, u, v, part: 'flat' });
  const cx = x + CELL / 2, cy = y + CELL / 2, half = WALK / 2;
  const pA = socketPos(u, v, from, z0);
  const pB = socketPos(u, v, to, z1);
  const nav = { nodes: [{ p: pA }, { p: pB }], edges: [] };
  const lo0 = (side) => (AXIS[side] === 'x' ? x : y);       // cell's low edge on that axis

  /* One piece of the L: a span along `side`'s axis, WALK wide, centred on the
   * other axis. `sk` names the interior face it must not draw. */
  const piece = (side, lo, len, top, thick, sk, own = g) => (AXIS[side] === 'x'
    ? bx(own, lo, cy - half, top - thick, len, WALK, thick, 's', 't', sk)
    : bx(own, cx - half, lo, top - thick, WALK, len, thick, 's', 't', sk));

  const mid = (side, lo, len, top) => (AXIS[side] === 'x'
    ? { x: lo + len / 2, y: cy, z: top }
    : { x: cx, y: lo + len / 2, z: top });

  if (Math.abs(z1 - z0) < 1e-9) {
    // Three butted solids. For an arm on the '-' side the shared plane with the
    // landing is the arm's '+' face; for an arm on the '+' side that plane is
    // the landing's '+' face, and the arm's own '+' face is the open socket.
    // Either way the arm suppresses its '+' face and the landing suppresses
    // whichever '+' faces have an arm against them.
    for (const side of [from, to]) {
      const plus = SIGN[side] > 0;
      const lo = plus ? (AXIS[side] === 'x' ? cx : cy) + half : lo0(side);
      const len = CELL / 2 - half;
      piece(side, lo, len, z0, SLAB, AXIS[side] === 'x' ? 'r' : 'l');
    }
    const lskip = (from === '+x' || to === '+x' ? 'r' : '') + (from === '+y' || to === '+y' ? 'l' : '');
    bx(g, cx - half, cy - half, z0 - SLAB, WALK, WALK, SLAB, 's', 't', lskip);

    const centre = { x: cx, y: cy, z: z0 };
    nav.nodes.push({ p: centre });
    nav.edges.push([pA, centre], [centre, pB]);
    return { kind: 'corner', u, v, id, cells: [{ u, v }], groups: [g], sockets: [{ u, v, side: from, z: z0 }, { u, v, side: to, z: z1 }], nav };
    /* the level corner is one group on purpose: every box in it tops out at z0,
       which is exactly the traveller's feet, so the sort separates her cleanly */
  }

  /* Rising: five surfaces along the L — two treads in, the landing, two out —
   * flush with z0 at the entry edge and z1 at the exit edge, with a riser of
   * (z1-z0)/4 each, the same as a straight flight.
   *
   * They must not overlap. An earlier version ran both arms across the full
   * width of the turn, so the last tread in and the first tread out shared the
   * corner square. Two boxes that overlap in x AND y and straddle each other in
   * z cannot be separated by the depth sort, and the traveller standing on
   * either of them sank into the other.
   */
  const d = (z1 - z0) / 4;
  const arm = CELL / 2 - half;                            // edge to the landing
  const T = arm / 2;
  const runs = [];
  for (let i = 0; i < 2; i++) {                           // in, toward the centre
    const plus = SIGN[from] > 0;
    runs.push({
      side: from, len: T, top: z0 + i * d, outer: i === 0,
      lo: lo0(from) + (plus ? CELL - (i + 1) * T : i * T),
    });
  }
  for (let i = 0; i < 2; i++) {                           // out, away from it
    const plus = SIGN[to] > 0;
    runs.push({
      side: to, len: T, top: z0 + (i + 3) * d, outer: i === 1,
      lo: lo0(to) + (plus ? CELL / 2 + half + i * T : CELL / 2 - half - (i + 1) * T),
    });
  }

  let prev = pA;
  const emit = (r, i) => {
    // The only interior face is the one lying in an open socket's plane, and
    // only a '+' socket has a drawn face there. The rest are risers: keep them.
    const sk = r.outer && SIGN[r.side] > 0 ? (AXIS[r.side] === 'x' ? 'r' : 'l') : '';
    const own = group('slice', { slice: 'corner', id, u, v, part: i });   // see straight()
    groups.push(own);
    piece(r.side, r.lo, r.len, r.top, SLAB + Math.abs(d), sk, own);
    const p = mid(r.side, r.lo, r.len, r.top);
    nav.nodes.push({ p });
    nav.edges.push([prev, p]);
    prev = p;
  };

  emit(runs[0], 0);
  emit(runs[1], 1);

  const pad = group('slice', { slice: 'corner', id, u, v, part: 'landing' });
  groups.push(pad);
  const zMid = z0 + 2 * d;
  bx(pad, cx - half, cy - half, zMid - SLAB - Math.abs(d), WALK, WALK, SLAB + Math.abs(d), 's', 't',
    (from === '+x' || to === '+x' ? 'r' : '') + (from === '+y' || to === '+y' ? 'l' : ''));
  const centre = { x: cx, y: cy, z: zMid };
  nav.nodes.push({ p: centre });
  nav.edges.push([prev, centre]);
  prev = centre;

  emit(runs[2], 2);
  emit(runs[3], 3);

  nav.edges.push([prev, pB]);
  return { kind: 'corner', u, v, id, cells: [{ u, v }], groups, sockets: [{ u, v, side: from, z: z0 }, { u, v, side: to, z: z1 }], nav };
}

export const TEMPLATES = { court, straight, corner, crossing };

/* --------------------------------------------------------------- crossing -- */

/* One cell, two paths, one passing over the other.
 *
 * Orthogonal routes that own their cells outright cannot always be drawn in the
 * plane: three routes can ring a court and wall it off, and no ordering
 * heuristic makes that impossible. The way out is the one Monument Valley uses
 * on nearly every screen — let a path cross above another.
 *
 * It changes nothing about the contract. The cell still has four sockets, each
 * still names a height, and the seam check still holds. What it drops is the
 * assumption that a cell's four sockets belong to the SAME path: here they are
 * two pairs, and the nav graph deliberately leaves them unjoined. That is
 * ustwo's trick of putting two nav nodes in one place with different roles,
 * seen from the other end.
 */
/* Clearance between the two paths. It has to exceed the traveller's height plus
 * the upper slab's thickness, or she walks through the bridge above her. */
export const HEADROOM = 4;

export function crossing(spec) {
  const { u, v, hi, lo, id } = spec;
  const { x, y } = cellOrigin(u, v);
  const groups = [];
  const nav = { nodes: [], edges: [] };
  const sockets = [];

  // A group each, for the same reason the treads get one: a single box holding
  // both decks contains the traveller when she walks the lower one, and the
  // sort could then not tell whether she passes under the bridge or over it.
  for (const path of [lo, hi]) {
    const g = group('slice', { slice: 'crossing', id, u, v, part: path === lo ? 'lo' : 'hi' });
    groups.push(g);
    const axis = AXIS[path.from];
    const c0 = (axis === 'x' ? y : x) + (CELL - WALK) / 2;
    const a0 = axis === 'x' ? x : y;
    const skip = skipFor([path.from, path.to]);
    if (axis === 'x') bx(g, a0, c0, path.z - SLAB, CELL, WALK, SLAB, 's', 't', skip);
    else bx(g, c0, a0, path.z - SLAB, WALK, CELL, SLAB, 's', 't', skip);

    const pA = socketPos(u, v, path.from, path.z);
    const pB = socketPos(u, v, path.to, path.z);
    nav.nodes.push({ p: pA }, { p: pB });
    nav.edges.push([pA, pB]);                    // the two paths are NOT joined
    sockets.push({ u, v, side: path.from, z: path.z }, { u, v, side: path.to, z: path.z });
  }

  return { kind: 'crossing', u, v, id, cells: [{ u, v }], groups, sockets, nav };
}
