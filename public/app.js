/* Graph Valley — front end: world rendering, traversal, lessons. */

import { P, depthSort, screenBox } from '/world/iso.js';
import { build } from '/world/build.js';
import { CELL, DECK } from '/world/slices.js';
import { findWalk, nearestNode, navKey } from '/world/nav.js';
import { plan as planWalk, at as walkAt, duration, traveller, orderWith } from '/world/walk.js';

/* Stable hash so a topic always produces the same chapter palette. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

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
  done: new Set(), world: null, courts: [], nodeById: new Map(), elFor: new Map(), her: null,
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

function shapesInto(node, g) {
  for (const sh of g.shapes) {
    node.appendChild(sh.tag === 'path'
      ? el('path', { class: sh.cls, d: sh.d })
      : el('polygon', { class: sh.cls, points: sh.pts }));
  }
}

function renderWorld() {
  const host = $('#world-structure');
  const av = $('#avatar');
  const lamp = $('#avatar-lamp');
  av.remove();
  lamp.remove();
  host.textContent = '';

  const frag = document.createDocumentFragment();
  S.elFor = new Map();
  for (const g of S.world.groups) {
    const node = el('g', { class: g.slice === 'court' ? 'grp monument' : 'grp span' });
    if (g.slice === 'court') {
      node.setAttribute('data-node', g.id);
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
    } else if (g.navAt) {
      // Every walkable surface is a destination, not only the courts. This is
      // also what stops a bridge drawn in front of a platform from swallowing
      // the click meant for it: the bridge is a place you can go.
      node.setAttribute('data-nav', navKey(g.navAt));
      node.setAttribute('data-label', g.navLabel || 'the path');
    }
    shapesInto(node, g);
    S.elFor.set(g, node);
    frag.appendChild(node);
  }
  host.appendChild(frag);
  host.appendChild(av);
  host.appendChild(lamp);

  renderLabels();   // must exist before paintStatus fills in their names
  paintStatus();
}

/* The draw order, recomputed every frame with the traveller in it.
 *
 * She is SORTED INTO the scene rather than inserted into a precomputed order.
 * The tempting optimisation — settle the static world once, then find the one
 * slot she belongs in — is unsound, and it is the bug the old renderer shipped
 * with. The order is a topological sort of a PARTIAL order, so two groups that
 * cannot be compared are separated by an arbitrary tie-break; she can be in
 * front of the one the tie-break put last and behind the one it put first, and
 * then no single slot satisfies both. `sortAvatar` chose the safer half of that
 * constraint and still got it wrong, just less visibly.
 *
 * Mist rides on top of the same pass. Unrevealed stone is drawn BEHIND
 * everything revealed: later layers sit nearer the camera in this projection,
 * so left in true depth order the ghosts would fall in front of the monuments
 * you can actually see and turn them milky. Within each band the exact depth
 * order is preserved, and she is always in the clear band.
 */
const BANDS = ['far', 'near', 'clear'];

function reorder() {
  const host = $('#world-structure');
  const her = S.her;
  const ordered = her ? orderWith(S.world.groups, her) : depthSort(S.world.groups);

  const bands = { far: [], near: [], clear: [] };
  for (const g of ordered) bands[g === her ? 'clear' : (g.veil || 'clear')].push(g);

  // Reconcile against the order rather than rebuilding the DOM. The world's
  // groups keep their relative places between frames, so the common case moves
  // exactly one element even though every one is checked.
  let node = host.firstChild;
  for (const band of BANDS) {
    for (const g of bands[band]) {
      const wanted = g === her ? $('#avatar') : S.elFor.get(g);
      if (!wanted) continue;
      if (node === wanted) { node = node.nextSibling; continue; }
      host.insertBefore(wanted, node);
    }
  }
  host.appendChild($('#avatar-lamp'));
}

