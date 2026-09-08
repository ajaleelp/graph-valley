/* Choosing the shape of the world for the screen it will be seen on.
 *
 * Monument Valley's answer to "make it pleasant on screen" was a hard
 * constraint, not a flourish. Ken Wong: the playing area was reduced to fit on
 * a single screen, because without that you cannot force great compositions —
 * every level had to read as a piece of graphic design. Levels do not scroll.
 *
 * We cannot take that literally: a curriculum has as many platforms as it has,
 * and we may not cut content to make a picture. Nor does the mist save us —
 * the summit is deliberately always revealed, "a ghost on the horizon", so the
 * revealed bounding box spans the whole world from the first step to the last.
 * Measured over a full playthrough of all six authored graphs, the revealed
 * area never shrinks below 96% of the total. Mist hides detail, not extent.
 *
 * What we can do is choose the world's PROPORTIONS to suit the viewport, and
 * that turns out to be forced rather than tasteful. The projection is rigid:
 * one depth layer climbs FLOOR, so a layer step of (a,b) coarse cells lands at
 *
 *     dx = (a - b) * CELL * TW        dy = (a + b) * CELL * TH - FLOOR * TZ
 *
 * which for our constants is dx = (a-b)*256, dy = (a+b)*128 - 128. Two
 * consequences do all the work here:
 *
 *   a + b === 1  =>  dy === 0.  The band is LEVEL. Layers read as a row.
 *   a === b      =>  dx === 0.  The step is straight DOWN the screen.
 *
 * So a serpentine falls out of the arithmetic: run a band of layers level with
 * (a, 1-a), drop to the next band with (k, k), and run the next band level in
 * the mirrored direction (1-a, a). Every band is exactly level, every fold is
 * exactly vertical, and nothing about the socket contract is disturbed — this
 * changes only where courts are PLACED, never how they stitch.
 *
 * The free parameter is N, layers per band. It is not a matter of taste:
 * desktop (16:9 = 1.78) and phone portrait (390:844 = 0.46) differ by a factor
 * of 3.9, and log2(3.9) = 1.96 — so a layout tuned for one is off by about two
 * octaves for the other. No single N serves both. We therefore score the
 * candidates against the actual viewport and pick.
 *
 * Measured aspect penalty (see below) across the six authored graphs, best N
 * per viewport versus never folding:
 *
 *            never fold        best N
 *   desktop  0.07 - 0.67    0.13 - 0.70
 *   phone    1.27 - 2.14    0.07 - 1.01
 *   tablet   1.83 - 4.00    0.01 - 0.79
 *
 * Landscape barely moves, which is why the unfolded layout looked fine for so
 * long: it was only ever being judged on a laptop.
 */

import { P, TW, TH, TZ } from './iso.js';
import { CELL, FLOOR, DECK } from './slices.js';

/* Free coarse cells between courts, over and above their span. Lives here
 * rather than in layout.js because it is the constant that decides whether a
 * candidate layout is placeable, and layout.js imports the answer. */
export const GAP = 2;

/* Cells that must separate two courts: their own footprint, plus the gap that
 * leaves room for a walkway to pass between them. */
export const clearance = (span) => span + GAP;

/* How much screen one court occupies, derived from the geometry rather than
 * measured, so it cannot drift out of step with slices.js. The footprint spans
 * `span * CELL` fine units on each axis; the masses reach ARCH above the deck
 * and the root hangs ROOT below it.
 *
 * check.mjs asserts this against a real court's screen box. */
const ROOT = DECK + 2.2 + 2.6;      // deck underside, taper, root
const ARCH = 11;                    // tallest ordinary feature above the deck
export function courtScreen(span) {
  const foot = span * CELL;
  return {
    w: 2 * foot * TW,
    h: 2 * foot * TH + (ROOT + ARCH) * TZ,
  };
}

/* --------------------------------- scoring ------------------------------- */

/* Aspect penalty in octaves: 0 is a world shaped exactly like the screen, 1 is
 * one octave out (twice as wide, relatively), 2 is four times out. Logarithmic
 * because being twice too wide and half too wide are the same mistake.
 *
 * Fill is the fraction of the viewport covered once the world is scaled to fit.
 * The two are related but not redundant: fill collapses as the penalty grows,
 * and it is the number a person actually perceives ("the world is a stripe in
 * the middle of my phone"). */
export function score(box, [vw, vh]) {
  const aspect = Math.abs(Math.log2((box.w / box.h) / (vw / vh)));
  const k = Math.min(vw / box.w, vh / box.h);
  return { aspect, fill: (box.w * k * box.h * k) / (vw * vh) };
}

/* ------------------------------- candidates ------------------------------ */

