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

This went through several full rebuilds after user feedback ("cubes and dotted
lines", "still not monument", "screenshot looks broken", and finally "I am really
struggling to get the Monument Valley world I want"). What shipped, and why:

1. **Pastel floating islands + dotted edges** (v1) — read as a graph, not a world.
2. **Dark mystic night theme + cute avatar** — pretty, but the reference was a
   **light, airy** game. Dark theme was abandoned.
3. **Continuous structure** — one structure instead of islands. Coral towers +
   cream rooftops + stair-causeways.
4. **Varied castles** — six procedural building variants with cone roofs,
   pennants, domes.
5. **Full isometric rewrite** (current) — steps 3 and 4 still did not look like
   the reference, and the reasons were structural, not cosmetic:

   - There was **no isometric projection**. `addBlock()` invented three faces in
     screen space from a "half-width" heuristic, so nothing lined up and the
     result read as a pile rather than a building.
   - The **layout was a jittered radial scatter** with random elevations.
     Monument Valley geometry is orthogonal and gridded; a scatter can never
     look like it.
   - **Occlusion was approximate** (`sy + elev`, with all connectors drawn
     first), so bridges crossed through towers.
   - The **vocabulary was wrong**: cone roofs and pennant flags are fairy-tale
     castle, not Monument Valley, which is cuboids, staircases, arches,
     colonnades, ziggurats and domes.
   - The **palette was four shades of the same coral**, and locked nodes were
     `grayscale(0.75)`, which drained most of the world of colour on first sight.

   The rewrite addresses each of those directly — see `iso.js` and `world.js`.

### How the current renderer works

- **Projection** (`iso.js`): `TW = 32, TH = 16, TZ = 32`. Because `TZ === 2 * TH`
  the view direction in grid space is exactly `(1, 1, 1)`, which is what makes
  the depth sort below exact. `+x` is the screen-right face, `+y` the
  screen-left face, and larger coordinates are nearer the camera.
- **Depth sort, between groups**: drawables are grouped (one per monument, one
  per piece of path). Box A is strictly in front of B when A lies entirely on
  the near side along any one axis; that partial order is resolved by Kahn's
  algorithm. Pairs whose *screen* bounding boxes miss each other are never
  compared. Anything left in a cycle falls back to a `x0 + y0 + z0` key.
- **Depth sort, within a group**: a monument is one group, and its pieces used
  to be drawn in whatever order the archetype happened to declare them — so a
  tower on the far flank could paint over the ramp in front of it. Every shape
  now carries a painter's key (its near corner) and groups are sorted by it;
  the sort is stable, so coincident pieces keep their build order. Decorations
  (window recesses, inlaid panels) get a small epsilon so they stay on top of
  their host, and cast shadows get a negative one so they stay under theirs.
- **Layout** (`world.js`): depth layers advance along `+x` by `SPAN`, siblings
  fan along `+y` by `LANE`, and each layer gains `RISE` levels. Every monument
  in a layer shares one footprint and one height — that uniformity is what lets
  all the paths leaving a layer meet at the same place.

### The three findings that shaped the current geometry

**1. LANE has to be about twice the footprint.** Monuments that touch on screen
collapse into one unreadable mass however well each one is modelled. Most of
what read as "a crowded dump of blocks" was simply insufficient sky.

**2. One viaduct per corridor, not one bridge per dependency.** SPAN and RISE
are locked together by two requirements pulling in opposite directions: the
world only climbs up-screen when `RISE > SPAN / 2`, while the staircase into the
next layer only looks like architecture when its slope stays near 1. Solving the
pair forces a corridor roughly twice the footprint — so a ten-node graph built
one bridge per edge produced ten full-length viaducts stacked through the same
gaps, and the world became mostly bridge. Each corridor now carries a single
shared viaduct: a short spur off each departing deck, one staircase into each
arriving one. Two further things cut the count again:

- the **transitive reduction** — a DAG usually states a prerequisite twice
  ("you need A" and "you need B, which needs A"), and building stone for both
  means a second bridge running the length of the world beside a route that
  already exists. Only edges with no alternative path get carved. Unlocking
  still uses the full dependency set; this decides only what is built, and
  `findPath` routes over the carved edges rather than over every dependency.
- **landings at every turn**, so a route reads as designed architecture rather
  than planks meeting in mid-air.

**3. Part of every layer's climb has to happen inside the monument.** This was
the subtle one. A monument's own footprint contributes eleven cells of run and
no rise, which flattens everything: at `RISE = 18` the spine climbed 64px per
layer against 1024px of travel — a 16:1 strip, whatever the buildings looked
like. Splitting the budget between a stepped ramp through the monument's lane
and the staircase in the corridor gives two gentle flights instead of one steep
one, lets `RISE` go half as high again, and takes the world to roughly 1.5:1.
Walking up through a building is the Monument Valley move anyway.

### Reading at a distance

Detail that is correct up close but dissolves into fuzz when the camera pulls
back is worse than no detail. Three things were rebuilt on that basis:

- **stairs** use two-cell treads and no side rails (one-cell treads with a
  stepped rail either side are a sawtooth);
- **battlements** are two big merlons rather than a fine comb;
- **colonnades** are four thick columns rather than five slender ones;
- **accent panels** are inset from the edges of their block, so a rim of stone
  shows and the colour reads as something set into the stone rather than a
  painted lid.

Every monument also carries a **parapet** around its deck. That single element
does more for legibility than anything else: without it the decks of
neighbouring monuments run together into one pale plane.

### Known rendering limitations

- **No impossible geometry.** Penrose stairs and pivoting bridges are still not
  implemented — deliberately deferred. The grid and the exact depth sort make
  it tractable, and it remains the biggest "wow" available.
- **No vertical climbing.** Paths connect decks and ramps; the reference also
  climbs *up* tower faces and spiral stairs.
- **The spine is linear.** Layers march along one axis. A switchback layout
  would be more compact, but it complicates the corridor model, which assumes
  one advance axis.
- **Long journeys still stretch.** A sixteen-layer chain reaches about 2.6:1;
  the composition is only compact for the four-to-six layer graphs the
  generator usually produces.
- **Contact shadows are placed by hand** per archetype rather than derived, so a
  new archetype has to remember to cast one.

---

## 3. Walkability & how the traveller walks

Every piece of path records the centre line of the stone it draws, one point per
stair tread, and each dependency stitches its own route out of the shared
pieces: up its own monument's ramp, along the spur, across the viaduct, up the
staircase, onto the next deck. Travel is a BFS over the **carved** edges — not
over every dependency, since the transitive reduction means some dependencies
have no stone under them — and the walk is parameterised by *screen* arc length
so the pace looks even whether she is crossing a flat viaduct or climbing.

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