import { test } from 'node:test';
import assert from 'node:assert/strict';

import { practicePrompt, lessonPrompt } from './lesson.mjs';
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

test('asks for a worked example, and refuses to set a task', () => {
  const p = lessonPrompt(DOC, summit);
  assert.match(p, /worked example/i);
  // The scaffold moved to practicePrompt when practice became its own
  // platform. A study platform that also sets an exercise asks her two
  // different questions in a row.
  assert.match(p, /do NOT set her a task/i);
  assert.doesNotMatch(p, /now you try/i);
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

/* --- practice: one question, and it is not arithmetic recall ------------ */

test('practice carries the scaffold that study gave up', () => {
  const p = practicePrompt(DOC, summit, { atoms: ['k1'] });
  assert.match(p, /stopped before|leave her|unaided/i);
});

test('practice puts the task in the check, never twice', () => {
  const p = practicePrompt(DOC, summit, { atoms: ['k1'] });
  assert.match(p, /Exactly 2 short paragraphs/);
  assert.match(p, /QUESTION BELOW is the\s+task/);
  assert.doesNotMatch(p, /stated as a question/);
});

test('practice refuses to work out the thing it is about to ask', () => {
  const p = practicePrompt(DOC, summit, { atoms: ['k1'] });
  assert.match(p, /Do NOT work out.*the thing the question asks/is);
});

test('practice will not test a number she can read off the page', () => {
  const p = practicePrompt(DOC, summit, { atoms: ['k1'] });
  assert.match(p, /Never ask her to repeat a number/i);
  assert.match(p, /Recalling a figure is not learning/i);
});

test('an "understand" atom is practised by explaining, not by calculating', () => {
  const doc = { ...DOC, kcs: [{ id: 'k1', label: 'why it happens', level: 'understand' }] };
  const p = practicePrompt(doc, summit, { atoms: ['k1'] });
  assert.match(p, /EXPLANATION or a\s+judgement/);
  assert.match(p, /Not a\s+calculation/);
});

test('an "apply" atom is practised by carrying out the method', () => {
  const doc = { ...DOC, kcs: [{ id: 'k1', label: 'do the thing', level: 'apply' }] };
  const p = practicePrompt(doc, summit, { atoms: ['k1'] });
  assert.match(p, /worked procedure is the right shape/);
});
