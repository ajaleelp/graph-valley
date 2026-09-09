# The ascent: a capstone in the sky, and a course built one module at a time

**Date:** 2026-09-09
**Status:** design, with the two load-bearing risks measured

## What changes, in one paragraph

The capstone stops being a platform at the end of a valley and becomes a
destination floating above the clouds, visible from the first moment and
reachable only at the last. The course is no longer generated in one call:
first a handful of **modules**, then — one at a time, as she approaches them —
the atoms inside a module. Each module is its own small world, sized to one
screen. She works up through it, and when it is finished the next one arrives:
stairs appear, or the ground lifts. Mist is no longer decoration. It is the
edge of what has been decided.

## Why: the two measurements

### 1. Lifting the capstone is what makes mist work

Mist today cannot shrink the view, because the summit is deliberately always
revealed and it pins the bounding box. Measured over full playthroughs of the
six authored graphs, the revealed area never drops below **96%** of the whole
world. You are always looking at everything.

Take the capstone out of the world and put it in the sky, and the revealed area
at the start of a journey falls to:

| world | revealed area, summit pinned | capstone in the sky |
|---|---|---|
| deep | 100% | **16%** |
| branching | 100% | **31%** |
| chain | 100% | 38% |
| wide | 100% | 50% |

That is the whole argument. It also unlocks the second half of the design: if
the summit must be drawn, the entire graph must exist before anything can be
drawn. Once the world is allowed to end in mist, the part beyond the mist does
not have to exist yet.

### 2. Module-scoped decomposition validates; whole-course decomposition does not

The risk that would have sunk this: if a module fails validation as often as a
whole course does, we have moved the fallback rather than fixed it. Measured on
three real goals, including the one that failed in live testing:

| Goal | Whole course, one call | Module-scoped |
|---|---|---|
| Develop a fundraising strategy *(create)* | **fallback** — `kc-unused`, `summit-below-goal` | **CLEAN**, both modules |
| Implement a supervised learning algorithm *(create)* | `llm-retry` | **CLEAN**, both modules |
| Explain how vaccines work *(understand)* | `llm-retry` | **CLEAN**, both modules |

Six of six module decompositions passed on the first attempt, with no retry.

This is not surprising in hindsight. A whole course must satisfy every rule at
once over sixteen atoms with one shot at it; a module satisfies the same rules
over five. `too-few-atoms` disappears because a module is *allowed* to be
small — the floor moves to the course, which now has 36 to 42 atoms rather than
six to nine. `summit-below-goal` is satisfied by the module planner, which is
told the last module must reach the goal's level, and did so in both
create-level cases.

The module graphs also branch on their own: `roots=2, joins=2` for vaccines.
Forks arrive at the scale where a learner can actually feel them — "which part
of this do I take next" — rather than between two adjacent atoms.

### 3. Module-sized worlds route and compose (150/150)

150 random 3-to-7-platform worlds, on three viewports: **every one routed with
zero problems**. Median aspect penalty 0.12 on desktop, fill 0.92.

One correction to an earlier claim. I said the viewport fold would become
unnecessary at module scale. Half true:

| viewport | never fold (median/worst) | chosen (median/worst) |
|---|---|---|
| desktop | 0.12 / 0.79 | 0.12 / 0.46 — **fold gains nothing** |
| phone | 1.83 / 2.14 | 0.50 / 1.15 — **fold gains 1.33 octaves** |

So `compose.js` stays. It stops mattering on landscape and keeps carrying
portrait entirely.

## The architecture

### Two graphs, two scales

- **The module graph** — 4 to 7 modules, a DAG, generated once, cheap. This is
  the journey: what is available, what is locked, where it forks.
- **The atom graph inside one module** — 5 to 8 atoms, generated when she
  approaches that module. This is a level: a small world, one screen.

The existing engine renders the second unchanged. The first is progression
state, not geometry.

### What she sees

- **The capstone**, fixed high above, drawn in screen space rather than world
  space so it never enters the bounding box and never scales away. Always
  visible from the first second. It is what the mist is between her and.
- **The module she is in** — a handful of platforms, hers to walk.
- **Below her**, the modules she has finished, receding into cloud.
- **Above her**, nothing yet — mist. When a module is unlocked, the way up
  appears: a flight of stairs, or ground that lifts into place.

The metaphor shifts from a valley you cross to a tower you climb. Worth saying
out loud, because the project is called Graph Valley.

### Mist as the generation boundary

Today mist means "not yet unlocked". It comes to mean "not yet decided", which
is the same thing seen from the system's side, and it is honest: there is
genuinely nothing above her until the next module is generated. Generation of
module N+1 starts when she enters module N, so the stairs are ready before she
needs them, and the loading screen disappears after the first module.

### The way up appears

