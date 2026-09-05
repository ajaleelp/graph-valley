/* Graph Valley — front end: world rendering, traversal, lessons. */

import { P } from './iso.js';
import { layout, buildScene, hash } from './world.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const SVGNS = 'http://www.w3.org/2000/svg';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SAVE_KEY = 'graphvalley.save.v2';

/* Chapter palettes. Each is one coherent Monument Valley scene: a stone with
   three flat tones (lid / left / right), a lighter trim for decks and stairs,
   one saturated accent, and a sky the stone sits against. Light falls from the
   left, so the +y face is always lighter than the +x face. */
const CHAPTERS = [
  { name: 'sandstone',
    s: ['#f6dcc0', '#e0a87a', '#c07e51'], t: ['#fce9d4', '#e9b78d', '#cd8d62'],
    a: ['#3fa396', '#348a7f', '#2a7268'], n: ['#a96b48', '#97583a', '#82492f'],
    sky: ['#ffebd2', '#fbc9b0', '#e0a4b6'], sun: '#fff3d6' },
  { name: 'rose',
    s: ['#f8dad6', '#e5a19c', '#c77a76'], t: ['#fde8e5', '#eeb1ac', '#d38b87'],
    a: ['#eeb13b', '#d89a2c', '#bc8020'], n: ['#b06d6a', '#9c5b58', '#874c49'],
    sky: ['#ffe6e4', '#f5c4ce', '#c4a8d6'], sun: '#fff2e8' },
  { name: 'lagoon',
    s: ['#d6e6ea', '#8fb4c0', '#628b9b'], t: ['#e4f0f3', '#a3c4ce', '#7599a8'],
    a: ['#f0855c', '#da6e46', '#bc5836'], n: ['#527787', '#456573', '#3a5663'],
    sky: ['#e4f2f5', '#bedce4', '#a6b7dc'], sun: '#f9ffff' },
  { name: 'lilac',
    s: ['#eadff4', '#bca2d6', '#9a7dbb'], t: ['#f4ebfa', '#cbb4e2', '#a98cc8'],
    a: ['#6fbf9a', '#58a783', '#468c6c'], n: ['#8467a5', '#745793', '#63497e'],
    sky: ['#f2e6fb', '#d9c3ee', '#b3aae3'], sun: '#fff4fd' },
  { name: 'verdigris',
    s: ['#dfeee0', '#a2c6a9', '#7ca487'], t: ['#ecf6ed', '#b3d3b9', '#8db296'],
    a: ['#e37a52', '#cc653f', '#ae5031'], n: ['#6e9377', '#608266', '#517058'],
    sky: ['#e7f5e9', '#c9e3d3', '#a9c2dc'], sun: '#faffef' },
  { name: 'ember',
    s: ['#fbdece', '#ec9f7c', '#d07a57'], t: ['#ffeade', '#f2b291', '#dc8c68'],
    a: ['#4e85b6', '#3f6f9c', '#325a80'], n: ['#b06344', '#9c5236', '#86452c'],
    sky: ['#ffe6d0', '#f9bca8', '#cb9fc1'], sun: '#fff5da' },
];
/* Completed monuments turn to gold; locked ones sit in unlit stone. */
const GOLD = {
  s: ['#fbecca', '#e9c67d', '#cda256'], t: ['#fef6df', '#f2d9a4', '#dcbb74'],
  a: ['#fdf0d3', '#e8ce92', '#cfae69'], n: ['#c6a161', '#b28f52', '#9b7c46'],
};

/* Locked stone is NOT greyed out — Monument Valley never drains its world of
   colour, and the whole structure should be worth looking at from the first
   second. Locked monuments just recede: a touch of atmosphere mixed in, the
   way distance works. State is carried by the glow and the label instead. */
function hexToHsl(hex) {
  const v = parseInt(hex.slice(1), 16);
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, sat, l];
}
const dim = (hex, satMul = 0.88, lightMix = 0.1) => {
  const [h, s, l] = hexToHsl(hex);
  return `hsl(${(h * 360).toFixed(1)} ${(s * satMul * 100).toFixed(1)}% ${((l + (0.9 - l) * lightMix) * 100).toFixed(1)}%)`;
};
const dimTri = (tri) => tri.map((c) => dim(c));

