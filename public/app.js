/* Graph Valley — front-end: world rendering, traversal, lessons. */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const SVGNS = 'http://www.w3.org/2000/svg';
const XHTMLNS = 'http://www.w3.org/1999/xhtml';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* Per-castle accent palettes — varied like the reference (coral, pink, teal,
   gold, sky), all with cream tops. Complete turns gold. */
const PALETTES = [
  { top: '#f8ecd8', left: '#f2a583', right: '#e58a66' }, // coral
  { top: '#fcefe0', left: '#f3b8a0', right: '#ef9c86' }, // blush
  { top: '#f6eeda', left: '#e0a06a', right: '#cd8350' }, // terracotta
  { top: '#fbf0dd', left: '#f0ad8e', right: '#e48f70' }, // peach
];
const GOLD = { top: '#fbe7c0', left: '#f2c94c', right: '#e0a83b' };
const SAVE_KEY = 'graphvalley.save.v1';

const S = {
  topic: null,
  title: null,
  graph: null,
  source: null,
  done: new Set(),
  nodeEls: new Map(),
  avatar: { x: 0, y: 0 },
  anim: null,
  lessonCache: new Map(),
  currentNode: null,
  at: null, // id of the node the avatar is standing at
  walking: false,
};

const view = { x: 0, y: 0, k: 1 };
let didDrag = false;

/* ------------------------------ helpers ------------------------------ */

function el(tag, attrs = {}) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

/* deterministic PRNG so the starfield is stable per render */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

function saveGame() {
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({ topic: S.topic, title: S.title, graph: S.graph, source: S.source, done: [...S.done] }),
    );
  } catch { /* private mode etc. */ }
}

function loadSave() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}

/* ------------------------------- layout ------------------------------ */

/* Compact connected layout: ONE dense structure. depth = a tight ring
   outward; nodes cluster so towers nearly touch, with real verticality. */
function computeLayout(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const rand = mulberry32(20240);
  const cache = new Map();
  const depth = (id) => {
    if (cache.has(id)) return cache.get(id);
    const n = byId.get(id);
    const d = n.deps.length ? 1 + Math.max(...n.deps.map(depth)) : 0;
    cache.set(id, d);
    return d;
  };
  const layers = new Map();
  for (const n of graph.nodes) {
    const L = depth(n.id);
    if (!layers.has(L)) layers.set(L, []);
    layers.get(L).push(n);
    n.depth = L;
  }
  for (const [L, arr] of layers) {
    if (L === 0) { arr.forEach((n) => { n.sx = 0; n.sy = 0; }); continue; }
    arr.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    const baseAngle = rand() * Math.PI * 2;
    arr.forEach((n, i) => {
      const ang = baseAngle + (i * 2 * Math.PI) / arr.length + (rand() - 0.5) * 0.5;
      const r = L * 28 + (rand() - 0.5) * 8; // super dense – one single monument
      n.sx = Math.cos(ang) * r;
      n.sy = Math.sin(ang) * r * 0.5;
      n.elev = Math.max(...n.deps.map((d) => byId.get(d).elev ?? 0), 0) + (rand() < 0.55 ? 0 : 22);
    });
  }
  graph.nodes.forEach((n, i) => (n._pal = i % PALETTES.length));
}

const statusOf = (n) =>
  S.done.has(n.id) ? 'complete' : n.deps.every((d) => S.done.has(d)) ? 'available' : 'locked';

/* --------------------------- world rendering -------------------------- */

/* -------------------- Monument Valley building blocks --------------------
   Isometric helper: for an object of half-width w sitting with its front
   corner at (0,y0) rising to height h, the visible faces are three quads. */

function polyPts(...pts) {
  return pts.map((p) => p.join(',')).join(' ');
}

/* ---- isometric block: a solid box of half-width w, top at (x, topY) ----
   The "top" diamond has its front corner at (x, topY + w*0.5). */
function addBlock(g, x, topY, w, h) {
  const ry = w * 0.5;
  const f = topY + ry; // front corner of the top face
  g.appendChild(el('polygon', { class: 'f-left', points: polyPts([x - w, topY], [x, f], [x, f + h], [x - w, topY + h]) }));
  g.appendChild(el('polygon', { class: 'f-right', points: polyPts([x + w, topY], [x, f], [x, f + h], [x + w, topY + h]) }));
  g.appendChild(el('polygon', { class: 'f-top', points: polyPts([x, topY - ry], [x + w, topY], [x, f], [x - w, topY]) }));
  return topY;
}

