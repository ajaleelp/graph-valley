import test from 'node:test';
import assert from 'node:assert/strict';

import { toStages, remediationFor, stagesToGraph, STAGES } from './stages.mjs';
import { kc, check, node } from './fixture.mjs';

/* A module: three atoms in one group, two in another, with k1 required from
 * an earlier module. */
function doc(over = {}) {
  return {
    topic: 'a module',
    goal: { statement: 'Do the thing', level: 'apply' },
    kcs: [
      kc('k0'), kc('k1'), kc('k2'), kc('k3'), kc('k4'),
    ].map((k) => ({ ...k, check: check(k.id, 'understand') })),
    nodes: [
      node('n1', { teaches: ['k1', 'k2'], requires: ['k0'] }),
      node('n2', { teaches: ['k3', 'k4'], requires: [] }),
    ],
    ...over,
  };
}

test('a module becomes recall, study/practice pairs, and prove', () => {
  const s = toStages(doc());
  assert.deepEqual(s.map((x) => x.stage),
    ['recall', 'study', 'practice', 'study', 'practice', 'prove']);
});

test('every stage is one of the four', () => {
  for (const x of toStages(doc())) assert.ok(STAGES.includes(x.stage));
});

test('recall names what the module needs from earlier, and teaches nothing', () => {
  const r = toStages(doc()).find((s) => s.stage === 'recall');
  assert.deepEqual(r.recalls, ['k0']);
  assert.deepEqual(r.teaches, []);
});

test('no recall platform when nothing precedes the module', () => {
  const d = doc();
  d.nodes = [node('n1', { teaches: ['k1', 'k2'], requires: [] })];
  const s = toStages(d);
  assert.equal(s.some((x) => x.stage === 'recall'), false,
    'an empty warm-up is the filler this design removes');
  assert.deepEqual(s[0].deps, []);
});

test('study introduces the atoms; practice introduces none', () => {
  const s = toStages(doc());
  const study = s.filter((x) => x.stage === 'study');
  const practice = s.filter((x) => x.stage === 'practice');
  assert.deepEqual(study.flatMap((x) => x.teaches), ['k1', 'k2', 'k3', 'k4']);
  for (const p of practice) assert.deepEqual(p.teaches, []);
});

test('each practice follows its own study, not the other pair', () => {
  const s = toStages(doc());
  const p1 = s.find((x) => x.id === 's-practice-1');
  assert.deepEqual(p1.deps, ['s-study-1']);
});

test('the pairs do not depend on each other, so the level forks', () => {
  const s = toStages(doc());
  const studies = s.filter((x) => x.stage === 'study');
  assert.equal(studies.length, 2);
  // both hang off the same entry, neither off the other
  assert.deepEqual(studies[0].deps, studies[1].deps);
  assert.equal(studies[1].deps.includes(studies[0].id), false);
});

test('prove waits for every practice, and joins the fork', () => {
  const s = toStages(doc());
  const prove = s.find((x) => x.stage === 'prove');
  assert.deepEqual(prove.deps.sort(), ['s-practice-1', 's-practice-2']);
});

test('prove retrieves everything the module taught', () => {
  const prove = toStages(doc()).find((s) => s.stage === 'prove');
  assert.deepEqual(prove.retrieves, ['k1', 'k2', 'k3', 'k4']);
  assert.equal(prove.checks.length, 4);
});

test('prove is the summit of its module', () => {
  const s = toStages(doc());
  assert.equal(s.filter((x) => x.goal).length, 1);
  assert.equal(s.find((x) => x.goal).stage, 'prove');
});

test('a missed atom sends her back down to the practice that drilled it', () => {
  const s = toStages(doc());
  assert.equal(remediationFor(s, 'k3'), 's-practice-2');
  assert.equal(remediationFor(s, 'k1'), 's-practice-1');
});

test('remediation falls back to study when an atom was never practised', () => {
  const s = toStages(doc()).filter((x) => x.stage !== 'practice');
  assert.equal(remediationFor(s, 'k1'), 's-study-1');
});

test('an atom nobody teaches has nowhere to send her, and says so', () => {
  assert.equal(remediationFor(toStages(doc()), 'nope'), null);
});

test('the graph handed to the renderer is the old shape, plus the stage', () => {
  const g = stagesToGraph(toStages(doc()), 'A module');
  assert.equal(g.title, 'A module');
  for (const n of g.nodes) {
    assert.ok(typeof n.id === 'string' && typeof n.title === 'string');
    assert.ok(Array.isArray(n.deps));
    assert.ok(STAGES.includes(n.stage));
  }
});

test('the graph is acyclic and has exactly one way in', () => {
  const g = stagesToGraph(toStages(doc()), 't');
  const roots = g.nodes.filter((n) => !n.deps.length);
  assert.equal(roots.length, 1);
  const seen = new Set();
  const walk = (id, path) => {
    assert.equal(path.includes(id), false, `cycle through ${id}`);
    seen.add(id);
    for (const m of g.nodes.filter((n) => n.deps.includes(id))) walk(m.id, [...path, id]);
  };
  walk(roots[0].id, []);
  assert.equal(seen.size, g.nodes.length, 'every stage is reachable');
});

test('a module of one group is a straight climb, not a fork', () => {
  const d = doc();
  d.nodes = [node('n1', { teaches: ['k1'], requires: ['k0'] })];
  const s = toStages(d);
  assert.deepEqual(s.map((x) => x.stage), ['recall', 'study', 'practice', 'prove']);
});