const S = {
  topic: null, title: null, graph: null, source: null,
  done: new Set(), scene: null, edgeMap: new Map(), nodeById: new Map(),
  groupEls: [], visOrder: [], avIdx: -1,
  lessonCache: new Map(), currentNode: null, at: null, walking: false,
  chapter: CHAPTERS[0], reduced: false,
};

const view = { x: 0, y: 0, k: 0.6 };
let didDrag = false;
let avatarPos = { x: 0, y: 0, z: 0 };

/* ------------------------------- helpers ------------------------------- */

function el(tag, attrs = {}) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

const showScreen = (id) => $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));

function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      topic: S.topic, title: S.title, source: S.source, done: [...S.done],
      graph: {
        title: S.graph.title,
        nodes: S.graph.nodes.map((n) => ({ id: n.id, title: n.title, summary: n.summary, deps: n.deps, goal: n.goal })),
      },
    }));
  } catch { /* private mode */ }
}
const loadSave = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; } };

const statusOf = (n) =>
  S.done.has(n.id) ? 'complete' : n.deps.every((d) => S.done.has(d)) ? 'available' : 'locked';

/* How much of the world is out of the mist yet.
   Monument Valley never hands you the whole map: you see where you are, a
   suggestion of what is next, and nothing beyond. The summit is the one
   exception — it stays a ghost on the horizon, because it is what you are
   walking toward. */
function veilOf(n) {
  if (statusOf(n) !== 'locked') return 'clear';
  if (n.goal) return 'near';
  return n.deps.some((d) => statusOf(S.nodeById.get(d)) !== 'locked') ? 'near' : 'far';
}

/* -------------------------------- palette ------------------------------- */

function applyChapter(topic) {
  S.chapter = CHAPTERS[hash(topic || 'graph valley') % CHAPTERS.length];
  const c = S.chapter;
  const root = $('#screen-world');
  const set = (prefix, tri) => {
    root.style.setProperty(`--${prefix}-t`, tri[0]);
    root.style.setProperty(`--${prefix}-l`, tri[1]);
    root.style.setProperty(`--${prefix}-r`, tri[2]);
  };
  set('s', c.s); set('t', c.t); set('a', c.a); set('n', c.n);
  set('gs', GOLD.s); set('gt', GOLD.t); set('ga', GOLD.a); set('gn', GOLD.n);
  set('ls', dimTri(c.s)); set('lt', dimTri(c.t)); set('la', dimTri(c.a)); set('ln', dimTri(c.n));
  root.style.setProperty('--sky-1', c.sky[0]);
  root.style.setProperty('--sky-2', c.sky[1]);
  root.style.setProperty('--sky-3', c.sky[2]);
  root.style.setProperty('--sun', c.sun);
  root.style.setProperty('--accent', c.a[1]);
}

/* ----------------------------- world rendering --------------------------- */

function renderWorld() {
  const host = $('#world-structure');
  const av = $('#avatar');
  const lamp = $('#avatar-lamp');
  av.remove();
  lamp.remove();
  host.textContent = '';
  const frag = document.createDocumentFragment();
  S.groupEls = [];

  for (const g of S.scene.groups) {
    const node = el('g', { class: g.kind === 'node' ? 'grp monument' : 'grp span' });
    if (g.nodeId) {
      node.setAttribute('data-node', g.nodeId);
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
    }
    if (g.from) { node.setAttribute('data-from', g.from); node.setAttribute('data-to', g.to); }
    for (const s of g.shapes) {
      node.appendChild(s.tag === 'path'
        ? el('path', { class: s.cls, d: s.d })
        : el('polygon', { class: s.cls, points: s.pts }));
    }
    S.groupEls.push(node);
    frag.appendChild(node);
  }
  host.appendChild(frag);
  host.appendChild(av);
  host.appendChild(lamp);
  S.avIdx = -1;
  renderLabels();   // must exist before paintStatus fills in their names
  paintStatus();
}

/* Draw the unrevealed world BEHIND the revealed one.
   In this projection later layers sit nearer the camera, so left in their true
   depth order the mist would fall in front of the monuments you can actually
   see and turn them milky. Ghosts belong behind; the moment a place is
   revealed it drops back into its real position. Within each band the exact
   depth order is preserved. */
