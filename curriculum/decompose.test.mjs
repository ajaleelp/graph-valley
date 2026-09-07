import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decompose } from './decompose.mjs';

const GOAL = { statement: 'explain why light cannot escape', level: 'understand' };
const CAPSTONE = { prompt: 'so what is a black hole?', requires: ['k2'], rubric: ['names the radius'] };

/** An llm stand-in that answers with whatever text it was handed. */
const saying = (text) => async () => text;

const RESPONSE = JSON.stringify({
  spine: 'concept',
  assumed: ['school arithmetic'],
  kcs: [
    {
      id: 'k1', label: 'gravity pulls harder up close', type: 'concept',
      cluster: 'Falling', level: 'understand', requires: [], misconceptions: ['gravity stops in space'],
      check: {
        kc: 'k1', level: 'understand', kind: 'mcq', stem: 'closer means?',
        options: ['stronger', 'weaker', 'same', 'none'], answerIndex: 0,
        distractorSource: [null, 'gravity stops in space', 'gravity stops in space', 'gravity stops in space'],
      },
    },
    {
      id: 'k2', label: 'escape velocity', type: 'principle',
      cluster: 'Escaping', level: 'understand', requires: ['k1'], misconceptions: ['it depends on your mass'],
      check: {
        kc: 'k2', level: 'understand', kind: 'mcq', stem: 'escape velocity?',
        options: ['a', 'b', 'c', 'd'], answerIndex: 0,
        distractorSource: [null, 'it depends on your mass', 'it depends on your mass', 'it depends on your mass'],
      },
    },
  ],
  clusters: [
    { title: 'Falling', summary: 'how gravity behaves', kcs: ['k1'] },
    { title: 'Escaping', summary: 'getting away', kcs: ['k2'] },
  ],
});

test('reads atoms, clusters and checks out of the model response', async () => {
  const spec = await decompose({ topic: 'black holes', goal: GOAL, capstone: CAPSTONE, llm: saying(RESPONSE) });
  assert.equal(spec.kcs.length, 2);
  assert.equal(spec.kcs[1].id, 'k2');
  assert.deepEqual(spec.kcs[1].requires, ['k1']);
  assert.equal(spec.kcs[0].check.kind, 'mcq');
  assert.deepEqual(spec.clusters.map((c) => c.title), ['Falling', 'Escaping']);
  assert.deepEqual(spec.assumed, ['school arithmetic']);
});

test('drops a prerequisite naming an atom that does not exist', async () => {
  const body = JSON.parse(RESPONSE);
  body.kcs[1].requires = ['k1', 'k99'];
  const spec = await decompose({ topic: 'x', goal: GOAL, capstone: CAPSTONE, llm: saying(JSON.stringify(body)) });
  assert.deepEqual(spec.kcs[1].requires, ['k1']);
});

test('drops an atom that claims to need itself', async () => {
  const body = JSON.parse(RESPONSE);
  body.kcs[1].requires = ['k2'];
  const spec = await decompose({ topic: 'x', goal: GOAL, capstone: CAPSTONE, llm: saying(JSON.stringify(body)) });
  assert.deepEqual(spec.kcs[1].requires, []);
});

test('returns nothing when the model answers with something unusable', async () => {
  const spec = await decompose({ topic: 'x', goal: GOAL, capstone: CAPSTONE, llm: saying('sorry, I cannot help') });
  assert.equal(spec, null);
});

test('passes the validator complaints back to the model when retrying', async () => {
  let seen = '';
  const llm = async (_system, user) => { seen = user; return RESPONSE; };
  await decompose({
    topic: 'x', goal: GOAL, capstone: CAPSTONE, llm,
    complaints: [{ code: 'kc-untaught', message: 'p2 requires k9, which nothing teaches' }],
  });
  assert.match(seen, /kc-untaught/);
  assert.match(seen, /nothing teaches/);
});

test('reads which atoms the capstone actually exercises', async () => {
  const body = JSON.parse(RESPONSE);
  body.capstoneRequires = ['k2'];
  const spec = await decompose({ topic: 'x', goal: GOAL, capstone: { prompt: 'p', rubric: [] }, llm: saying(JSON.stringify(body)) });
  assert.deepEqual(spec.capstone.requires, ['k2']);
});

test('falls back to the atoms nothing else needs when the model omits that', async () => {
  const spec = await decompose({ topic: 'x', goal: GOAL, capstone: { prompt: 'p', rubric: [] }, llm: saying(RESPONSE) });
  assert.deepEqual(spec.capstone.requires, ['k2'], 'k2 is the only atom nothing else requires');
});

test('ignores capstone atoms that do not exist', async () => {
  const body = JSON.parse(RESPONSE);
  body.capstoneRequires = ['k2', 'k99'];
  const spec = await decompose({ topic: 'x', goal: GOAL, capstone: { prompt: 'p', rubric: [] }, llm: saying(JSON.stringify(body)) });
  assert.deepEqual(spec.capstone.requires, ['k2']);
});
