# Slice POC — from a concept graph to a walkable Monument Valley world

An independent proof of concept, in `poc/`. It shares nothing with the app in
`server.mjs` / `public/` except an idea about isometric projection.

**The question:** given a few connected concepts, can we build a walkable
isometric world in the register of Monument Valley out of a **small library of
reusable template slices**, stitched seamlessly?

**The answer: yes, with four templates.** Look and feel is deliberately left as
whitebox — four flat materials, no lighting, no mist, no art direction.

```bash
node poc/check.mjs                              # verify every claim below, headless
node poc/serve.mjs                              # viewer at http://localhost:5174
node poc/render.mjs deep out.svg --at p4 --nav  # render a world to a file
```

In the viewer: **click any platform to walk there.** You can click a new one
mid-walk — she re-paths from where she is standing rather than snapping back.
Drag to pan, scroll to zoom, and the toggles overlay the nav graph and the
slice kinds.

---

## The idea: a socket contract

The world is a coarse grid of square **cells**, `CELL = 8` fine grid units on a
side. Every slice occupies one or more cells and exposes **sockets** — one at
the midpoint of each cell edge, each either closed or open at a specific height.

> **Two slices stitch iff their facing sockets are both open and at the same
> height.**

That one rule does four jobs:

1. **Seamlessness becomes an invariant.** Matching heights means flush walking
   surfaces. `check.mjs` asserts it over every seam of every world; it is not
   something you eyeball.
2. **Walkability is the same fact seen from the other side.** Each slice puts a
   nav node exactly at each open socket, so stitched slices share a node by
   coordinate. The nav graph is connected *if and only if* the geometry is
   stitched — there is no second system to keep in sync.
3. **It says which faces to hide.** A vertical face lying in an open socket's
   plane is interior. Without suppressing those, a walkway crossing ten cells
   shows a dark band at all nine boundaries.
4. **It does not care how big a slice is.** A socket is identified by `(cell,
   side)`, so a 2×2 court with eight sockets stitches by exactly the same rule
   as a 1×1 walkway with two.

## The four templates

| Slice | Sockets | Job |
|---|---|---|
| **court** | up to 8 (2×2 footprint) | a concept. Start, waypoint, fork and summit are all courts — they differ only in how many sockets are open and which architecture stands on them. |
| **straight** | 2, opposite | a walkway across the cell. If its two sockets are at different heights it renders as a flight of steps, so **a stair is a parameter, not a template**. |
| **corner** | 2, adjacent | a turn, with a landing at the cell centre. |
| **crossing** | 4, in two pairs at different heights | one path passing over another. |

Architecture on a court is not placed by hand. The socket lanes are derived from
the contract, and the buildable ground is whatever is left between them — which
is why a court accepts a path on any side without the architecture ever needing
to know.

## How a graph becomes a world

1. **Depth** = longest path from a root, and depth becomes the floor: a node at
   depth *d* sits at `z = d·FLOOR` and coarse column `u = d·step`. Prerequisites
   are literally lower and behind.
2. **Transitive reduction.** A DAG usually states a prerequisite twice; building
   stone for both lays a redundant walkway beside one that already exists.
3. **Lanes** within a layer are settled by forward/backward barycentre sweeps —
   the standard layered-graph-drawing method — because long links are what clog
   the grid.
4. **Route** each surviving edge with Dijkstra over free cells, with a turn
   penalty (straight cells are where stairs can go), a penalty for hugging
   someone else's court, and a larger one for bridging.
5. **Distribute the climb**: exactly `Δdepth` cells become flights, preferring
   straights. Where a route bridges another, the flights are *searched* rather
   than spread, so the two paths clear each other.
6. **Rip-up and retry.** Routes reserve whole cells, so a greedy pass can wall
   off the plane. On failure the attempt is thrown away, the failed edge is
   promoted to the front of the queue, and everything is laid again.

### Why the stairs have five treads

A flight must present its surface at exactly `z0` at the entry edge and exactly
`z1` at the exit edge, or the socket equality fails at the seam. Five treads
flush at both ends gives four risers, so `FLOOR = 4`.

That buys a second property free: the screen delta per depth layer is
`(CELL·TW, CELL·TH − FLOOR·TZ)` = `(256, 128 − 128)` = `(256, 0)`. The terms
cancel exactly, so **depth advances horizontally across the screen while
climbing in world space**, and layers read as level bands.

## What `check.mjs` proves

Over six authored graphs and 200 random DAGs — 1442 assertions:

- **every seam is flush**, to 1e-9, re-derived independently of the builder;
- **no two slices claim a cell**, and no socket opens onto empty space;
- **every court is reachable** from the start through the nav graph alone, and a
  concrete walk to the summit exists;
- **routes climb and never descend** — you never go down to reach something that
  depends on you;
- **no welded nav nodes** — nav nodes merge by coordinate, which is what stitches
  slices together, so a collision between slices that are *not* neighbours would
  silently weld two distant parts of the world and let the traveller step across
  the map. Every shared node is either one slice's own or a socket between
  orthogonally adjacent cells;
- **the motion, not just the destination** — sampled at 60fps, the traveller
  starts and ends exactly on her endpoints, never leaves the nav polyline (to
  1e-6), never moves more than 1.5 units in a frame, and never descends;
- **only the four templates** are ever instantiated;
- **crossings clear** by at least `HEADROOM` levels and the nav graph keeps
  their two paths unjoined.

## Known limits

- **Worlds get wide.** Depth runs horizontally, so a nine-deep curriculum is a
  long band. Fine to pan, but it is not a single-screen composition the way a
  Monument Valley level is.
- **No impossible geometry.** Out of scope by instruction. The depth sort would
  need a different treatment for it.
- **Whitebox only.** Four flat materials. No lighting, mist, occlusion of
  distant content, or progression state.
- **A court caps at eight paths.** Beyond that it would need a 3×3 footprint;
  nothing in the contract objects, it is simply not implemented.
- **Corners can carry a flight** if a route has too few straights, and a bent
  flight reads worse than a straight one. The router avoids it; it is a
  fallback, not a design.