function layerMist() {
  const host = $('#world-structure');
  const frag = document.createDocumentFragment();
  S.visOrder = [];
  for (const band of ['far', 'near', 'clear']) {
    S.scene.groups.forEach((g, i) => {
      if (g.veil !== band) return;
      frag.appendChild(S.groupEls[i]);
      if (band === 'clear') S.visOrder.push({ g, el: S.groupEls[i] });
    });
  }
  host.appendChild(frag);
  host.appendChild($('#avatar'));
  host.appendChild($('#avatar-lamp'));
  S.avIdx = -1;
  sortAvatar();
}

/* Slot the traveller into the painter's order for wherever she is standing.
   She used to be drawn last, which is what made her look like she was flying
   over the world: nothing could ever pass in front of her. Now she is a small
   box like any other, so the near flank of a monument hides her as she passes
   behind it and an arch passes over her head. */
function sortAvatar() {
  const vis = S.visOrder;
  if (!vis || !vis.length) return;
  const p = avatarPos;
  const x0 = p.x - 0.4, y0 = p.y - 0.4, z0 = p.z;
  let idx = 0;
  for (let i = 0; i < vis.length; i++) {
    const g = vis[i].g;
    // the piece lies entirely on her far side along some axis, so it is behind
    if (g.x1 <= x0 + 1e-6 || g.y1 <= y0 + 1e-6 || g.z1 <= z0 + 1e-6) idx = i + 1;
  }
  if (idx === S.avIdx) return;
  S.avIdx = idx;
  $('#world-structure').insertBefore($('#avatar'), idx < vis.length ? vis[idx].el : null);
  $('#world-structure').appendChild($('#avatar-lamp'));
}

const VEIL_RANK = { far: 0, near: 1, clear: 2 };

function paintStatus() {
  const veil = new Map(S.graph.nodes.map((n) => [n.id, veilOf(n)]));
  // A path is as visible as the more revealed of the two places it joins, so
  // you can see the bridge you are about to take leading off into the mist.
  const legVeil = (a, b) =>
    VEIL_RANK[veil.get(a)] >= VEIL_RANK[veil.get(b)] ? veil.get(a) : veil.get(b);

  for (const g of $$('#world-structure .monument')) {
    const n = S.nodeById.get(g.dataset.node);
    g.setAttribute('data-st', statusOf(n));
    g.setAttribute('data-veil', veil.get(n.id));
    g.classList.toggle('is-goal', !!n.goal);
  }
  for (const g of $$('#world-structure .span')) {
    const a = S.nodeById.get(g.dataset.from), b = S.nodeById.get(g.dataset.to);
    g.setAttribute('data-st', S.done.has(a.id) && S.done.has(b.id) ? 'complete'
      : S.done.has(a.id) ? 'available' : 'locked');
    g.setAttribute('data-veil', legVeil(a.id, b.id));
  }
  for (const g of S.scene.groups) {
    g.veil = g.nodeId ? veil.get(g.nodeId) : legVeil(g.from, g.to);
  }
  layerMist();
  for (const l of $$('#labels .mlabel')) {
    const n = S.nodeById.get(l.dataset.node);
    const st = statusOf(n);
    l.dataset.st = st;
    l.querySelector('.mlabel-text').textContent = st === 'locked' && !n.goal ? 'Undiscovered' : n.title;
  }
  positionLabels();
}

/* Labels live in an HTML layer above the SVG: crisp text at any zoom, and a
   generous click target for the monument underneath. */
function renderLabels() {
  const host = $('#labels');
  host.textContent = '';
  for (const n of S.graph.nodes) {
    const b = document.createElement('button');
    b.className = 'mlabel';
    b.dataset.node = n.id;
    b.classList.toggle('is-goal', !!n.goal);
    b.innerHTML = `<span class="mlabel-step">${n.goal ? 'Summit' : `Step ${n.depth + 1}`}</span>`
      + '<span class="mlabel-text"></span>';
    b.addEventListener('click', () => onNodeClick(n.id));
    host.appendChild(b);
  }
  positionLabels();
}

const LABEL_RANK = { available: 0, complete: 1, locked: 2 };