A stair that appears is not new machinery. `poc/README.md` already observes
that under the socket contract a moving path is cheap: a pivot is a slice whose
socket moves from one side to another, and the seam check says whether it has
landed. The same holds for a flight that arrives — it is a slice whose sockets
open, and `check.mjs` asserts the seam is flush the moment it does.

## Schema

```
course = {
  topic, goal, capstone,
  modules: [{ id, title, outcome, level, requires[], state, world? }]
}
```

`state` is one of `locked | ready | generating | open | done`. `world` is the
atom-level document, absent until generated.

The existing syllabus document becomes the per-module document, unchanged in
shape — which is why `pack`, `validate`, `project` and the renderer all survive
untouched. `MIN_KCS` moves from the course to the module and drops from 6 to 3.

## The two prompts

**Call 1, the module planner** (new). Tested; the version used in the risk test
is in the design's test script and produced clean, branching module graphs:

```
Break this into 4 to 7 MODULES — the large steps of the journey, in the order
they must be learned. A module is a coherent chunk that takes a sitting or two,
not a single idea and not the whole course.

{"modules": [{"id","title","outcome","level","requires"[]}]}

- The LAST module must reach "{goal.level}", the level the goal asks for.
- "requires" must form a DAG. Where two modules genuinely do not depend on
  each other, say so.
- No filler. No "Introduction", no "Advanced Topics", no "Conclusion".
```

**Call 2, the atom decomposer** — today's `decomposePrompt`, unchanged, with
the module's `outcome` as the goal and `"Show you can: {outcome}"` as the
capstone. It already works; that is what the risk test measured.

## Look

The world is repetitive today for reasons that are entirely mechanical: four
architecture templates dealt round-robin by array index, and every platform the
same size because `assignSpans` returns 2 unconditionally. Meanwhile every atom
already carries `type` (fact/concept/procedure/principle) and `level`
(remember…create), and the renderer reads neither.

So variety should carry meaning rather than be sprinkled:

| lever | encodes |
|---|---|
| platform size | how many atoms it teaches |
| architecture kind | the knowledge type already in the data |
| height | Bloom level — a "create" platform towers over a "remember" one |
| weathering | mastery decay: a platform whose atoms are fading |

Plus more templates, because silhouette variety is the actual Monument Valley
lever. Each new one must satisfy the socket contract *and* the sortability
rules — one group per tread, architecture set back from the deck edge, inlaid
panels sunk rather than raised. `check.mjs` asserts all of that automatically,
so the cost per template is mechanical rather than risky. That is what the
contract was for.

### Colour

Continuous drift by altitude rather than six discrete chapter palettes. Two
constraints, both real:

- Every material is three fixed tones — top, +y face, +x face — and the
  geometry only reads because of the contrast between them. A hue ramp must
  preserve that contrast at every altitude, or the world flattens into mush.
- `data-st` currently *replaces* colour for gold and locked. Hue-by-altitude
  and state-by-progress will fight unless state becomes a modifier — a
  saturation and lightness shift — rather than a substitution.

## What survives, what changes

| Survives untouched | Changes | Goes |
|---|---|---|
| `iso.js`, `slices.js`, `nav.js`, `walk.js` | `compose.js` — still needed for portrait only | the single-graph-per-course premise |
| `layout.js` routing, rip-up, crossings | `build.js` — per module, plus arriving stairs | `MIN_KCS = 6` at course scale |
| `decompose.mjs`, `pack.mjs`, `validate.mjs` | `project.mjs` — projects a module | the 6–16 atom cap |
| `check.mjs` — more valuable, not less | `app.js` — level transitions, floating capstone | the one-shot loading screen |

## Risks and open questions

- **A module's outcome is promised before its atoms exist.** Call 1 commits to
  "this module covers X"; call 2 must deliver exactly that. Six for six so far,
  but the failure mode is real and needs a re-run when the atoms do not cover
  the promised outcome.
- **A stack of modules is a corridor** unless the module graph genuinely
  branches. It did in testing (`roots=2, joins=2`), and `check.mjs` should
  assert it at module scale the way it already reports fork counts.
- **What the up-and-down within a module *is*.** If the platforms of a level
  are the steps of the teaching loop — activate, worked example, faded
  practice, cold retrieval — then the pedagogy finally has a spatial home. If
  they are just movement between text screens, it is padding with stairs. This
  design does not settle it, and it is the most important thing left.
- **The capstone must eventually be administered.** Backward design fixes the
  assessment first and we have never once given it. Arriving at the floating
  destination has to mean taking it, against its rubric.

## Build order

1. Module planner: prompt, schema, validation, cached per course.
2. Lazy per-module generation, with N+1 prefetched while she walks N.
3. Floating capstone in screen space; mist bounded by what is generated.
4. Level transition — stairs that arrive when a module unlocks.
5. Form follows content: size, kind, height from the data already present.
6. Continuous altitude palette, with the contrast and state constraints above.
7. The teaching loop inside a level. The largest, and the point of all of it.
