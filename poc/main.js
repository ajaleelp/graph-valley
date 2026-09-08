/* The viewer. Renders a built world as flat SVG polygons in the exact draw
 * order the depth sort produced, and walks a traveller along the nav graph.
 *
 * The world is static, so it is rendered once. Only the traveller moves, and
 * she is placed by re-inserting a single DOM node at the right point in the
 * order rather than re-rendering the scene.
 */

import { P, depthSort } from '/world/iso.js';
import { build } from '/world/build.js';
import { CELL } from '/world/slices.js';
import { GRAPHS } from '/world/graphs.js';
import { findWalk, nearestNode, navKey } from '/world/nav.js';
import { plan, at, duration, traveller, orderWith } from '/world/walk.js';

const svg = document.getElementById('stage');
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

const S = { world: null, view: { x: 0, y: 0, k: 1 }, at: null, walking: false, elFor: new Map() };

/* ------------------------------------------------------------- traveller -- */

function drawGroup(g) {
  const node = el('g', { class: g.kind === 'you' ? 'you' : g.slice === 'court' ? 'court' : 'link' });
  if (g.slice === 'court' && g.id) node.dataset.id = g.id;
  if (g.navAt) { node.dataset.nav = navKey(g.navAt); node.dataset.label = g.navLabel || 'the path'; }
  for (const s of g.shapes) {
    node.appendChild(s.tag === 'path'
      ? el('path', { class: s.cls, d: s.d })
      : el('polygon', { class: s.cls, points: s.pts }));
  }
  return node;
}

/* ----------------------------------------------------------------- scene -- */

let scene, navLayer, routeLayer, labelLayer, youEl = null, labels = [];