function positionLabels() {
  if (!S.graph) return;
  const r = $('#world').getBoundingClientRect();
  // Zoomed right out the world should read as a silhouette, not a pin board.
  const sparse = view.k < 0.42;
  const wanted = [];

  for (const l of $$('#labels .mlabel')) {
    const n = S.nodeById.get(l.dataset.node);
    const st = statusOf(n);
    const x = n.anchor.x * view.k + view.x;
    const y = n.anchor.y * view.k + view.y + 22 * Math.max(0.6, view.k);
    // A place only announces itself once it is out of the mist.
    const on = x > -160 && x < r.width + 160 && y > -60 && y < r.height + 60
      && veilOf(n) !== 'far' && (!sparse || st !== 'locked' || n.goal);
    if (!on) { l.style.display = 'none'; continue; }
    l.style.display = '';
    l.style.transform = `translate(${x}px, ${y}px) translate(-50%, 0)`;
    wanted.push({ l, x, y, rank: (n.goal ? -1 : LABEL_RANK[st] ?? 3) });
  }

  // Greedy de-collision: where names would pile up, the ones that matter most
  // (the summit, then where you can go now) keep the space.
  wanted.sort((a, b) => a.rank - b.rank || a.x - b.x);
  const placed = [];
  for (const w of wanted) {
    const bw = w.l.offsetWidth || 120, bh = w.l.offsetHeight || 30;
    const box = { x0: w.x - bw / 2, x1: w.x + bw / 2, y0: w.y, y1: w.y + bh };
    const hit = placed.some((p) => box.x0 < p.x1 && p.x0 < box.x1 && box.y0 < p.y1 && p.y0 < box.y1);
    if (hit) w.l.style.display = 'none';
    else placed.push(box);
  }
}

/* -------------------------------- camera -------------------------------- */

function applyView() {
  $('#viewport').setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
  positionLabels();
  positionChoice();
}

/* The screen bounds of everything currently out of the mist. */
function visibleBounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of S.scene.groups) {
    if (g.veil === 'far') continue;
    for (const X of [g.x0, g.x1]) for (const Y of [g.y0, g.y1]) for (const Z of [g.z0, g.z1]) {
      const p = P(X, Y, Z);
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : S.scene.bounds;
}

function fitView(animate = false) {
  if (!S.scene) return;
  const r = $('#world').getBoundingClientRect();
  const b = visibleBounds();
  const pad = r.width < 700 ? 40 : 110;
  const k = clamp(Math.min((r.width - pad * 2) / (b.x1 - b.x0), (r.height - pad * 2 - 60) / (b.y1 - b.y0)), 0.14, 1.1);
  const target = {
    k,
    x: (r.width - (b.x1 - b.x0) * k) / 2 - b.x0 * k,
    y: (r.height - (b.y1 - b.y0) * k) / 2 - b.y0 * k + 20,
  };
  if (animate) glideTo(target); else { Object.assign(view, target); applyView(); }
}

/* Centre the camera on a grid point. */
function focusOn(pt, zoom = null, animate = true) {
  const r = $('#world').getBoundingClientRect();
  const k = zoom ?? view.k;
  const p = P(pt.x, pt.y, pt.z);
  const target = { k, x: r.width * 0.42 - p.x * k, y: r.height * 0.58 - p.y * k };
  if (animate) glideTo(target); else { Object.assign(view, target); applyView(); }
}

let glideRaf = null;
function glideTo(target, ms = 700) {
  cancelAnimationFrame(glideRaf);
  if (S.reduced) { Object.assign(view, target); applyView(); return; }
  const from = { ...view };
  const t0 = performance.now();
  const step = (now) => {
    const u = clamp((now - t0) / ms, 0, 1);
    const e = 1 - Math.pow(1 - u, 3);
    view.x = from.x + (target.x - from.x) * e;
    view.y = from.y + (target.y - from.y) * e;
    view.k = from.k + (target.k - from.k) * e;
    applyView();
    if (u < 1) glideRaf = requestAnimationFrame(step);
  };
  glideRaf = requestAnimationFrame(step);
}

function bindCamera() {
  const svg = $('#world');
  let start = null;
  const pointers = new Map();
  let pinch = null;

  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k,
        cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vx: view.x, vy: view.y,
      };
      start = null;
      return;
    }
    start = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('panning');
  });

  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = svg.getBoundingClientRect();
      const k = clamp(pinch.k * (d / pinch.d), 0.14, 2.2);
      const mx = pinch.cx - r.left, my = pinch.cy - r.top;
      view.x = mx - ((mx - pinch.vx) / pinch.k) * k;
      view.y = my - ((my - pinch.vy) / pinch.k) * k;
      view.k = k;
      didDrag = true;
      applyView();
      return;
    }
    if (!start) return;
    const dx = e.clientX - start.px, dy = e.clientY - start.py;
    if (Math.abs(dx) + Math.abs(dy) > 6) didDrag = true;
    view.x = start.vx + dx;
    view.y = start.vy + dy;
    applyView();
  });

  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) {
      start = null;
      svg.classList.remove('panning');
      setTimeout(() => (didDrag = false), 0);
    }
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const wx = (mx - view.x) / view.k, wy = (my - view.y) / view.k;
    view.k = clamp(view.k * Math.exp(-e.deltaY * 0.0015), 0.14, 2.2);
    view.x = mx - wx * view.k;
    view.y = my - wy * view.k;
    applyView();
  }, { passive: false });

  // clicking the stone itself travels there, not just the label
  $('#world-structure').addEventListener('click', (e) => {
    if (didDrag) { didDrag = false; return; }
    const g = e.target.closest('[data-node]');
    if (g) onNodeClick(g.dataset.node);
  });
  $('#world-structure').addEventListener('keydown', (e) => {
    const g = e.target.closest('[data-node]');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onNodeClick(g.dataset.node); }
  });
  window.addEventListener('resize', () => { positionLabels(); positionChoice(); });
}

