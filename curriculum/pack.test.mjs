import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pack } from './pack.mjs';
import { validate } from './validate.mjs';
import { atom, cluster } from './fixture.mjs';

/** The walkthrough's eight atoms, in six clusters. */
function blackHoles() {
  return {
    topic: 'how black holes work',
    spine: 'concept',
    goal: { statement: 'explain why light cannot escape', level: 'understand' },
    capstone: { prompt: 'so what is a black hole?', requires: ['k8'], rubric: ['names the radius'] },
    assumed: [],
    kcs: [
      atom('k1', { cluster: 'Falling and escaping' }),
      atom('k2', { cluster: 'Falling and escaping' }),
      atom('k3', { cluster: 'What makes escape hard', requires: ['k1', 'k2'] }),
      atom('k4', { cluster: "Light's speed limit" }),
      atom('k5', { cluster: "Light's speed limit", requires: ['k4'] }),
      atom('k6', { cluster: 'The point of no return', requires: ['k3', 'k5'] }),
      atom('k7', { cluster: 'Squeeze it smaller', requires: ['k3'] }),
      atom('k8', { cluster: 'What a black hole is', requires: ['k6', 'k7'] }),
    ],
    clusters: [
      cluster('Falling and escaping', ['k1', 'k2']),
      cluster('What makes escape hard', ['k3']),
      cluster("Light's speed limit", ['k4', 'k5']),
      cluster('The point of no return', ['k6']),
      cluster('Squeeze it smaller', ['k7']),
      cluster('What a black hole is', ['k8']),
    ],
  };
}

test('each cluster becomes one platform when it fits the budget', () => {
  const { nodes, problems } = pack(blackHoles(), { budget: 3 });
  assert.deepEqual(problems, []);
  assert.equal(nodes.length, 6);
  assert.deepEqual(
    nodes.map((n) => n.title),
    ['Falling and escaping', 'What makes escape hard', "Light's speed limit",
     'The point of no return', 'Squeeze it smaller', 'What a black hole is'],
  );
  assert.deepEqual(nodes[0].teaches, ['k1', 'k2']);
  assert.deepEqual(nodes[2].teaches, ['k4', 'k5']);
});

test('splits a cluster that carries more than the budget allows', () => {
  const { nodes } = pack(blackHoles(), { budget: 1 });
  const first = nodes.filter((n) => n.teaches.includes('k1') || n.teaches.includes('k2'));
  assert.equal(first.length, 2, 'the two-atom cluster should split in two');
  assert.ok(first.every((n) => n.teaches.length === 1));
});

test('orders platforms so nothing needs what a later platform teaches', () => {
  const { nodes } = pack(blackHoles(), { budget: 3 });
  const taughtBy = new Map();
  nodes.forEach((n, i) => n.teaches.forEach((k) => taughtBy.set(k, i)));
  nodes.forEach((n, i) => {
    for (const k of n.requires) {
      assert.ok(taughtBy.get(k) < i, `${n.id} needs ${k}, taught at or after it`);
    }
  });
});

test('derives every edge from a component the two platforms share', () => {
  const { nodes, edges } = pack(blackHoles(), { budget: 3 });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  assert.ok(edges.length > 0);
  for (const e of edges) {
    assert.ok(byId.get(e.from).teaches.includes(e.via));
    assert.ok(byId.get(e.to).requires.includes(e.via));
  }
});

test('names exactly one summit, and it is the platform the capstone ends on', () => {
  const { nodes } = pack(blackHoles(), { budget: 3 });
  const goals = nodes.filter((n) => n.goal);
  assert.equal(goals.length, 1);
  assert.ok(goals[0].teaches.includes('k8'));
});

test('leaves out components the learner already has', () => {
  const { nodes } = pack(blackHoles(), { budget: 3, known: new Set(['k1', 'k2']) });
  assert.equal(nodes.length, 5, 'the platform that only taught k1 and k2 should be gone');
  assert.ok(!nodes.some((n) => n.teaches.includes('k1')));
  assert.ok(!nodes.some((n) => n.requires.includes('k1')), 'nothing should still be waiting on it');
});

test('produces a syllabus the validator accepts', () => {
  const spec = blackHoles();
  const packed = pack(spec, { budget: 3 });
  const r = validate({ ...spec, ...packed, budget: { newKcs: 3 } });
  assert.equal(r.ok, true, r.errors.map((e) => `${e.code}: ${e.message}`).join('\n'));
});