/* The two families worth considering.
 *
 * `drift` is what the world did before any of this: every layer steps (step,0),
 * which is neither level nor vertical but diagonally down-right. It wastes no
 * space on a landscape screen, and it is still the best answer there.
 *
 * `band` is the serpentine derived above. It is the answer everywhere else. */
export function candidates({ layers, span, laneStep }) {
  const step = clearance(span);
  const out = [{ mode: 'drift', bands: layers, step, laneStep, lane: { u: 0, v: laneStep } }];
  // A level band needs a + b = 1 with both courts clear of each other, so the
  // smallest usable step along the band is (step, 1 - step).
  for (let bands = 1; bands <= layers; bands++) {
    out.push({ mode: 'band', bands, step, laneStep, lane: { u: laneStep, v: laneStep } });
  }
  return out;
}

/* The (u,v) origin of each depth layer under a given candidate. */
export function anchors(plan, layers) {
  const { mode, bands, step } = plan;
  const out = [];
  let u = 0, v = 0;
  for (let d = 0; d < layers; d++) {
    if (d > 0) {
      if (mode === 'drift') u += step;
      else if (d % bands === 0) { u += plan.fold; v += plan.fold; }      // straight down
      else if (Math.floor(d / bands) % 2 === 0) { u += step; v += 1 - step; }  // level, right
      else { u += 1 - step; v += step; }                                 // level, left
    }
    out.push({ u, v });
  }
  return out;
}

/* The vertical drop between bands has to clear a whole court plus however many
 * lanes stack below it, or one band paints into the next. dy = (2k-1)*TH*CELL/4
 * for a (k,k) step... in our constants, (2k-1)*128. */
export function foldFor(span, maxLanes, laneStep) {
  const court = courtScreen(span);
  const laneDy = laneStep * CELL * TH * 2;          // a (laneStep, laneStep) offset
  const need = court.h + (maxLanes - 1) * laneDy;
  // dy for a (k,k) step carrying one FLOOR of climb.
  const dy = (k) => 2 * k * CELL * TH - FLOOR * TZ;
  for (let k = clearance(span); k < 80; k++) if (dy(k) >= need) return k;
  return 80;
}

/* ------------------------------- the choice ------------------------------ */

/* Place every court analytically and measure the result. Cheap — this is a few
 * hundred arithmetic operations per candidate, and it runs once per world. */
export function boxOf(plan, layers, laneCounts, span) {
  const anch = anchors(plan, layers);
  const court = courtScreen(span);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const seen = [];
  for (let d = 0; d < layers; d++) {
    const n = laneCounts[d] || 1;
    for (let i = 0; i < n; i++) {
      const o = i - Math.floor((n - 1) / 2);
      const u = anch[d].u + o * plan.lane.u;
      const v = anch[d].v + o * plan.lane.v;
      for (const q of seen) {
        if (Math.max(Math.abs(q.u - u), Math.abs(q.v - v)) < clearance(span)) return null;
      }
      seen.push({ u, v });
      const p = P(u * CELL, v * CELL, d * FLOOR);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
  }
  return { w: x1 - x0 + court.w, h: y1 - y0 + court.h };
}

/* Folding is not free, so it has to earn its place.
 *
 * A band change displaces (k,k) — nine cells in each axis on a two-lane world —
 * and that is a route the grid has to find room for. Measured on the `deep`
 * graph, folding took the walkway count from 28 straights to 68: more than
 * twice the stone, and a walk long enough that the traveller had to move
 * 1.6 units per frame to cross it in the time allowed.
 *
 * So a fold must beat the unfolded layout by a real margin, not a rounding
 * error. A quarter of an octave is about a 19% improvement in proportion —
 * below that, the extra stone costs more than the composition gains. */
const FOLD_MARGIN = 0.25;

/* Pick the layout whose proportions best match the screen.
 *
 * A candidate that cannot be placed without courts colliding is discarded
 * outright. `drift` is the incumbent and keeps the world unless a fold clears
 * FOLD_MARGIN. */
export function choose({ layers, laneCounts, span, viewport, laneStep = null }) {
  const step = clearance(span);
  const lane = laneStep ?? step;
  const maxLanes = Math.max(1, ...laneCounts);
  const fold = foldFor(span, maxLanes, lane);

  let incumbent = null, best = null;
  for (const plan of candidates({ layers, span, laneStep: lane })) {
    plan.fold = fold;
    const box = boxOf(plan, layers, laneCounts, span);
    if (!box) continue;
    const cand = { plan, box, score: score(box, viewport) };
    if (plan.mode === 'drift') { incumbent = cand; continue; }
    if (!best || cand.score.aspect < best.score.aspect
      || (cand.score.aspect === best.score.aspect && cand.score.fill > best.score.fill)) best = cand;
  }
  if (!incumbent) return best;
  if (!best) return incumbent;
  return best.score.aspect <= incumbent.score.aspect - FOLD_MARGIN ? best : incumbent;
}
