# Challenges, Decisions & Known Limitations

This file is the honest log of what this project is, how it evolved, and what's
still unresolved. Read it before continuing the work — it will save you from
re-treading dead ends.

---

## 1. Product-level challenges

### Curriculum quality depends on the LLM
The core risk is **scope + ordering**: *"learn AI"* could legitimately be a
10-node or 10,000-node graph. The current system just feeds the topic to an LLM
and validates the shape. It does **not** yet:

- ask a clarifying question (level / goal / time budget) before generating;
- constrain graph size/depth by the topic's breadth;
- cite sources or verify factual content.

The server-side validator (unique ids, real deps, acyclicity, single goal) stops
*crashes*, not *mediocre curricula*. **Highest-leverage next step:** a
clarifying pre-step and two-pass generation (outline → expand).

### Assessment is squishy
Lesson checks are single 4-option MCQs, LLM-generated and LLM-graded. They can be
trivial or occasionally ambiguous. No spaced repetition, no partial credit, no
verifiable "did you actually learn it". Fine for MVP feel-testing; not yet
credible as a learning tool.

### Cost & latency
LLM per-topic graph + per-node lessons = real tokens per user per journey. The
in-memory lesson cache helps, but a **global cache keyed by (topic, level)** and
pre-quality-reviewing popular journeys is where costs and quality would both
improve. Graph generation also takes seconds — the "building your world…"
loading screen is doing real heavy lifting.

### Retention
Gamification gets the first session but there's **no streak, no social proof, no
daily pull** yet. Monument Valley sells *completion* as the mechanism; a
"walking toward a visible goal" is the retention bet here, but it's unproven.

---

## 2. Rendering: the long road to "Monument Valley"

Several full rebuilds, each after the same feedback in different words: it does
not look like the reference.

1. **Pastel floating islands + dotted edges** — read as a graph, not a world.
2. **Dark mystic night theme** — pretty, but the reference is light and airy.
3. **Continuous structure**, then **varied castles** — cone roofs and pennants
   are fairy-tale castle, not Monument Valley.
4. **Full isometric rewrite** — the real fixes, listed below, because the
   problems were structural rather than cosmetic.
5. **Whole-monument nodes** — every node became a building with a lane through
   it, joined by shared viaducts, switchback corridors and bypass routes. This
   was the peak of the complexity, and it was the wrong direction: it read as
   clutter, and nearly all the geometry went into the connections rather than
   the places.
6. **A dungeon-crawl trail** (current) — small floating platforms, one piece of
   architecture on each, joined by plain walkways and stairs. Monument Valley
   is the register, not a blueprint. `world.js` went from about 700 lines to
   450 and from ~2000 shapes per world to ~750.

### What the isometric rewrite fixed, and why those fixes still stand

- **A true projection** (`iso.js`): `TW = 32, TH = 16, TZ = 32`. Because
  `TZ === 2 * TH` the view direction in grid space is exactly `(1, 1, 1)`,
  which is what makes the depth sort exact. `+x` is the screen-right face, `+y`
  the screen-left face, and larger coordinates are nearer the camera. The old
  renderer invented three faces in screen space from a half-width heuristic, so
  nothing lined up.
- **Exact occlusion between groups.** Box A is strictly in front of B when it
  lies entirely on the near side along any one axis; that partial order is
  resolved by Kahn's algorithm, comparing only pairs whose *screen* boxes
  overlap, with a `x0 + y0 + z0` fallback for anything left in a cycle.
- **Occlusion within a group.** Every shape carries a painter's key (its near
  corner) and groups are sorted by it, stably. Decorations get a small epsilon
  so they stay on top of their host; cast shadows get a negative one.
- **The traveller is part of that order.** She used to be drawn last, so nothing
  could ever pass in front of her and she read as flying over the world. She is
  now slotted into the draw order every frame. That required the places to be
  split into pieces whose boxes are separable — below the deck, far half, near
  half, and anything spanning overhead — because a single group's box contains
  her and no axis can separate them. Her lantern is a separate layer drawn
  last, so stone hides her without losing her.
- **Colour is not drained.** Locked stone keeps its chapter hue and merely
  recedes; the old `grayscale(0.75)` greyed out most of the world on arrival.
- **Detail has to survive distance.** Stairs use two-cell treads and no rails,
  battlements are two big merlons rather than a comb, colonnades are four thick
  columns rather than five slender ones, and accent panels are inset so a rim
  of stone shows. Anything finer dissolves into fuzz when the camera pulls back.

### How the trail works now

- **Serpentine layout.** Within a row the step between platforms is
  `(+STEP, -STEP, 0)`, which projects to pure screen *horizontal* — the two
  axes' vertical components cancel exactly. The row change is
  `(+TURN, +TURN, +CLIMB)`, which projects to pure screen *vertical* for the
  same reason. So the world reads as level rows stacked up the screen, running
  alternately left and right: a dungeon map, and compact instead of
  unidirectional. Measured screen deltas for a ten-step chain: `(768, 0)` three
  times, then `(0, -864)`, then `(-768, 0)` three times, then `(0, -864)`.
