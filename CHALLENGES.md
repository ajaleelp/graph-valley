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
  screen-left face.
- **Depth sort**: drawables are grouped (one group per monument, one per
  causeway leg — legs are split so every bounding box stays compact). Box A is
  strictly in front of B when A lies entirely on the near side along any one
  axis; that partial order is resolved by Kahn's algorithm. Pairs whose *screen*
  bounding boxes miss each other are never compared, which keeps it fast.
  Anything left in a cycle falls back to a `x0 + y0 + z0` key, so nothing is
  ever dropped.
- **Layout** (`world.js`): depth layers advance along `+x` by `SPAN = 15`,
  siblings fan along `+y` by `LANE = 9`, and each layer gains `RISE = 10`
  levels. `RISE > SPAN / 2` is the condition for the world to climb up-screen
  rather than sag — that single inequality is what turns a row of towers into
  an ascent.
- **Causeways**: step out of A along `+x`, cross to the target lane inside the
  corridor between layers, then climb in. The corridor is wide enough
  (`SPAN - footprint`) that the climb is a real staircase at roughly 1.3 levels
  per cell. Layer-skipping edges detour to a lane behind the world first.
- **Monuments** keep a two-cell lane clear through the middle at deck level, so
  the traveller can walk through; anything crossing that lane does so overhead
  as an arch or a bridge. That constraint is what makes the archetypes feel like
  places rather than props.
- **Colour**: one chapter palette per topic (deterministic from a hash) exposed
  as CSS custom properties. State is an attribute selector on the group
  (`[data-st]`), so completion animates as a `fill` transition to gold with no
  re-render.

### Known rendering limitations

- **No impossible geometry.** The signature Monument Valley moment — Penrose
  stairs, rotating/pivoting bridges — is still not implemented. It is now much
  more tractable than before (there is a real grid and an exact depth sort to
  build on), and it remains the single biggest "wow" addition available.
- **No vertical climbing.** Causeways connect decks; the reference also climbs
  *up* tower faces and spiral stairs.
- **The spine is linear.** Layers march along one axis. A switchback layout
  (alternating `+x` and `-y`) would be more compact and more like a real level,
  but it complicates causeway routing, which currently assumes one advance axis.
- **Steep stairs.** Climbing enough to read as an ascent forces ~1.3–1.5 levels
  per cell. Switchback staircases would let it be both steep and gentle.
- **Contact shadows are placed by hand** per archetype rather than derived, so a
  new archetype has to remember to cast one.

---

## 3. Walkability & how the traveller walks

Each causeway stores the centre-line of the stone it draws (`edge.walk`, in grid
coordinates), including one point per stair tread. Travel is a BFS over the
undirected graph, then the matching walk polylines are concatenated — reversed
when travelling against the dependency direction. The walk is parameterised by
*screen* arc length so the pace looks even whether she is crossing a flat
causeway or climbing.

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