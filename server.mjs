// Graph Valley — zero-dependency Node server.
// Serves the static frontend and two JSON endpoints:
//   POST /api/graph  { topic }            -> { topic, graph, source }
//   POST /api/node   { topic, title, summary } -> { lesson, source }
// Uses Anthropic or OpenAI if a key is present; otherwise falls back to a
// deterministic built-in generator so the app always works offline.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 3217);
const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url));

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

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

/* --------------------------- LLM plumbing --------------------------- */

const GRAPH_SYSTEM =
  'You design learning curriculums as dependency graphs. Output ONLY valid JSON. No markdown, no prose.';

function graphPrompt(topic) {
  return `A learner said: "I want to learn ${topic}".

Design a step-by-step learning path as a JSON knowledge graph:
{"title": "short journey title", "nodes": [{"id": "n1", "title": "...", "summary": "<= 20 words", "deps": ["nX"], "goal": false}]}

Rules:
- 8 to 12 nodes, ordered from absolute beginner to confident competence.
- "deps" lists prerequisite node ids and must form a DAG (no cycles). The first 1-2 nodes have no deps.
- Middle nodes depend on 1-2 earlier nodes. Allow occasional parallel branches.
- Exactly ONE node has "goal": true; nothing depends on it; it is the final capstone.
- Node titles: 2-6 words, concrete and specific to ${topic} (no generic filler like "Advanced Topics").
- Summaries: one sentence describing what the learner will be able to do.`;
}

const LESSON_SYSTEM =
  'You are a warm, brilliant teacher writing bite-sized lessons. Output ONLY valid JSON. No markdown, no prose.';

function lessonPrompt(topic, title, summary) {
  return `Course: "${topic}". Current lesson: "${title}" — ${summary}.

Write this lesson as JSON:
{"content": ["paragraph 1", "paragraph 2", "paragraph 3"],
 "check": {"question": "...", "options": ["A", "B", "C", "D"], "answerIndex": 0, "explanation": "..."}}

Rules:
- 2-4 short paragraphs. Concrete, friendly, plain language. Include one vivid analogy or example.
- Teach THIS lesson only; assume the learner already completed its prerequisites.
- The check question must be answerable purely from the content above.
- Exactly 4 options; exactly one correct; wrong options plausible but clearly wrong to a careful reader.`;
}

async function llm(system, user, maxTokens = 2200) {
  try {
    if (ANTHROPIC_KEY) return await anthropic(system, user, maxTokens);
    if (OPENAI_KEY) return await openai(system, user, maxTokens);
  } catch (e) {
    console.warn('LLM call failed:', e.message);
  }
  return null;
}

async function anthropic(system, user, max_tokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
  const data = await res.json();
  return (data.content || []).map((b) => b.text || '').join('\n');
}

async function openai(system, user, max_tokens) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${OPENAI_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/* --------------------- graph validation / fallback -------------------- */

function normalizeGraph(g, topic) {
  if (!g || !Array.isArray(g.nodes)) return null;
  const nodes = g.nodes.slice(0, 16).map((n, i) => ({
    id: String(n.id ?? `n${i}`),
    title: String(n.title ?? `Step ${i + 1}`).slice(0, 80),
    summary: String(n.summary ?? '').slice(0, 220),
    deps: Array.isArray(n.deps) ? n.deps.map(String) : [],
    goal: !!n.goal,
  }));
  if (nodes.length < 4) return null;
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) return null;
  for (const n of nodes) n.deps = [...new Set(n.deps.filter((d) => ids.has(d) && d !== n.id))];
  if (!nodes.some((n) => n.deps.length === 0)) nodes[0].deps = [];

  // acyclicity check (Kahn)
  const indeg = new Map(nodes.map((n) => [n.id, n.deps.length]));
  const dependents = new Map(nodes.map((n) => [n.id, []]));
  nodes.forEach((n) => n.deps.forEach((d) => dependents.get(d).push(n.id)));
  const queue = nodes.filter((n) => n.deps.length === 0).map((n) => n.id);
  let seen = 0;
  while (queue.length) {
    const id = queue.shift();
    seen++;
    for (const m of dependents.get(id)) {
      indeg.set(m, indeg.get(m) - 1);
      if (indeg.get(m) === 0) queue.push(m);
    }
  }
  if (seen !== nodes.length) return null; // cycle

  // guarantee exactly one goal
  let goals = nodes.filter((n) => n.goal);
  if (goals.length === 0) {
    const sinks = nodes.filter((n) => dependents.get(n.id).length === 0);
    sinks[sinks.length - 1].goal = true;
  } else {
    goals.slice(1).forEach((n) => (n.goal = false));
  }
  return { title: String(g.title || topic).slice(0, 90), nodes };
}

