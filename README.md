# Graph Valley

**Type a goal. Walk the path. Reach the summit.**

Graph Valley is a gamified, AI-driven way to learn anything. You type a free-text
goal ("I want to learn how black holes work", "how the stock market works",
"conversational Japanese"), and an LLM turns it into a step-by-step knowledge
graph — which is then rendered as a single continuous **Monument Valley–inspired
world**. Your little avatar walks the rooftops between monuments, and at each one
you get a bite-sized lesson + a quick comprehension check. Answer correctly and
the monument turns gold, lighting the way to the next.

The learning graph (prerequisites → concepts → goal) is the world itself.

---

## Features

- **Free-text intent** — one input box, any topic, any level.
- **LLM-generated curriculum** — a dependency DAG (no cycles, exactly one goal),
  validated on the server before it's ever rendered.
- **One continuous structure, not separate islands** — chunky coral towers with
  cream rooftops, dark pointed roofs, pennant flags, domes, arched doorways, and
  tapering bases, joined by heavy stair-causeways and hanging pillars.
- **6 building variants** — Gate (start), Twin, Keep, Tall, Court, and Temple
  (goal), with per-castle accent palettes (coral / blush / terracotta / peach).
- **The avatar really walks** — it traverses the actual walkways between
  monuments (path-sampled from the SVG), not a dotted line.
- **Fork-in-the-road guidance** — when 2+ paths are open, a Monument Valley–style
  speech bubble asks where you'd like to go next.
- **Mystery in the dark** — locked monuments are unlabeled; titles reveal only
  when they're within reach.
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
    ├── style.css       # creamy Monument Valley light theme (coral/cream, airy sky)
    └── app.js          # radial layout, world structure renderer, avatar walking,
                        #   fork prompts, lessons + checks, camera (pan/zoom), save/resume
```

---

## Controls

- **Click** a glowing monument — the avatar walks to it and the lesson opens.
- **Drag** to pan, **scroll** to zoom, **Fit** re-frames the whole world.
- **Esc** closes the lesson sheet.

---

## Deeper background & known limits

See **[CHALLENGES.md](./CHALLENGES.md)** for the full log of design challenges,
trade-offs, and known limitations (occlusion, impossible geometry, retention,
LLM curriculum quality, cost, and more).