# Graph Valley

> **Work in progress.** Two halves, at different stages.
>
> **The world** is real and playable, and mid-replacement: `poc/` is a proven,
> independently verified rebuild of it as four reusable slice templates stitched
> by a socket contract, and `public/` should be rebuilt on it. See
> [poc/README.md](poc/README.md) and section 5 of [CHALLENGES.md](CHALLENGES.md).
>
> **The curriculum** is newly rebuilt on standard instructional design, verified
> headlessly, and now runs against a real model — the committed fixtures are
> recorded `gpt-4o` output. What it produces has never been read by a learner.
> See [What isn't built yet](#what-isnt-built-yet).

**Type a goal. Walk the path. Reach the summit.**

---

## What we're attempting

Most self-directed learning fails in the same place: not at the studying, but at
the *map*. You don't know what the steps are, what order they go in, how far
along you are, or whether you're nearly there. A syllabus is a list, and a list
shows you none of that.

Graph Valley is an attempt to make that map a **place you walk through**.

You name something you want to be able to do. A pipeline turns it into a
dependency graph of concepts, and that graph is rendered as a small isometric
world in the register of *Monument Valley*: a trail of floating stone platforms
joined by walkways and stairs, folding back on itself like a dungeon map. A
traveller walks it.

The bet is that **the structure of what you're learning should be the structure
of the space you move through**:

- Prerequisites are literally behind you and underfoot.
- What's next is a platform whose shape you can already see.
- What's far off is hidden in mist, so a journey is legible rather than
  overwhelming.
- Progress is a distance travelled, not a percentage.
- A branching curriculum is a fork in the road, and you get asked at the fork.

Whether any of that actually helps someone learn is an open question, and one
this prototype cannot yet answer.

---

## How a syllabus is built

The old pipeline was one LLM call that emitted 8–12 titled nodes with
hand-waved dependencies. The server could check the result was *well-formed* —
unique ids, acyclic, one goal — but never that it was *right*.

The new one composes five standard frameworks into one pass, and the output is
something a checker can argue with. The reasoning is in
[docs/plans/2026-09-05-curriculum-pipeline-design.md](docs/plans/2026-09-05-curriculum-pipeline-design.md).

**1 · Fix the summit first.** *(Backward design — Wiggins & McTighe)* A short
dialogue turns "how black holes work" into one concrete thing you'll be able to
do, and the assessment that would prove it. This is what bounds scope: "learn
AI" is unscopeable; "explain why light can't escape, and roughly where the
boundary sits" is a syllabus of finite length.

**2 · Work backwards to the atoms.** *(Learning hierarchies — Gagné; knowledge
components — Koedinger)* The goal decomposes into the smallest things you either
know or don't — with, for each, what it needs first, what people commonly get
wrong about it, and one question that tests it.

**3 · Pack atoms into platforms.** *(Cognitive load — Sweller)* At most three
new atoms per platform. This step is **pure code, no model** — deterministic,
unit-tested, and cheap to run again, which is what later lets the world
re-shape itself around what a learner already knows.

**4 · Derive the edges.** `edge(a → b) ⟺ teaches(a) ∩ requires(b) ≠ ∅`. The
graph is a projection of the atom declarations, not a second thing to keep in
sync — the same trick `poc/` pulls with sockets and its nav graph. Forks appear
where the subject genuinely branches, rather than being sprinkled for variety.

**5 · Assert it.** Curriculum quality stops being something you eyeball.

```
node curriculum/check.mjs      # or: npm run check
node --test 'curriculum/*.test.mjs'   # or: npm test
```

The validator rejects a syllabus with a hole (an atom required but never
taught), a redundancy (taught twice), scope creep (an atom the capstone never
needs), an overloaded platform, an unexamined atom, a check pitched above what
its platform taught, a summit that never reaches the level the goal asked for, a
capstone that names no atoms at all, a decomposition too thin to be a course, a
distractor not drawn from a named misconception, an edge no shared atom
justifies, a circular prerequisite, a junction with more ways out than a court
has sides, or — the one that matters most — **a world with no platform you can
start on**. A model can group a perfectly acyclic set of atoms into platforms
that wait on each other, and every other rule passes it.

When it rejects a syllabus, the pipeline hands the specific complaints back to
the model and retries once before falling back. On a live five-topic run, three
of the five were rescued that way.

`check.mjs` also reports the *shape* of each world — platforms, roots, forks,
joins, longest path — because a valley with no junctions is a corridor, and
that's a quality signal no single assertion catches.

---

## What does work

- **A true isometric engine** (`public/iso.js`) — everything sits on an integer
  3D grid projected 2:1, so a cell is a real cube. Flat three-tone shading, one
  light source, no outlines. Occlusion is a topological sort over bounding boxes
  rather than an approximate depth key, so nothing ever paints over what stands
  in front of it — the traveller included.
- **A serpentine trail** (`public/world.js`) — platforms run left to right along
  a row, up a flight of stairs, then back the other way. It falls out of the
  projection: the within-row step's vertical components cancel exactly, and the
  row change's horizontal ones do, so rows come out level and stack up the
  screen.
- **She actually walks it** — along stone that is really drawn, stairs included,
  never diagonally through open sky. The camera follows her.
- **Mist** — nothing past the next platform is drawn; the next one is a ghost;
  the summit stays a ghost on the horizon.
- **Forks asked at the fork** — she walks out to the junction before asking.
- **Six chapter palettes**, chosen deterministically from your topic.
- **A curriculum that can be argued with** — 70 unit tests, 31 end-to-end
  assertions over five recorded topics, all headless.
- **Zero npm dependencies** — one Node file, vanilla JS frontend, `node:test`.

---

## What isn't built yet

**The model matters more than anything else here.** `gpt-4o-mini` passes one
topic in five: asked for 6–16 atoms it returns four, asked for concrete cluster
titles it returns "Economic Factors, Political Factors, Ideological Factors",
asked to vary Bloom levels it flattens everything to "understand". `gpt-4o`
passes all five. Set `OPENAI_MODEL=gpt-4o` — the default is not good enough.

**Runs vary a lot.** Two `gpt-4o` runs over the same five topics with the same
prompts scored 4/5 and 2/5 before the last round of fixes, and 5/5 after. Treat
a single run as an anecdote. The retry is doing real work: three of the five
were rejected first time and rescued second.

**Nobody has read a generated lesson.** The pipeline proves a syllabus is
well-structured — no gaps, no redundancy, nothing off-topic, no step too big,
every platform reachable. It cannot prove anything in it is *true*, and no
human has yet sat down and walked one to see whether it teaches. That is the
next thing to find out, and no amount of assertion will answer it.

**No adaptation.** Everyone still gets the same valley. The schema is built for
it — `pack()` already takes a set of atoms the learner holds and re-derives a
shorter world around them, and `check.mjs` asserts that re-packing stays valid —
but nothing computes that set yet. No placement check, no mastery estimate, no
learner state at all beyond `localStorage`.

**No spaced repetition, no review.** Once a platform turns gold it stays gold.
Nothing brings an atom back later, which is the mechanism most likely to make
any of it stick.

**No intake UI.** `POST /api/negotiate` exists and works; nothing calls it. The
front end still posts a bare topic, and the server takes it at face value —
which skips backward design's first stage, the one that does the most work.

**Nothing is grounded.** No sources, no citations. A confident wrong statement
passes every assertion here.

**One check per platform reaches the renderer.** The syllabus holds one question
per atom; `public/` reads one per platform, so the rest are carried but unused
until the renderer catches up.

There is also no account system and no persistence beyond `localStorage`.

---

## Quick start

Requires **Node 18+** (uses global `fetch` and `AbortSignal.timeout`).

```bash
npm start
```

Then open <http://localhost:3217>. Change the port with `PORT=4000 npm start`.

Without API keys it runs in **demo mode**: a deterministic built-in generator
produces a nine-atom syllabus across four platforms — placeholder content, real
structure — and a small `demo` badge shows in the HUD. For real journeys:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

```bash
OPENAI_API_KEY=sk-... npm start
```

Override the model with `ANTHROPIC_MODEL` / `OPENAI_MODEL`. Syllabi and lessons
are cached in memory, so repeated lookups don't re-bill.

---

## Controls

- **Click** a lit platform (or its label) — the traveller walks there and the
  lesson opens.
- **Drag** to pan, **scroll** or **pinch** to zoom.
- **Next** jumps to the next open platform; **Fit** (or **F**) re-frames the
  journey.
- **Esc** closes the lesson sheet.
- `prefers-reduced-motion` is honoured throughout.

---

## HTTP API

| Endpoint | Request | Response |
|---|---|---|
| `POST /api/negotiate` | `{ topic, turns[] }` | `{ done: false, ask }` — or `{ done: true, goal, capstone, spine, priors }` |
| `POST /api/syllabus` | `{ topic, goal?, capstone? }` | `{ topic, syllabus, source }` — atoms, platforms, derived edges, checks |
| `POST /api/graph` | `{ topic }` | `{ topic, graph, source }` — the syllabus **projected** to the old shape |
| `POST /api/node` | `{ topic, title, summary }` | `{ lesson, source }` |

`/api/graph` still returns `{ id, title, summary, deps[], goal }` exactly as
before, so **`public/` and `poc/` both consume it unchanged** — the curriculum
work and the renderer rebuild stay independent. `source` is `"llm"` |
`"llm-retry"` | `"fallback"` | `"cache"`.

`/api/node` takes the same request as before, but the server now finds that
platform in the syllabus it already holds and writes the lesson from its atoms:
what to teach, what to pull back out of memory first, which misconceptions to
head off, and how much scaffolding to leave in place. The check it returns comes
from the syllabus rather than from a second LLM call, so its wrong answers are
real misconceptions rather than invented ones.

---

## Project structure

```
├── server.mjs            # zero-dependency Node server: static + JSON API
├── curriculum/           # the syllabus pipeline — pure modules, no DOM, no server
│   ├── negotiate.mjs     #   dialogue → a committed goal and capstone
│   ├── decompose.mjs     #   goal → atoms, prerequisites, misconceptions, checks
│   ├── pack.mjs          #   atoms → platforms + derived edges   (pure, no model)
│   ├── validate.mjs      #   the assertions a syllabus must satisfy
│   ├── build.mjs         #   the pipeline, with retry and offline fallback
│   ├── project.mjs       #   syllabus → the graph shape the renderers read
│   ├── lesson.mjs        #   the lesson prompt, written from the syllabus
│   ├── llm.mjs           #   Anthropic / OpenAI plumbing
│   ├── check.mjs         #   headless end-to-end verification + shape report
│   └── fixtures/         #   recorded model responses; --live re-records
└── public/
    ├── index.html        # screens: home, loading, world, lesson sheet, fork, summit
    ├── style.css         # flat palette as CSS vars, per-state overrides, sky, HUD
    ├── iso.js            # isometric engine: projection, solids, stairs, depth sort
    ├── world.js          # the serpentine trail, platform features, path builder
    └── app.js            # rendering, camera, the walk, mist, labels, save/resume
```

`iso.js` and `world.js` are pure — no DOM, no browser globals — so they import
straight into Node for geometry work. Everything in `curriculum/` is likewise
importable and testable on its own; the two LLM stages take the model as an
argument, so nothing there needs a network to be tested.

---

## Background

**[CHALLENGES.md](./CHALLENGES.md)** is the honest log: what was tried, what was
thrown away and why, the projection arithmetic that constrains the layout, and
the full list of known limitations. Worth reading before continuing the work —
several of the obvious ideas here have already been built and discarded.

**[docs/plans/](./docs/plans)** holds the design documents: the slice-world
rebuild, and the curriculum pipeline with the research behind it.
