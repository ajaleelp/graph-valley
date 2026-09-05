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
lines", "still not monument", "screenshot looks broken"). What shipped, and why:

1. **Pastel floating islands + dotted edges** (v1) — read as a graph, not a world.
2. **Dark mystic night theme + cute avatar** — pretty, but user's reference was
   a **light, airy** game. Dark theme was abandoned.
3. **Continuous structure** — the big pivot: one isometric structure instead of
   islands. Tall coral towers + cream rooftops + heavy stair-causeways.
4. **Varied castles** — replaced identical boxes with 6 procedural building
   variants (gate/twin/keep/tall/court/temple), dark pointed roofs, pennants,
   domes, arched doorways, tapering bases, per-castle accent colors.
5. **Label bugfix** — floating text was labels anchored to the node *origin*
   while buildings hung *downward*. Now labels anchor below the base via
   `baseBottom()`, and locked nodes show **no label at all** (no more "???").

### Known rendering limitations

- **Occlusion is approximate.** Nodes are depth-sorted by `sy + elev` and drawn
  back-to-front, so at some camera angles a far bridge can cross in front of a
  near tower's face. True iso z-ordering (or WebGL) would fix it. The avatar is
  always drawn on top.
- **No impossible geometry yet.** The signature Monument Valley moment — Penrose
  stairs, rotating/pivoting bridges — is not implemented. This is the single
  most impactful "wow" addition available.
- **No vertical climbing.** Walkways connect rooftops; the reference also climbs
  *up* tower faces / spiral stairs.
- **Layout is radial-by-depth.** Works well and spreads in all directions, but it
  does not run edge-routing, so on sparse graphs outer causeways can fan.
- Text labels live in SVG `foreignObject` (fine in modern browsers; not rendered
  by headless rasterizers like `svglib`).

---

## 3. Walkability & how the avatar "walks"

The avatar walks straight-line segments between rooftops (`nodeTop`), sampled
over the actual walkway path via a hidden SVG probe path (`getPointAtLength`).
This looked fine at the density tested, but:

- points are generated at fixed 16px intervals — very long causeways are slower;
- a future BFS could be upgraded to walk *along the visual walkway* including
  steps by sampling the connector's own geometry rather than a straight line.

---

## 4. Tooling / environment notes

- **Headless preview without puppeteer/playwright:** a throwaway Node harness
  (`/tmp/render_world.mjs`, not committed) imports the pure geometry functions
  from `app.js`, emits an SVG, and rasterizes via Python `svglib`+`reportlab`.
  It cannot resolve CSS `var()` fills, so the harness bakes per-node colors into
  per-group CSS classes. Useful if you continue iterating blind.
- Server is intentionally **zero-dependency** (`node server.mjs`). Bumping to
  Node ≥ 18 required — everything else is stdlib.

---

## 5. Immediate next steps (ranked)

1. **Rotating / pivoting bridge interaction** — the most Monument Valley thing
   possible; a bridge that swings to connect two towers when you tap it.
2. **Occlusion sort** — proper painter's order so bridges never cross towers.
3. **Global journey cache + pre-review** of popular topics (cost + quality).
4. **Clarifying question before generation** (level/scope) — biggest curriculum
   quality win.
5. **Ambient sound** (Web Audio, no assets): pad + soft walk chimes.
6. **Spaced repetition / better assessment** before this is a real learning tool.