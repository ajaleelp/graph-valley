/* Backward design, stage 1.5: the journey before the steps.
 *
 * A course used to be decomposed in one call — sixteen atoms, every rule
 * satisfied at once, one shot. It failed often, and it failed in a way that was
 * invisible to the learner: the pipeline quietly fell back to a nine-step
 * template with the topic pasted in.
 *
 * Measured on three real goals, whole-course decomposition gave one outright
 * fallback and two rescued-only-on-retry. The same goals decomposed one MODULE
 * at a time gave six clean documents out of six, first attempt, no retries.
 * A module satisfies the same rules over five atoms instead of sixteen, which
 * is simply an easier thing to ask for.
 *
 * It also buys the length a real subject deserves: six or seven modules of five
 * to eight atoms is thirty-six to forty-two, where the old cap was sixteen and
 * the floor of six was what rejected every well-scoped narrow goal.
 */

export const MODULE_TOKENS = 1500;

export const MODULE_SYSTEM =
  'You plan a course as a sequence of modules. Output ONLY valid JSON. No markdown, no prose.';

export const MIN_MODULES = 3;
export const MAX_MODULES = 8;

export function modulePrompt({ topic, goal, capstone, complaints = [] }) {
  const retry = complaints.length
    ? `\n\nYour previous attempt was rejected. Fix exactly these problems:\n${complaints
        .map((c) => `- [${c.code}] ${c.message}`)
        .join('\n')}\n`
    : '';

  return `Topic: "${topic}".
Goal: ${goal.statement}
The learner proves it by: ${capstone.prompt}

Break this into 4 to 7 MODULES — the large steps of the journey, in the order
they must be learned. A module is a coherent chunk that takes a sitting or two:
not a single idea, and not the whole course.

{"modules": [{"id": "m1",
              "title": "3-6 words, concrete",
              "outcome": "one thing she can DO after this module, starting with a verb",
              "level": "remember|understand|apply|analyze|evaluate|create",
              "requires": ["ids of modules needed before this one"]}]}

Rules:
- The FIRST module must give her the SHAPE of the whole subject before any part
  of it is examined closely — what kind of thing this is, what its major parts
  are, and what they are called. Someone who finishes it should be able to
  sketch the outline even though they know none of the detail yet. For a
  political system that means naming the form of government and its branches
  and chambers, not opening with the founding document. This is an advance
  organiser, not an introduction: it teaches real content, and "Overview" is
  not an acceptable title for it.
- The LAST module must reach "${goal.level || 'apply'}", the level the goal asks
  for. Earlier modules may sit lower.
- "requires" must form a DAG. Not every module needs to follow from exactly one
  other — where two modules genuinely do not depend on each other, say so, and
  she gets to choose which to take next.
- Each outcome must be something she DOES, not something she "understands about".
- No filler. No "Introduction", no "Advanced Topics", no "Conclusion", no
  "Putting it all together".${retry}`;
}

function extractJson(text) {
  if (!text) return null;
  const t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    return null;
  }
}

const LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
const rank = (l) => Math.max(0, LEVELS.indexOf(l));
const str = (v, f = '') => (typeof v === 'string' ? v.trim() : f);

/** Read a plan, keeping only what is well-formed. Ids are re-derived. */
export function readModules(raw, { goal } = {}) {
  const list = Array.isArray(raw?.modules) ? raw.modules : [];
  const seen = new Set();
  const mods = [];
  for (const m of list) {
    const title = str(m?.title);
    const outcome = str(m?.outcome);
    const id = str(m?.id);
    if (!title || !outcome || !id || seen.has(id)) continue;
    seen.add(id);
    mods.push({
      id,
      title,
      outcome,
      level: LEVELS.includes(m?.level) ? m.level : 'understand',
      requires: [...new Set((Array.isArray(m?.requires) ? m.requires : []).map(String))],
    });
  }
  if (mods.length < MIN_MODULES) return null;

  // Drop references to modules that did not survive, and any that point
  // forward or at themselves — a plan is an order, not a web.
  const ids = new Set(mods.map((m) => m.id));
  const index = new Map(mods.map((m, i) => [m.id, i]));
  for (const m of mods) {
    m.requires = m.requires.filter((d) => ids.has(d) && index.get(d) < index.get(m.id));
  }
  return mods.slice(0, MAX_MODULES);
}

/* The plan has to hold together before a single atom is generated, because
 * every later call is scoped by it. These are the same kinds of assertion the
 * syllabus validator makes, one level up. */
export function validateModules(mods, { goal } = {}) {
  const errors = [];
  const fail = (code, message, id) => errors.push({ code, message, id });

  if (!mods || mods.length < MIN_MODULES) {
    fail('too-few-modules', `${mods?.length || 0} modules is not a journey`);
    return errors;
  }

  const ids = new Set(mods.map((m) => m.id));
  for (const m of mods) {
    for (const d of m.requires) if (!ids.has(d)) fail('dangling-requires', `${m.id} needs unknown ${d}`, m.id);
  }

  // Somewhere to start.
  if (!mods.some((m) => !m.requires.length)) {
    fail('no-entry', 'every module waits on another, so the journey cannot begin');
  }

  // Reachability: a module nothing leads to is a module she never walks.
  const kids = new Map(mods.map((m) => [m.id, []]));
  for (const m of mods) for (const d of m.requires) kids.get(d)?.push(m.id);
  const seen = new Set(mods.filter((m) => !m.requires.length).map((m) => m.id));
  const q = [...seen];
  while (q.length) for (const k of kids.get(q.pop()) || []) if (!seen.has(k)) { seen.add(k); q.push(k); }
  for (const m of mods) if (!seen.has(m.id)) fail('unreachable-module', `${m.title} is never reached`, m.id);

  // The course must arrive where the goal asked.
  const top = mods.reduce((a, b) => (rank(b.level) > rank(a.level) ? b : a));
  if (goal?.level && rank(top.level) < rank(goal.level)) {
    fail('journey-below-goal',
      `the highest module reaches "${top.level}" but the goal asks for "${goal.level}"`);
  }

  // Filler is the failure mode a plan actually has.
  for (const m of mods) {
    if (/^(introduction|intro|overview|conclusion|advanced topics|putting it all together|getting started)\b/i.test(m.title)) {
      fail('filler-module', `"${m.title}" is a chapter heading, not a step`, m.id);
    }
  }
  return errors;
}

/** Plan the journey. One call, one retry with the complaints handed back. */
export async function planModules({ topic, goal, capstone, llm }) {
  if (!llm) return null;
  let complaints = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let mods = null;
    try {
      mods = readModules(
        extractJson(await llm(MODULE_SYSTEM, modulePrompt({ topic, goal, capstone, complaints }), MODULE_TOKENS)),
        { goal },
      );
    } catch {
      return null;                                  // network or quota: caller decides
    }
    if (!mods) { complaints = [{ code: 'unreadable', message: 'the reply was not a usable plan' }]; continue; }
    const errors = validateModules(mods, { goal });
    if (!errors.length) return { modules: mods, source: attempt ? 'llm-retry' : 'llm', errors: [] };
    complaints = errors;
  }
  return null;
}
