/* Headless verification of the curriculum pipeline. Run: node curriculum/check.mjs
 *
 * The unit tests prove each module in isolation. This proves the thing that
 * actually matters: that realistic model output, run end to end, produces a
 * syllabus that satisfies every assertion — and describes the *shape* of what
 * came out, because a valley with no junctions is a corridor, and that is a
 * quality signal no single assertion catches.
 *
 *   node curriculum/check.mjs           # against recorded fixtures, offline
 *   node curriculum/check.mjs --live    # call the real model and re-record
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { buildSyllabus, assemble, fallbackSpec } from './build.mjs';
import { decompose } from './decompose.mjs';
import { pack } from './pack.mjs';
import { validate, MAX_BRANCH } from './validate.mjs';

const DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const LIVE = process.argv.includes('--live');

let pass = 0;
const failures = [];
const notes = [];

function check(label, ok, detail = '') {
  if (ok) { pass++; return true; }
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}

/** Longest path and junction counts — how the world will actually read. */
function shapeOf({ nodes, edges }) {
  const succ = new Map(nodes.map((n) => [n.id, new Set()]));
  const pred = new Map(nodes.map((n) => [n.id, new Set()]));
  for (const e of edges) { succ.get(e.from).add(e.to); pred.get(e.to).add(e.from); }

  const depth = new Map();
  for (const n of nodes) {
    depth.set(n.id, 1 + Math.max(-1, ...[...pred.get(n.id)].map((p) => depth.get(p) ?? 0)));
  }

  return {
    platforms: nodes.length,
    atoms: nodes.reduce((a, n) => a + n.teaches.length, 0),
    forks: nodes.filter((n) => succ.get(n.id).size > 1).length,
    joins: nodes.filter((n) => pred.get(n.id).size > 1).length,
    widest: Math.max(0, ...nodes.map((n) => Math.max(succ.get(n.id).size, pred.get(n.id).size))),
    longest: Math.max(0, ...[...depth.values()]) + 1,
    roots: nodes.filter((n) => pred.get(n.id).size === 0).length,
  };
}

async function verify(name, fixture, built) {
  check(`${name}: the model's own decomposition is accepted`, built.source.startsWith('llm'),
    built.errors.map((e) => `${e.code}: ${e.message}`).slice(0, 3).join('; '));

  const doc = built.doc;
  const result = validate(doc);
  check(`${name}: validates clean`, result.ok,
    result.errors.map((e) => `${e.code}: ${e.message}`).slice(0, 3).join('; '));
  // Not a failure: a recovered cluster cycle still yields a walkable world, and
  // reachability is asserted below on its own. But it says the model's grouping
  // was bad, which is worth seeing.
  if (doc.problems.length) notes.push(`${name}: ${doc.problems.join('; ')}`);

  // Every atom the capstone leans on is reachable by walking forwards.
  const teacherOf = new Map();
  doc.nodes.forEach((n) => n.teaches.forEach((k) => teacherOf.set(k, n.id)));
  check(`${name}: the capstone's atoms are all taught somewhere`,
    doc.capstone.requires.every((k) => teacherOf.has(k)),
    doc.capstone.requires.filter((k) => !teacherOf.has(k)).join(','));

  // The fringe must never empty before the summit — knowledge space theory's
  // well-gradedness. Walk it greedily from nothing and see if we arrive.
  const held = new Set(doc.assumed);
  const walked = new Set();
  for (;;) {
    const next = doc.nodes.find((n) => !walked.has(n.id) && n.requires.every((k) => held.has(k)));
    if (!next) break;
    walked.add(next.id);
    next.teaches.forEach((k) => held.add(k));
  }
  check(`${name}: every platform is reachable from a standing start`,
    walked.size === doc.nodes.length,
    `stalled after ${walked.size}/${doc.nodes.length}`);

  // Re-packing with atoms already held must shorten the world, not break it.
  const first = doc.nodes[0];
  const shorter = assemble({ ...doc, spine: doc.spine }, { known: new Set(first.teaches), budget: 3 });
  check(`${name}: re-packs cleanly when atoms are already held`,
    validate(shorter).ok && shorter.nodes.length < doc.nodes.length,
    `${doc.nodes.length} → ${shorter.nodes.length}`);

  const shape = shapeOf(doc);
  check(`${name}: no junction wider than the world can render`, shape.widest <= MAX_BRANCH, `widest ${shape.widest}`);

  // Say which world this actually describes. When a decomposition is rejected
  // the document is the built-in generator's, and reporting its shape as the
  // model's would flatter a run that in fact produced nothing usable.
  return { ...shape, source: built.source };
}

