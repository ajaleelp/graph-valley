/* Isometric projection, primitives and exact depth sort.
 *
 * A true 2:1 isometric transform: TW=32, TH=16, TZ=32. Because TZ === 2*TH the
 * view direction in grid space is exactly (1,1,1), which is what makes the
 * depth sort below exact rather than approximate.
 *
 * Screen axes: +x runs right-and-down, +y runs left-and-down, +z runs up. So
 * the two visible vertical faces of a box are its +x side (drawn right) and its
 * +y side (drawn left), and larger coordinates are nearer the camera.
 *
 * (The projection and sort are carried over from the main renderer, which is
 * the one part of it that is unambiguously right. Everything else here is new.)
 */

export const TW = 32;
export const TH = 16;
export const TZ = 32;

export const P = (x, y, z) => ({ x: (x - y) * TW, y: (x + y) * TH - z * TZ });

const pts = (arr) => arr.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

/* A drawable unit with an axis-aligned bounding box in grid space. A slice emits
 * one or more of these; the sort below orders whole groups against each other,
 * so a group's box needs to stay compact and separable from its neighbours'.
 *
 * Inside a group, the individual SOLIDS are ordered by the same exact rule.
 * They have to be: a court's deck sits above its own taper and root, and no
 * single scalar key can express "above" and "in front of" at once — key by the
 * near corner and the root paints over the deck; key by the far corner and the
 * deck paints over anything standing on it. */
export function group(kind, meta = {}) {
  return {
    kind, ...meta,
    solids: [], shapes: [],
    x0: Infinity, y0: Infinity, z0: Infinity,
    x1: -Infinity, y1: -Infinity, z1: -Infinity,
  };
}

function grow(g, x0, y0, z0, x1, y1, z1) {
  if (x0 < g.x0) g.x0 = x0; if (y0 < g.y0) g.y0 = y0; if (z0 < g.z0) g.z0 = z0;
  if (x1 > g.x1) g.x1 = x1; if (y1 > g.y1) g.y1 = y1; if (z1 > g.z1) g.z1 = z1;
}

function solid(g, x0, y0, z0, x1, y1, z1, shapes) {
  g.solids.push({ x0, y0, z0, x1, y1, z1, shapes });
  grow(g, x0, y0, z0, x1, y1, z1);
  return g;
}

/* Solid box occupying [x,x+w] x [y,y+d] x [z,z+h]. `side` is the material for
 * the two vertical faces, `top` for the lid. */
export function bx(g, x, y, z, w, d, h, side = 's', top = side, skip = '') {
  const t = z + h;
  const A = P(x, y, t), B = P(x + w, y, t), C = P(x + w, y + d, t), D = P(x, y + d, t);
  const b = P(x + w, y, z), c = P(x + w, y + d, z), e = P(x, y + d, z);
  // `skip` suppresses a vertical face that is interior — butted against another
  // solid. Only the +x ('r') and +y ('l') faces are ever drawn, so a shared
  // plane between two solids is owned by exactly one of them: the one on the
  // low side. That is what keeps a walkway crossing many cells from showing a
  // seam at every cell boundary. See slices.js — the socket contract says
  // precisely which faces are interior.
  const shapes = [];
  if (!skip.includes('l')) shapes.push({ cls: `${side}-l`, pts: pts([D, C, c, e]) });  // +y, screen-left
  if (!skip.includes('r')) shapes.push({ cls: `${side}-r`, pts: pts([B, C, c, b]) });  // +x, screen-right
  shapes.push({ cls: `${top}-t`, pts: pts([A, B, C, D]) });                            // lid
  return solid(g, x, y, z, x + w, y + d, t, shapes);
}

/* A flat panel lying on a horizontal surface, for markings that must not add
 * height.
 *
 * Its hair of thickness hangs BELOW the surface, never above. A panel that rose
 * even 0.01 above its host lifted the whole group's bounding box past the deck
 * top, and that top is exactly what the sort uses to separate the platform from
 * whoever is standing on it — so an inlaid floor tile was enough to make the
 * traveller unorderable against the court she was standing in. Being inset, the
 * panel still sorts above the deck on the near-corner tie-break. */
export function faceT(g, Z, x0, y0, x1, y1, cls = 'a-t') {
  return solid(g, x0, y0, Z - 0.01, x1, y1, Z,
    [{ cls, pts: pts([P(x0, y0, Z), P(x1, y0, Z), P(x1, y1, Z), P(x0, y1, Z)]) }]);
}

/* --------------------------------- depth sort --------------------------- */

function screenBox(g) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const X of [g.x0, g.x1]) for (const Y of [g.y0, g.y1]) for (const Z of [g.z0, g.z1]) {
    const p = P(X, Y, Z);
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

/* -1 -> a before b, 1 -> b before a, 0 -> no constraint. With a (1,1,1) view
 * direction, A is strictly in front of B whenever A sits entirely on the near
 * side of B along any one axis. */
export function order(a, b) {
  const E = 1e-6;
  if (a.x1 <= b.x0 + E) return -1;
  if (b.x1 <= a.x0 + E) return 1;
  if (a.y1 <= b.y0 + E) return -1;
  if (b.y1 <= a.y0 + E) return 1;
  if (a.z1 <= b.z0 + E) return -1;
  if (b.z1 <= a.z0 + E) return 1;
  return 0;
}

/* Back-to-front order for a list of boxes: the partial order above resolved by
 * Kahn's algorithm, comparing only pairs whose SCREEN boxes overlap, since
 * boxes that miss each other on screen cannot occlude either way. */
export function topoSort(boxes) {
  const n = boxes.length;
  if (n < 2) return boxes.slice();
  const sb = boxes.map(screenBox);
  const key = boxes.map((g) => g.x0 + g.y0 + g.z0);
  const after = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const A = sb[i], B = sb[j];
      if (A.x1 <= B.x0 || B.x1 <= A.x0 || A.y1 <= B.y0 || B.y1 <= A.y0) continue; // cannot occlude
      const o = order(boxes[i], boxes[j]);
      if (o < 0) { after[i].push(j); indeg[j]++; }
      else if (o > 0) { after[j].push(i); indeg[i]++; }
    }
  }

  // Always take the furthest-back ready box, so ties resolve into a stable
  // back-to-front order.
  const ready = [];
  for (let i = 0; i < n; i++) if (!indeg[i]) ready.push(i);
  const out = [];
  const seen = new Set();
  while (ready.length) {
    let best = 0;
    for (let i = 1; i < ready.length; i++) if (key[ready[i]] < key[ready[best]]) best = i;
    const u = ready.splice(best, 1)[0];
    out.push(boxes[u]);
    seen.add(u);
    for (const v of after[u]) if (--indeg[v] === 0) ready.push(v);
  }
  // Anything left sat in a cycle (interlocking geometry): fall back to the
  // approximate key so nothing is ever dropped from the scene.
  if (out.length < n) {
    const rest = [];
    for (let i = 0; i < n; i++) if (!seen.has(i)) rest.push(i);
    rest.sort((a, b) => key[a] - key[b]);
    for (const i of rest) out.push(boxes[i]);
  }
  return out;
}

/* Settle a group's own solids and flatten them into a draw list. */
export function sortShapes(g) {
  g.shapes = topoSort(g.solids).flatMap((s) => s.shapes);
  return g;
}

export const depthSort = topoSort;

export function boundsOf(groups) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of groups) {
    for (const X of [g.x0, g.x1]) for (const Y of [g.y0, g.y1]) for (const Z of [g.z0, g.z1]) {
      const p = P(X, Y, Z);
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
  }
  return { x0, y0, x1, y1 };
}
