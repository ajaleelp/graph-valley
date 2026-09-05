/* Graph Valley — isometric engine.
 *
 * Everything lives on an integer 3D grid and is projected with a true 2:1
 * isometric transform, so a unit cell is a real cube: the top face is a
 * 2*TW x 2*TH rhombus and the vertical edge is TZ = 2*TH tall. Because
 * TZ === 2 * TH the view direction in grid space is exactly (1, 1, 1), which
 * is what makes the depth sort below correct.
 *
 * Screen axes: +x runs right-and-down, +y runs left-and-down, +z runs up.
 * So the two visible vertical faces of a box are its +x side (drawn on the
 * right) and its +y side (drawn on the left).
 */

export const TW = 32; // half-width of a grid cell, in px
export const TH = 16; // half-depth of a grid cell, in px
export const TZ = 32; // height of one grid level, in px

export const P = (x, y, z) => ({ x: (x - y) * TW, y: (x + y) * TH - z * TZ });

const pts = (arr) => arr.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

/* --------------------------------------------------------------------------
 * Groups: one drawable unit with an axis-aligned bounding box in grid space.
 * A monument is one group; each leg of a causeway is its own group, so every
 * bounding box stays compact and the painter's-order sort stays exact.
 * ------------------------------------------------------------------------ */

function group(kind, meta = {}) {
  return {
    kind, ...meta,
    shapes: [],
    x0: Infinity, y0: Infinity, z0: Infinity,
    x1: -Infinity, y1: -Infinity, z1: -Infinity,
  };
}

function grow(g, x0, y0, z0, x1, y1, z1) {
  if (x0 < g.x0) g.x0 = x0; if (y0 < g.y0) g.y0 = y0; if (z0 < g.z0) g.z0 = z0;
  if (x1 > g.x1) g.x1 = x1; if (y1 > g.y1) g.y1 = y1; if (z1 > g.z1) g.z1 = z1;
}

/* --------------------------------- primitives --------------------------- */

/* Solid box occupying [x,x+w] x [y,y+d] x [z,z+h].
 * `side` is the material for the two vertical faces, `top` for the lid. */
export function bx(g, x, y, z, w, d, h, side = 's', top = side) {
  const t = z + h;
  const A = P(x, y, t), B = P(x + w, y, t), C = P(x + w, y + d, t), D = P(x, y + d, t);
  const b = P(x + w, y, z), c = P(x + w, y + d, z), e = P(x, y + d, z);
  const k = x + y + z;   // painter's key: the near-side corner of the solid
  g.shapes.push(
    { k, cls: `${side}-l`, pts: pts([D, C, c, e]) },  // +y face, screen-left
    { k, cls: `${side}-r`, pts: pts([B, C, c, b]) },  // +x face, screen-right
    { k, cls: `${top}-t`,  pts: pts([A, B, C, D]) },  // lid
  );
  grow(g, x, y, z, x + w, y + d, t);
  return g;
}

/* A flat inset panel on a box's +x (right) face — windows, doorways, niches. */
export function faceR(g, X, y0, z0, y1, z1, cls = 'k-r') {
  g.shapes.push({ k: X + y0 + z0 + 0.02, cls, pts: pts([P(X, y0, z1), P(X, y1, z1), P(X, y1, z0), P(X, y0, z0)]) });
}

/* The same on the +y (left) face. */
export function faceL(g, Y, x0, z0, x1, z1, cls = 'k-l') {
  g.shapes.push({ k: x0 + Y + z0 + 0.02, cls, pts: pts([P(x0, Y, z1), P(x1, Y, z1), P(x1, Y, z0), P(x0, Y, z0)]) });
}

/* A flat inset panel lying on a horizontal surface — courtyards, gardens, pools. */
export function faceT(g, Z, x0, y0, x1, y1, cls = 'k-t') {
  g.shapes.push({ k: x0 + y0 + Z + 0.02, cls, pts: pts([P(x0, y0, Z), P(x1, y0, Z), P(x1, y1, Z), P(x0, y1, Z)]) });
}