/* ------------------------------- run -------------------------------- */

const files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort();
const shapes = [];
const retried = [];

for (const file of files) {
  const fixture = JSON.parse(await readFile(join(DIR, file), 'utf8'));
  const name = file.replace(/\.json$/, '');

  const { topic, goal, capstone, response } = fixture;
  let built;

  if (LIVE) {
    // Run the pipeline for real, retry included. Replaying one recorded answer
    // for both attempts measures the first-attempt rate, not the one a learner
    // would actually see — the retry exists precisely to rescue these.
    const { llm } = await import('./llm.mjs');
    try {
      built = await buildSyllabus({ topic, goal, capstone, spine: response.spine, llm });
      if (built.source.startsWith('llm')) {
        fixture.response = {
          spine: built.doc.spine, assumed: built.doc.assumed, kcs: built.doc.kcs,
          clusters: built.doc.clusters, capstoneRequires: built.doc.capstone.requires,
        };
        fixture.capstone = { ...fixture.capstone, requires: built.doc.capstone.requires };
        await writeFile(join(DIR, file), `${JSON.stringify(fixture, null, 2)}\n`);
      }
      if (built.source === 'llm-retry') retried.push(name);
    } catch (e) {
      check(`${name}: the model call reached the model`, false, e.message.replace(/\s+/g, ' ').slice(0, 120));
    }
  }

  if (!built) {
    const replay = async () => JSON.stringify(response);
    built = await buildSyllabus({ topic, goal, capstone, spine: response.spine, llm: replay });
  }

  shapes.push([name, await verify(name, fixture, built)]);
}

// The offline generator is a fallback the product actually ships on.
const built = assemble(fallbackSpec('anything at all'), { budget: 3 });
check('fallback: the built-in generator validates', validate(built).ok,
  validate(built).errors.map((e) => e.code).join(','));

/* ------------------------------ report ------------------------------- */

console.log('\nShape of each world\n');
console.log('  topic                      platforms  atoms  roots  forks  joins  longest  from');
for (const [name, s] of shapes) {
  console.log(
    `  ${name.padEnd(26)} ${String(s.platforms).padStart(6)} ${String(s.atoms).padStart(6)} ` +
    `${String(s.roots).padStart(6)} ${String(s.forks).padStart(6)} ${String(s.joins).padStart(6)} ` +
    `${String(s.longest).padStart(8)}  ${s.source}`,
  );
}

if (retried.length) {
  console.log(`\n  ${retried.join(', ')} failed first time and were rescued by the retry.`);
}

const fellBack = shapes.filter(([, s]) => s.source === 'fallback');
if (fellBack.length) {
  console.log(`\n  ${fellBack.length}/${shapes.length} fell back: ${fellBack.map(([n]) => n).join(', ')}.`);
  console.log('  Those rows describe the built-in generator, not the model. The model produced');
  console.log('  nothing usable for them — see the failures below for what it got wrong.');
}

const corridors = shapes.filter(([, s]) => s.source !== 'fallback' && s.forks === 0 && s.platforms > 3);
if (corridors.length) {
  console.log(`\n  Note: ${corridors.map(([n]) => n).join(', ')} came out as a corridor — no junctions.`);
  console.log('  Not a failure, but a valley with nothing to choose is a list with scenery.');
}

if (notes.length) {
  console.log('\nRecovered, but worth knowing');
  for (const n of notes) console.log(`  · ${n}`);
}

console.log(`\n${failures.length ? '✗' : '✓'} ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);