/* -------------------------------- avatar -------------------------------- */

function drawAvatar(pt) {
  const p = P(pt.x, pt.y, pt.z);
  const t = `translate(${p.x} ${p.y})`;
  $('#avatar').setAttribute('transform', t);
  $('#avatar-lamp').setAttribute('transform', t);
  avatarPos = pt;
  sortAvatar();
}

function placeAvatar(node) {
  S.at = node.id;
  drawAvatar(node.stand);
}

const edgeKey = (a, b) => `${a} ${b}`;

/* Fewest-hops path across the causeway network.
   The adjacency is built from the causeways that were actually carved, not
   from every dependency — the world only builds stone for the transitive
   reduction, and routing over an edge with no stone under it would teleport
   the traveller through open sky. */
function findPath(fromId, toId) {
  if (fromId === toId) return [fromId];
  const adj = new Map(S.graph.nodes.map((n) => [n.id, []]));
  for (const e of S.scene.edges) {
    adj.get(e.from).push(e.to);
    adj.get(e.to).push(e.from);
  }
  const prev = new Map([[fromId, null]]);
  const q = [fromId];
  while (q.length) {
    const u = q.shift();
    if (u === toId) break;
    for (const v of adj.get(u) || []) if (!prev.has(v)) { prev.set(v, u); q.push(v); }
  }
  if (!prev.has(toId)) return [fromId, toId];
  const path = [];
  for (let c = toId; c !== null; c = prev.get(c)) path.unshift(c);
  return path;
}

/* The real causeway geometry for a hop sequence — the avatar walks the stone
   that is actually drawn, staircases included. */
function routePoints(path) {
  const out = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const fwd = S.edgeMap.get(edgeKey(a, b));
    const rev = S.edgeMap.get(edgeKey(b, a));
    if (fwd) out.push(...fwd.walk);
    else if (rev) out.push(...[...rev.walk].reverse());
    out.push(S.nodeById.get(b).stand);
  }
  // She may already be part-way along this route — waiting at a junction, say.
  // Rejoin it where she stands instead of walking back to the start first.
  let at = -1, best = 0.9;
  for (let i = 0; i < out.length; i++) {
    const d = Math.hypot(out[i].x - avatarPos.x, out[i].y - avatarPos.y, out[i].z - avatarPos.z);
    if (d < best) { best = d; at = i; }
  }
  return [avatarPos, ...out.slice(at + 1)];
}

/* Consecutive waypoints must differ on at most one horizontal axis: the
   causeways are axis-aligned, so a diagonal step would cut across open sky. */
