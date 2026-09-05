/* The viewer. Renders a built world as flat SVG polygons in the exact draw
 * order the depth sort produced, and walks a traveller along the nav graph.
 *
 * The world is static, so it is rendered once. Only the traveller moves, and
 * she is placed by re-inserting a single DOM node at the right point in the
 * order rather than re-rendering the scene.
 */

import { P, order as frontOf, group, bx, depthSort, sortShapes } from './iso.js';
import { build } from './build.js';
import { CELL } from './slices.js';
import { GRAPHS } from './graphs.js';
import { findWalk } from './nav.js';

const svg = document.getElementById('stage');
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

const S = { world: null, view: { x: 0, y: 0, k: 1 }, at: null, walking: false, els: [], order: [] };

/* ------------------------------------------------------------- traveller -- */

/* A body and a head, as one group with a compact box, so the depth sort can
 * place her among the architecture rather than always on top of it. */
function traveller(p) {
  const g = group('you');
  bx(g, p.x - 0.42, p.y - 0.42, p.z, 0.84, 0.84, 1.5, 'body');
  bx(g, p.x - 0.34, p.y - 0.34, p.z + 1.5, 0.68, 0.68, 0.7, 'head');
  return sortShapes(g);
}

function drawGroup(g) {
  const node = el('g', { class: g.kind === 'you' ? 'you' : g.slice === 'court' ? 'court' : 'link' });
  if (g.id) node.dataset.id = g.id;
  for (const s of g.shapes) {
    node.appendChild(s.tag === 'path'
      ? el('path', { class: s.cls, d: s.d })
      : el('polygon', { class: s.cls, points: s.pts }));
  }
  return node;
}

/* Where the traveller belongs in a settled draw order: immediately before the
 * first group she is in front of. */
function insertionIndex(sorted, her) {
  for (let i = 0; i < sorted.length; i++) if (frontOf(her, sorted[i]) < 0) return i;
  return sorted.length;
}

/* ----------------------------------------------------------------- scene -- */

let scene, navLayer, labelLayer, youEl = null, labels = [];

function render(world) {
  svg.replaceChildren();
  scene = el('g');
  navLayer = el('g', { id: 'navlayer' });
  labelLayer = el('g');
  svg.append(scene, navLayer, labelLayer);

  S.order = depthSort(world.groups);
  S.els = S.order.map((g) => {
    const node = drawGroup(g);
    scene.appendChild(node);
    return node;
  });

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
  const idx = insertionIndex(S.order, her);
  const node = drawGroup(her);
  if (youEl) youEl.remove();
  youEl = node;
  scene.insertBefore(node, S.els[idx] || null);
}

/* ------------------------------------------------------------------ view -- */

function applyView() {
  const { x, y, k } = S.view;
  scene.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
  navLayer.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
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

function walkTo(courtId) {
  if (S.walking) return;
  const c = S.world.courts.find((q) => q.id === courtId);
  if (!c || !S.at) return;
  const from = `${S.at.x.toFixed(3)},${S.at.y.toFixed(3)},${S.at.z.toFixed(3)}`;
  const path = findWalk(S.world.nav, from, c.navKey);
  if (!path || path.length < 2) return;

  // constant speed along the polyline, so stairs do not read as teleports
  const seg = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y, (b.z - a.z) * 0.7) || 0.001;
    seg.push(d); total += d;
  }
  const dur = Math.min(6000, total * 70);
  const t0 = performance.now();
  S.walking = true;

  // requestAnimationFrame does not fire while the tab is hidden, and a walk
  // that never finishes leaves S.walking true forever and makes the whole world
  // unclickable. The guard promises the walk always ends.
  const arrive = () => {
    clearTimeout(guard);
    S.at = { ...c.stand };
    placeTraveller();
    S.walking = false;
  };
  const guard = setTimeout(arrive, dur + 500);

  const step = () => {
    if (!S.walking) return;
    const u = Math.min(1, (performance.now() - t0) / dur);
    let want = u * total, i = 0;
    while (i < seg.length - 1 && want > seg[i]) { want -= seg[i]; i++; }
    const a = path[i], b = path[i + 1], f = Math.min(1, want / seg[i]);
    S.at = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
    placeTraveller();
    if (u < 1) return requestAnimationFrame(step);
    arrive();
  };
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------------- ui --- */

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
  const world = build(GRAPHS[key]);
  S.world = world;
  const start = world.courts.find((c) => c.depth === 0);
  S.at = { ...start.stand };
  S.walking = false;
  fit(world);
  render(world);
  stats(world);
}

/* pan, zoom, click ---------------------------------------------------------- */

let drag = null;
svg.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, vx: S.view.x, vy: S.view.y, moved: false };
  svg.setPointerCapture(e.pointerId);
  svg.classList.add('dragging');
});
svg.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  S.view.x = drag.vx + dx; S.view.y = drag.vy + dy;
  applyView();
});
svg.addEventListener('pointerup', (e) => {
  const wasDrag = drag && drag.moved;
  drag = null;
  svg.classList.remove('dragging');
  if (wasDrag) return;
  const court = e.target.closest('.court');
  if (court && court.dataset.id) walkTo(court.dataset.id);
});
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
window.poc = { S, load, applyView, walkTo, focus(id) {
  const c = S.world.courts.find((q) => q.id === id) || S.world.courts[0];
  const p = P(c.stand.x, c.stand.y, c.stand.z);
  const W = svg.clientWidth, H = svg.clientHeight;
  S.view = { k: 1, x: W / 2 - p.x, y: H / 2 - p.y };
  applyView();
} };

picker.value = 'diamond';
load('diamond');