/** A skill: whole tasks of rising complexity, scaffolding falling away. */
function skill() {
  return {
    topic: 'conversational Japanese',
    spine: 'task',
    goal: { statement: 'hold a short exchange', level: 'apply' },
    capstone: { prompt: 'order something', requires: ['t5'], rubric: ['stays in Japanese'] },
    assumed: [],
    kcs: [
      atom('t1', { cluster: 'Greet someone', level: 'apply' }),
      atom('t2', { cluster: 'Greet someone', level: 'apply', requires: ['t1'] }),
      atom('t3', { cluster: 'Ask for a thing', level: 'apply', requires: ['t2'] }),
      atom('t4', { cluster: 'Ask for a thing', level: 'apply', requires: ['t3'] }),
      atom('t5', { cluster: 'Run the whole exchange', level: 'apply', requires: ['t4'] }),
    ],
    clusters: [
      cluster('Greet someone', ['t1', 't2']),
      cluster('Ask for a thing', ['t3', 't4']),
      cluster('Run the whole exchange', ['t5']),
    ],
  };
}

test('keeps a whole task on one platform when it fits the budget', () => {
  const { nodes } = pack(skill(), { budget: 3 });
  assert.equal(nodes.length, 3, 'three tasks should be three platforms, not six');
  assert.deepEqual(nodes[0].teaches, ['t1', 't2']);
});

test('lets scaffolding fall away as the tasks go on', () => {
  const { nodes } = pack(skill(), { budget: 3 });
  const scaffold = (n) => n.segments.find((s) => s.kind === 'apply').scaffold;
  assert.equal(scaffold(nodes[0]), 'full', 'the first whole task is worked through');
  assert.equal(scaffold(nodes[nodes.length - 1]), 'none', 'the last is performed unaided');
});

test('holds scaffolding steady on a concept spine', () => {
  const { nodes } = pack(blackHoles(), { budget: 3 });
  const scaffolds = new Set(nodes.map((n) => n.segments.find((s) => s.kind === 'apply').scaffold));
  assert.deepEqual([...scaffolds], ['partial']);
});

test('falls back to prerequisite order when the proposed grouping is circular', () => {
  // A live model grouped an acyclic chain into themes that wait on each other.
  // Honouring that grouping produces a valley with no way in, so the grouping
  // is what has to give — it is a hint, and the atoms are the fact.
  const spec = {
    topic: 'x', spine: 'concept',
    goal: { statement: 'do it', level: 'apply' },
    capstone: { prompt: 'prove it', requires: ['k4'], rubric: ['r'] },
    assumed: [],
    kcs: [atom('k1'), atom('k2', { requires: ['k1'] }), atom('k3', { requires: ['k2'] }), atom('k4', { requires: ['k3'] })],
    clusters: [cluster('Odd', ['k1', 'k3']), cluster('Even', ['k2', 'k4'])],
  };
  const { nodes } = pack(spec, { budget: 3 });

  const held = new Set();
  const walked = [];
  for (;;) {
    const next = nodes.find((n) => !walked.includes(n.id) && n.requires.every((k) => held.has(k)));
    if (!next) break;
    walked.push(next.id);
    next.teaches.forEach((k) => held.add(k));
  }
  assert.equal(walked.length, nodes.length, `stalled after ${walked.length}/${nodes.length} platforms`);
});

test('capitalises platform titles, which are labels the learner reads', () => {
  const spec = blackHoles();
  spec.clusters[0].title = 'falling and escaping';
  spec.kcs[0].cluster = 'falling and escaping';
  spec.kcs[1].cluster = 'falling and escaping';
  const { nodes } = pack(spec, { budget: 3 });
  assert.equal(nodes[0].title, 'Falling and escaping');
});

test('a split cluster names each half after what it teaches, not "(1)" and "(2)"', () => {
  const spec = {
    topic: 'the indian political system',
    spine: 'concept',
    goal: { statement: 'outline the system', level: 'understand' },
    capstone: { prompt: 'sketch it', requires: ['k4'], rubric: ['names the branches'] },
    assumed: [],
    kcs: [
      { ...atom('k1', { cluster: 'Structure' }), label: 'India is a parliamentary democracy' },
      { ...atom('k2', { cluster: 'Structure' }), label: 'the executive is led by the Prime Minister' },
      { ...atom('k3', { cluster: 'Structure' }), label: 'the judiciary is independent of the other two' },
      { ...atom('k4', { cluster: 'Structure', requires: ['k1'] }), label: 'Parliament has two houses' },
    ],
    clusters: [cluster('Structure', ['k1', 'k2', 'k3', 'k4'], 'how it is put together')],
  };
  const { nodes } = pack(spec, { budget: 3 });
  assert.ok(nodes.length > 1, 'four atoms at a budget of three must split');
  for (const n of nodes) {
    assert.doesNotMatch(n.title, /\(\d\)\s*$/, `"${n.title}" tells her nothing about which half it is`);
  }
  assert.equal(new Set(nodes.map((n) => n.title)).size, nodes.length,
    'both halves carrying the same name is the same problem with nicer words');
});