- **Rows have to clear a whole platform.** They are `32 * (CLIMB - TURN)` apart
  on screen, and a platform is roughly 860px from deck to the tip of its root.
  Less than that and the trail folds back over itself and stops being
  traceable — which is exactly what the first attempt at this did.
- **One path builder.** `run()` lays a walkway or a flight of steps along one
  axis in either direction, and `link()` joins two platforms with two of them
  and a landing at the turn. That single pair replaced a corridor builder, a
  switchback builder and a bypass builder.
- **The climb is shared between the two legs** in proportion to their length.
  Putting all of it on the first leg turned the flight between two floors into
  a 4:1 ladder.
- **Tall things go on the far half only.** In this projection a mass on the near
  half projects up and to the LEFT — straight over the middle of the platform —
  and would hide whoever is standing there.
- **The transitive reduction still applies.** A DAG usually states a
  prerequisite twice, and building stone for both lays a second walkway beside
  a route that already exists. `findPath` routes over the carved edges rather
  than over every dependency, and refuses to animate a route that is not
  continuous stone.
- **The world arrives out of the mist.** Nothing past the next platform is
  drawn; the next is a ghost; the summit stays a ghost on the horizon. Later
  layers sit nearer the camera here, so in true depth order the mist fell in
  front of what you could see and turned it milky — unrevealed pieces are drawn
  behind everything and drop into place when revealed. `Fit` frames only what
  is out of the mist.

### Known rendering limitations

- **No impossible geometry.** Penrose stairs and pivoting bridges are still not
  implemented — deliberately deferred.
- **A single row is inherently wide.** A four-step journey is one floor of the
  dungeon and comes out around 2.8:1; longer journeys fold to near 1:1.
- **Layer-skipping links can be steep.** They take whatever run the direct
  L-route happens to have; above a 1.6 gradient the tread narrows so the flight
  still reads as a staircase rather than four giant blocks, but a proper
  switchback detour would be better.
- **Siblings stack on screen.** A layer with several nodes offsets them along
  `(+1, +1)`, which is pure screen vertical. It reads correctly as depth, but a
  heavily branching layer piles up.
- **Contact shadows are placed by hand** per feature rather than derived.

---

## 3. Walkability & how the traveller walks

Every piece of path records the centre line of the stone it draws, one point per
stair tread, and each link stitches its route out of them: out of one platform's
edge, along the longer axis, round a landing, and in. Travel is a BFS over the
**carved** edges — not over every dependency, since the transitive reduction
means some dependencies have no stone under them — and the walk is parameterised
by *screen* arc length so the pace looks even whether she is crossing a level
walkway or climbing a flight.

Where the trail forks she walks out to the fork before asking: the junction is
the longest stretch every onward path shares, computed as the common prefix of
their walks. `routePoints` then rejoins a route wherever she is standing, so
being sent onward from a junction does not send her back to the start first.

Every consecutive pair of waypoints differs on at most one horizontal axis,
because the paths are axis-aligned; `assertOnStone` checks that before
animating and steps her there directly rather than gliding across open sky if it
ever fails. The geometry test in the repo's notes checks the same invariant, plus
that every route ends exactly on its target's landing.

One bug worth remembering: `requestAnimationFrame` stops in a backgrounded tab,
and the walk used to leave `S.walking = true` forever if it never completed —
which silently made the entire world unclickable. Every walk now has a
`setTimeout` guard that finalises it regardless.

---

## 4. Tooling / environment notes

- **`iso.js` and `world.js` are pure** — no DOM, no browser globals — so they
  import straight into Node for geometry work or a headless SVG dump. `app.js`
  is the only file that touches the DOM.
- Colours live in CSS custom properties, not in the geometry, so a headless
  rasteriser that cannot resolve `var()` will render the world as flat black
  unless you inline a palette first.
- Server is intentionally **zero-dependency** (`node server.mjs`). Bumping to
  Node ≥ 18 required — everything else is stdlib.

---

## 5. Immediate next steps (ranked)

1. **Rotating / pivoting bridge interaction** — the most Monument Valley thing
   possible; a bridge that swings to connect two decks when you tap it. The grid
   and the exact depth sort now make this buildable.
2. **Switchback causeways** — would let the world climb steeply while keeping
   the staircases gentle, and would make the layout far more compact.
3. **Global journey cache + pre-review** of popular topics (cost + quality).
4. **Clarifying question before generation** (level/scope) — biggest curriculum
   quality win.
5. **Ambient sound** (Web Audio, no assets): pad + soft walk chimes.
6. **Spaced repetition / better assessment** before this is a real learning tool.