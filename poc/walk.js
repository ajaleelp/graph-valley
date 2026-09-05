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

import { group, bx, sortShapes } from './iso.js';

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

/* How long the walk should take, in ms. Capped so a long journey stays
 * watchable, floored so a single hop is not a snap. */
export function duration(total) {
  return Math.max(450, Math.min(6000, total * 70));
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
  bx(g, p.x - 0.8, p.y - 0.8, p.z, 1.6, 1.6, 0.01, 'shadow');
  bx(g, p.x - 0.6, p.y - 0.6, p.z, 1.2, 1.2, 1.7, 'body');
  bx(g, p.x - 0.72, p.y - 0.72, p.z + 1.7, 1.44, 1.44, 0.42, 'brim');
  bx(g, p.x - 0.45, p.y - 0.45, p.z + 2.12, 0.9, 0.9, 0.85, 'head');
  return sortShapes(g);
}