function render(world) {
  svg.replaceChildren();
  scene = el('g');
  routeLayer = el('g', { id: 'routelayer' });
  navLayer = el('g', { id: 'navlayer' });
  labelLayer = el('g');
  svg.append(scene, routeLayer, navLayer, labelLayer);

  S.elFor = new Map();
  for (const g of depthSort(world.groups)) {
    const node = drawGroup(g);
    S.elFor.set(g, node);
    scene.appendChild(node);
  }

  // nav graph overlay
  const seen = new Set();
  for (const [k, adj] of world.nav.adj) {
    const a = world.nav.pos.get(k), pa = P(a.x, a.y, a.z);
    for (const j of adj) {
      const key = k < j ? `${k}|${j}` : `${j}|${k}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = world.nav.pos.get(j), pb = P(b.x, b.y, b.z);
      navLayer.appendChild(el('line', { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y }));
    }
    navLayer.appendChild(el('circle', { cx: pa.x, cy: pa.y, r: 2 }));
  }

  // Labels live in SCREEN space, not world space: a caption scaled with the
  // world becomes two pixels tall the moment you zoom out to see all of it.
  labels = [];
  for (const c of world.courts) {
    const p = P(c.stand.x, c.stand.y + c.span * (CELL / 2), c.stand.z);
    const g = el('g', { class: 'label' });
    const t = el('text', { 'text-anchor': 'middle', y: 12 });
    t.textContent = c.title || c.id;
    g.append(el('rect', { x: 0, y: 0, width: 0, height: 17, rx: 4 }), t);
    labelLayer.appendChild(g);
    labels.push({ node: g, p, dy: 6 });
  }
  for (const s of world.slices) {
    if (s.kind === 'court') continue;
    const p = P(s.u * CELL + CELL / 2, s.v * CELL + CELL / 2, s.sockets[0].z);
    const g = el('g', { class: 'kind' });
    const t = el('text', { 'text-anchor': 'middle', y: 4 });
    t.textContent = { straight: 'S', corner: 'C', crossing: 'X' }[s.kind];
    g.appendChild(t);
    labelLayer.appendChild(g);
    labels.push({ node: g, p, dy: 0 });
  }

  placeTraveller();
  applyView();
  syncToggles();
}

function placeTraveller() {
  if (!S.at) return;
  const her = traveller(S.at);
  if (youEl) youEl.remove();
  youEl = drawGroup(her);

  // Reconcile the DOM against the exact order rather than rebuilding it. The
  // world's groups keep their relative places from frame to frame, so this
  // moves one element in the common case even though it checks all of them.
  const want = orderWith(S.world.groups, her).map((g) => (g === her ? youEl : S.elFor.get(g)));
  let node = scene.firstChild;
  for (const el of want) {
    if (!el) continue;
    if (node === el) { node = node.nextSibling; continue; }
    scene.insertBefore(el, node);
  }
}

/* ------------------------------------------------------------------ view -- */

function applyView() {
  const { x, y, k } = S.view;
  const t = `translate(${x} ${y}) scale(${k})`;
  scene.setAttribute('transform', t);
  routeLayer.setAttribute('transform', t);
  navLayer.setAttribute('transform', t);
  for (const l of labels) {
    l.node.setAttribute('transform', `translate(${x + l.p.x * k} ${y + l.p.y * k + l.dy})`);
    const t = l.node.querySelector('text');
    const r = l.node.querySelector('rect');
    if (r) {
      const w = t.textContent.length * 6.6 + 12;
      r.setAttribute('x', -w / 2);
      r.setAttribute('width', w);
    }
  }
}

function fit(world) {
  const b = world.bounds;
  const W = svg.clientWidth || 1200, H = svg.clientHeight || 800;
  const k = Math.min((W - 340) / (b.x1 - b.x0 + 120), (H - 140) / (b.y1 - b.y0 + 140), 1.1);
  S.view = { k, x: W / 2 - ((b.x0 + b.x1) / 2) * k, y: H / 2 - ((b.y0 + b.y1) / 2) * k };
}

/* ------------------------------------------------------------------ walk -- */

function showRoute(path) {
  routeLayer.replaceChildren();
  if (!path) return;
  const pts = path.map((q) => { const p = P(q.x, q.y, q.z); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; });
  routeLayer.appendChild(el('polyline', { points: pts.join(' ') }));
}

let raf = null, guard = null;

function stop() {
  cancelAnimationFrame(raf);
  clearTimeout(guard);
  S.walking = false;
}

function walkTo(courtId) {
  const c = S.world.courts.find((q) => q.id === courtId);
  if (!c) return;
  walkToNode(c.navKey, c.title || c.id, c.stand);
}

/* Walk to any nav node. Courts are just the named case. */
function walkToNode(target, label, snap) {
  if (!S.at || !S.world.nav.pos.has(target) || target === navKey(S.at)) return;
  const dest = snap || S.world.nav.pos.get(target);

  // Interrupting mid-walk re-paths from the node she is standing nearest, with
  // her exact position kept on the front so she carries on from where she is
  // rather than snapping to a nav node.
  const here = { ...S.at };
  const from = S.walking ? nearestNode(S.world.nav, here) : navKey(here);
  stop();
  const found = findWalk(S.world.nav, from, target);
  if (!found || found.length < 2) return;
  const path = navKey(found[0]) === navKey(here) ? found : [here, ...found];

  const pl = plan(path);
  const dur = duration(pl.total);
  const t0 = performance.now();
  S.walking = true;
  showRoute(path);
  setStatus(`walking to ${label}`);

  // requestAnimationFrame does not fire while the tab is hidden, and a walk
  // that never finishes leaves S.walking true forever and makes the whole world
  // unclickable. The guard promises the walk always ends.
  const arrive = () => {
    stop();
    S.at = { ...dest };
    placeTraveller();
    showRoute(null);
    setStatus(`at ${label}`);
  };
  guard = setTimeout(arrive, dur + 500);

  const step = () => {
    if (!S.walking) return;
    const u = (performance.now() - t0) / dur;
    S.at = at(pl, u);
    placeTraveller();
    if (u < 1) { raf = requestAnimationFrame(step); return; }
    arrive();
  };
  raf = requestAnimationFrame(step);
}

/* ------------------------------------------------------------------- ui --- */

function setStatus(text) {
  const n = document.getElementById('status');
  if (n) n.textContent = text;
}

function syncToggles() {
  navLayer.style.display = document.getElementById('nav').checked ? '' : 'none';
  const labels = document.getElementById('labels').checked;
  const kinds = document.getElementById('cells').checked;
  for (const g of labelLayer.children) {
    g.style.display = (g.classList.contains('label') ? labels : kinds) ? '' : 'none';
  }
}

function stats(world) {
  const dl = document.getElementById('stats');
  const s = world.stats;
  dl.replaceChildren();
  const rows = [
    ['concepts', s.courts], ['straights', s.straights], ['corners', s.corners],
    ['crossings', s.crossings], ['seams (all flush)', s.seams],
    ['nav nodes', s.navNodes], ['polygons', s.shapes],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
  const box = document.getElementById('problems');
  box.hidden = !world.problems.length;
  box.textContent = world.problems.join('\n');
}

function load(key) {
  // Hand the builder the real viewport: compose.js chooses how the world folds
  // from the shape of the screen it will be seen on, so the POC demonstrates
  // that choice rather than hard-coding one side of it.
  const world = build(GRAPHS[key], { viewport: [svg.clientWidth || 1200, svg.clientHeight || 800] });
  S.world = world;
  const start = world.courts.find((c) => c.depth === 0);
  stop();
  S.at = { ...start.stand };
  if (routeLayer) showRoute(null);
  fit(world);
  render(world);
  stats(world);
  setStatus(`at ${start.title || start.id}`);
}

/* pan, zoom, click ---------------------------------------------------------- */

/* The click target is read at POINTERDOWN, not at pointerup.
 *
 * setPointerCapture retargets every subsequent event for that pointer to the
 * capture element, so by pointerup e.target IS the <svg> and closest('.court')
 * is null no matter what you clicked on. Capture is still worth having — it
 * keeps a drag alive when the pointer leaves the window — so the fix is to
 * remember what was actually under the pointer when it went down. */
let drag = null;

/* What a press landed on: a named court, or any other walkable surface. */
const targetUnder = (node) => {
  if (!node || !node.closest) return null;
  const court = node.closest('.court');
  if (court && court.dataset.id) return { court: court.dataset.id };
  const link = node.closest('.link');
  if (link && link.dataset.nav) return { nav: link.dataset.nav, label: link.dataset.label };
  return null;
};

svg.addEventListener('pointerdown', (e) => {
  drag = {
    x: e.clientX, y: e.clientY,
    vx: S.view.x, vy: S.view.y,
    moved: false,
    hit: targetUnder(e.target),
    id: e.pointerId,
  };
  try { svg.setPointerCapture(e.pointerId); } catch { /* some pointers refuse it */ }
  svg.classList.add('dragging');
});

svg.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  // A few pixels of tremor between press and release is a click, not a drag.
  if (Math.hypot(dx, dy) > 5) drag.moved = true;
  S.view.x = drag.vx + dx;
  S.view.y = drag.vy + dy;
  applyView();
});

const endDrag = (e) => {
  if (!drag || (e && e.pointerId !== drag.id)) return null;
  const d = drag;
  drag = null;
  svg.classList.remove('dragging');
  try { if (e) svg.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
  return d;
};

svg.addEventListener('pointerup', (e) => {
  const d = endDrag(e);
  if (!d || d.moved || !d.hit) return;
  if (d.hit.court) walkTo(d.hit.court);
  else walkToNode(d.hit.nav, d.hit.label || 'the path');
});
// A cancelled gesture must not leave a half-open drag behind, or the next
// press inherits it and the click after that is swallowed as a drag.
svg.addEventListener('pointercancel', endDrag);

svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const k = Math.max(0.15, Math.min(3, S.view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
  const r = svg.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  S.view.x = mx - (mx - S.view.x) * (k / S.view.k);
  S.view.y = my - (my - S.view.y) * (k / S.view.k);
  S.view.k = k;
  applyView();
}, { passive: false });

const picker = document.getElementById('graph');
for (const [key, g] of Object.entries(GRAPHS)) {
  const o = document.createElement('option');
  o.value = key; o.textContent = `${key} — ${g.name}`;
  picker.appendChild(o);
}
picker.addEventListener('change', () => load(picker.value));
for (const id of ['nav', 'labels', 'cells']) {
  document.getElementById(id).addEventListener('change', syncToggles);
}
window.addEventListener('resize', () => { fit(S.world); applyView(); });

// A handle for driving the viewer from the console or a test harness.
window.poc = { S, load, applyView, walkTo, walkToNode, targetUnder, focus(id) {
  const c = S.world.courts.find((q) => q.id === id) || S.world.courts[0];
  const p = P(c.stand.x, c.stand.y, c.stand.z);
  const W = svg.clientWidth, H = svg.clientHeight;
  S.view = { k: 1, x: W / 2 - p.x, y: H / 2 - p.y };
  applyView();
} };

picker.value = 'diamond';
load('diamond');
