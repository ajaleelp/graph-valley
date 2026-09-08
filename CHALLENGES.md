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
6. **A dungeon-crawl trail** (current in `public/`) — small floating platforms,
   one piece of architecture on each, joined by plain walkways and stairs.
   Monument Valley is the register, not a blueprint. `world.js` went from about
   700 lines to 450 and from ~2000 shapes per world to ~750.
7. **A slice-and-socket system** (`poc/`, proven, not yet adopted) — the world
   assembled from four reusable templates that stitch by a stated contract
   rather than by bespoke geometry per node. See section 6.

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

### How the trail worked before the slice rebuild

> **Superseded.** This describes `public/world.js`, deleted in the section 5
> rebuild. It is kept because the projection arithmetic below is still exactly
> what constrains the current layout — `world/compose.js` derives its level
> bands and vertical folds from the same two identities — and because knowing
> that this shape was tried, and why it read well, is worth more than the code
> was.

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

## 5. The renderer overhaul — done, and what it cost

This section used to argue that `public/` should be rebuilt on `poc/`, because
the repo carried two world-builders that disagreed and the one that shipped had
four latent defects. That is done. What follows is the record.

**One engine.** The engine moved to a top-level `world/`, imported by the
product, by the whitebox lab in `poc/`, and by `world/check.mjs`. Copying the
POC into `public/` would have kept two builders with different names; promoting
it means the assertions test shipped code. `public/iso.js` and `public/world.js`
are deleted rather than fixed — the surest way not to regress into a renderer is
not to have it.

**The four defects, and why they cannot return.** Each was a consequence of the
old code existing, so each died with it:

- *The avatar painted over by her own walkway.* `world.js` built a causeway leg
  — every tread — as one group whose bounding box **contained** her, so no axis
  separated them. Now: one group per tread, per corner arm, per crossing deck.
- *`sortAvatar` satisfied half its constraint.* It inserted her after the last
  group entirely behind her and ignored everything she must be drawn *before*.
  The order is a topological sort of a **partial** order, so incomparable groups
  are separated by an arbitrary tie-break and no single slot need satisfy both
  ends. Now: she is sorted **into** the scene every frame.
- *A scalar painter's key cannot order stacked solids.* One key cannot say "the
  deck is above its own root" and "the deck is behind the column standing on it"
  at once. Now: solids inside a group are ordered by the same exact topological
  sort used between groups.
- *A raised floor panel broke the platform's separation.* `faceT` lifted an
  inlaid panel above its surface, which lifted the group's box past the deck top
  — and that top is exactly what separates a platform from whoever stands on it.
  Now: the panel sinks below its surface and still sorts above on the tie-break.

`assertOnStone` went too. It existed to catch the walk polylines disagreeing
with the stone they claimed to follow; there is no second representation now, so
the failure mode and its policeman are both gone.

### The compactness question, and the two answers it gave

The POC's stated limit was "worlds get wide", and the obvious fix was to fold
the trail the way the old `world.js` did. Confirming that before adoption was
worth the trouble, because it failed twice, in opposite directions.

The projection is rigid: a layer step of `(a,b)` cells carrying one `FLOOR` of
climb lands at `dx = (a-b)*256`, `dy = (a+b)*128 - 128`. So `a+b = 1` gives an
exactly level band and `a = b` an exactly vertical fold — a serpentine falls
straight out of the arithmetic. But a level band costs `(+4,-3)` = 1792px per
layer against the unfolded `(+4,0)`'s 1024px, because the old serpentine got
level rows free (z was constant within a row) and the slice world must climb
every layer. Searched exhaustively on a 16:9 viewport, the best fold bought
9–14% on deep worlds, most of it from changing the layer direction rather than
from folding at all. **Don't fold.**

That conclusion was true and useless, because it was a desktop conclusion.
Monument Valley is a phone game and Ken Wong's constraint was that a level fits
one screen — without it, he said, you cannot force great compositions. Re-scored
against phone portrait the result inverts: unfolded scores an aspect penalty of
1.27–2.14 octaves where the fold scores 0.00. Desktop (1.78) and phone (0.46)
differ by 3.9x, and `log2(3.9) = 1.96` — precisely the gap. **No fixed layout
serves both.**

Nor does the mist rescue it, which was the other tempting escape. The summit is
deliberately always revealed, so the revealed bounding box spans the whole world
from the first step to the last: measured over full playthroughs of all six
authored graphs, the revealed area never drops below 96% of the total. Mist
hides detail, not extent.

So layers-per-band became a **viewport parameter**, scored in `world/compose.js`
against the real screen. Folding still is not free — a band change is a long
route, and on `deep` it took the world from 28 straights to 68 and forced the
traveller to 1.6 units a frame — so a fold must win by a quarter of an octave
before it is taken. Full reasoning:
[docs/plans/2026-09-08-slice-world-adoption-design.md](docs/plans/2026-09-08-slice-world-adoption-design.md).

### What this cost, and what is still owed

- Worlds on portrait screens carry 1.1–1.5x the polygons, and noticeably more
  walkway, because a fold's band change is a long route.
- The layout is chosen once, at build time. Rotating a phone re-fits the camera
  but does not re-compose the world: rebuilding mid-journey would invalidate the
  nav node the traveller is standing on.
- `poc/` survives as the whitebox lab. It is not dead code — it is how you debug
  geometry with the curriculum and the art out of the way.

---

## 6. Immediate next steps (ranked)

1. **Have someone read a generated lesson.** Everything else here is structure,
   and structure is now well asserted. Nothing has verified that what a platform
   teaches is *true*, or that walking one teaches anything. No further assertion
   will answer it.
2. **Decide whether `MIN_KCS` should scale with the breadth of the goal.** The
   negotiation now makes goals narrower, a narrow goal decomposes into fewer
   atoms, and the floor of six then rejects the syllabus as too thin — twice —
   so it falls back to demo content. Seen on two of three live topics. The floor
   earns its keep against weak models; the interaction with a well-scoped goal
   is new and unhandled.
3. **Rotating / pivoting bridge interaction** — the most Monument Valley thing
   possible; a bridge that swings to connect two decks when you tap it. Easier
   under the socket contract than before: a pivot is a slice whose socket moves
   from one side to another, and the seam check says whether it has landed.
3. **Global journey cache + pre-review** of popular topics (cost + quality).
4. **Clarifying question before generation** (level/scope) — biggest curriculum
   quality win.
5. **Ambient sound** (Web Audio, no assets): pad + soft walk chimes.
6. **Spaced repetition / better assessment** before this is a real learning tool.