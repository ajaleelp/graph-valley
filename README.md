# Graph Valley

> **Work in progress.** The world renderer is real and playable; the teaching is
> not built yet. See [What isn't built yet](#what-isnt-built-yet) before judging
> this as a learning tool — right now it is a prototype of an *idea about
> learning*, not something that will actually teach you anything.

**Type a goal. Walk the path. Reach the summit.**

---

## What we're attempting

Most self-directed learning fails in the same place: not at the studying, but at
the *map*. You don't know what the steps are, what order they go in, how far
along you are, or whether you're nearly there. A syllabus is a list, and a list
shows you none of that.

Graph Valley is an attempt to make that map a **place you walk through**.

You type a free-text goal — "how black holes work", "conversational Japanese",
"how the stock market works" — and an LLM turns it into a dependency graph:
prerequisites, concepts, and one capstone. That graph is then rendered as a
small isometric world in the register of *Monument Valley*: a trail of floating
stone platforms joined by walkways and stairs, folding back on itself like a
dungeon map. A traveller walks it.

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

## What isn't built yet

**The pedagogy.** That's the honest headline. There is a lesson panel and a
comprehension check on each platform, but they are scaffolding, not teaching:

- **Lessons are one LLM call each**, with no instructional design behind them —
  no worked examples, no progressive disclosure, no adaptation to what you
  already know or just got wrong.
- **Assessment is a single 4-option multiple-choice question** per step,
  written and marked by the same model that wrote the lesson. It gates
  progress, which makes it *feel* meaningful, but it does not measure
  understanding, and it can be trivially guessable or occasionally ambiguous.
- **No spaced repetition, no retrieval practice, no review.** Once a platform
  turns gold it stays gold. Nothing brings a concept back later — which is
  precisely the mechanism most likely to make any of it stick.
- **Curriculum quality is unverified.** The server checks the *shape* of the
  LLM's graph — unique ids, real dependencies, acyclic, exactly one goal — and
  falls back to a built-in generator if the shape is wrong. It has no way to
  judge whether the curriculum is any good: whether the ordering is sound, the
  scope sensible, or the content correct. "Learn AI" could legitimately be ten
  steps or ten thousand, and nothing here decides which.
- **No level or prior-knowledge input.** Everyone gets the same path for the
  same topic.
- **No sources or citations.** Nothing is grounded or checkable.

There is also no account system, no persistence beyond `localStorage`, and no
retention loop of any kind.

So: the world is the part that works. Treat the learning as a placeholder that
demonstrates the shape of the interaction, and nothing more.

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
- **Zero npm dependencies** — one Node file, vanilla JS frontend.

---

## Quick start

Requires **Node 18+** (uses global `fetch` and `AbortSignal.timeout`).

```bash
npm start
```

Then open <http://localhost:3217>. Change the port with `PORT=4000 npm start`.

Without API keys it runs in **demo mode**: a deterministic built-in generator
produces a 10-node graph and placeholder lessons, and a small `demo` badge shows
in the HUD. For LLM-generated journeys:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

```bash
OPENAI_API_KEY=sk-... npm start
```

Override the model with `ANTHROPIC_MODEL` / `OPENAI_MODEL`. Lessons are cached
in memory per `topic::title`, so repeated lookups don't re-bill.

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
| `POST /api/graph` | `{ "topic": "how black holes work" }` | `{ topic, graph: { title, nodes[] }, source }` |
| `POST /api/node` | `{ topic, title, summary }` | `{ lesson: { content[], check }, source }` |

- `graph.nodes` = `{ id, title, summary, deps[], goal }`. The server validates
  the LLM's output (unique ids, real dependencies, acyclic via Kahn, exactly one
  goal) and falls back to the built-in generator if anything is off.
- `source` is `"llm"` | `"fallback"` | `"cache"`.
- Static files are served from `public/` with path-traversal protection.

---

## Project structure

```
├── server.mjs          # zero-dependency Node server: static + JSON API, LLM calls,
│                       #   graph/lesson validation, demo-mode fallbacks, lesson cache
├── package.json        # {"start": "node server.mjs"} — nothing to install
└── public/
    ├── index.html      # screens: home, loading, world, lesson sheet, fork prompt, summit
    ├── style.css       # flat palette as CSS vars, per-state overrides, sky, HUD, sheet
    ├── iso.js          # isometric engine: projection, solids, stairs, domes, depth sort
    ├── world.js        # the serpentine trail, the platform features, the path builder
    └── app.js          # rendering, camera, the walk, mist, labels, lessons, save/resume
```

`iso.js` and `world.js` are pure — no DOM, no browser globals — so they import
straight into Node for geometry work.

---

## Background

**[CHALLENGES.md](./CHALLENGES.md)** is the honest log: what was tried, what was
thrown away and why, the projection arithmetic that constrains the layout, and
the full list of known limitations. Worth reading before continuing the work —
several of the obvious ideas here have already been built and discarded.