function assertOnStone(pts) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (Math.abs(b.x - a.x) > 0.02 && Math.abs(b.y - a.y) > 0.02) return false;
  }
  return true;
}

let walkRaf = null;

/* Walk a polyline of grid points, at an even pace, with the camera following. */
function animateWalk(pts, done) {
  if (S.walking) return;
  if (!assertOnStone(pts)) {
    // No continuous walkway. Better to step there than to glide across open
    // sky, which is the one thing that reads as broken.
    const end = pts[pts.length - 1];
    drawAvatar(end);
    focusOn(end, null, false);
    done && done();
    return;
  }
  if (S.reduced) {
    const end = pts[pts.length - 1];
    drawAvatar(end);
    focusOn(end, null, false);
    done && done();
    return;
  }
  // arc-length parameterise in screen space so the pace reads evenly
  const scr = pts.map((p) => P(p.x, p.y, p.z));
  const seg = [];
  let total = 0;
  for (let i = 1; i < scr.length; i++) {
    const d = Math.hypot(scr[i].x - scr[i - 1].x, scr[i].y - scr[i - 1].y);
    seg.push(d);
    total += d;
  }
  if (total < 1) {
    drawAvatar(pts[pts.length - 1]);
    done && done();
    return;
  }

  const dur = clamp((total / 300) * 1000, 550, 5200);
  const av = $('#avatar');
  av.classList.add('walking');
  S.walking = true;
  const t0 = performance.now();

  // requestAnimationFrame stops in a backgrounded tab, and a throw inside the
  // step would otherwise leave S.walking true forever and make the whole world
  // unclickable. This guarantees the walk always ends.
  const arrive = () => {
    if (!S.walking) return;
    cancelAnimationFrame(walkRaf);
    clearTimeout(walkGuard);
    S.walking = false;
    av.classList.remove('walking');
    const end = pts[pts.length - 1];
    drawAvatar(end);
    focusOn(end, null, false);
    done && done();
  };
  const walkGuard = setTimeout(arrive, dur + 600);

  const step = (now) => {
    const u = clamp((now - t0) / dur, 0, 1);
    let want = u * total, i = 0;
    while (i < seg.length - 1 && want > seg[i]) { want -= seg[i]; i++; }
    const f = seg[i] ? clamp(want / seg[i], 0, 1) : 0;
    const a = pts[i], b = pts[i + 1] || pts[i];
    drawAvatar({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f });
    focusOn(avatarPos, null, false);
    if (u < 1) { walkRaf = requestAnimationFrame(step); return; }
    arrive();
  };
  walkRaf = requestAnimationFrame(step);
}

function walkTo(node, done) {
  if (S.walking) return;
  if (!S.at || S.at === node.id) { placeAvatar(node); done && done(); return; }
  animateWalk(routePoints(findPath(S.at, node.id)), () => {
    placeAvatar(node);
    done && done();
  });
}

/* Walk out to where the onward paths actually diverge, and stop there. She is
   still "at" the monument she came from; routePoints rejoins whichever route
   she is sent on next from wherever she is standing. */
function walkToJunction(n, done) {
  if (!n.junctionWalk || S.walking) { done && done(); return; }
  animateWalk([avatarPos, ...n.junctionWalk], done);
}

/* -------------------------------- lessons ------------------------------- */

function onNodeClick(id) {
  const n = S.nodeById.get(id);
  if (!n || S.walking) return;
  const st = statusOf(n);
  if (st === 'locked') {
    const g = $(`#world-structure [data-node="${CSS.escape(id)}"]`);
    g?.classList.add('shake');
    setTimeout(() => g?.classList.remove('shake'), 500);
    toast('That way is still closed. Finish a lit monument to open it.');
    return;
  }
  hideChoice();
  S.currentNode = n;
  walkTo(n, () => openSheet(n, statusOf(n)));
}

