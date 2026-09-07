// Graph Valley — zero-dependency Node server.
// Serves the static frontend and two JSON endpoints:
//   POST /api/negotiate { topic, turns }  -> { done, ask } | { done, goal, capstone, spine }
//   POST /api/syllabus  { topic, goal, capstone } -> { syllabus, source }
//   POST /api/graph     { topic }         -> { topic, graph, source }   (projection)
//   POST /api/node      { topic, title, summary } -> { lesson, source }
// Uses Anthropic or OpenAI if a key is present; otherwise falls back to a
// deterministic built-in generator so the app always works offline.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { llm, hasKey, describeModel } from './curriculum/llm.mjs';
import { negotiate } from './curriculum/negotiate.mjs';
import { buildSyllabus, defaultGoalFor, defaultCapstoneFor } from './curriculum/build.mjs';
import { toGraph } from './curriculum/project.mjs';
import { lessonPrompt as syllabusLessonPrompt, LESSON_SYSTEM as SYLLABUS_LESSON_SYSTEM } from './curriculum/lesson.mjs';

const PORT = Number(process.env.PORT || 3217);
const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url));


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

/** The renderer reads one question per platform; the syllabus holds one per
 *  atom. Hand over the first — scoring all of them is v2's job. */
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

function normalizeLesson(x) {
  if (!x) return null;
  const content = Array.isArray(x.content) ? x.content.map(String).filter(Boolean).slice(0, 6) : [];
  const c = x.check || {};
  const options = Array.isArray(c.options) ? c.options.map(String).slice(0, 4) : [];
  const answerIndex = Number(c.answerIndex);
  if (!content.length || options.length !== 4 || typeof c.question !== 'string') return null;
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) return null;
  return {
    content,
    check: {
      question: c.question,
      options,
      answerIndex,
      explanation: String(c.explanation || ''),
    },
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

  let outcome = null;
  try {
    if (hasKey()) outcome = await negotiate({ topic, turns, llm });
  } catch (e) {
    console.warn('negotiate failed:', e.message);
  }
  if (!outcome) {
    // No key, or nothing usable came back: skip the dialogue and take the topic
    // at face value rather than stranding the learner on a chat screen.
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
  send(res, 200, { topic, ...outcome, source: 'llm' });
}

/** The full document: atoms, platforms, derived edges, checks. */
async function buildFor(topic, body = {}) {
  const key = `${topic}::${body.goal?.statement || ''}`;
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
  syllabusCache.set(key, built);
  return built;
}

async function handleSyllabus(req, res) {
  const body = await readBody(req);
  const raw = String(body.topic || '').slice(0, 240);
  if (!raw.trim()) return send(res, 400, { error: 'topic is required' });
  const topic = cleanTopic(raw);

  const built = await buildFor(topic, body);
  send(res, 200, { topic, syllabus: built.doc, source: built.source });
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

  const key = `${topic}::${title}`;
  if (lessonCache.has(key)) return send(res, 200, { lesson: lessonCache.get(key), source: 'cache' });

  // The renderer only knows a title, but we still hold the syllabus it came
  // from — so the lesson can be written from the atoms rather than the label.
  const doc = [...syllabusCache.values()].map((b) => b.doc).find((d) => d.topic === topic);
  const node = doc?.nodes.find((n) => n.title === title);

  let raw = null;
  try {
    raw = await llm(
      SYLLABUS_LESSON_SYSTEM,
      syllabusLessonPrompt(doc, node, { topic, title, summary }),
      2000,
    );
  } catch (e) {
    console.warn('lesson call failed:', e.message);
  }
  let lesson = normalizeLesson(extractJson(raw));
  const source = lesson ? 'llm' : 'fallback';
  if (!lesson) lesson = fallbackLesson(topic, title, summary);
  if (node?.checks?.length) lesson.check = toRendererCheck(node.checks[0]);
  lessonCache.set(key, lesson);
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
  const fp = join(PUBLIC_DIR, normalize(p).replace(/^([/\\])+/, ''));
  if (!fp.startsWith(PUBLIC_DIR)) {
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
    if (req.method === 'POST' && url.pathname === '/api/syllabus') return await handleSyllabus(req, res);
    if (req.method === 'POST' && url.pathname === '/api/graph') return await handleGraph(req, res);
    if (req.method === 'POST' && url.pathname === '/api/node') return await handleNode(req, res);
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
