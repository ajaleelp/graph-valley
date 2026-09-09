// Graph Valley — zero-dependency Node server.
// Serves the static frontend and two JSON endpoints:
//   POST /api/negotiate { topic, turns }  -> { done, ask } | { done, goal, capstone, spine }
//   POST /api/course    { topic, goal }   -> { modules[], goal, capstone }
//   POST /api/module    { topic, goal, id } -> { module, graph, stages[] }
//   POST /api/syllabus  { topic, goal, capstone } -> { syllabus, source }
//   POST /api/graph     { topic }         -> { topic, graph, source }   (projection)
//   POST /api/node      { topic, title, summary } -> { lesson, source }
// Uses Anthropic or OpenAI if a key is present; otherwise falls back to a
// deterministic built-in generator so the app always works offline.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { appendFile, mkdir } from 'node:fs/promises';

import { llm, hasKey, describeModel } from './curriculum/llm.mjs';
import { negotiate } from './curriculum/negotiate.mjs';
import { buildSyllabus, defaultGoalFor, defaultCapstoneFor, MIN_MODULE_KCS } from './curriculum/build.mjs';
import { toGraph, titleFor } from './curriculum/project.mjs';
import { planModules } from './curriculum/modules.mjs';
import { toStages, stagesToGraph, remediationFor } from './curriculum/stages.mjs';
import {
  lessonPrompt as syllabusLessonPrompt, practicePrompt, stageLesson,
  LESSON_SYSTEM as SYLLABUS_LESSON_SYSTEM, readLesson,
} from './curriculum/lesson.mjs';

const PORT = Number(process.env.PORT || 3217);
/* ------------------------- TEMPORARY OBSERVABILITY -------------------------
 * A JSONL trace of what actually happened, so a manual test session can be
 * read back afterwards instead of reconstructed from memory. One line per
 * event, appended, never rotated, gitignored.
 *
 * Delete this block, the /api/observe route and the observe() calls in
 * public/app.js to remove it. Nothing else depends on it. */
const TRACE = fileURLToPath(new URL('./.observe/trace.jsonl', import.meta.url));
let traceReady = null;

function note(event, data = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), event, ...data }) + '\n';
  traceReady = (traceReady || mkdir(fileURLToPath(new URL('./.observe', import.meta.url)), { recursive: true }))
    .then(() => appendFile(TRACE, line))
    .catch(() => {});           // observability must never break the request
}

const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url));
// The world engine is shared: public/ renders with it, poc/ whiteboxes it, and
// world/check.mjs asserts it. Serving it from one place is what keeps those
// three honest about being the same code.
const WORLD_DIR = fileURLToPath(new URL('./world', import.meta.url));


const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

const lessonCache = new Map();

