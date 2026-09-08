/* Following a walk.
 *
 * Pure and DOM-free, so the motion can be tested without a renderer — which
 * matters more than usual here, because "the avatar arrived" and "the avatar
 * moved cleanly to get there" are different claims and only the first one is
 * easy to check.
 *
 * Speed is constant in distance, not in hops. Nav hops vary from 1.6 units (one
 * stair tread) to about 9 (a spoke across a court deck), so pacing by hop would
 * make her crawl up stairs and bolt across platforms.
 */

import { group, bx, sortShapes, order, depthSort } from './iso.js';

export const HEIGHT = 2.4;   // total, feet to crown
export const HALF = 0.55;    // half-width; must stay under slices.INSET

/* Vertical distance is discounted: a step up a stair is less far than the same
 * number of units along the ground, and pacing by raw 3D length makes flights
 * feel slow. */
const RISE = 0.7;

export function plan(path) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y, (b.z - a.z) * RISE);
    seg.push(d);
    total += d;
  }
  return { path, seg, total };
}

/* Position at fraction `u` of the way along. u <= 0 is the start, u >= 1 the
 * end, exactly — no drift at either edge. */
export function at({ path, seg, total }, u) {
  if (!(u > 0)) return { ...path[0] };
  if (u >= 1 || total <= 0) return { ...path[path.length - 1] };

  let want = u * total;
  let i = 0;
  while (i < seg.length - 1 && want > seg[i]) { want -= seg[i]; i++; }
  const a = path[i], b = path[i + 1];
  const f = seg[i] > 0 ? Math.min(1, want / seg[i]) : 1;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
}

/* The largest step she may take between two frames, in world units. Above this
 * the motion stops reading as walking and starts reading as a skip. At 60fps
 * and full zoom it is about 34px on screen. */
const MAX_STEP = 1.4;
const FRAME = 1000 / 60;

/* How long the walk should take, in ms. Capped so a long journey stays
 * watchable, floored so a single hop is not a snap — and then stretched again
 * if the cap would force her to move faster than MAX_STEP per frame. A folded
 * world can put a band change several hundred units long in front of her, and
 * six seconds is not enough to cross that on foot. */
export function duration(total) {
  return Math.max(450, Math.min(6000, total * 70), (total / MAX_STEP) * FRAME);
}

/* The traveller: a shadow, a body, a hat brim and a head, as one group with a
 * compact box, so the depth sort can place her among the architecture rather
 * than always on top of it.
 *
 * The shadow starts at exactly her standing height rather than below it. That
 * keeps her group's z0 equal to the deck's z1, which is what lets the sort
 * separate her from the platform she is standing on instead of finding a cycle
 * and falling back to guesswork.
 */
export function traveller(p) {
  const g = group('you');
  // Her footprint has to stay clear of the next tread up (1.6 units along the
  // run), and her height has to fit under a crossing: HEADROOM - SLAB.
  bx(g, p.x - HALF, p.y - HALF, p.z, 2 * HALF, 2 * HALF, 0.01, 'shadow');
  bx(g, p.x - 0.46, p.y - 0.46, p.z, 0.92, 0.92, 1.35, 'body');
  bx(g, p.x - HALF, p.y - HALF, p.z + 1.35, 2 * HALF, 2 * HALF, 0.37, 'brim');
  bx(g, p.x - 0.34, p.y - 0.34, p.z + 1.72, 0.68, 0.68, 0.68, 'head');
  return sortShapes(g);
}

/* Placing the traveller in the draw order.
 *
 * She is sorted INTO the scene every frame rather than inserted into a
 * precomputed order. The obvious optimisation — sort the static world once,
 * then find the one slot she belongs in — is unsound, and was the bug behind
 * "she walks below the path". The scene order comes from a topological sort of
 * a PARTIAL order, so two groups that cannot be compared to each other are
 * separated by an arbitrary tie-break. She may be in front of the one the
 * tie-break put last and behind the one it put first, and then no single slot
 * satisfies both: at 427 of 505 walkable positions across the six worlds there
 * was no valid slot at all.
 *
 * Sorting the whole scene with her in it is exact by construction, and costs
 * 0.16ms for the largest world — a hundredth of a frame. The optimisation was
 * never worth its risk.
 */
export function orderWith(groups, her) {
  return depthSort(groups.concat([her]));
}