/* hanging pillar below a block (Monument Valley's floating columns) */
function addPillar(g, x, topY, w, drop) {
  const ry = w * 0.5;
  g.appendChild(el('polygon', { class: 'f-left', points: polyPts([x - w, topY], [x, topY + ry], [x, topY + ry + drop], [x - w, topY + drop]) }));
  g.appendChild(el('polygon', { class: 'f-right', points: polyPts([x + w, topY], [x, topY + ry], [x, topY + ry + drop], [x + w, topY + drop]) }));
}

function addDome(g, x, topY) {
  g.appendChild(el('path', { class: 'f-dome', d: `M ${x - 13} ${topY} A 13 13 0 0 1 ${x + 13} ${topY} Z` }));
  g.appendChild(el('line', { class: 'roofline', x1: x, y1: topY - 13, x2: x, y2: topY - 20 }));
  g.appendChild(el('circle', { class: 'roof', cx: x, cy: topY - 22, r: 2.4 }));
}

/* arched doorway on the front face of a block */
function addArch(g, x, baseY, s = 1) {
  g.appendChild(el('path', {
    class: 'f-arch',
    d: `M ${x - 5 * s} ${baseY} L ${x - 5 * s} ${baseY - 9 * s} A ${5 * s} ${5 * s} 0 0 1 ${x + 5 * s} ${baseY - 9 * s} L ${x + 5 * s} ${baseY} Z`,
  }));
}

/* The walkable point on top of a node (world coords): front corner of its roof. */
const nodeTop = (n) => ({ x: n.sx, y: n.sy + n.w * 0.5 - (n.elev || 0) });

const buildingH = (n, i) => (n.goal ? 96 : 58 + (i % 3) * 14);
/* the front-bottom corner y of a node's base (local coords) — where its label sits */
const baseBottom = (n, i) => -(n.elev || 0) + buildingH(n, i) + n.w * 0.5;

/* A floating castle: towers with dark pointed roofs + pennants on a solid
   base that tapers downward. All coordinates are explicit so roofs sit flush. */
function buildNodeBuilding(n, i) {
  const g = el('g', { class: 'bldg' });
  const w = n.w;
  const topY = -(n.elev || 0); // the walkable roof plane (front corner at topY + w*0.5)
  const H = buildingH(n, i);
  const variant = n.goal ? 'temple' : n.depth === 0 ? 'gate' : ['twin', 'keep', 'tall', 'court'][i % 4];

  // A tower standing on the base roof: draw a block of half-width tw whose
  // sides rise `th` ABOVE the base roof plane, then cap it with a roof.
  const tower = (x, tw, th, roof, flag = true) => {
    const ry = tw * 0.5;
    const topY2 = topY - th; // the tower's own roof plane
    addBlock(g, x, topY2, tw, th); // sides hang down `th` from topY2, back to base roof
    const topNorth = topY2; // top face north corner
    if (roof === 'cone') {
      g.appendChild(el('polygon', { class: 'roof', points: polyPts([x, topNorth - tw * 1.4], [x + tw, topNorth + ry], [x - tw, topNorth + ry]) }));
    } else if (roof === 'dome') {
      g.appendChild(el('path', { class: 'f-dome', d: `M ${x - tw * 0.8} ${topNorth + ry} A ${tw * 0.8} ${tw * 0.8} 0 0 1 ${x + tw * 0.8} ${topNorth + ry} Z` }));
    }
    if (flag) addFlag(g, x + tw * 0.4, topNorth - (roof === 'cone' ? tw * 1.4 : 0));
  };

  // ---- solid base under the whole castle (tapers down) ----
  // main base block: top face at topY, walls drop H
  addBlock(g, 0, topY, w, H);
  // a lower tapering tier
  addBlock(g, 0, topY + H, w * 0.66, H * 0.5);

  // ---- towers on top, per variant ----
  if (variant === 'temple') {
    tower(0, w * 0.5, H * 0.95, 'dome', false);
    tower(-w * 0.62, w * 0.3, H * 0.66, 'cone');
    tower(w * 0.62, w * 0.3, H * 0.66, 'cone');
  } else if (variant === 'gate') {
    tower(-w * 0.5, w * 0.36, H * 0.7, 'cone');
    tower(w * 0.5, w * 0.36, H * 0.7, 'cone');
  } else if (variant === 'twin') {
    tower(-w * 0.5, w * 0.4, H * 0.78, 'cone');
    tower(w * 0.5, w * 0.4, H * 0.95, 'cone');
  } else if (variant === 'keep') {
    tower(0, w * 0.54, H * 0.85, 'dome', false);
    tower(-w * 0.66, w * 0.28, H * 0.55, 'cone');
    tower(w * 0.66, w * 0.28, H * 0.62, 'cone');
  } else if (variant === 'tall') {
    tower(0, w * 0.42, H * 1.1, 'cone');
    tower(-w * 0.6, w * 0.3, H * 0.66, 'cone');
    tower(w * 0.6, w * 0.3, H * 0.52, 'dome');
  } else { // court
    tower(-w * 0.55, w * 0.32, H * 0.66, 'cone');
    tower(w * 0.55, w * 0.32, H * 0.66, 'cone');
    tower(0, w * 0.4, H * 0.42, 'dome', false);
  }

  // arched doorway on the front of the main base
  addArch(g, 0, topY + w * 0.5 + H * 0.32, n.goal ? 1.7 : 1.2);
  return g;
}

