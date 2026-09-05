# Graph → Monument Valley world: a slice-based POC

**Date:** 2026-09-05
**Status:** design for an independent proof of concept, built in `poc/`

## The question this answers

Given a few connected concepts (a DAG: prerequisites → concepts → one goal),
can we lay out a *walkable* isometric world in the register of Monument Valley
using a **small library of reusable template slices** stitched together, rather
than generating bespoke geometry per node?

Look and feel are explicitly out of scope. This is a whitebox.

## What the research says

From ustwo's own accounts of Monument Valley:

- **A 30° isometric grid, orthographic camera.** Every angle is 30°, 120° or
  vertical. The constraint is what makes pieces line up.
- **Levels were whiteboxed first** — geometry that works, then colour to make it
  readable, then polish. Never the other way round.
- **Navigation is a separate node graph laid over walkable surfaces**, not
  derived from the mesh. Tech director Peter Pashley: building the shape is the
  easy part; making navigation and locomotion work is the hard part.
- **Occlusion was automated** by ordering nodes in depth order from the camera.
- Two nav nodes can sit at the same point with different roles (ladder / floor).

From modular level-design practice: tiles stitch seamlessly when they share
**edge geometry** — "different centres, same edges". Strips are built from
start / middle / end pieces.

That last point is the whole design. It converts "how do I connect two
platforms?" from a geometry problem into a **matching problem**.

## The core idea: a socket contract

The world is a coarse grid of square **cells** (`CELL = 8` fine grid units).
Every slice occupies one cell and exposes up to four **sockets** — one at the
midpoint of each cell edge, each either closed or open at a specific height.

> Two slices stitch iff their facing sockets are both open **and at the same
> height**.

Because the socket is a point on a shared edge, matching heights means the
walking surfaces are flush. Seamlessness stops being something you eyeball and
becomes an invariant you can assert. So does walkability: each slice publishes
its own little nav graph with a node exactly at each open socket, so the world
nav graph is **connected iff the geometry is stitched**.

## The slice library

Three templates. That is the whole vocabulary.

| Slice | Sockets | Purpose |
|---|---|---|
| **court** | up to 4, all at the deck height | a concept — a floating platform with one piece of architecture. Start, fork, and summit are all courts with different socket counts and features. |
| **straight** | 2, opposite sides, heights `z0`/`z1` | a walkway across the cell. `z0 ≠ z1` renders it as a flight of steps — so "stair" is a parameter, not a fourth template. |
| **corner** | 2, adjacent sides | a turn, with a landing at the cell centre. |

Any orthogonal route on a grid decomposes into straights and corners, so three
templates cover every connection the graph can ask for.

## Layout: routing the graph onto the grid

1. **Depth** = longest path from a root. Depth becomes the floor: a node at
   depth *d* sits at `z = d * FLOOR` and at coarse column `u = 2d`.
   Prerequisites are literally lower and behind.
2. **Lanes.** Within a layer, nodes are ordered by the mean lane of their
   parents (barycentre ordering, to keep links short and uncrossed) and placed
   at `v = 2i`, centred.
3. Spacing of 2 in both axes guarantees at least one free cell between any two
   courts — which is where the stairs go.
4. **Transitive reduction** first: a DAG usually states a prerequisite twice,
   and building stone for both lays a redundant second walkway.
5. **Route each surviving edge** with Dijkstra over free cells, 4-connected,
   with a turn penalty so runs stay straight. Route cells are then reserved, so
   no two walkways ever overlap.
6. **Convert cells to slices**: opposite in/out → straight, adjacent → corner.
7. **Distribute the climb**: the route must gain `Δdepth * FLOOR`. Exactly
   `Δdepth` cells become stairs — preferring straight cells, evenly spaced.
   Every other cell is level. So one flight of steps per floor gained.

## Geometry that makes the stairs flush

A stair cell must present its walking surface at exactly `z0` at the entry edge
and exactly `z1` at the exit edge, or the socket invariant fails at the seam.
So a stair is **5 treads flush at both ends**: heights `z0, z0+1, z0+2, z0+3,
z0+4`, each tread `CELL/5 = 1.6` long. Hence `FLOOR = 4`.

That choice buys a second property for free. The screen delta per depth layer is
`(CELL·TW, CELL·TH − FLOOR·TZ)` = `(256, 128 − 128)` = `(256, 0)`: the two terms
cancel exactly, so **depth advances horizontally across the screen while
climbing in world space**. Layers read as level bands.

## Rendering

A true 2:1 isometric projection with `TW=32, TH=16, TZ=32`, so `TZ = 2·TH` and
the view direction in grid space is exactly `(1,1,1)`. That makes the depth sort
*exact*: box A is in front of B when it lies entirely on the near side along any
one axis; Kahn's algorithm turns that partial order into a draw order. This math
is carried over from the existing renderer, which is the one part of the current
world that is unambiguously right.

Courts are split into `base` / `back` / `front` groups so the traveller can be
sorted *among* the architecture rather than always drawn on top.

Colour is four flat materials. No gradients, no texture, no mist. Whitebox.

## What the POC has to prove

`poc/check.mjs` runs headless over several sample graphs and asserts:

1. **Seam invariant** — every pair of stitched slices has matching socket
   heights, within 1e-9.
2. **No overlap** — no two slices claim the same cell.
3. **Connectivity** — every court is reachable from the start through the nav
   graph alone.
4. **Order** — walking from the start to any node passes its prerequisites'
   floors first (depth is monotone along the route).
5. **Vocabulary** — only the three templates are ever instantiated.

The viewer (`poc/index.html`) renders the world, overlays the nav graph on a
toggle, and walks a traveller along BFS routes when you click a court.

## Deliberately not doing

- Impossible geometry. Explicitly out of scope.
- Art direction, mist, lighting, materials, the goal panel, lessons, the LLM.

---

## What the build changed

Three things the design got wrong, each found by `check.mjs` rather than by eye.

**Three templates became four.** Orthogonal routes that own their cells outright
cannot always be drawn in the plane: three routes can ring a court and wall it
off, and no ordering heuristic makes that impossible. 13 of 200 random DAGs
failed this way, all of them plane-partitioning rather than socket exhaustion.
The fix is the one Monument Valley uses on nearly every screen — a **crossing**
slice, letting one path pass over another. It changes nothing about the
contract: the cell still has four sockets each naming a height. What it drops is
the assumption that a cell's sockets belong to the *same* path. The nav graph
deliberately leaves the two pairs unjoined, which is ustwo's trick of putting
two nav nodes in one place with different roles, seen from the other end.

**Every court is 2×2, not 1×1.** A 1×1 court has four sockets and so carries at
most four paths, which a hub concept overruns. It also had the wrong
proportions: at this spacing a 1×1 court was a quarter the length of the walkway
leading to it, so the world read as corridors with occasional platforms rather
than places with paths between them.

**The painter's key had to go.** A single scalar per solid cannot order a
court's deck against its own taper and root: key by the near corner and the root
paints over the deck, key by the far corner and the deck paints over anything
standing on it. Solids inside a group are now ordered by the same exact
topological sort used between groups.

Routing also needed **rip-up and retry**, borrowed from PCB autorouting: on
failure, throw the attempt away, promote the failed edge to the front of the
queue, and lay everything again.

Final state: 1442 assertions passing over six authored graphs and 200 random
DAGs, zero failures.