function fallbackGraph(topic) {
  const N = (id, title, summary, deps = [], goal = false) => ({ id, title, summary, deps, goal });
  return {
    title: `The path to ${topic}`,
    nodes: [
      N('n1', `Foundations of ${topic}`, `What ${topic} is, why it matters, and the big picture.`),
      N('n2', 'Key vocabulary', 'The core terms and mental models used everywhere later on.', ['n1']),
      N('n3', 'Core principles', 'The fundamental rules that govern how things actually work.', ['n1']),
      N('n4', 'Common pitfalls', 'Beginner mistakes and how to spot and avoid them early.', ['n2', 'n3']),
      N('n5', 'Guided practice', 'First hands-on exercises applying the core principles.', ['n3']),
      N('n6', 'Intermediate techniques', 'Techniques used by confident practitioners day to day.', ['n4', 'n5']),
      N('n7', 'Real-world applications', 'How all of this shows up in real projects and situations.', ['n6']),
      N('n8', 'Advanced concepts', 'Deeper ideas that separate experts from amateurs.', ['n6']),
      N('n9', 'Synthesis project', 'Combine everything into one coherent piece of work.', ['n7', 'n8']),
      N('n10', `Mastery: ${topic}`, 'Prove to yourself you can do this independently.', ['n9'], true),
    ],
  };
}

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

async function handleGraph(req, res) {
  const body = await readBody(req);
  const raw = String(body.topic || '').slice(0, 240);
  if (!raw.trim()) return send(res, 400, { error: 'topic is required' });
  const topic = cleanTopic(raw);

  let graph = normalizeGraph(extractJson(await llm(GRAPH_SYSTEM, graphPrompt(topic))), topic);
  let source = 'llm';
  if (!graph) {
    graph = fallbackGraph(topic);
    source = 'fallback';
  }
  send(res, 200, { topic, graph, source });
}

async function handleNode(req, res) {
  const body = await readBody(req);
  const topic = cleanTopic(body.topic || '');
  const title = String(body.title || '').slice(0, 120);
  const summary = String(body.summary || '').slice(0, 300);
  if (!topic || !title) return send(res, 400, { error: 'topic and title are required' });

  const key = `${topic}::${title}`;
  if (lessonCache.has(key)) return send(res, 200, { lesson: lessonCache.get(key), source: 'cache' });

  let lesson = normalizeLesson(extractJson(await llm(LESSON_SYSTEM, lessonPrompt(topic, title, summary), 2000)));
  const source = lesson ? 'llm' : 'fallback';
  if (!lesson) lesson = fallbackLesson(topic, title, summary);
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
  const llm = ANTHROPIC_KEY
    ? `Anthropic (${ANTHROPIC_MODEL})`
    : OPENAI_KEY
      ? `OpenAI (${OPENAI_MODEL})`
      : 'none — demo mode (set ANTHROPIC_API_KEY or OPENAI_API_KEY)';
  console.log(`\n  Graph Valley running → http://localhost:${PORT}\n  LLM: ${llm}\n`);
});
