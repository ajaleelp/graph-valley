# Graph Valley

**Type a goal. Walk the path. Reach the summit.**

Graph Valley is a gamified, AI-driven way to learn anything. You type a free-text
goal ("I want to learn how black holes work", "how the stock market works",
"conversational Japanese"), and an LLM turns it into a step-by-step knowledge
graph — which is then rendered as a single continuous **Monument Valley–inspired
world**, drawn with a true isometric engine. A traveller walks the actual
staircases and causeways between monuments, and at each one you get a
bite-sized lesson + a quick comprehension check. Answer correctly and the
monument turns gold, lighting the way to the next.

The learning graph (prerequisites → concepts → goal) is the world itself.

---

## Features

- **Free-text intent** — one input box, any topic, any level.
- **LLM-generated curriculum** — a dependency DAG (no cycles, exactly one goal),
  validated on the server before it's ever rendered.
- **A true isometric engine** — everything sits on an integer 3D grid and is
  projected 2:1, so a cell is a real cube. Solids are flat-shaded in three tones
  (lid / left / right) with one light source from the left, and never outlined.
- **Exact occlusion** — drawables are ordered by a topological sort over their
  bounding boxes rather than an approximate depth key, so a causeway never
  crosses in front of a tower it passes behind.
- **8 monument archetypes** built from a Monument Valley vocabulary — plinths,
  ziggurats, colonnades, arches, crenellated keeps, domed pavilions, sunken
  courts, garden terraces — with varied footprints, heights and floating feet,
  so ten monuments never read as ten identical towers.
- **Real causeways** — every connection is an axis-aligned run of solid steps
  routed through the corridor between layers. Edges that skip a layer detour
  behind the world rather than spearing whatever is in the way.
- **The traveller really walks them** — she follows the staircase geometry that
  is actually drawn, and the camera tracks her.
- **6 chapter palettes** (sandstone, rose, lagoon, lilac, verdigris, ember),
  chosen deterministically from your topic, each with its own sky.
- **Fork-in-the-road guidance** — when 2+ paths are open, a Monument Valley–style
  speech bubble asks where you'd like to go next.
- **Mystery, without draining the world** — locked stone keeps its colour and
  just recedes; unreached monuments read as "Undiscovered" until they are one
  step away, and labels de-collide so the world never becomes a pin board. The
  summit is always named — it is what you are walking toward.
- **Lessons + checks** — each monument opens a lesson sheet generated per topic;
  a 4-option comprehension check gates your progress. Completed monuments turn
  gold.
- **Progress persistence** — saved to `localStorage`, resumable from the home
  screen.
- **Zero npm dependencies** — a single Node server, vanilla JS frontend.

---

## Quick start

Requires **Node 18+** (uses global `fetch` and `AbortSignal.timeout`).

```bash
npm start
# → Graph Valley running → http://localhost:3217
```

Change the port with `PORT=4000 npm start`.

### Making it "really" AI (optional)

Without keys the app runs in **demo mode**: a built-in deterministic generator
produces a sensible 10-node graph and placeholder lessons (a small `demo` badge
shows in the HUD). Set one of these to get fully AI-generated journeys:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start          # default model: claude-sonnet-4-5
OPENAI_API_KEY=sk-... npm start                 # default model: gpt-4o-mini
```

Override the model with `ANTHROPIC_MODEL` / `OPENAI_MODEL`. Lessons are cached
in-memory per `topic::title`, so repeated lookups don't re-bill.

---

## HTTP API

| Endpoint | Request | Response |
|---|---|---|
| `POST /api/graph` | `{ "topic": "how black holes work" }` | `{ topic, graph: { title, nodes[] }, source }` |
| `POST /api/node` | `{ topic, title, summary }` | `{ lesson: { content[], check }, source }` |

Notes:

- `graph.nodes` = `{ id, title, summary, deps[], goal }`. The server **validates**
  the LLM output (ids unique, deps reference real ids, acyclic via Kahn, exactly
  one goal) and falls back to the demo generator if anything is off.
- `source` is `"llm"` | `"fallback"` | `"cache"`.
- Static files are served from `public/` with path-traversal protection.

---

## Project structure

```
├── server.mjs          # zero-dependency Node server: static + JSON API, LLM calls,
│                       #   graph/lesson validation, demo-mode fallbacks, lesson cache
├── package.json        # {"start": "node server.mjs"} — nothing to install
└── public/
    ├── index.html      # screens: home, loading, world, lesson sheet, fork-choice, celebration
    ├── style.css       # flat Monument Valley palette: face tones as CSS vars, per-state
    │                   #   overrides (gold / unlit), sky, HUD, sheet, labels
    ├── iso.js          # the isometric engine: grid -> screen projection, solids, stairs,
    │                   #   arches, domes, colonnades, contact shadows, topological depth sort
    ├── world.js        # layout (layers climb along +x, siblings fan along +y), the eight
    │                   #   monument archetypes, and causeway routing
    └── app.js          # scene rendering, camera (pan / zoom / pinch / follow), the
                        #   traveller's walk, labels, lessons + checks, save/resume
```

---

## Controls

- **Click** a lit monument (or its label) — the traveller walks there and the
  lesson opens.
- **Drag** to pan, **scroll** or **pinch** to zoom.
- **Next** jumps to the next open monument; **Fit** (or **F**) re-frames the
  whole journey.
- **Esc** closes the lesson sheet.
- `prefers-reduced-motion` is honoured: the walk, drifting clouds, camera glide
  and confetti all stand still.

---

## Deeper background & known limits

See **[CHALLENGES.md](./CHALLENGES.md)** for the full log of design challenges,
trade-offs, and known limitations (occlusion, impossible geometry, retention,
LLM curriculum quality, cost, and more).