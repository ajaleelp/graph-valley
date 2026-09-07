import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toGraph } from './project.mjs';
import { assemble } from './build.mjs';
import { atom, cluster } from './fixture.mjs';

const SPEC = {
  topic: 'x',
  spine: 'concept',
  goal: { statement: 'do it', level: 'apply' },
  capstone: { prompt: 'prove it', requires: ['k3'], rubric: ['r'] },
  assumed: [],
  kcs: [
    atom('k1', { cluster: 'One' }),
    atom('k2', { cluster: 'One' }),
    atom('k3', { cluster: 'Two', requires: ['k1', 'k2'] }),
  ],
  clusters: [cluster('One', ['k1', 'k2']), cluster('Two', ['k3'])],
};

test('projects to exactly the shape the renderers already read', () => {
  const g = toGraph(assemble(SPEC, { budget: 3 }));
  assert.deepEqual(Object.keys(g).sort(), ['nodes', 'title']);
  for (const n of g.nodes) {
    assert.deepEqual(Object.keys(n).sort(), ['deps', 'goal', 'id', 'summary', 'title']);
    assert.equal(typeof n.summary, 'string');
  }
  assert.equal(g.nodes.filter((n) => n.goal).length, 1);
});

test('collapses two shared components into one dependency', () => {
  const g = toGraph(assemble(SPEC, { budget: 3 }));
  const summit = g.nodes.find((n) => n.goal);
  assert.deepEqual(summit.deps, ['p1'], 'k1 and k2 both come from p1 — one edge, not two');
});

test('the first platform depends on nothing', () => {
  const g = toGraph(assemble(SPEC, { budget: 3 }));
  assert.deepEqual(g.nodes[0].deps, []);
});