/* The soft contact shadow a mass casts onto the deck it stands on. One light
 * source, from the left, so the shadow falls a little to the +x side. Emitted
 * into the same group before the mass itself, so it lands under it. */
export function shade(g, x, y, z, w, d) {
  const ox = 0.55, oy = 0.25;
  g.shapes.push({
    // just under the mass that casts it, whatever order it was declared in
    k: x + y + z - 0.4,
    cls: 'sh-t',
    pts: pts([P(x + ox, y + oy, z), P(x + w + ox, y + oy, z), P(x + w + ox, y + d + oy, z), P(x + ox, y + d + oy, z)]),
  });
}

/* Hemisphere sitting on (cx, cy) at level z, radius r in grid units.
 * Drawn as a flat two-tone silhouette: lit left half, shaded right half. */
export function dome(g, cx, cy, z, r, mat = 's') {
  const c = P(cx, cy, z);
  const R = r * TW, ry = r * TH;
  const k = cx - r + cy - r + z;
  g.shapes.push({
    k, cls: `${mat}-t`, tag: 'path',
    d: `M ${c.x - R} ${c.y} A ${R} ${R} 0 0 1 ${c.x + R} ${c.y} A ${R} ${ry} 0 0 1 ${c.x - R} ${c.y} Z`,
  });
  g.shapes.push({
    k, cls: `${mat}-r`, tag: 'path',
    d: `M ${c.x} ${c.y - R} A ${R} ${R} 0 0 1 ${c.x + R} ${c.y} A ${R} ${ry} 0 0 1 ${c.x} ${c.y + ry} Z`,
  });
  grow(g, cx - r, cy - r, z, cx + r, cy + r, z + r);
}

/* Merlons along a top edge. Two big teeth, not a fine comb: at any distance a
 * comb dissolves into noise, while a pair of blocks still reads as a
 * battlement. */
export function crenels(g, x, y, z, w, d, axis = 'x', mat = 's') {
  const h = 1.1;
  if (axis === 'x') {
    bx(g, x, y, z, w * 0.38, d, h, mat);
    bx(g, x + w * 0.62, y, z, w * 0.38, d, h, mat);
  } else {
    bx(g, x, y, z, w, d * 0.38, h, mat);
    bx(g, x, y + d * 0.62, z, w, d * 0.38, h, mat);
  }
}

/* A row of columns carrying a heavy entablature. Few and thick: five slender
 * posts read as a comb once the camera pulls back, four solid ones still read
 * as a colonnade. */
export function colonnade(g, x, y, z, w, d, h, n, mat = 's', top = 't') {
  const gap = w / n;
  for (let i = 0; i < n; i++) bx(g, x + i * gap + gap * 0.14, y + d * 0.22, z, gap * 0.72, d * 0.56, h, mat);
  bx(g, x, y, z + h, w, d, 1.2, mat, top);
}

/* An ascending run of solid steps. Returns the walkable centre-line points.
 * Steps advance one cell along `axis` and rise `dz` levels each; the run is
 * `width` cells across. The top surface of the first step is at z0 + dz. */
export function stairs(g, x, y, z0, axis, n, width, dz = 1, mat = 't') {
  const walk = [];
  for (let i = 0; i < n; i++) {
    const top = z0 + (i + 1) * dz;
    const sx = axis === 'x' ? x + i : x;
    const sy = axis === 'y' ? y + i : y;
    const w = axis === 'x' ? 1 : width;
    const d = axis === 'y' ? 1 : width;
    bx(g, sx, sy, top - 1.6, w, d, 1.6, mat);
    walk.push({ x: sx + w / 2, y: sy + d / 2, z: top });
  }
  return walk;
}

