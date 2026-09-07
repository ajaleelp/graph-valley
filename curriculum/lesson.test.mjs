import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lessonPrompt } from './lesson.mjs';
import { assemble } from './build.mjs';
import { atom, cluster } from './fixture.mjs';

const DOC = assemble({
  topic: 'how black holes work',
  spine: 'concept',
  goal: { statement: 'explain why light cannot escape', level: 'understand' },
  capstone: { prompt: 'so what is a black hole?', requires: ['k3'], rubric: ['names the radius'] },
  assumed: [],
  kcs: [
    atom('k1', { cluster: 'Escaping' }, { label: 'escape velocity rises with mass' }),
    atom('k2', { cluster: 'Light', }, { label: 'light has a top speed' }),
    atom('k3', { cluster: 'The horizon', requires: ['k1', 'k2'] }, {
      label: 'where escape velocity reaches light speed, nothing gets out',
      misconceptions: ['the boundary is a solid surface'],
    }),
  ],
  clusters: [cluster('Escaping', ['k1']), cluster('Light', ['k2']), cluster('The horizon', ['k3'])],
}, { budget: 3 });

const summit = DOC.nodes.find((n) => n.teaches.includes('k3'));

test('names the atom this platform teaches, and only that one', () => {
  const p = lessonPrompt(DOC, summit);
  assert.match(p, /where escape velocity reaches light speed/);
  assert.doesNotMatch(p, /Teach: .*light has a top speed/);
});

test('names the atoms to reactivate, so the lesson opens by recalling them', () => {
  const p = lessonPrompt(DOC, summit);
  assert.match(p, /escape velocity rises with mass/);
  assert.match(p, /light has a top speed/);
});

test('carries the misconceptions through, so the lesson can pre-empt them', () => {
  assert.match(lessonPrompt(DOC, summit), /the boundary is a solid surface/);
});

test('names the summit, so the lesson can say why this step matters', () => {
  assert.match(lessonPrompt(DOC, summit), /explain why light cannot escape/);
});

test('asks for a worked example and the scaffold the platform calls for', () => {
  const p = lessonPrompt(DOC, summit);
  assert.match(p, /worked example/i);
  assert.match(p, /partial/);
});

test('falls back to title and summary when the platform is unknown', () => {
  const p = lessonPrompt(null, null, { topic: 'sourdough', title: 'Starters', summary: 'wild yeast' });
  assert.match(p, /sourdough/);
  assert.match(p, /Starters/);
  assert.match(p, /wild yeast/);
});

/* --- reading the model's reply ---------------------------------------- */

test('accepts prose alone, because the check comes from the syllabus', async () => {
  const { readLesson } = await import('./lesson.mjs');
  // The prompt tells the model not to write a quiz. Demanding one back
  // rejected every well-formed reply and sent every lesson to the fallback.
  const l = readLesson({ content: ['one', 'two'] });
  assert.deepEqual(l.content, ['one', 'two']);
  assert.equal(l.check, undefined);
});

test('keeps a check when the model volunteers a well-formed one', async () => {
  const { readLesson } = await import('./lesson.mjs');
  const l = readLesson({
    content: ['one'],
    check: { question: 'q?', options: ['a', 'b', 'c', 'd'], answerIndex: 2, explanation: 'because' },
  });
  assert.equal(l.check.answerIndex, 2);
});

test('rejects a reply with no prose at all', async () => {
  const { readLesson } = await import('./lesson.mjs');
  assert.equal(readLesson({ content: [] }), null);
  assert.equal(readLesson(null), null);
});

test('drops a half-written check rather than showing it', async () => {
  const { readLesson } = await import('./lesson.mjs');
  const l = readLesson({ content: ['one'], check: { question: 'q?', options: ['a', 'b'] } });
  assert.deepEqual(l.content, ['one']);
  assert.equal(l.check, undefined);
});
