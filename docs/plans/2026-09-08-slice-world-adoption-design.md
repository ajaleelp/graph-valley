# Adopting the slice world, and composing it for the screen

**Date:** 2026-09-08
**Status:** built and verified

## The question this answers

`poc/` proved a concept graph could become a walkable Monument Valley world
from four template slices. `public/` shipped a different, older world-builder
with four known defects. The curriculum pipeline worked end to end and the
front end called almost none of it.

How do we get to one product, without carrying the old renderer's bugs across?

## The shape of the answer

**One engine, not two.** The engine moves to a top-level `world/`, imported by
`public/` (the product), `poc/` (the whitebox lab), and `world/check.mjs` (the
assertions). Copying the POC into `public/` would have kept two builders with
different names. Promoting it means the 3154 assertions stop testing a proof of
concept and start testing shipped code — and the buggy renderer is *deleted*,
not fixed, so it has nowhere to live.

**What made it cheap.** Two accidents of history: the POC emits the same
material classes (`s`/`t`/`a`/`n` × `-t`/`-l`/`-r`) that `public/style.css`
already themes, and all the gold/locked/mist styling keys off `data-st` and
`data-veil` attributes on group elements. The new geometry inherited the
product's six chapter palettes essentially unchanged.

## Composition: the part that needed a model

The POC's known limit was "worlds get wide". The obvious fix — fold the world
like `public/`'s serpentine — had to be confirmed before adoption. It did not
survive contact with the arithmetic, twice, in opposite directions.

### The projection is rigid

One depth layer climbs `FLOOR`, so a layer step of `(a,b)` coarse cells lands at

```
dx = (a - b) * CELL * TW          dy = (a + b) * CELL * TH - FLOOR * TZ
```

which for our constants is `dx = (a-b)*256`, `dy = (a+b)*128 - 128`. Two
identities do all the work:

- `a + b = 1` ⟹ `dy = 0` — the band is **exactly level**.
- `a = b` ⟹ `dx = 0` — the step is **exactly vertical**.

A serpentine falls straight out: run a band level with `(a, 1-a)`, drop with
`(k,k)`, run the next band level mirrored. `public/`'s old serpentine got level
rows for free because z was constant within a row; the slice world climbs every
layer, so it must pay for level bands with width.

### First measurement: the fold looked worse

A level band needs `(+4,−3)` = **1792px per layer**, against the unfolded
`(+4,0)`'s 1024px plus 384px of useful downward drift. An exhaustive search over
layer steps, fold vectors and band widths, scored on a 16:9 viewport, found at
best a 9–14% improvement on deep worlds — most of it from changing the layer
*direction*, not from folding. Conclusion: don't fold.

### Second measurement: that was a desktop-only conclusion

Monument Valley is a phone game, and Ken Wong's constraint was that a level fits
one screen — *"without that you can't force great compositions"*, every level
*"a piece of graphic design"*. Re-scoring against phone portrait inverted the
result:

|          | unfolded            | best fold          |
|----------|---------------------|--------------------|
| desktop  | asp 0.07–0.67       | asp 1.94           |
| phone    | asp 1.27–2.14       | asp 0.00           |

Desktop (1.78) and phone (0.46) differ by 3.9× in aspect; `log₂(3.9) = 1.96`,
exactly the gap between the columns. **No fixed layout serves both.**

### What mist does not do

The tempting escape is "mist keeps the visible world small". It does not: the
summit is deliberately always revealed — a ghost on the horizon — so the
revealed bounding box spans the whole world from the first step to the last.
Measured over full playthroughs of all six authored graphs, the revealed area
never drops below 96% of the total. Mist hides detail, not extent.

### The model

Layers-per-band is a **viewport parameter**. `world/compose.js` enumerates
candidates (the unfolded `drift`, and `band` at every width), places every court
analytically, rejects any placement where courts collide, and scores the result:

- **aspect penalty** = `|log₂((W/H) / (Vw/Vh))|`, in octaves — logarithmic
  because twice too wide and half too wide are the same mistake;
- **fill** = fraction of the viewport covered once scaled to fit.

Folding is not free: a band change displaces `(k,k)` and is a long route. On
`deep` it took the world from 28 straights to 68 and forced the traveller to
move 1.6 units per frame. So a fold must beat the unfolded layout by a quarter
of an octave (~19%) before it is taken, and `duration()` stretches rather than
let her skip. Polygon cost of the folds actually chosen: 1.1–1.5×.

Result, aspect penalty in octaves:

|          | never fold   | chosen      |
|----------|--------------|-------------|
| desktop  | 0.07–0.67    | 0.03–0.19   |
| phone    | 1.27–2.14    | 0.03–1.04   |

None of this touches the socket contract. It moves courts; seams, sockets,
climb and nav are all downstream and unchanged. 64 assertions check it: bands
are exactly level, folds exactly vertical, the court-size model is checked
against real geometry rather than trusted, and every world composes and still
routes on all three reference viewports.

## The four defects, and why they cannot return

| Defect | Why it existed | Now |
|---|---|---|
| avatar painted over by her own walkway | `world.js` built a causeway leg as one group whose box *contained* her | one group per tread; her box is separable |
| `sortAvatar` satisfied half a constraint | inserted after the last group behind her, ignoring what she must precede | sorted **into** the scene each frame |
| a scalar painter's key can't order stacked solids | one key can't say "above its own root" and "behind what stands on it" | per-solid topological sort |
| a raised floor panel broke separation | `faceT` lifted the panel past the deck top | the panel sinks below its surface |

`assertOnStone` is gone too — it existed to catch the walk polylines disagreeing
with the stone. There is no second representation now: each slice puts a nav
node at each open socket, so the nav graph is connected **iff** the geometry is
stitched.

## Curriculum

The front end now runs `POST /api/negotiate` before building — backward design's
first stage, previously implemented and never called. And every check the
syllabus holds reaches the learner; carrying one per atom and showing the first
was the last place the document knew more than the learner ever saw.

## Known limitations, measured

- **Narrow goals can fall under the atom floor.** The negotiation makes goals
  more specific, and a tightly-scoped goal decomposes into fewer atoms.
  `MIN_KCS = 6` then rejects it, twice, and the syllabus falls back to demo
  content. Observed on two of three live topics. The floor exists for a good
  reason (weak models return three against a prompt asking for six to sixteen),
  so whether it should scale with goal breadth is a curriculum-design call, not
  a rendering one.
- **The layout is chosen once, at build time.** Rotating a phone re-fits the
  camera but does not re-compose the world; rebuilding mid-journey would
  invalidate the nav key the traveller is standing on.
- **A resumed journey on a cold server** falls back to a generic lesson: the
  syllabus lives in server memory, and `localStorage` carries only the goal.
