# Graph Valley

**Type a goal. Climb to it.**

You name something you want to be able to do. It becomes a course of modules,
each module a small floating world you walk through — every platform one step
of a teaching loop — with the destination visible above the clouds from the
first moment and reachable only at the last.

> **Status:** a working prototype, end to end, against a real model. What it
> produces has been *walked* many times and still never *read* for truth by
> someone who knows the subject. See [What isn't built yet](#what-isnt-built-yet).

---

## What we're attempting

Most self-directed learning fails at the *map*, not the studying. You don't
know what the steps are, what order they go in, or whether you're nearly there.
A syllabus is a list, and a list shows you none of that.

Graph Valley makes the map a place. The bet is that **the structure of what
you're learning should be the structure of the space you move through**:

- Prerequisites are literally behind you and below.
- What's next is a platform whose shape you can already see.
- What's far off is in mist, so a long journey is legible rather than daunting.
- A fork in the subject is a fork in the path, and you're asked at the fork.
- Finishing a module lifts you to the next, with the whole climb shown between.

Whether any of this helps someone learn is an open question this prototype
cannot yet answer.

---

## How a course is built

Five instructional-design frameworks, composed — and built one module at a
time rather than in one shot, because that is what made it reliable.

**1 · Fix the summit.** *(Backward design — Wiggins & McTighe)* One question at
most turns "machine learning" into *implement a supervised learning algorithm
from scratch in Python*. If you already said what you want, it asks nothing.

**2 · Plan the climb.** Four to seven **modules**, a DAG, each with an outcome
she can *do* and the level it reaches. The first must give the shape of the
whole subject before any part is examined closely — an advance organiser
(Ausubel), not an introduction. Forks appear where the subject genuinely
branches.

**3 · Build the module she's entering.** *(Learning hierarchies — Gagné;
knowledge components — Koedinger)* Five to eight atoms, each with what it needs
first, what people get wrong about it, and a question that tests it. Validated
fourteen ways; retried once with the complaints handed back. Nothing beyond the
current module has to exist — that is what lets the world end in mist.

**4 · Pack atoms into platforms.** *(Cognitive load — Sweller)* At most three
new atoms per platform. Pure code, no model.

**5 · Make the teaching loop geometry.** Each module's platforms *are* the
steps:

```
prove        cold retrieval of everything the module taught — no notes
practice_i   the same atoms, faded: the method starts, she finishes it
study_i      the worked example — atoms introduced, three at a time
recall       what the module needs from earlier, pulled back first
```

Pairs sit in rows of at most two, so a level forks and joins. A wrong answer at
`prove` names the atom she has not got, and walks her back down to the practice
that drilled it.

Measured: module-scoped decomposition validated 6/6 first attempt where
whole-course decomposition gave one fallback and two rescued-on-retry.

```
npm test          # 113 unit tests over the curriculum
npm run check     # 31 end-to-end assertions over five recorded topics
npm run world     # 3164 assertions over the world engine
```

---

## How a world is drawn

One engine, in `world/`, shared by the product and the assertions.

- **Four template slices** — court, straight, corner, crossing — joined by a
  socket contract: two slices stitch iff their facing sockets are open at the
  same height. Seamlessness is an assertion. A stair is a parameter, not a
  template. See [world/README.md](world/README.md).
- **Walkability is the same fact as the geometry.** Each slice puts a nav node
  at each open socket, so the nav graph is connected *iff* the world is
  stitched. There is no second representation to keep in step.
- **Exact occlusion.** A topological sort over bounding boxes, with the
  traveller sorted *into* the scene every frame rather than inserted into a
  precomputed order — which was the bug the old renderer shipped with.
- **Composed for the screen.** Layers-per-band is chosen by scoring candidate
  layouts against the actual viewport; desktop and phone portrait are two
  octaves apart and no single layout serves both. See
  [the design note](docs/plans/2026-09-08-slice-world-adoption-design.md).
- **Form follows content.** Architecture from the stage, height from the Bloom
  level, size from how many atoms a platform teaches, and a per-module seed so
  no two levels are the same picture.
- **The capstone in the sky** — real geometry, drawn in screen space so it never
  enters the world's bounding box. That is what lets mist shrink the view: with
  the summit pinned in-world the revealed area never dropped below 96%; lifted
  out, the opening view falls to 16%.
- **The whole climb, seen.** Before each module the entire course is shown as
  castles — finished ones gold — and the camera flies into the one she's about
  to walk. It's built by the same engine from the module graph: the original
  idea, one scale up.

---

## What isn't built yet

**The capstone is never administered.** Backward design fixes the assessment
first; we generate it, carry it everywhere, and never give it. Arriving at the
summit should mean taking it against its rubric.

