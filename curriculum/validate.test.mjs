import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validate } from './validate.mjs';
import { syllabus, node, kc, check } from './fixture.mjs';

/** Assert the run failed, and that `code` is among the reasons. */
function failsWith(doc, code) {
  const r = validate(doc);
  assert.equal(r.ok, false, `expected ${code}, but the document validated clean`);
  assert.ok(
    r.errors.some((e) => e.code === code),
    `expected ${code}, got: ${r.errors.map((e) => e.code).join(', ') || '(none)'}`,
  );
}

test('a well-formed syllabus validates clean', () => {
  const r = validate(syllabus());
  assert.equal(r.ok, true, r.errors.map((e) => `${e.code}: ${e.message}`).join('\n'));
  assert.deepEqual(r.errors, []);
});

test('rejects a knowledge component that nothing teaches', () => {
  failsWith(
    syllabus({
      kcs: [kc('k1'), kc('k2', ['k1']), kc('k3')],
      nodes: [
        node('n1', { teaches: ['k1'] }),
        node('n2', { teaches: ['k2'], requires: ['k1', 'k3'], level: 'apply', goal: true }),
      ],
    }),
    'kc-untaught',
  );
});

test('rejects a knowledge component taught by two platforms', () => {
  failsWith(
    syllabus({
      nodes: [
        node('n1', { teaches: ['k1'] }),
        node('n1b', { teaches: ['k1'] }),
        node('n2', { teaches: ['k2'], requires: ['k1'], level: 'apply', goal: true }),
      ],
    }),
    'kc-taught-twice',
  );
});

test('rejects a knowledge component the capstone never needs', () => {
  failsWith(
    syllabus({
      kcs: [kc('k1'), kc('k2', ['k1']), kc('k3')],
      nodes: [
        node('n1', { teaches: ['k1'] }),
        node('n2', { teaches: ['k2'], requires: ['k1'], level: 'apply', goal: true }),
        node('n3', { teaches: ['k3'] }),
      ],
    }),
    'kc-unused',
  );
});

test('rejects a platform carrying more new components than the budget allows', () => {
  failsWith(
    syllabus({
      budget: { newKcs: 2 },
      kcs: [kc('k1'), kc('k2'), kc('k3'), kc('k4', ['k1', 'k2', 'k3'])],
      capstone: { prompt: 'now do it', requires: ['k4'], rubric: ['does the thing'] },
      nodes: [
        node('n1', { teaches: ['k1', 'k2', 'k3'] }),
        node('n2', { teaches: ['k4'], requires: ['k1', 'k2', 'k3'], level: 'apply', goal: true }),
      ],
      edges: [
        { from: 'n1', to: 'n2', via: 'k1' },
        { from: 'n1', to: 'n2', via: 'k2' },
        { from: 'n1', to: 'n2', via: 'k3' },
      ],
    }),
    'node-overloaded',
  );
});

test('rejects a taught component with nothing to check it', () => {
  failsWith(
    syllabus({
      nodes: [
        node('n1', { teaches: ['k1'] }, { checks: [] }),
        node('n2', { teaches: ['k2'], requires: ['k1'], level: 'apply', goal: true }),
      ],
    }),
    'kc-unchecked',
  );
});

test('rejects a distractor not drawn from a named misconception', () => {
  failsWith(
    syllabus({
      nodes: [
        node('n1', { teaches: ['k1'] }, {
          checks: [check('k1', 'understand', { distractorSource: [null, null, null, null] })],
        }),
        node('n2', { teaches: ['k2'], requires: ['k1'], level: 'apply', goal: true }),
      ],
    }),
    'distractor-unsourced',
  );
});

test('rejects a check pitched above the level its platform taught at', () => {
  failsWith(
    syllabus({
      nodes: [
        node('n1', { teaches: ['k1'] }, { checks: [check('k1', 'create')] }),
        node('n2', { teaches: ['k2'], requires: ['k1'], level: 'apply', goal: true }),
      ],
    }),
    'check-level-too-high',
  );
});

test('allows difficulty to dip after a hard insight', () => {
  // Elaboration theory's zoom lens: reach a synthesis, then zoom into a
  // mechanical detail. A platform's level is the max over its atoms, so an
  // edge-by-edge difficulty rule reads a legitimate zoom-in as a regression —
  // and a false reject costs the learner a bespoke course. Only the summit
  // has to arrive; see the next test.
  const r = validate(syllabus({
    goal: { statement: 'do the thing', level: 'apply', audience: 'anyone' },
    nodes: [
      node('n1', { teaches: ['k1'], level: 'analyze' }),
      node('n2', { teaches: ['k2'], requires: ['k1'], level: 'understand', goal: true }),
    ],
  }));
  assert.deepEqual(r.errors.filter((e) => e.code.startsWith('level')), []);
});

test('rejects a summit that never reaches the level the goal asked for', () => {
  failsWith(
    syllabus({
      goal: { statement: 'do the thing', level: 'analyze', audience: 'anyone' },
      nodes: [
        node('n1', { teaches: ['k1'], level: 'understand' }),
        node('n2', { teaches: ['k2'], requires: ['k1'], level: 'understand', goal: true }),
      ],
    }),
    'summit-below-goal',
  );
});

test('rejects a junction the world cannot render legibly', () => {
  const branch = (id, k) => node(id, { teaches: [k], requires: ['k1'], goal: id === 'n5' });
  failsWith(
    syllabus({
      kcs: [kc('k1'), kc('k2', ['k1']), kc('k3', ['k1']), kc('k4', ['k1']), kc('k5', ['k1'])],
      capstone: { prompt: 'now do it', requires: ['k2', 'k3', 'k4', 'k5'], rubric: ['does it'] },
      nodes: [
        node('n1', { teaches: ['k1'] }),
        branch('n2', 'k2'), branch('n3', 'k3'), branch('n4', 'k4'), branch('n5', 'k5'),
      ],
      edges: ['n2', 'n3', 'n4', 'n5'].map((to) => ({ from: 'n1', to, via: 'k1' })),
    }),
    'branching-too-wide',
  );
});

test('rejects an edge that no shared component justifies', () => {
  failsWith(
    syllabus({ edges: [{ from: 'n1', to: 'n2', via: 'k1' }, { from: 'n2', to: 'n1', via: 'k2' }] }),
    'edge-not-derived',
  );
});

test('rejects components that depend on each other in a circle', () => {
  failsWith(
    syllabus({ kcs: [kc('k1', ['k2']), kc('k2', ['k1'])] }),
    'kc-cycle',
  );
});

test('rejects a syllabus without exactly one summit', () => {
  failsWith(
    syllabus({
      nodes: [
        node('n1', { teaches: ['k1'], goal: true }),
        node('n2', { teaches: ['k2'], requires: ['k1'], level: 'apply', goal: true }),
      ],
    }),
    'goal-not-unique',
  );
});

test('rejects a capstone that names no atoms, rather than throwing', () => {
  failsWith(syllabus({ capstone: { prompt: 'now do it', rubric: [] } }), 'capstone-empty');
});
