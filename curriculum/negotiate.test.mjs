import { test } from 'node:test';
import assert from 'node:assert/strict';

import { negotiate, MAX_TURNS } from './negotiate.mjs';

const saying = (obj) => async () => (typeof obj === 'string' ? obj : JSON.stringify(obj));

const COMMITTED = {
  done: true,
  spine: 'concept',
  goal: { statement: 'Explain why light cannot escape a black hole.', level: 'understand', audience: 'curious adult' },
  capstone: { prompt: 'Tell a friend where the boundary sits and why.', rubric: ['names the radius'] },
  priors: ['escape velocity, vaguely'],
};

test('relays the question when the model wants one more answer', async () => {
  const r = await negotiate({ topic: 'black holes', turns: [], llm: saying({ ask: 'Maths, or no maths?' }) });
  assert.equal(r.done, false);
  assert.equal(r.ask, 'Maths, or no maths?');
});

test('commits once the model has a goal and a capstone', async () => {
  const r = await negotiate({ topic: 'black holes', turns: [{ text: 'no maths' }], llm: saying(COMMITTED) });
  assert.equal(r.done, true);
  assert.match(r.goal.statement, /light cannot escape/);
  assert.ok(r.capstone.prompt);
  assert.deepEqual(r.priors, ['escape velocity, vaguely']);
  assert.equal(r.spine, 'concept');
});

test('carries the skill spine through when the model reports one', async () => {
  const r = await negotiate({
    topic: 'conversational Japanese', turns: [{ text: 'for travel' }],
    llm: saying({ ...COMMITTED, spine: 'task' }),
  });
  assert.equal(r.spine, 'task');
});

test('commits anyway once the conversation has used up its turns', async () => {
  const turns = Array.from({ length: MAX_TURNS }, (_, i) => ({ text: `answer ${i}` }));
  const r = await negotiate({ topic: 'black holes', turns, llm: saying({ ask: 'and another thing?' }) });
  assert.equal(r.done, true, 'must not keep asking past the cap');
  assert.ok(r.goal.statement.length > 0);
  assert.ok(r.capstone.prompt.length > 0);
});

test('returns nothing when the model answers with something unusable', async () => {
  const r = await negotiate({ topic: 'black holes', turns: [], llm: saying('sorry') });
  assert.equal(r, null);
});
