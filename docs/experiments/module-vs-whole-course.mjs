/* RISK TEST 1 — does module-scoped decomposition validate more reliably than
 * decomposing the whole course in one call?
 *
 * If it fails as often, the two-call plan has moved the fallback rather than
 * fixed it, and the whole redesign rests on sand. */
import { llm } from '../../curriculum/llm.mjs';
import { decompose } from '../../curriculum/decompose.mjs';
import { buildSyllabus, assemble, defaultCapstoneFor } from '../../curriculum/build.mjs';
import { validate } from '../../curriculum/validate.mjs';

const MODULE_SYSTEM = 'You plan a course as a sequence of modules. Output ONLY valid JSON.';
const modulePrompt = ({ topic, goal, capstone }) => `Topic: "${topic}".
Goal: ${goal.statement}
The learner proves it by: ${capstone.prompt}

Break this into 4 to 7 MODULES — the large steps of the journey, in the order
they must be learned. A module is a coherent chunk that takes a sitting or two,
not a single idea and not the whole course.

{"modules": [{"id": "m1",
              "title": "3-6 words, concrete",
              "outcome": "one thing she can DO after this module, starting with a verb",
              "level": "remember|understand|apply|analyze|evaluate|create",
              "requires": ["ids of modules needed before this one"]}]}

Rules:
- The LAST module must reach "${goal.level}", the level the goal asks for.
- "requires" must form a DAG. Not every module needs to be a straight line —
  where two modules genuinely do not depend on each other, say so.
- No filler modules. No "Introduction", no "Advanced Topics", no "Conclusion".`;

const extract = (t) => {
  const s = String(t || '').trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
};

const CASES = [
  { topic: 'Fund raising', goal: { statement: 'Develop a comprehensive fundraising strategy for a for-profit venture', level: 'create', audience: 'a founder' } },
  { topic: 'Machine learning', goal: { statement: 'Implement and explain a supervised learning algorithm from scratch in Python', level: 'create', audience: 'a programmer new to ML' } },
  { topic: 'How vaccines work', goal: { statement: 'Explain how vaccines stimulate the immune system at a cellular level', level: 'understand', audience: 'a curious adult' } },
];

for (const c of CASES) {
  const capstone = defaultCapstoneFor(c.topic);
  console.log('\n' + '='.repeat(74));
  console.log(`${c.topic}  —  "${c.goal.statement}"  [${c.goal.level}]`);

  // ---- A. whole course, one call (what we do today) ----
  const whole = await buildSyllabus({ topic: c.topic, goal: c.goal, capstone, llm });
  console.log(`  WHOLE COURSE : ${whole.source.padEnd(10)} atoms=${String(whole.doc.kcs.length).padStart(2)} `
    + `platforms=${whole.doc.nodes.length}  ${whole.errors.length ? 'errors: ' + [...new Set(whole.errors.map(e => e.code))].join(',') : 'clean'}`);

  // ---- B. modules first, then one module ----
  const mods = extract(await llm(MODULE_SYSTEM, modulePrompt({ ...c, capstone }), 1500));
  if (!mods?.modules?.length) { console.log('  MODULES      : call failed'); continue; }
  console.log(`  MODULES      : ${mods.modules.length} — ${mods.modules.map(m => m.title).join(' | ')}`);
  const forks = mods.modules.filter(m => (m.requires || []).length > 1).length;
  const roots = mods.modules.filter(m => !(m.requires || []).length).length;
  console.log(`                 roots=${roots} joins=${forks} last-level=${mods.modules[mods.modules.length - 1].level}`);

  // decompose module 1 as if it were its own little course
  for (const m of mods.modules.slice(0, 2)) {
    const mGoal = { statement: m.outcome, level: m.level, audience: c.goal.audience };
    const mCap = { prompt: `Show you can: ${m.outcome}`, rubric: ['uses the right ideas', 'the steps follow'] };
    let spec = null;
    try { spec = await decompose({ topic: `${c.topic} — ${m.title}`, goal: mGoal, capstone: mCap, llm }); } catch (e) { /* */ }
    if (!spec) { console.log(`  module "${m.title}": decompose failed`); continue; }
    const doc = assemble(spec, {});
    doc.minKcs = 3;                      // a module is not a course; the floor is lower
    const errs = validate(doc);
    console.log(`  MODULE "${m.title.slice(0, 28).padEnd(28)}": atoms=${String(doc.kcs.length).padStart(2)} `
      + `platforms=${doc.nodes.length}  ${errs.length ? 'errors: ' + [...new Set(errs.map(e => e.code))].join(',') : 'CLEAN'}`);
  }
}