/* little pennant flag on a pole */
function addFlag(g, x, y) {
  g.appendChild(el('line', { class: 'flagpole', x1: x, y1: y, x2: x, y2: y - 13 }));
  g.appendChild(el('polygon', { class: 'flag', points: polyPts([x, y - 13], [x + 11, y - 10], [x, y - 7]) }));
}

/* a THICK bridge / staircase connecting two towers — a solid slab with side
   walls, like the reference's heavy arches and causeways. */
function addConnector(g, a, b) {
  const A = nodeTop(a), B = nodeTop(b);
  const w = 20; // wide
  const dx = B.x - A.x, dy = B.y - A.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * w, ny = (dx / len) * w * 0.5;
  // roof of the causeway
  g.appendChild(el('polygon', {
    class: 'walk-top',
    points: polyPts([A.x + nx, A.y + ny], [B.x + nx, B.y + ny], [B.x - nx, B.y - ny], [A.x - nx, A.y - ny]),
  }));
  // stair treads across the top
  const steps = Math.max(3, Math.floor(len / 16));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = A.x + dx * t, cy = A.y + dy * t;
    g.appendChild(el('line', { class: 'tread', x1: cx + nx, y1: cy + ny, x2: cx - nx, y2: cy - ny }));
  }
  // solid side walls — deep, so it reads as a heavy structure, not a line
  const drop = 46;
  g.appendChild(el('polygon', {
    class: 'f-right',
    points: polyPts([A.x + nx, A.y + ny], [B.x + nx, B.y + ny], [B.x + nx, B.y + ny + drop], [A.x + nx, A.y + ny + drop]),
  }));
  g.appendChild(el('polygon', {
    class: 'f-left',
    points: polyPts([A.x - nx, A.y - ny], [B.x - nx, B.y - ny], [B.x - nx, B.y - ny + drop], [A.x - nx, A.y - ny + drop]),
  }));
  return g;
}

/* The whole continuous world: buildings joined by stair-bridges, hanging
   from slender pillars — one structure, not scattered islands. */
