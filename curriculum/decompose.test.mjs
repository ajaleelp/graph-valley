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

test('asks for enough tokens to fit a full decomposition', async () => {
  let budget = 0;
  const llm = async (_s, _u, maxTokens) => { budget = maxTokens; return RESPONSE; };
  await decompose({ topic: 'x', goal: GOAL, capstone: CAPSTONE, llm });
  // A 13-atom decomposition with a check per atom runs past 3,000 tokens.
  assert.ok(budget >= 6000, `asked for only ${budget} tokens; a real decomposition truncates`);
});

test('tells the model what level the course has to reach', async () => {
  const { decomposePrompt } = await import('./decompose.mjs');
  const p = decomposePrompt({
    topic: 'x',
    goal: { statement: 'analyse the thing', level: 'analyze' },
    capstone: { prompt: 'prove it' },
  });
  // Not just present in the level enum — stated as something the course must
  // reach. Live runs flattened every atom to "understand" against an "analyze"
  // goal, and the prompt never said otherwise.
  assert.match(p, /must reach "analyze"/, 'the goal level must be stated as a requirement');
});

/* --- the check shape the model is actually asked for ------------------- */

const CO_LOCATED = JSON.stringify({
  spine: 'concept', assumed: [], capstoneRequires: ['k1'],
  kcs: [{
    id: 'k1', label: 'a thing', type: 'concept', cluster: 'One', level: 'understand', requires: [],
    misconceptions: ['people think it is X', 'people think it is Y'],
    check: {
      kc: 'k1', level: 'understand', kind: 'mcq', stem: 'which is true?',
      correct: 'the right answer',
      wrong: [
        { text: 'it is X', because: 'people think it is X' },
        { text: 'it is Y', because: 'people think it is Y' },
        { text: 'it is X, sort of', because: 'people think it is X' },
      ],
    },
  }],
  clusters: [{ title: 'One', summary: 's', kcs: ['k1'] }],
});

const readCheck = async () => {
  const spec = await decompose({ topic: 'x', goal: GOAL, capstone: CAPSTONE, llm: saying(CO_LOCATED) });
  return spec.kcs[0].check;
};

test('builds a four-option check from the correct answer and the wrong ones', async () => {
  const c = await readCheck();
  assert.equal(c.options.length, 4);
  assert.equal(c.options[c.answerIndex], 'the right answer');
});

test('points every wrong option at the misconception written beside it', async () => {
  const c = await readCheck();
  c.options.forEach((text, i) => {
    if (i === c.answerIndex) return assert.equal(c.distractorSource[i], null);
    const named = ['people think it is X', 'people think it is Y'];
    assert.ok(named.includes(c.distractorSource[i]), `option "${text}" lost its misconception`);
  });
});

test('does not leave the correct answer in the same place every time', async () => {
  // Every live check came back with answerIndex 0, which makes the whole thing
  // guessable without reading. Position is ours to decide, not the model's.
  const seen = new Set();
  for (const id of ['k1', 'k2', 'k3', 'k4', 'k5', 'k6']) {
    const body = JSON.parse(CO_LOCATED);
    body.kcs[0].id = id; body.kcs[0].check.kc = id;
    body.clusters[0].kcs = [id]; body.capstoneRequires = [id];
    const spec = await decompose({ topic: 'x', goal: GOAL, capstone: CAPSTONE, llm: saying(JSON.stringify(body)) });
    seen.add(spec.kcs[0].check.answerIndex);
  }
  assert.ok(seen.size > 1, `the answer sat at index ${[...seen]} every time`);
});

test('still accepts a check already written as options and an answer index', async () => {
  const spec = await decompose({ topic: 'x', goal: GOAL, capstone: CAPSTONE, llm: saying(RESPONSE) });
  assert.equal(spec.kcs[0].check.options.length, 4);
  assert.equal(spec.kcs[0].check.answerIndex, 0);
});

test('never lets a check ask for more than its atom claims to teach', async () => {
  // Live: the model set an atom to "remember" and its check to "understand".
  // The atom's level is the claim; the check cannot outrun it.
  const body = JSON.parse(CO_LOCATED);
  body.kcs[0].level = 'remember';
  body.kcs[0].check.level = 'analyze';
  const spec = await decompose({ topic: 'x', goal: GOAL, capstone: CAPSTONE, llm: saying(JSON.stringify(body)) });
  assert.equal(spec.kcs[0].check.level, 'remember');
});