**Answers are recognition, not recall.** Four options, one click. The design for
free-text answers — closed-set classification against the misconceptions each
check already names, plugging into the remediation walk that already exists —
is in [docs/plans/2026-09-09-conversation-design.md](docs/plans/2026-09-09-conversation-design.md).

**Nothing ever comes back.** No spacing, no review. Gold stays gold, and that is
the mechanism most likely to make anything stick.

**Priors are recorded and never read.** `pack()` already accepts held atoms and
re-derives a shorter world; nothing calls it.

**Nothing is grounded.** No sources. A confident wrong statement passes every
assertion here.

**The model matters.** `gpt-4o` is the default; `gpt-4o-mini` passes one topic
in five. Runs still vary.

Also: level progress resets on a mid-module resume (module completion persists);
the summit monument is one fixed design per course; a continuous altitude
palette is designed and not built.

---

## Quick start

Requires **Node 18+**. Zero npm dependencies.

```bash
npm start
```

Then open <http://localhost:3217>. Copy `.env.example` to `.env` and set one key:

```bash
OPENAI_API_KEY=sk-...        # gpt-4o by default
# ANTHROPIC_API_KEY=sk-ant-...
```

Without a key it runs in demo mode with placeholder content and real structure.

---

## Controls

- **Click** a lit platform (or its label) to walk there and open it. Click any
  walkway to walk to it.
- **Drag** to pan, **scroll** or **pinch** to zoom, **Fit** (or **F**) to
  re-frame.
- **Tap the summit** to unfold the route — every module, done, current, locked.
- **Esc** closes the lesson.
- `prefers-reduced-motion` is honoured: nothing moves on its own.

---

## HTTP API

| Endpoint | Request | Response |
|---|---|---|
| `POST /api/negotiate` | `{ topic, turns[], asked[], maxTurns }` | `{ done: false, ask }` — or `{ done: true, goal, capstone, spine, priors }` |
| `POST /api/course` | `{ topic, goal, capstone }` | `{ title, goal, capstone, modules[], source }` |
| `POST /api/module` | `{ topic, goal, id }` | `{ module, graph, stages[], source }` — the level, built on demand |
| `POST /api/lesson` | `{ topic, goal, id, stageId }` | `{ lesson: { content[], checks[], checkAtoms[] }, source }` |
| `POST /api/remediation` | `{ topic, goal, id, kc }` | `{ to }` — the platform that drilled that atom |
| `POST /api/observe` | `{ event, data }` | `{ ok }` — appended to `.observe/trace.jsonl` |

A course is identified by its topic **and** the goal it was negotiated to.
`source` is `"llm"` \| `"llm-retry"` \| `"fallback"` \| `"cache"`.

---

## Project structure

```
├── server.mjs            # zero-dependency Node server: static + JSON API + trace
├── curriculum/           # the pipeline — pure modules, no DOM, no server
│   ├── negotiate.mjs     #   dialogue → a committed goal
│   ├── modules.mjs       #   goal → the journey: 4–7 modules, a DAG
│   ├── decompose.mjs     #   one module → atoms, prerequisites, misconceptions, checks
│   ├── pack.mjs          #   atoms → platforms, ≤3 new atoms each   (pure)
│   ├── stages.mjs        #   platforms → the teaching loop as places (pure)
│   ├── validate.mjs      #   the assertions a module must satisfy
│   ├── lesson.mjs        #   prompts per stage: worked example, faded practice, quiz
│   ├── build.mjs         #   the pipeline, with retry and offline fallback
│   ├── check.mjs         #   headless end-to-end verification over recorded fixtures
│   └── fixtures/         #   recorded model responses
├── world/                # the world engine — one copy, shared
│   ├── iso.js            #   projection, solids, exact depth sort
│   ├── slices.js         #   the four templates, nine architectures, the socket contract
│   ├── layout.js         #   graph → coarse grid: lanes, routing, rip-up and retry
│   ├── compose.js        #   how the world folds, chosen from the viewport
│   ├── nav.js            #   the walkable graph, derived from the sockets
│   ├── build.js          #   layout → slices → geometry + nav
│   ├── walk.js           #   following a path; the traveller's own box
│   ├── summit.js         #   the destination in the sky
│   ├── check.mjs         #   3164 headless assertions
│   └── README.md         #   the engine's own account of itself
├── public/               # the client: index.html · style.css · app.js
└── docs/
    ├── plans/            # design notes, in order
    └── experiments/      # the scripts behind the load-bearing measurements
```

Everything in `curriculum/` and `world/` is pure — no DOM, no browser globals —
so it imports straight into Node, which is how every assertion runs without a
browser.

---

## Background

**[CHALLENGES.md](./CHALLENGES.md)** is the log: what was tried, what was thrown
away and why, the projection arithmetic that constrains the layout, and the
known limitations. **[docs/plans/](./docs/plans)** holds the design notes,
each with the measurements that decided it.
