import test from 'node:test';
import assert from 'node:assert/strict';

import { readModules, validateModules, planModules, modulePrompt } from './modules.mjs';

const mod = (id, over = {}) => ({
  id, title: `module ${id}`, outcome: `Do the ${id} thing`, level: 'understand', requires: [], ...over,
});

const plan = (...ms) => ({ modules: ms });

test('reads a well-formed plan', () => {
  const out = readModules(plan(mod('m1'), mod('m2', { requires: ['m1'] }), mod('m3', { requires: ['m2'] })));
  assert.equal(out.length, 3);
  assert.deepEqual(out[1].requires, ['m1']);
});

test('rejects a plan too short to be a journey', () => {
  assert.equal(readModules(plan(mod('m1'), mod('m2'))), null);
});

test('drops a module missing its outcome, rather than inventing one', () => {
  const out = readModules(plan(mod('m1'), mod('m2', { outcome: '' }), mod('m3'), mod('m4')));
  assert.deepEqual(out.map((m) => m.id), ['m1', 'm3', 'm4']);
});

test('drops requires that point forward — a plan is an order, not a web', () => {
  const out = readModules(plan(mod('m1', { requires: ['m3'] }), mod('m2'), mod('m3')));
  assert.deepEqual(out[0].requires, []);
});

test('drops a self-requirement', () => {
  const out = readModules(plan(mod('m1'), mod('m2', { requires: ['m2'] }), mod('m3')));
  assert.deepEqual(out[1].requires, []);
});

test('accepts a plan that branches', () => {
  const mods = readModules(plan(
    mod('m1'), mod('m2', { requires: ['m1'] }), mod('m3', { requires: ['m1'] }),
    mod('m4', { requires: ['m2', 'm3'], level: 'apply' }),
  ));
  assert.deepEqual(validateModules(mods, { goal: { level: 'apply' } }), []);
});

test('rejects a journey that never reaches the level the goal asked for', () => {
  const mods = readModules(plan(mod('m1'), mod('m2', { requires: ['m1'] }), mod('m3', { requires: ['m2'] })));
  const errs = validateModules(mods, { goal: { level: 'create' } });
  assert.equal(errs[0].code, 'journey-below-goal');
});

test('rejects a module nothing ever leads to', () => {
  const mods = [mod('m1'), mod('m2', { requires: ['m1'] }), mod('m3', { requires: ['mX'] })];
  const errs = validateModules(mods);
  assert.ok(errs.some((e) => e.code === 'dangling-requires'));
});

test('rejects filler chapter headings', () => {
  const mods = readModules(plan(mod('m1', { title: 'Introduction' }), mod('m2'), mod('m3')));
  const errs = validateModules(mods);
  assert.equal(errs[0].code, 'filler-module');
});

test('rejects a plan with nowhere to start', () => {
  const mods = [mod('m1', { requires: ['m2'] }), mod('m2', { requires: ['m1'] }), mod('m3', { requires: ['m1'] })];
  const errs = validateModules(mods);
  assert.ok(errs.some((e) => e.code === 'no-entry'));
});

test('the prompt names the level the last module must reach', () => {
  const p = modulePrompt({ topic: 't', goal: { statement: 'g', level: 'analyze' }, capstone: { prompt: 'c' } });
  assert.match(p, /LAST module must reach "analyze"/);
});

test('the prompt hands back the complaints on a retry', () => {
  const p = modulePrompt({
    topic: 't', goal: { statement: 'g' }, capstone: { prompt: 'c' },
    complaints: [{ code: 'filler-module', message: '"Introduction" is a chapter heading' }],
  });
  assert.match(p, /\[filler-module\]/);
});

test('planModules retries once with the complaints, then succeeds', async () => {
  const replies = [
    JSON.stringify(plan(mod('m1', { title: 'Introduction' }), mod('m2'), mod('m3'))),
    JSON.stringify(plan(mod('m1'), mod('m2', { requires: ['m1'] }), mod('m3', { requires: ['m2'] }))),
  ];
  const seen = [];
  const llm = async (_s, prompt) => { seen.push(prompt); return replies.shift(); };
  const out = await planModules({ topic: 't', goal: { statement: 'g' }, capstone: { prompt: 'c' }, llm });
  assert.equal(out.source, 'llm-retry');
  assert.equal(out.modules.length, 3);
  assert.match(seen[1], /filler-module/);
});

test('planModules gives up rather than returning a broken plan', async () => {
  const llm = async () => JSON.stringify(plan(mod('m1', { title: 'Introduction' }), mod('m2'), mod('m3')));
  assert.equal(await planModules({ topic: 't', goal: { statement: 'g' }, capstone: { prompt: 'c' }, llm }), null);
});

test('planModules survives an unreadable reply', async () => {
  const llm = async () => 'sorry, I cannot help with that';
  assert.equal(await planModules({ topic: 't', goal: { statement: 'g' }, capstone: { prompt: 'c' }, llm }), null);
});