function renderWorldStructure() {
  const world = $('#world-structure');
  world.innerHTML = '';
  const rand = mulberry32(777);
  S.nodeEls.clear();

  for (const n of S.graph.nodes) n.w = n.goal ? 130 : n.depth === 0 ? 110 : 95;

  const byId = new Map(S.graph.nodes.map((n) => [n.id, n]));
  const order = [...S.graph.nodes].sort((a, b) => a.sy + (a.elev || 0) - (b.sy + (b.elev || 0)));

  // connectors first (buildings sit on top of their ends)
  for (const n of S.graph.nodes) {
    for (const d of n.deps) {
      const a = byId.get(d);
      if (!a) continue;
      const conn = el('g', { class: 'conn locked', 'data-a': a.id, 'data-b': n.id });
      addConnector(conn, a, n);
      world.appendChild(conn);
    }
  }

  // each building, hanging from pillar(s)
  for (const n of order) {
    const i = S.graph.nodes.indexOf(n);
    const st = statusOf(n);
    const pal = st === 'complete' ? GOLD : PALETTES[n._pal];
    const g = el('g', {
      class: `node ${st}`,
      'data-id': n.id,
      transform: `translate(${n.sx} ${n.sy})`,
      role: 'button', tabindex: '0',
    });
    g.style.setProperty('--top', pal.top);
    g.style.setProperty('--left', pal.left);
    g.style.setProperty('--right', pal.right);

    // slender pillar(s) dropping from the building's underside into the void
    const baseY = -(n.elev || 0) + buildingH(n, i);
    addPillar(g, -n.w * 0.3, baseY, 5, 60 + rand() * 40);
    if (n.w > 38) addPillar(g, n.w * 0.3, baseY, 5, 90 + rand() * 30);

    g.appendChild(buildNodeBuilding(n, i));

    // glow ring for available / beacon for the goal
    g.appendChild(el('ellipse', { class: 'ring', cx: 0, cy: -(n.elev || 0) + n.w * 0.5, rx: n.w + 12, ry: (n.w + 12) * 0.5 }));
    if (n.goal) g.appendChild(el('ellipse', { class: 'beacon', cx: 0, cy: -(n.elev || 0) + n.w * 0.5, rx: n.w + 30, ry: (n.w + 30) * 0.5 }));

    // Only show a label for reachable/complete nodes. No floating "???" pills.
    if (st !== 'locked') {
      const labelY = baseBottom(n, i) + 8;
      const fo = el('foreignObject', { x: -85, y: labelY, width: 170, height: 30, class: 'label-fo' });
      const wrap = document.createElementNS(XHTMLNS, 'div');
      wrap.setAttribute('class', 'node-label-wrap');
      const label = document.createElementNS(XHTMLNS, 'div');
      label.setAttribute('class', 'node-label');
      label.textContent = n.title;
      wrap.appendChild(label);
      fo.appendChild(wrap);
      g.appendChild(fo);
    }

    g.addEventListener('click', () => { if (didDrag) { didDrag = false; return; } onNodeClick(n.id); });
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNodeClick(n.id); } });
    world.appendChild(g);
    S.nodeEls.set(n.id, g);
  }
  paintAll();
}

function paintAll() {
  const byId = new Map(S.graph.nodes.map((n) => [n.id, n]));
  for (const n of S.graph.nodes) {
    const g = S.nodeEls.get(n.id);
    if (!g) continue;
    const st = statusOf(n);
    const pal = st === 'complete' ? GOLD : PALETTES[n._pal];
    g.style.setProperty('--top', pal.top);
    g.style.setProperty('--left', pal.left);
    g.style.setProperty('--right', pal.right);
    g.setAttribute('class', `node ${st}`);
    const label = g.querySelector('.node-label');
    if (label) label.textContent = st === 'locked' ? '???' : n.title;
  }
  // walkway states: lit once its source is done, golden once both ends are
  $('#world-structure').querySelectorAll('.conn').forEach((c) => {
    const a = byId.get(c.dataset.a), b = byId.get(c.dataset.b);
    if (!a || !b) return;
    const st = S.done.has(a.id) && S.done.has(b.id) ? 'done' : S.done.has(a.id) ? 'open' : 'locked';
    c.setAttribute('class', `conn ${st}`);
  });
}

function buildDefs(svg) {
  const d = el('defs');
  d.innerHTML = `
    <radialGradient id="avatarGlow">
      <stop offset="0" stop-color="#ffdf9e" stop-opacity="0.9"/>
      <stop offset="0.5" stop-color="#ffc46a" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#ffc46a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="goalGlow">
      <stop offset="0" stop-color="#f7d774" stop-opacity="0.85"/>
      <stop offset="0.6" stop-color="#f2c94c" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#f2c94c" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="4"/>
    </filter>`;
  svg.appendChild(d);
}