/* ----------------------------- helpers ----------------------------- */

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 65536) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function cleanTopic(raw) {
  let s = String(raw || '').trim().replace(/\s+/g, ' ');
  s = s.replace(/^(i want to|i'd like to|i would like to|please)\s+/i, '');
  s = s.replace(/^(learn|teach me|teach me about|understand|master|study)\s+/i, '');
  s = s.replace(/^(about|the basics of)\s+/i, '');
  s = s.trim();
  if (!s) s = String(raw || '').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b === -1 || b <= a) return null;
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    return null;
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** The syllabus holds one question per atom, and every one of them now reaches
 *  the renderer. Carrying them and showing one was the last place where the
 *  document knew more than the learner ever saw. */
function toRendererCheck(c) {
  return {
    question: c.stem,
    options: c.options,
    answerIndex: c.answerIndex,
    explanation: c.explanation || `This tests one idea: ${c.kc}.`,
  };
}

/* ---------------------- lesson fallback ---------------------- */

function fallbackLesson(topic, title, summary) {
  const clean = title.replace(/"/g, '');
  const content = [
    `${title} is a key step on your journey to learn ${topic}. ${summary}`,
    `You are currently in demo mode, so this is a placeholder lesson. Start the server with ANTHROPIC_API_KEY or OPENAI_API_KEY set and every island will generate a full lesson written specifically for ${topic}.`,
    `For now, treat this island as a milestone: spend a few minutes reading about “${clean}” from any source you trust, then answer the quick check below to keep moving.`,
  ];
  const correct = summary || `It is a real, necessary step toward learning ${topic}.`;
  const options = shuffle([
    correct,
    'It is completely optional and has no effect on later steps.',
    `It is unrelated to ${topic} and included only for decoration.`,
    'It can only be understood after finishing the entire journey.',
  ]);
  return {
    content,
    check: {
      question: `Which statement about “${clean}” is accurate?`,
      options,
      answerIndex: options.indexOf(correct),
      explanation: correct,
    },
    demo: true,
  };
}

/* ------------------------------ handlers ----------------------------- */

const syllabusCache = new Map();

/** Backward design stage 1: settle the summit by conversation. */
async function handleNegotiate(req, res) {
  const body = await readBody(req);
  const raw = String(body.topic || '').slice(0, 240);
  if (!raw.trim()) return send(res, 400, { error: 'topic is required' });
  const topic = cleanTopic(raw);

  const turns = (Array.isArray(body.turns) ? body.turns : [])
    .slice(0, 6)
    .map((t) => ({ text: String(t?.text || '').slice(0, 400) }))
    .filter((t) => t.text);

  // How many questions the client is willing to ask. One, by default: the hook
  // is "type a goal, walk the path", and being interrogated before anything is
  // built is the fastest way to lose someone.
  const maxTurns = Math.max(1, Math.min(3, Number(body.maxTurns) || 1));

  let outcome = null;
  try {
    if (hasKey()) outcome = await negotiate({ topic, turns, llm, maxTurns });
  } catch (e) {
    console.warn('negotiate failed:', e.message);
    note('negotiate.error', { topic, message: e.message });
  }

  // A model that asks the same thing twice is not narrowing anything, and the
  // learner experiences it as being pestered. Treat a repeat as a commitment.
  if (outcome && !outcome.done && turns.length) {
    const norm = (t) => String(t).toLowerCase().replace(/[^a-z ]/g, '').trim();
    const asked = norm(outcome.ask);
    if (body.asked?.some?.((q) => norm(q) === asked)) {
      note('negotiate.repeat', { topic, ask: outcome.ask });
      outcome = await negotiate({ topic, turns, llm, maxTurns: 0 });
    }
  }
  if (!outcome) {
    // No key, or nothing usable came back: skip the dialogue and take the topic
    // at face value rather than stranding the learner on a chat screen.
    note('negotiate', { topic, turns: turns.length, source: 'fallback', done: true });
    return send(res, 200, {
      topic,
      done: true,
      spine: 'concept',
      goal: defaultGoalFor(topic),
      capstone: defaultCapstoneFor(topic),
      priors: [],
      source: 'fallback',
    });
  }
  note('negotiate', {
    topic, turns: turns.length, source: 'llm', done: !!outcome.done,
    ask: outcome.ask, goal: outcome.goal?.statement, level: outcome.goal?.level,
  });
  send(res, 200, { topic, ...outcome, source: 'llm' });
}

/** One topic can be negotiated into several different courses, so a syllabus is
 *  identified by its topic AND the goal that was settled on — not the topic
 *  alone. `handleNode` has to derive the same key, or it writes the lesson from
 *  whichever course happened to be cached first. */
const keyFor = (topic, goal) => `${topic}::${goal?.statement || ''}`;

/* ------------------------------- the course ------------------------------
 * A journey is planned once — four to seven modules — and then built one
 * module at a time, as she reaches it. Nothing beyond the module she is in has
 * to exist, which is what lets the world end in mist rather than in a wall.
 */
const courseCache = new Map();      // topic::goal  -> { modules, source }
const moduleCache = new Map();      // topic::goal::moduleId -> built syllabus

/** A journey she can start walking, even when the planner cannot. */
function fallbackModules(topic, goal) {
  const subject = String(topic || 'the subject').trim();
  return [
    { id: 'm1', title: 'The ground floor', outcome: `Name the pieces of ${subject} and say what each is for`, level: 'understand', requires: [] },
    { id: 'm2', title: 'How it fits', outcome: `Explain how the pieces of ${subject} work together`, level: 'understand', requires: ['m1'] },
    { id: 'm3', title: 'Reading real ones', outcome: `Tell a good example of ${subject} from a bad one`, level: 'analyze', requires: ['m2'] },
    { id: 'm4', title: 'Doing it yourself', outcome: goal?.statement || `Do ${subject} unaided`, level: goal?.level || 'apply', requires: ['m3'] },
  ];
}

async function courseFor(topic, body = {}) {
  const key = keyFor(topic, body.goal);
  if (courseCache.has(key)) return { ...courseCache.get(key), source: 'cache' };

  const goal = body.goal || defaultGoalFor(topic);
  const capstone = body.capstone?.prompt ? body.capstone : defaultCapstoneFor(topic);

  let planned = null;
  try {
    if (hasKey()) planned = await planModules({ topic, goal, capstone, llm });
  } catch (e) {
    console.warn('module plan failed:', e.message);
    note('course.error', { topic, message: e.message });
  }
  const out = planned
    ? { modules: planned.modules, goal, capstone, source: planned.source }
    : { modules: fallbackModules(topic, goal), goal, capstone, source: 'fallback' };

  note('course', {
    topic, source: out.source, goal: goal.statement, level: goal.level,
    modules: out.modules.map((m) => m.title),
    roots: out.modules.filter((m) => !m.requires.length).length,
    joins: out.modules.filter((m) => m.requires.length > 1).length,
  });
  courseCache.set(key, out);
  return out;
}

/** One module, decomposed into atoms and expanded into teaching-loop stages. */
async function moduleFor(topic, body, moduleId) {
  const course = await courseFor(topic, body);
  const mod = course.modules.find((m) => m.id === moduleId) || course.modules[0];
  const key = `${keyFor(topic, body.goal)}::${mod.id}`;
  if (moduleCache.has(key)) return { ...moduleCache.get(key), source: 'cache' };

  // The module's outcome IS the goal, at module scale. That is the whole reason
  // this validates where a whole course does not: the same rules, over five
  // atoms instead of sixteen.
  const built = await buildSyllabus({
    topic: `${topic} — ${mod.title}`,
    goal: { statement: mod.outcome, level: mod.level, audience: course.goal.audience },
    capstone: { prompt: `Show you can: ${mod.outcome}`, rubric: ['uses the right ideas', 'the steps follow'] },
    spine: body.spine === 'task' ? 'task' : 'concept',
    llm: hasKey() ? llm : null,
    minKcs: MIN_MODULE_KCS,
  });

  const stages = toStages(built.doc);
  const out = { mod, doc: built.doc, stages, source: built.source, errors: built.errors };
  note('module', {
    topic, id: mod.id, title: mod.title, source: built.source,
    atoms: built.doc.kcs.length, groups: built.doc.nodes.length,
    stages: stages.map((s) => s.stage),
    errors: built.errors.map((e) => e.code),
  });
  moduleCache.set(key, out);
  return out;
}

/** The full document: atoms, platforms, derived edges, checks. */
async function buildFor(topic, body = {}) {
  const key = keyFor(topic, body.goal);
  if (syllabusCache.has(key)) return { ...syllabusCache.get(key), source: 'cache' };

  const built = await buildSyllabus({
    topic,
    goal: body.goal || defaultGoalFor(topic),
    capstone: body.capstone?.prompt ? body.capstone : defaultCapstoneFor(topic),
    spine: body.spine === 'task' ? 'task' : 'concept',
    llm: hasKey() ? llm : null,
  });

  if (built.errors.length) {
    console.warn(`syllabus for "${topic}" fell back:`, built.errors.map((e) => e.code).join(', '));
  }
  note('syllabus', {
    topic, source: built.source,
    goal: (body.goal || defaultGoalFor(topic)).statement,
    level: (body.goal || defaultGoalFor(topic)).level,
    platforms: built.doc.nodes.length, atoms: built.doc.kcs.length,
    errors: built.errors.map((e) => e.code),
  });
  syllabusCache.set(key, built);
  return built;
}

/** The journey: the modules, and where she may go next. Cheap and once. */
async function handleCourse(req, res) {
  const body = await readBody(req);
  const raw = String(body.topic || '').slice(0, 240);
  if (!raw.trim()) return send(res, 400, { error: 'topic is required' });
  const topic = cleanTopic(raw);
  const course = await courseFor(topic, body);
  send(res, 200, {
    topic,
    title: titleFor({ goal: course.goal, topic }),
    goal: course.goal,
    capstone: course.capstone,
    modules: course.modules,
    source: course.source,
  });
}

/** One module, as a level: the teaching-loop platforms she will walk. */
async function handleModule(req, res) {
  const body = await readBody(req);
  const raw = String(body.topic || '').slice(0, 240);
  if (!raw.trim()) return send(res, 400, { error: 'topic is required' });
  const topic = cleanTopic(raw);
  const id = String(body.id || '').slice(0, 40);

  const built = await moduleFor(topic, body, id);
  send(res, 200, {
    topic,
    module: built.mod,
    graph: stagesToGraph(built.stages, built.mod.title),
    stages: built.stages.map((s) => ({
      id: s.id, stage: s.stage, title: s.title, summary: s.summary,
      level: s.objective?.level, checks: s.checks || [],
      teaches: s.teaches || [], exercises: s.exercises || [],
      retrieves: s.retrieves || [], recalls: s.recalls || [],
    })),
    source: built.source,
  });
}

/** The lesson for one platform of one level, written for the step it is.
 *
 * recall and prove need no model at all — one is a doorway and the other is
 * the examination. study writes the worked example; practice sets the same
 * atoms again with the middle taken out. */
async function handleLesson(req, res) {
  const body = await readBody(req);
  const topic = cleanTopic(body.topic || '');
  const stageId = String(body.stageId || '').slice(0, 40);
  if (!topic || !stageId) return send(res, 400, { error: 'topic and stageId are required' });

  const key = `${keyFor(topic, body.goal)}::${body.id}::${stageId}`;
  if (lessonCache.has(key)) return send(res, 200, { lesson: lessonCache.get(key), source: 'cache' });

  const built = await moduleFor(topic, body, String(body.id || ''));
  const stage = built.stages.find((s) => s.id === stageId);
  if (!stage) return send(res, 404, { error: 'no such platform' });

  const labels = new Map(built.doc.kcs.map((k) => [k.id, k.label]));
  const atoms = stage.recalls?.length ? stage.recalls
    : stage.retrieves?.length ? stage.retrieves
    : stage.exercises?.length ? stage.exercises
    : stage.teaches || [];

  // The two stages that are not writing.
  const canned = stageLesson(stage.stage, { atoms, labels, goal: built.doc.goal?.statement });
  if (canned) {
    const lesson = { ...canned, checks: stage.checks.map(toRendererCheck) };
    lesson.check = lesson.checks[0];
    lessonCache.set(key, lesson);
    note('lesson', { topic, id: body.id, stage: stage.stage, source: 'stage', checks: lesson.checks.length });
    return send(res, 200, { lesson, source: 'stage' });
  }

  const group = built.doc.nodes.find((n) => (n.teaches || []).some((k) => atoms.includes(k)));
  const syllabusIsReal = built.source !== 'fallback';
  const needChecks = !syllabusIsReal || !stage.checks?.length;

  const prompt = stage.stage === 'practice'
    ? practicePrompt(built.doc, group, { atoms })
    : syllabusLessonPrompt(built.doc, group, { topic, title: stage.title, summary: stage.summary }, { needChecks });

  let raw = null;
  try {
    raw = await llm(SYLLABUS_LESSON_SYSTEM, prompt, 2000);
  } catch (e) {
    console.warn('lesson call failed:', e.message);
    note('lesson.error', { topic, stage: stage.stage, message: e.message });
  }
  let lesson = readLesson(extractJson(raw));
  const source = lesson ? 'llm' : 'fallback';
  if (!lesson) lesson = fallbackLesson(topic, stage.title, stage.summary);

  if (syllabusIsReal && stage.checks?.length) lesson.checks = stage.checks.map(toRendererCheck);
  else if (!lesson.checks?.length) lesson.checks = lesson.check ? [lesson.check] : [];
  lesson.check = lesson.checks[0];

  // Which atom each question belongs to, so a miss can send her somewhere.
  lesson.checkAtoms = (syllabusIsReal && stage.checks?.length)
    ? stage.checks.map((c) => c.kc || null) : lesson.checks.map(() => null);

  lessonCache.set(key, lesson);
  note('lesson', {
    topic, id: body.id, stage: stage.stage, source,
    paragraphs: lesson.content.length,
    words: lesson.content.join(' ').split(/\s+/).length,
    checks: lesson.checks.length,
  });
  send(res, 200, { lesson, source });
}

/** Where a missed check sends her: the platform that drilled that atom. */
async function handleRemediation(req, res) {
  const body = await readBody(req);
  const topic = cleanTopic(body.topic || '');
  const built = await moduleFor(topic, body, String(body.id || ''));
  send(res, 200, { to: remediationFor(built.stages, String(body.kc || '')) });
}

async function handleSyllabus(req, res) {
  const body = await readBody(req);
  const raw = String(body.topic || '').slice(0, 240);
  if (!raw.trim()) return send(res, 400, { error: 'topic is required' });
  const topic = cleanTopic(raw);

  const built = await buildFor(topic, body);
  // Both shapes in one round trip: the renderer wants the projection, the
  // lesson sheet wants the document. Asking for them separately meant building
  // the world and then waiting again before anything could be taught.
  send(res, 200, { topic, syllabus: built.doc, graph: toGraph(built.doc), source: built.source });
}

/** The old shape, projected from the new document. Renderers see no change. */
async function handleGraph(req, res) {
  const body = await readBody(req);
  const raw = String(body.topic || '').slice(0, 240);
  if (!raw.trim()) return send(res, 400, { error: 'topic is required' });
  const topic = cleanTopic(raw);

  const built = await buildFor(topic, body);
  send(res, 200, { topic, graph: toGraph(built.doc), source: built.source });
}

async function handleNode(req, res) {
  const body = await readBody(req);
  const topic = cleanTopic(body.topic || '');
  const title = String(body.title || '').slice(0, 120);
  const summary = String(body.summary || '').slice(0, 300);
  if (!topic || !title) return send(res, 400, { error: 'topic and title are required' });

  const key = `${keyFor(topic, body.goal)}::${title}`;
  if (lessonCache.has(key)) return send(res, 200, { lesson: lessonCache.get(key), source: 'cache' });

  // The lesson is written from the atoms of the platform it belongs to, not
  // from its label. The client sends back the goal it was built with so we look
  // up the same course it is actually walking.
  const held = syllabusCache.get(keyFor(topic, body.goal));
  const doc = held?.doc || [...syllabusCache.values()].map((b) => b.doc).find((d) => d.topic === topic);
  const node = doc?.nodes.find((n) => n.id === body.id) || doc?.nodes.find((n) => n.title === title);

  // Whose questions to use. The syllabus's are far better when they are real:
  // each is tagged to an atom and its distractors are named misconceptions. But
  // when the syllabus itself fell back they are template filler, and filler put
  // in front of a learner is worse than a question the model wrote about what
  // it just taught. So in that case we ask for them.
  const syllabusIsReal = held ? held.source !== 'fallback' : false;
  const needChecks = !syllabusIsReal || !node?.checks?.length;

  let raw = null;
  try {
    raw = await llm(
      SYLLABUS_LESSON_SYSTEM,
      syllabusLessonPrompt(doc, node, { topic, title, summary }, { needChecks }),
      2000,
    );
  } catch (e) {
    console.warn('lesson call failed:', e.message);
    note('lesson.error', { topic, title, message: e.message });
  }
  let lesson = readLesson(extractJson(raw));
  const source = lesson ? 'llm' : 'fallback';
  if (!lesson) lesson = fallbackLesson(topic, title, summary);
  let checkSource = 'llm';
  if (syllabusIsReal && node?.checks?.length) {
    lesson.checks = node.checks.map(toRendererCheck);
    checkSource = 'syllabus';
  } else if (!lesson.checks?.length) {
    lesson.checks = lesson.check ? [lesson.check] : [];
    checkSource = source === 'fallback' ? 'template' : 'llm';
  }
  lesson.check = lesson.checks[0];
  lessonCache.set(key, lesson);
  note('lesson', {
    topic, id: body.id, title, source, checkSource,
    paragraphs: lesson.content.length,
    words: lesson.content.join(' ').split(/\s+/).length,
    checks: lesson.checks.length,
  });
  send(res, 200, { lesson, source });
}

async function serveStatic(pathname, res) {
  let p;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    p = '/';
  }
  if (p === '/') p = '/index.html';
  const rel = normalize(p).replace(/^([/\\])+/, '');
  const root = rel === 'world' || rel.startsWith('world/') ? dirname(WORLD_DIR) : PUBLIC_DIR;
  const fp = join(root, rel);
  if (!fp.startsWith(root === PUBLIC_DIR ? PUBLIC_DIR : WORLD_DIR)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  try {
    const data = await readFile(fp);
    res.writeHead(200, { 'content-type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'POST' && url.pathname === '/api/negotiate') return await handleNegotiate(req, res);
    if (req.method === 'POST' && url.pathname === '/api/course') return await handleCourse(req, res);
    if (req.method === 'POST' && url.pathname === '/api/module') return await handleModule(req, res);
    if (req.method === 'POST' && url.pathname === '/api/lesson') return await handleLesson(req, res);
    if (req.method === 'POST' && url.pathname === '/api/remediation') return await handleRemediation(req, res);
    if (req.method === 'POST' && url.pathname === '/api/syllabus') return await handleSyllabus(req, res);
    if (req.method === 'POST' && url.pathname === '/api/graph') return await handleGraph(req, res);
    if (req.method === 'POST' && url.pathname === '/api/node') return await handleNode(req, res);
    // TEMPORARY: client-side events, so a manual test session reads back whole.
    if (req.method === 'POST' && url.pathname === '/api/observe') {
      const b = await readBody(req);
      note(`ui.${String(b.event || 'unknown').slice(0, 40)}`, b.data || {});
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET') return await serveStatic(url.pathname, res);
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Graph Valley running → http://localhost:${PORT}\n  LLM: ${describeModel()}\n`);
});