function openSheet(n, st) {
  $('#sheet-kicker').textContent = n.goal ? 'THE SUMMIT' : `STEP ${n.depth + 1}`;
  $('#sheet-title').textContent = n.title;
  $('#sheet-summary').textContent = n.summary || '';
  $('#sheet-content').innerHTML =
    '<div class="sk w90"></div><div class="sk"></div><div class="sk w80"></div><div class="sk w60"></div>';
  $('#sheet-check').classList.add('hidden');
  $('#modal-backdrop').classList.add('show');
  $('#sheet-close').focus();

  loadLesson(n).then((lesson) => {
    if (S.currentNode !== n || !$('#modal-backdrop').classList.contains('show')) return;
    $('#sheet-content').innerHTML = lesson.content.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
    if (st === 'complete') return;
    renderCheck(n, lesson.check);
  }).catch(() => {
    $('#sheet-content').innerHTML =
      '<p class="sheet-error">Could not load this lesson. <button class="ghost" id="retry-lesson">Retry</button></p>';
    $('#retry-lesson')?.addEventListener('click', () => { S.lessonCache.delete(n.id); openSheet(n, st); });
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
  $('#sheet-check').classList.remove('hidden');
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
        $('#check-expl').textContent = check.explanation || 'Correct.';
        $('#check-expl').classList.remove('hidden');
        $('#check-continue').classList.remove('hidden');
        completeNode(n);
      } else {
        b.classList.add('wrong');
        b.disabled = true;
        toast('Not quite — try another.');
      }
    });
    box.appendChild(b);
  });
}

function completeNode(n) {
  const before = new Set(S.graph.nodes.filter((x) => statusOf(x) === 'available').map((x) => x.id));
  S.done.add(n.id);
  saveGame();
  paintStatus();
  updateHud();
  for (const m of S.graph.nodes) {
    if (statusOf(m) === 'available' && !before.has(m.id)) {
      const g = $(`#world-structure [data-node="${CSS.escape(m.id)}"]`);
      g?.classList.add('born');
      setTimeout(() => g?.classList.remove('born'), 1000);
    }
  }
  if (n.goal) setTimeout(celebrate, 700);
}

function closeSheet() {
  $('#modal-backdrop').classList.remove('show');
  const n = S.currentNode;
  if (!n || n.goal) return;
  const opts = S.graph.nodes.filter((m) => m.id !== n.id && m.deps.includes(n.id) && statusOf(m) === 'available');
  if (opts.length < 2) return;
  // Walk out to the fork first and ask there. Being asked which way to go
  // while still standing in the doorway is not a choice you can see.
  walkToJunction(n, () => showChoice(opts));
}

/* -------------------------- fork-in-the-road prompt ---------------------- */

function showChoice(opts) {
  const texts = ['The path divides here.', 'Two ways lead onward.', 'Which way, wanderer?'];
  $('#choice-text').textContent = texts[hash(opts.map((o) => o.id).join('')) % texts.length];
  const list = $('#choice-list');
  list.innerHTML = '';
  for (const n of opts) {
    const b = document.createElement('button');
    b.className = 'choice-opt';
    b.textContent = n.title;
    b.addEventListener('click', () => { hideChoice(); onNodeClick(n.id); });
    list.appendChild(b);
  }
  $('#choice').classList.remove('hidden');
  positionChoice();
}
const hideChoice = () => $('#choice').classList.add('hidden');

function positionChoice() {
  const c = $('#choice');
  if (c.classList.contains('hidden')) return;
  const r = $('#world').getBoundingClientRect();
  const p = P(avatarPos.x, avatarPos.y, avatarPos.z);
  const sx = p.x * view.k + view.x, sy = p.y * view.k + view.y;
  c.style.left = clamp(sx - c.offsetWidth / 2, 12, r.width - c.offsetWidth - 12) + 'px';
  c.style.top = Math.max(84, sy - 78 - 26 * view.k - c.offsetHeight) + 'px';
}

/* ------------------------------ celebration ----------------------------- */

function celebrate() {
  closeSheet();
  const ordered = [...S.graph.nodes].sort((a, b) => a.depth - b.depth || a.gy - b.gy);
  $('#recap').innerHTML = ordered.map((n) => `<li>${escapeHtml(n.title)}</li>`).join('');
  $('#cel-title').textContent = S.title || S.topic;
  $('#cel-overlay').classList.remove('hidden');
  fitView(true);
  confetti();
}