const VEIL_RANK = { far: 0, near: 1, clear: 2 };
const moreRevealed = (a, b) => (VEIL_RANK[a] >= VEIL_RANK[b] ? a : b);

function paintStatus() {
  const veil = new Map(S.courts.map((n) => [n.id, veilOf(n)]));
  // A path is as visible as the more revealed of the two places it joins, so
  // you can see the bridge you are about to take leading off into the mist.
  const legVeil = (a, b) => moreRevealed(veil.get(a) || 'far', veil.get(b) || 'far');
  const legStatus = (a, b) =>
    S.done.has(a) && S.done.has(b) ? 'complete' : S.done.has(a) ? 'available' : 'locked';

  for (const g of S.world.groups) {
    if (g.slice === 'court') {
      g.veil = veil.get(g.id) || 'far';
      g.status = statusOf(S.nodeById.get(g.id));
    } else if (g.edges) {
      // A crossing carries two paths. It is as revealed, and as lit, as the
      // more advanced of them — it is one piece of stone either way.
      g.veil = g.edges.map((e) => legVeil(e.from, e.to)).reduce(moreRevealed);
      g.status = g.edges.map((e) => legStatus(e.from, e.to))
        .reduce((a, b) => (a === 'complete' || b === 'complete' ? 'complete'
          : a === 'available' || b === 'available' ? 'available' : 'locked'));
    } else if (g.edgeFrom) {
      g.veil = legVeil(g.edgeFrom, g.edgeTo);
      g.status = legStatus(g.edgeFrom, g.edgeTo);
    } else {
      g.veil = 'clear';
      g.status = 'available';
    }
    const node = S.elFor.get(g);
    if (!node) continue;
    node.setAttribute('data-st', g.status);
    node.setAttribute('data-veil', g.veil);
    if (g.slice === 'court') node.classList.toggle('is-goal', !!S.nodeById.get(g.id)?.goal);
  }

  reorder();

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
  for (const n of S.courts) {
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
  for (const g of S.world.groups) {
    if (g.veil === 'far') continue;
    const b = screenBox(g);
    if (b.x0 < x0) x0 = b.x0;
    if (b.x1 > x1) x1 = b.x1;
    if (b.y0 < y0) y0 = b.y0;
    if (b.y1 > y1) y1 = b.y1;
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : S.world.bounds;
}

function fitView(animate = false) {
  if (!S.world) return;
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
  let hit = null;
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

  /* What a press landed on is read at POINTERDOWN, not at pointerup.
   *
   * setPointerCapture retargets every later event for that pointer to the
   * capture element, so by the time the click fires e.target IS the <svg> and
   * closest('[data-node]') is null however carefully you aimed. Capture is
   * worth keeping — it holds a pan together when the pointer leaves the window
   * — so the fix is to remember what was under the pointer when it went down. */
  svg.addEventListener('pointerdown', (e) => {
    const t = e.target;
    const court = t.closest?.('[data-node]');
    const path = t.closest?.('[data-nav]');
    hit = court ? { node: court.dataset.node }
      : path ? { nav: path.dataset.nav, label: path.dataset.label }
      : null;
  }, true);

  const release = (e) => {
    const h = hit;
    hit = null;
    if (didDrag) { didDrag = false; return; }
    if (!h) return;
    if (h.node) onNodeClick(h.node);
    else if (h.nav) onPathClick(h.nav);
  };
  svg.addEventListener('pointerup', release);
  $('#world-structure').addEventListener('keydown', (e) => {
    const g = e.target.closest('[data-node]');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onNodeClick(g.dataset.node); }
  });
  window.addEventListener('resize', () => { positionLabels(); positionChoice(); });
}

/* -------------------------------- avatar -------------------------------- */

/* Move her, and settle the draw order around her.
 *
 * She is DRAWN as the hand-made figure in index.html, but she is SORTED as the
 * box `traveller()` builds: a flat drawing has no extent in the grid, and the
 * depth sort needs something it can compare against a deck, a tread and an
 * arch. The box is the slightly more generous of the two, so she is never
 * revealed by stone that should have hidden her. */
function drawAvatar(pt) {
  const p = P(pt.x, pt.y, pt.z);
  const t = `translate(${p.x} ${p.y})`;
  $('#avatar').setAttribute('transform', t);
  $('#avatar-lamp').setAttribute('transform', t);
  avatarPos = pt;
  S.her = traveller(pt);
  reorder();
}

function placeAvatar(court) {
  S.at = court.id;
  drawAvatar(court.stand);
}

/* Where she can walk, and how.
 *
 * There is no second representation to keep in step any more. Each slice puts
 * a nav node at each of its open sockets, so two slices that stitch share a
 * node by coordinate and the nav graph is connected IF AND ONLY IF the geometry
 * is. The old renderer carried `edges[].walk` polylines alongside the stone and
 * needed `assertOnStone` to catch it out when the two disagreed; that whole
 * failure mode is gone, along with the function that policed it.
 */

/* The route to a nav node, starting from wherever she actually is. Interrupt a
 * walk and she re-paths from the node she is nearest, with her exact position
 * on the front, so she carries on from where she stands rather than snapping
 * back to where the last walk began. */
function routeTo(targetKey) {
  if (!S.world.nav.pos.has(targetKey)) return null;
  const here = { ...avatarPos };
  const from = S.walking ? nearestNode(S.world.nav, here) : navKey(here);
  const found = findWalk(S.world.nav, from, targetKey);
  if (!found || !found.length) return null;
  return navKey(found[0]) === navKey(here) ? found : [here, ...found];
}

let walkRaf = null, walkGuard = null;

function stopWalk() {
  cancelAnimationFrame(walkRaf);
  clearTimeout(walkGuard);
  S.walking = false;
  $('#avatar').classList.remove('walking');
}

/* Walk a nav path at an even pace, with the camera following. */
function animateWalk(path, done) {
  if (!path || path.length < 2) { done && done(); return; }
  const pl = planWalk(path);
  const end = path[path.length - 1];

  if (S.reduced || pl.total < 0.5) {
    stopWalk();
    drawAvatar(end);
    focusOn(end, null, false);
    done && done();
    return;
  }

  const dur = duration(pl.total);
  const t0 = performance.now();
  stopWalk();
  S.walking = true;
  $('#avatar').classList.add('walking');

  // requestAnimationFrame does not fire in a backgrounded tab, and a walk that
  // never finishes leaves S.walking true forever and makes the world
  // unclickable. The guard promises the walk always ends.
  const arrive = () => {
    if (!S.walking) return;
    stopWalk();
    drawAvatar(end);
    focusOn(end, null, false);
    done && done();
  };
  walkGuard = setTimeout(arrive, dur + 600);

  const step = (now) => {
    if (!S.walking) return;
    const u = (now - t0) / dur;
    drawAvatar(walkAt(pl, u));
    focusOn(avatarPos, null, false);
    if (u < 1) { walkRaf = requestAnimationFrame(step); return; }
    arrive();
  };
  walkRaf = requestAnimationFrame(step);
}

function walkTo(court, done) {
  if (S.at === court.id && !S.walking) { done && done(); return; }
  const path = routeTo(court.navKey);
  if (!path) { placeAvatar(court); done && done(); return; }
  animateWalk(path, () => { placeAvatar(court); done && done(); });
}

/* Walk out to where the onward paths actually diverge, and stop there.
 *
 * The fork is the stretch every onward route shares — the common prefix of the
 * nav walks to each option. She is still "at" the place she came from, and
 * `routeTo` rejoins whichever route she is sent on next from where she stands.
 */
function junctionWalk(n, opts) {
  const walks = opts.map((o) => findWalk(S.world.nav, n.navKey, o.navKey)).filter(Boolean);
  if (walks.length < 2) return null;
  const cap = Math.min(...walks.map((w) => w.length));
  let i = 1;
  while (i < cap && walks.every((w) => navKey(w[i]) === navKey(walks[0][i]))) i++;
  return i > 1 ? walks[0].slice(0, i) : null;
}

function walkToJunction(n, opts, done) {
  const w = junctionWalk(n, opts);
  if (!w) { done && done(); return; }
  animateWalk([{ ...avatarPos }, ...w.slice(1)], done);
}

/* -------------------------------- lessons ------------------------------- */

/* Walking to a stretch of walkway. Monument Valley lets you tap any surface,
 * and it removes the dead zone where a bridge drawn in front of a platform
 * swallowed the click meant for it. Nothing is taught out here — she simply
 * goes and stands where you pointed. */
function onPathClick(key) {
  if (!S.world?.nav.pos.has(key)) return;
  hideChoice();
  const path = routeTo(key);
  if (!path) return;
  // Only walk onto stone that is out of the mist; the rest is not there yet.
  const dest = path[path.length - 1];
  animateWalk(path, () => { S.at = null; drawAvatar(dest); });
}

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
  const before = new Set(S.courts.filter((x) => statusOf(x) === 'available').map((x) => x.id));
  S.done.add(n.id);
  saveGame();
  paintStatus();
  updateHud();
  for (const m of S.courts) {
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
  const opts = S.courts.filter((m) => m.id !== n.id && m.deps.includes(n.id) && statusOf(m) === 'available');
  if (opts.length < 2) return;
  // Walk out to the fork first and ask there. Being asked which way to go
  // while still standing in the doorway is not a choice you can see.
  walkToJunction(n, opts, () => showChoice(opts));
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
  const ordered = [...S.courts].sort((a, b) => a.depth - b.depth || a.cell.v - b.cell.v);
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
  // The screen has to be showing before it can be measured: a hidden <svg>
  // reports 0x0, and a world composed for a 0x0 viewport is composed for
  // nothing. Show first, measure second, build third.
  showScreen('screen-world');

  // The world's proportions are chosen from the screen it will be seen on:
  // desktop and phone portrait are two octaves apart in aspect, and no single
  // layout serves both. See world/compose.js.
  const r = $('#world').getBoundingClientRect();
  const viewport = [Math.max(320, r.width || 1024), Math.max(320, r.height || 640)];
  S.world = build(S.graph, { viewport });
  if (S.world.problems.length) console.warn('world problems:', S.world.problems);

  S.courts = S.world.courts;
  S.nodeById = new Map(S.courts.map((n) => [n.id, n]));
  // The south corner of the deck, where a label hangs without covering the
  // architecture standing on the far half.
  for (const n of S.courts) {
    const half = (n.span * CELL) / 2;
    n.anchor = P(n.stand.x + half, n.stand.y + half, n.stand.z - DECK);
  }

  renderWorld();
  fitView();

  const start = S.courts.find((n) => n.depth === 0) || S.courts[0];
  placeAvatar(start);
  updateHud();
  // establishing wide shot of the whole journey, then move in to walking
  // distance — close enough that the traveller reads as a figure, but far
  // enough on a phone that you can still see where the path goes
  setTimeout(() => focusOn(start.stand, r.width < 700 ? 0.55 : 0.62), 950);
}

function updateHud() {
  $('#hud-title').textContent = S.title || S.topic || '';
  const total = S.courts.length;
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
    const next = S.courts.find((n) => statusOf(n) === 'available') || S.nodeById.get(S.at);
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

/* A handle for driving the world from the console or a test harness — the same
 * affordance the POC viewer carries. It exposes state and the two travel verbs;
 * everything here is already reachable by clicking. */
window.gv = {
  S,
  get at() { return avatarPos; },
  walkTo, onNodeClick, onPathClick, routeTo, fitView, focusOn,
  compose: () => S.world?.graph.compose,
};