function buildWorld() {
  const svg = $('#world');
  const viewport = $('#viewport');
  svg.querySelectorAll('defs').forEach((x) => x.remove());
  viewport.querySelectorAll(':scope > .stars').forEach((x) => x.remove());
  buildDefs(svg);
  renderWorldStructure();
  fitView();

  const hub = S.graph.nodes.find((n) => n.depth === 0) || S.graph.nodes[0];
  placeAvatar(hub, true);
  S.at = hub.id;
  updateHud();
}

/* ----------------------------- camera ----------------------------- */

function applyView() {
  $('#viewport').setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
  positionChoice();
}

function fitView() {
  if (!S.graph) return;
  const r = $('#world').getBoundingClientRect();
  const xs = S.graph.nodes.map((n) => n.sx);
  const ys = S.graph.nodes.map((n) => n.sy);
  const minX = Math.min(...xs) - 160, maxX = Math.max(...xs) + 160;
  const minY = Math.min(...ys) - 260, maxY = Math.max(...ys) + 300;
  const bw = maxX - minX, bh = maxY - minY;
  view.k = Math.max(0.3, Math.min(r.width / bw, r.height / bh, 1.15));
  view.x = (r.width - bw * view.k) / 2 - minX * view.k;
  view.y = (r.height - bh * view.k) / 2 - minY * view.k;
  applyView();
}

function bindCamera() {
  const svg = $('#world');
  let start = null;

  svg.addEventListener('pointerdown', (e) => {
    start = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('panning');
  });
  svg.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.px, dy = e.clientY - start.py;
    if (Math.abs(dx) + Math.abs(dy) > 6) didDrag = true;
    view.x = start.vx + dx;
    view.y = start.vy + dy;
    applyView();
  });
  svg.addEventListener('pointerup', () => {
    start = null;
    svg.classList.remove('panning');
    setTimeout(() => (didDrag = false), 0);
  });
  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const wx = (mx - view.x) / view.k, wy = (my - view.y) / view.k;
      view.k = Math.min(2.5, Math.max(0.3, view.k * Math.exp(-e.deltaY * 0.0015)));
      view.x = mx - wx * view.k;
      view.y = my - wy * view.k;
      applyView();
    },
    { passive: false },
  );
  window.addEventListener('resize', fitView);
}

/* ------------------------------ avatar ------------------------------ */

function avatarSet(x, y) {
  $('#avatar').setAttribute('transform', `translate(${x} ${y})`);
}

const standPoint = (node) => nodeTop(node); // avatar stands on the roof

/* Teleport the avatar to stand on a node (initial placement). */
function placeAvatar(node, instant = true) {
  const p = standPoint(node);
  S.avatar = { x: p.x, y: p.y };
  S.at = node.id;
  avatarSet(p.x, p.y);
}

/* Walk the avatar to `node` along the graph, following the actual walkways,
   then call done(). */
function walkTo(node, done) {
  if (S.walking) return;
  if (!S.at || S.at === node.id) {
    placeAvatar(node, true);
    done && done();
    return;
  }
  const path = findPath(S.at, node.id);
  S.walking = true;
  $('#avatar').classList.add('walking');

  const points = [];
  const byId = new Map(S.graph.nodes.map((n) => [n.id, n]));
  let cur = { ...S.avatar };
  points.push(cur);
  for (let i = 0; i < path.length - 1; i++) {
    const a = byId.get(path[i]);
    const b = byId.get(path[i + 1]);
    const A = nodeTop(a), B = nodeTop(b);
    // walk in a straight line across the rooftops and stair-bridges
    const seg = samplePath(`M ${A.x} ${A.y} L ${B.x} ${B.y}`);
    // drop the first point of each segment to avoid duplicates at nodes
    for (let j = 1; j < seg.length; j++) points.push(seg[j]);
  }
  const stand = standPoint(node);
  points.push(stand);

  let idx = 0;
  const bobEl = $('#avatar .av-bob');
  const stepOnce = () => {
    if (idx >= points.length) {
      S.walking = false;
      $('#avatar').classList.remove('walking');
      S.avatar = stand;
      S.at = node.id;
      bobEl.setAttribute('transform', 'translate(0 0)');
      done && done();
      return;
    }
    const p = points[idx];
    avatarSet(p.x, p.y);
    // little hop bob while walking
    bobEl.setAttribute('transform', `translate(0 ${-Math.abs(Math.sin(idx * 0.5)) * 5})`);
    idx++;
    S.anim = setTimeout(stepOnce, 16);
  };
  stepOnce();
}

