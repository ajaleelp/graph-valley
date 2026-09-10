/* The destination, as a place rather than a progress bar.
 *
 * The capstone was an HTML card pinned under the HUD. It carried the right
 * information — the goal, and how far along the climb she was — and it read as
 * chrome, because that is what it was. Nothing about it suggested somewhere you
 * could stand.
 *
 * So it is built here out of the same primitives as everything else she walks
 * on, and it inherits the chapter palette through the same material classes.
 * The one difference is where it is DRAWN: this geometry goes into its own
 * layer, positioned in screen space, so it never enters the world's bounding
 * box. That distinction is load-bearing. Pinning the summit inside the world is
 * what kept the revealed area above 96% of the whole valley and left the mist
 * with nothing to hide; taking it out dropped the opening view to 16%. It has
 * to look like a place and not be one.
 *
 * It is deliberately not one of the four templates. Nothing stitches to it,
 * nothing walks on it, and the socket contract has no opinion about a thing
 * that exists only in the sky.
 */

import { group, bx, faceT, sortShapes, depthSort, boundsOf } from './iso.js';

/** Grid units. Small: this is seen at a distance, above the weather. */
const S = 11;          // footprint
const DECK = 2.2;      // how thick the island reads
const COL = 1.5;       // column width
const H = 7.5;         // column height

/* A floating island with a colonnade and something bright held above it.
 *
 * `reach` runs 0..1 with the climb. It does not change the architecture — a
 * destination that rebuilds itself as you approach is a different destination —
 * it only lifts the crown, so the thing at the top opens as she gets nearer.
 */
export function buildSummit({ reach = 0 } = {}) {
  const base = group('summit', { part: 'base' });
  const far = group('summit', { part: 'far' });
  const near = group('summit', { part: 'near' });
  const crown = group('summit', { part: 'crown' });

  // The island: deck, taper, and a root hanging into nothing. Same three-part
  // shape as every court, so it reads as the same world.
  bx(base, 0, 0, -DECK, S, S, DECK, 's', 't');
  bx(base, 1.6, 1.6, -DECK - 2.4, S - 3.2, S - 3.2, 2.4, 's');
  bx(base, 3.4, 3.4, -DECK - 2.4 - 4.6, S - 6.8, S - 6.8, 4.6, 'n');
  faceT(base, 0, 2.6, 2.6, S - 2.6, S - 2.6, 'a-t');

  // Four columns and the lintel they carry. The far pair goes in the far group
  // and the near pair in the near group, so the depth sort has something to
  // separate them by — the same rule the walkable world lives under, kept here
  // because a monument that paints over its own columns looks broken wherever
  // it is drawn.
  const inset = 1.5;
  const x1 = inset, x2 = S - inset - COL;
  for (const x of [x1, x2]) {
    bx(far, x, inset, 0, COL, COL, H);
    bx(far, x - 0.3, inset - 0.3, H, COL + 0.6, COL + 0.6, 0.7, 's', 'a');
  }
  for (const x of [x1, x2]) {
    bx(near, x, S - inset - COL, 0, COL, COL, H * 0.72);
    bx(near, x - 0.3, S - inset - COL - 0.3, H * 0.72, COL + 0.6, COL + 0.6, 0.6, 's', 'a');
  }
  bx(far, inset - 0.4, inset - 0.4, H + 0.7, S - 2 * inset + 0.8, COL + 0.8, 0.9, 's', 't');

  // The crown: a bright mass held over the middle, rising as the climb closes.
  const lift = 2.6 + reach * 3.2;
  const c = S / 2;
  bx(crown, c - 1.7, c - 1.7, H + lift, 3.4, 3.4, 1.5, 'a');
  bx(crown, c - 0.7, c - 0.7, H + lift + 1.5, 1.4, 1.4, 1.9, 'a');

  const groups = [base, far, near, crown].filter((g) => g.solids.length);
  for (const g of groups) sortShapes(g);
  return { groups: depthSort(groups), bounds: boundsOf(groups) };
}