function confetti() {
  if (S.reduced) return;
  const c = $('#confetti');
  c.innerHTML = '';
  const colors = [S.chapter.s[1], S.chapter.a[0], S.chapter.t[1], GOLD.s[1], S.chapter.a[1]];
  for (let i = 0; i < 34; i++) {
    const d = document.createElement('i');
    d.className = 'cf';
    d.style.left = `${Math.random() * 100}%`;
    d.style.background = colors[i % colors.length];
    d.style.animationDuration = `${1.8 + Math.random() * 2}s`;
    d.style.animationDelay = `${Math.random() * 0.6}s`;
    c.appendChild(d);
  }
  setTimeout(() => (c.innerHTML = ''), 4800);
}

/* -------------------------------- journey ------------------------------- */

const LOAD_MSGS = [
  'Reading your goal…', 'Charting the path…', 'Cutting stone…',
  'Raising the causeways…', 'Setting the summit stone…',
];
let loadTimer = null;
function cycleLoadingMessages() {
  let i = 0;
  const msg = $('#loading-msg');
  msg.textContent = LOAD_MSGS[0];
  loadTimer = setInterval(() => { i = (i + 1) % LOAD_MSGS.length; msg.textContent = LOAD_MSGS[i]; }, 1700);
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
  if (restore && save?.graph && save.topic?.toLowerCase() === topic.toLowerCase()) {
    Object.assign(S, {
      topic: save.topic, title: save.title, graph: save.graph, source: save.source,
      done: new Set(save.done), lessonCache: new Map(),
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
      wait(1400),
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
  applyChapter(S.topic);
  layout(S.graph);
  S.nodeById = new Map(S.graph.nodes.map((n) => [n.id, n]));
  S.scene = buildScene(S.graph);
  S.edgeMap = new Map(S.scene.edges.map((e) => [edgeKey(e.from, e.to), e]));
  showScreen('screen-world');
  renderWorld();
  fitView();

  const start = S.graph.nodes.find((n) => n.depth === 0) || S.graph.nodes[0];
  placeAvatar(start);
  updateHud();
  // establishing wide shot of the whole journey, then move in to walking
  // distance — close enough that the traveller reads as a figure, but far
  // enough on a phone that you can still see where the path goes
  const r = $('#world').getBoundingClientRect();
  setTimeout(() => focusOn(start.stand, r.width < 700 ? 0.55 : 0.62), 950);
}

function updateHud() {
  $('#hud-title').textContent = S.title || S.topic || '';
  const total = S.graph ? S.graph.nodes.length : 0;
  $('#hud-count').textContent = `${S.done.size}/${total}`;
  $('#hud-fill').style.width = total ? `${(S.done.size / total) * 100}%` : '0%';
  $('#demo-badge').classList.toggle('hidden', S.source !== 'fallback');
}

function refreshResume() {
  const save = loadSave();
  const b = $('#resume');
  if (save?.graph) {
    $('#resume-title').textContent = save.title || save.topic;
    b.classList.remove('hidden');
  } else b.classList.add('hidden');
}

/* --------------------------------- init --------------------------------- */

function init() {
  S.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  bindCamera();

  $('#topic-form').addEventListener('submit', (e) => { e.preventDefault(); startJourney($('#topic-input').value); });
  $$('#chips .chip').forEach((c) => c.addEventListener('click', () => {
    $('#topic-input').value = c.dataset.topic;
    startJourney(c.dataset.topic);
  }));
  $('#resume').addEventListener('click', () => {
    const save = loadSave();
    if (save) startJourney(save.topic, { restore: true });
  });

  $('#btn-home').addEventListener('click', () => { showScreen('screen-home'); refreshResume(); });
  $('#btn-fit').addEventListener('click', () => fitView(true));
  $('#btn-here').addEventListener('click', () => {
    const next = S.graph?.nodes.find((n) => statusOf(n) === 'available') || S.nodeById.get(S.at);
    if (next) focusOn(next.stand, clamp(Math.max(view.k, 0.55), 0.14, 1.4));
  });

  $('#sheet-close').addEventListener('click', closeSheet);
  $('#check-continue').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSheet(); hideChoice(); }
    if (e.key === 'f' && $('#screen-world').classList.contains('active')
      && !$('#modal-backdrop').classList.contains('show')) fitView(true);
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