/* BFS shortest path (fewest hops) between two node ids. */
function findPath(fromId, toId) {
  if (fromId === toId) return [fromId];
  const adj = new Map();
  for (const n of S.graph.nodes) {
    if (!adj.has(n.id)) adj.set(n.id, []);
    for (const d of n.deps) {
      adj.get(n.id).push(d);
      if (!adj.has(d)) adj.set(d, []);
      adj.get(d).push(n.id);
    }
  }
  const prev = new Map([[fromId, null]]);
  const q = [fromId];
  while (q.length) {
    const u = q.shift();
    if (u === toId) break;
    for (const v of adj.get(u) || []) {
      if (!prev.has(v)) {
        prev.set(v, u);
        q.push(v);
      }
    }
  }
  if (!prev.has(toId)) return [fromId, toId];
  const path = [];
  for (let c = toId; c !== null; c = prev.get(c)) path.unshift(c);
  return path;
}

/* Sample an SVG path string into world points using a hidden probe path. */
let probePath = null;
function samplePath(d) {
  const svg = $('#world');
  if (!probePath) {
    probePath = el('path', { fill: 'none', stroke: 'none', 'aria-hidden': 'true' });
    probePath.style.visibility = 'hidden';
    svg.appendChild(probePath);
  }
  probePath.setAttribute('d', d);
  const len = probePath.getTotalLength();
  const pts = [];
  const n = Math.max(6, Math.ceil(len / 16));
  for (let i = 0; i <= n; i++) {
    const pt = probePath.getPointAtLength((i / n) * len);
    pts.push({ x: pt.x, y: pt.y });
  }
  return pts;
}

/* ------------------------------ lessons ------------------------------ */

function onNodeClick(id) {
  const n = S.graph.nodes.find((x) => x.id === id);
  if (!n) return;
  const st = statusOf(n);
  if (st === 'locked') {
    const g = S.nodeEls.get(id);
    g.classList.add('shake');
    setTimeout(() => g.classList.remove('shake'), 500);
    toast('That monument is still hidden — complete the glowing ones first.');
    return;
  }
  hideChoice();
  S.currentNode = n;
  walkTo(n, () => openSheet(n, st));
}

function openSheet(n, st) {
  $('#sheet-kicker').textContent = n.goal ? 'THE SUMMIT' : `STEP ${n.depth + 1}`;
  $('#sheet-title').textContent = n.title;
  $('#sheet-summary').textContent = n.summary || '';
  $('#sheet-content').innerHTML =
    '<div class="sk w90"></div><div class="sk"></div><div class="sk w80"></div><div class="sk w60"></div>';
  $('#sheet-check').classList.add('hidden');
  $('#modal-backdrop').classList.add('show');

  loadLesson(n)
    .then((lesson) => {
      if (S.currentNode !== n || !$('#modal-backdrop').classList.contains('show')) return;
      $('#sheet-content').innerHTML = lesson.content.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
      if (st === 'complete') return; // reviewing: no quiz
      renderCheck(n, lesson.check);
    })
    .catch(() => {
      $('#sheet-content').innerHTML =
        '<p class="sheet-error">Couldn’t load this lesson. <button class="ghost" id="retry-lesson">Retry</button></p>';
      $('#retry-lesson')?.addEventListener('click', () => {
        S.lessonCache.delete(n.id);
        openSheet(n, st);
      });
    });
}

async function loadLesson(n) {
  if (S.lessonCache.has(n.id)) return S.lessonCache.get(n.id);
  const res = await fetch('/api/node', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: S.topic, title: n.title, summary: n.summary }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.lesson) throw new Error('no lesson');
  S.lessonCache.set(n.id, data.lesson);
  return data.lesson;
}

