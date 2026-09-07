# Curriculum pipeline — design

**Date:** 2026-09-05
**Status:** agreed, v1 in build
**Companion:** [research synthesis](https://claude.ai/code/artifact/2459c5a8-250d-411a-9e6a-698d813fc380)

## Problem

`POST /api/graph` is one LLM call that emits 8–12 titled nodes with authored
`deps`. The server can check that the result is *well-formed* — unique ids, real
dependencies, acyclic, one goal — but never that it is *right*. Every pedagogy
gap the README admits to descends from that: unverifiable curriculum quality,
guessable single-MCQ checks, no prior-knowledge input, no adaptation, no review.

"Topic → syllabus" is three problems wearing one coat:

| | Question |
|---|---|
| Macro | What are the steps and what depends on what? |
| Micro | What happens on one platform, and what proves it landed? |
| Learner | What does this person already know? |

## Approach

Five standard frameworks, composed into one pipeline and one schema:

- **Backward design** (Wiggins & McTighe) — author the summit and its capstone
  *first*. This is what bounds scope: "learn AI" is unscopeable, "explain why a
  transformer needs attention" is a finite syllabus.
- **Learning hierarchies** (Gagné) — derive prerequisites by recursion, don't
  invent them.
- **Knowledge components / KLI** (Koedinger) — the atom. Every check item tags
  the KC it tests.
- **Knowledge space theory** (Doignon & Falmagne; ALEKS) — the runtime model. A
  knowledge state is a set of mastered KCs; the *outer fringe* is what's
  walkable now. This is what the mist already does, unnamed.
- **Evidence-centred design** (Mislevy) + **cognitive load theory** (Sweller) —
  distractors from named misconceptions; a hard cap on new KCs per node.

### Decisions taken

**Conversational intake.** A negotiated syllabus (Breen & Littlejohn) — 2–3
turns of dialogue settle the summit before anything is built. Better instrument
than a form, and evidence favours it for motivation and engagement.

**Committed at intake: the summit and the full KC set. Deferred: the packing.**
Extent is known from turn one, so the summit sits honestly on the horizon and
distance-travelled still means something — but how KCs group into platforms is
decided as she approaches, informed by how she is doing. The mist stops being a
rendering trick and becomes literally true.

**The conversation seeds a prior, never a verdict.** Self-reported prior
knowledge is asymmetrically miscalibrated: weaker learners substantially
overestimate. "I know that vaguely" marks a KC *probably known*, to be confirmed
by a two-question check.

**Derive the edges.** Nodes declare `teaches` and `requires` over KCs;
`edge(a→b) ⟺ teaches(a) ∩ requires(b) ≠ ∅`. One structure, no second thing to
keep in sync — the same trick the slice POC pulls with sockets and the nav
graph. This is what makes the graph *checkable* rather than merely well-formed.

**`pack` is pure and contains no LLM call.** The model supplies domain knowledge
(what the atoms are, what depends on what, what people get wrong). Grouping
atoms into platforms is constrained graph partitioning — deterministic,
unit-testable, and re-runnable. Deferred packing and later adaptive re-packing
are the same function called again with a larger `known` set. An LLM packer
would make adaptation expensive and irreproducible.

**One schema for both topic shapes.** `spine: "concept" | "task"` switches the
packing heuristic (concept-spine packs by KC dependency depth; task-spine packs
by whole-task complexity, per 4C/ID task classes) and the segment weighting.
Schema, validator and renderer do not branch.

### Rejected

- *Everything fixed up front* — simplest and cacheable, but no adaptation
  without a later rewrite.
- *Only the summit fixed, KCs discovered as she goes* — most conversational,
  but scope becomes unbounded, distance-travelled stops meaning anything, and
  the backward-design guarantee that every node earns its place is lost.
- *Building the intake UI or migrating to the `poc/` renderer in v1* — the
  renderer rebuild is a separate large project. Keeping them apart lets
  curriculum quality be proven before any UI is spent on it.

## v1 scope

Server-side only, headless-verifiable. No learner state, no placement, no BKT,
no spacing, no intake UI, no renderer changes.

```
curriculum/
  negotiate.mjs   LLM · dialogue → committed goal + capstone (≤3 turns)
  decompose.mjs   LLM · goal + capstone → KCs, KC prereqs, misconceptions, clusters
  pack.mjs        pure · KCs → nodes + derived edges
  validate.mjs    pure · the assertions
  check.mjs       harness · pipeline over fixture topics, asserts everything
  fixtures/       recorded LLM responses — checks run fast, free, deterministic
```

Both LLM stages take an injected `llm` function, so they are testable without
network.

### Assertions the validator makes

Beyond today's four structural checks:

- **Coverage** — no KC required but never taught; no KC taught twice; no KC the
  capstone never transitively uses; every capstone KC reachable.
- **Load** — new KCs per node within budget; node count ≈ `ceil(|KCs|/budget)`.
- **Assessment** — every taught KC has a check; no check's Bloom level exceeds
  the level its node taught at; every distractor cites a named misconception.
- **Sequencing** — Bloom levels non-decreasing along any edge; the fringe is
  never empty until complete (KST well-gradedness).
- **World-fit** — branching factor ≤3 at any junction. A fork the slice world
  cannot render legibly is a curriculum bug, not a rendering bug.

### API

| Endpoint | Change |
|---|---|
| `POST /api/negotiate` | New. Turns → more questions, or a committed goal + capstone. |
| `POST /api/syllabus` | New. KCs, initial packing, derived edges. |
| `POST /api/graph` | **Kept, as a thin projection** emitting today's `{id,title,summary,deps,goal}`. `public/` and `poc/` untouched. |
| `POST /api/node` | Same signature; now sees `teaches`/`requires`/`segments` for a far better lesson prompt. |

On validation failure: retry once with the validator's specific complaints fed
back to the model, *then* fall back. The fallback generator emits the new schema
too, so nothing downstream branches on `source`.

### Fixture topics

- `how black holes work` — concept spine, clean prerequisite structure
- `conversational Japanese` — task spine, 4C/ID
- `learn AI` — unscopeable; negotiation must do real work or the run fails
- `the French Revolution` — narrative, genuinely weak prerequisite structure
- `how to make sourdough` — procedural, short, mostly one task class

## Implementation order

1. `validate.mjs` + tests — the assertions, against hand-built syllabi.
2. `pack.mjs` + tests — pure partitioning, verified by `validate`.
3. `decompose.mjs` + `negotiate.mjs` with injected `llm`, fake in tests.
4. `check.mjs` over recorded fixtures; `--live` re-records.
5. Wire into `server.mjs`, keeping `/api/graph` as a projection.

Tests use `node:test` — still zero npm dependencies.

## Later

v1.5 placement (seed `known` from a short check) · v2 per-KC mastery
probability, BKT or Elo, remediation spurs · v3 FSRS-style review, rendered as a
path back through the valley.
