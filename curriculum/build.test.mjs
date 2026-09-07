import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSyllabus, fallbackSpec } from './build.mjs';
import { validate } from './validate.mjs';

const GOAL = { statement: 'explain why light cannot escape', level: 'understand' };
const CAPSTONE = { prompt: 'so what is a black hole?', requires: ['k2'], rubric: ['names the radius'] };

function body(extra = []) {
  const mk = (id, requires, cluster) => {
    const m = `${id} is misunderstood`;
    return {
      id, label: `atom ${id}`, type: 'concept', cluster, level: 'understand', requires,
      misconceptions: [m],
      check: {
        kc: id, level: 'understand', kind: 'mcq', stem: `${id}?`,
        options: ['a', 'b', 'c', 'd'], answerIndex: 0, distractorSource: [null, m, m, m],
      },
    };
  };
  const kcs = [mk('k1', [], 'One'), mk('k2', ['k1'], 'Two'), ...extra.map((id) => mk(id, [], 'Spare'))];
  const clusters = [
    { title: 'One', summary: 's', kcs: ['k1'] },
    { title: 'Two', summary: 's', kcs: ['k2'] },
    ...(extra.length ? [{ title: 'Spare', summary: 's', kcs: extra }] : []),
  ];
  // The model declares what the capstone leans on, so a spare atom really is
  // scope creep rather than just another loose end.
  return JSON.stringify({ spine: 'concept', assumed: [], kcs, clusters, capstoneRequires: ['k2'] });
}

test('produces a validated syllabus when the model answers well', async () => {
  const r = await buildSyllabus({ topic: 'x', goal: GOAL, capstone: CAPSTONE, llm: async () => body() });
  assert.equal(r.source, 'llm');
  assert.equal(validate(r.doc).ok, true);
  assert.equal(r.doc.nodes.length, 2);
});

test('retries once with the complaints, and keeps the second attempt', async () => {
  const sent = [];
  const llm = async (_s, user) => { sent.push(user); return sent.length === 1 ? body(['k9']) : body(); };
  const r = await buildSyllabus({ topic: 'x', goal: GOAL, capstone: CAPSTONE, llm });

  assert.equal(sent.length, 2, 'should have asked twice');
  assert.match(sent[1], /kc-unused/, 'the retry must name what was wrong');
  assert.equal(r.source, 'llm-retry');
  assert.equal(validate(r.doc).ok, true);
});

test('falls back when both attempts fail, and the fallback is itself valid', async () => {
  const r = await buildSyllabus({ topic: 'x', goal: GOAL, capstone: CAPSTONE, llm: async () => 'nonsense' });
  assert.equal(r.source, 'fallback');
  const v = validate(r.doc);
  assert.equal(v.ok, true, v.errors.map((e) => `${e.code}: ${e.message}`).join('\n'));
});

test('the built-in generator alone produces a valid syllabus', async () => {
  const r = await buildSyllabus({ topic: 'sourdough', llm: null });
  assert.equal(r.source, 'fallback');
  assert.equal(validate(r.doc).ok, true);
  assert.ok(r.doc.nodes.length >= 3);
  assert.ok(fallbackSpec('sourdough').kcs.length >= 6);
});

test('phrases a default goal readably whatever case the topic arrives in', async () => {
  const { defaultGoalFor, defaultCapstoneFor } = await import('./build.mjs');
  assert.equal(
    defaultGoalFor('How black holes work').statement,
    'Explain how black holes work, well enough to walk someone through one real example.',
  );
  assert.equal(
    defaultGoalFor('Sourdough').statement,
    'Explain how sourdough works, well enough to walk someone through one real example.',
  );
  assert.match(defaultCapstoneFor('How black holes work').prompt, /one real example of black holes work/);
});

test('the built-in generator fills a valley worth walking', async () => {
  const r = await buildSyllabus({ topic: 'sourdough', llm: null });
  assert.ok(r.doc.nodes.length >= 4, `demo mode gave only ${r.doc.nodes.length} platforms`);
  assert.ok(r.doc.edges.length >= 3);
});