function renderCheck(n, check) {
  const wrap = $('#sheet-check');
  wrap.classList.remove('hidden');
  $('#check-q').textContent = check.question;
  const box = $('#check-opts');
  box.innerHTML = '';
  $('#check-expl').classList.add('hidden');
  $('#check-continue').classList.add('hidden');
  let settled = false;

  check.options.forEach((opt, i) => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.textContent = opt;
    b.addEventListener('click', () => {
      if (settled || b.disabled) return;
      if (i === check.answerIndex) {
        settled = true;
        b.classList.add('correct');
        $$('.opt', box).forEach((o) => (o.disabled = true));
        $('#check-expl').textContent = check.explanation || 'Correct!';
        $('#check-expl').classList.remove('hidden');
        $('#check-continue').classList.remove('hidden');
        completeNode(n);
      } else {
        b.classList.add('wrong');
        b.disabled = true;
        toast('Not quite — try again.');
      }
    });
    box.appendChild(b);
  });
}

function completeNode(n) {
  const wasAvailable = new Set(
    S.graph.nodes.filter((x) => statusOf(x) === 'available').map((x) => x.id),
  );
  S.done.add(n.id);
  saveGame();
  paintAll();
  updateHud();
  for (const m of S.graph.nodes) {
    if (statusOf(m) === 'available' && !wasAvailable.has(m.id)) {
      const g = S.nodeEls.get(m.id);
      g.classList.add('born');
      setTimeout(() => g.classList.remove('born'), 900);
    }
  }
  if (n.goal) setTimeout(celebrate, 700);
}

function closeSheet() {
  $('#modal-backdrop').classList.remove('show');
  // Monument Valley moment: when you finish somewhere with a fork, the world
  // asks where you'd like to wander next.
  const n = S.currentNode;
  if (!n || n.goal) return;
  const opts = S.graph.nodes.filter(
    (m) => m.id !== n.id && m.deps.includes(n.id) && statusOf(m) === 'available',
  );
  if (opts.length >= 2) showChoice(opts);
}

/* ------------------------- fork-in-the-road prompt ------------------------- */

function showChoice(opts) {
  const texts = ['The path splits here…', 'Two ways onward…', 'Where to next, wanderer?'];
  $('#choice-text').textContent = texts[Math.floor(Math.random() * texts.length)];
  const list = $('#choice-list');
  list.innerHTML = '';
  for (const n of opts) {
    const b = document.createElement('button');
    b.className = 'choice-opt';
    b.textContent = n.title;
    b.addEventListener('click', () => {
      hideChoice();
      onNodeClick(n.id);
    });
    list.appendChild(b);
  }
  $('#choice').classList.remove('hidden');
  positionChoice();
}

function hideChoice() {
  $('#choice').classList.add('hidden');
}

/* Position the speech bubble near the avatar (follows the camera). */
function positionChoice() {
  if ($('#choice').classList.contains('hidden')) return;
  const r = $('#world').getBoundingClientRect();
  const sx = S.avatar.x * view.k + view.x;
  const sy = S.avatar.y * view.k + view.y;
  const c = $('#choice');
  c.style.left = Math.max(12, Math.min(r.width - c.offsetWidth - 12, sx - c.offsetWidth / 2)) + 'px';
  c.style.top = Math.max(70, sy - 130 - c.offsetHeight) + 'px';
}

/* ----------------------------- celebration ----------------------------- */

function celebrate() {
  closeSheet();
  const ordered = [...S.graph.nodes].sort((a, b) => a.depth - b.depth || a.sx - b.sx);
  $('#recap').innerHTML = ordered.map((n) => `<li>${escapeHtml(n.title)}</li>`).join('');
  $('#cel-title').textContent = S.title || S.topic;
  $('#cel-overlay').classList.remove('hidden');
  confetti();
}

function confetti() {
  const c = $('#confetti');
  c.innerHTML = '';
  const colors = ['#f4a28e', '#9adfc3', '#b9a8e3', '#f2d49b', '#8fc1e3', '#f2c94c'];
  for (let i = 0; i < 30; i++) {
    const d = document.createElement('i');
    d.className = 'cf';
    d.style.left = `${Math.random() * 100}%`;
    d.style.background = colors[i % colors.length];
    d.style.animationDuration = `${1.6 + Math.random() * 1.8}s`;
    d.style.animationDelay = `${Math.random() * 0.5}s`;
    c.appendChild(d);
  }
  setTimeout(() => (c.innerHTML = ''), 4500);
}