/* A flat causeway slab whose walking surface is at level z. */
export function deck(g, x, y, z, w, d, mat = 't', thick = 1.4) {
  bx(g, x, y, z - thick, w, d, thick, mat);
  return [{ x: x + w / 2, y: y + d / 2, z }];
}

/* A low parapet wall: the raised kerb that turns a slab into a walkway and a
 * platform into a terrace. Sits ON the surface at `z`, so it never intersects
 * the slab below it and the depth sort stays acyclic. */
export function kerb(g, x, y, z, w, d, h = 0.8, mat = 's') {
  bx(g, x, y, z, w, d, h, mat);
}

/* --------------------------------------------------------------------------
 * Depth sort.
 *
 * With a (1,1,1) view direction, box A is strictly in front of box B whenever
 * A sits entirely on the near side of B along any one axis. That gives a
 * partial order over the groups; a topological sort turns it into a draw
 * order that is exact rather than approximate. Groups whose screen bounding
 * boxes miss each other cannot occlude, so they are never compared.
 * ------------------------------------------------------------------------ */

function screenBox(g) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const X of [g.x0, g.x1]) for (const Y of [g.y0, g.y1]) for (const Z of [g.z0, g.z1]) {
    const p = P(X, Y, Z);
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

/* -1 → a before b, 1 → b before a, 0 → no constraint. */
function order(a, b) {
  const E = 1e-6;
  if (a.x1 <= b.x0 + E) return -1;
  if (b.x1 <= a.x0 + E) return 1;
  if (a.y1 <= b.y0 + E) return -1;
  if (b.y1 <= a.y0 + E) return 1;
  if (a.z1 <= b.z0 + E) return -1;
  if (b.z1 <= a.z0 + E) return 1;
  return 0;
}

/* Painter's order WITHIN one group. The groups themselves are ordered exactly,
 * but a monument is a single group and its own pieces were previously drawn in
 * whatever order the archetype happened to declare them — so a tower on the far
 * flank could paint over the ramp in front of it. Sorting by each solid's near
 * corner fixes that; the sort is stable, so coincident pieces keep the order
 * they were built in. */
export function sortShapes(g) {
  g.shapes.sort((a, b) => (a.k ?? 0) - (b.k ?? 0));
  return g;
}

export function depthSort(groups) {
  const n = groups.length;
  const sb = groups.map(screenBox);
  const key = groups.map((g) => g.x0 + g.y0 + g.z0);
  const after = Array.from({ length: n }, () => []); // i -> groups that must follow i
  const indeg = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const A = sb[i], B = sb[j];
      if (A.x1 <= B.x0 || B.x1 <= A.x0 || A.y1 <= B.y0 || B.y1 <= A.y0) continue; // no overlap on screen
      const o = order(groups[i], groups[j]);
      if (o < 0) { after[i].push(j); indeg[j]++; }
      else if (o > 0) { after[j].push(i); indeg[i]++; }
    }
  }

  // Kahn's algorithm, always taking the furthest-back ready group so ties
  // resolve into a stable back-to-front order.
  const ready = [];
  for (let i = 0; i < n; i++) if (!indeg[i]) ready.push(i);
  const out = [];
  const seen = new Set();
  while (ready.length) {
    let best = 0;
    for (let i = 1; i < ready.length; i++) if (key[ready[i]] < key[ready[best]]) best = i;
    const u = ready.splice(best, 1)[0];
    out.push(groups[u]);
    seen.add(u);
    for (const v of after[u]) if (--indeg[v] === 0) ready.push(v);
  }
  // Any group left over sat in a cycle (interlocking geometry): fall back to
  // the approximate key so nothing is ever dropped from the scene.
  if (out.length < n) {
    const rest = [];
    for (let i = 0; i < n; i++) if (!seen.has(i)) rest.push(i);
    rest.sort((a, b) => key[a] - key[b]);
    for (const i of rest) out.push(groups[i]);
  }
  return out;
}