/* ------------------------------- journey ------------------------------- */

const LOAD_MSGS = [
  'Reading your goal…',
  'Sketching the learning graph…',
  'Raising islands from the mist…',
  'Building little bridges…',
  'Placing the final flag…',
];
let loadTimer = null;

function cycleLoadingMessages() {
  let i = 0;
  const msg = $('#loading-msg');
  msg.textContent = LOAD_MSGS[0];
  loadTimer = setInterval(() => {
    i = (i + 1) % LOAD_MSGS.length;
    msg.textContent = LOAD_MSGS[i];
  }, 1600);
}

async function startJourney(topic, { restore = false } = {}) {
  topic = String(topic || '').trim();
  if (!topic) {
    $('#topic-input').classList.add('shake');
    setTimeout(() => $('#topic-input').classList.remove('shake'), 450);
    return;
  }
  $('#btn-begin').disabled = true;

  const save = loadSave();
  if (restore && save && save.graph && save.topic.toLowerCase() === topic.toLowerCase()) {
    Object.assign(S, {
      topic: save.topic, title: save.title, graph: save.graph,
      source: save.source, done: new Set(save.done), lessonCache: new Map(),
    });
    enterWorld();
    $('#btn-begin').disabled = false;
    return;
  }

  showScreen('screen-loading');
  cycleLoadingMessages();
  try {
    const [res] = await Promise.all([
      fetch('/api/graph', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic }),
        signal: AbortSignal.timeout(90000),
      }),
      wait(1500),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.graph || !Array.isArray(data.graph.nodes)) throw new Error('bad graph');
    Object.assign(S, {
      topic: data.topic, title: data.graph.title, graph: data.graph,
      source: data.source, done: new Set(), lessonCache: new Map(),
    });
    saveGame();
    enterWorld();
  } catch (e) {
    console.error(e);
    toast('The world-builder is unreachable — is the server running?');
    showScreen('screen-home');
  } finally {
    clearInterval(loadTimer);
    $('#btn-begin').disabled = false;
  }
}

function enterWorld() {
  computeLayout(S.graph);
  showScreen('screen-world');
  buildWorld();
  $('#demo-badge').classList.toggle('hidden', S.source !== 'fallback');
}

function updateHud() {
  $('#hud-title').textContent = S.title || S.topic || '';
  const total = S.graph ? S.graph.nodes.length : 0;
  $('#hud-count').textContent = `${S.done.size}/${total}`;
  $('#hud-fill').style.width = total ? `${(S.done.size / total) * 100}%` : '0%';
}

function refreshResume() {
  const save = loadSave();
  const b = $('#resume');
  if (save && save.graph) {
    $('#resume-title').textContent = save.title || save.topic;
    b.classList.remove('hidden');
  } else {
    b.classList.add('hidden');
  }
}

/* -------------------------------- init -------------------------------- */

function init() {
  bindCamera();

  $('#topic-form').addEventListener('submit', (e) => {
    e.preventDefault();
    startJourney($('#topic-input').value);
  });
  $$('#chips .chip').forEach((c) =>
    c.addEventListener('click', () => {
      $('#topic-input').value = c.dataset.topic;
      startJourney(c.dataset.topic);
    }),
  );
  $('#resume').addEventListener('click', () => {
    const save = loadSave();
    if (save) startJourney(save.topic, { restore: true });
  });

  $('#btn-home').addEventListener('click', () => {
    showScreen('screen-home');
    refreshResume();
  });
  $('#btn-fit').addEventListener('click', fitView);

  $('#sheet-close').addEventListener('click', closeSheet);
  $('#check-continue').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });

  $('#btn-again').addEventListener('click', () => {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    $('#cel-overlay').classList.add('hidden');
    $('#topic-input').value = '';
    showScreen('screen-home');
    refreshResume();
    $('#topic-input').focus();
  });
  $('#btn-stay').addEventListener('click', () => $('#cel-overlay').classList.add('hidden'));

  refreshResume();
  $('#topic-input').focus();
}

document.addEventListener('DOMContentLoaded', init);
