/* Sample concept graphs. Each is a small DAG: prerequisites -> concepts -> goal.
 * The point of the POC is that nothing here knows anything about geometry. */

export const GRAPHS = {
  chain: {
    name: 'A straight run',
    nodes: [
      { id: 'n1', title: 'Sets', deps: [] },
      { id: 'n2', title: 'Functions', deps: ['n1'] },
      { id: 'n3', title: 'Limits', deps: ['n2'] },
      { id: 'n4', title: 'Derivatives', deps: ['n3'] },
    ],
  },

  diamond: {
    name: 'A fork that rejoins',
    nodes: [
      { id: 'sig', title: 'Signals', deps: [] },
      { id: 'sin', title: 'Sinusoids', deps: ['sig'] },
      { id: 'cpx', title: 'Complex numbers', deps: ['sig'] },
      { id: 'eul', title: "Euler's formula", deps: ['sin', 'cpx'] },
      { id: 'ft', title: 'Fourier transform', deps: ['eul'] },
    ],
  },

  branching: {
    name: 'Two roots, one summit',
    nodes: [
      { id: 'lin', title: 'Linear algebra', deps: [] },
      { id: 'prob', title: 'Probability', deps: [] },
      { id: 'opt', title: 'Optimisation', deps: ['lin'] },
      { id: 'stat', title: 'Statistics', deps: ['prob'] },
      { id: 'reg', title: 'Regression', deps: ['opt', 'stat'] },
      { id: 'nn', title: 'Neural networks', deps: ['reg'] },
      { id: 'bp', title: 'Backpropagation', deps: ['nn', 'opt'] },
    ],
  },

  wide: {
    name: 'A broad layer',
    nodes: [
      { id: 'a', title: 'Atoms', deps: [] },
      { id: 'b', title: 'Bonds', deps: ['a'] },
      { id: 'c', title: 'Orbitals', deps: ['a'] },
      { id: 'd', title: 'Molecules', deps: ['a'] },
      { id: 'e', title: 'Reactions', deps: ['b', 'd'] },
      { id: 'f', title: 'Spectroscopy', deps: ['c'] },
      { id: 'g', title: 'Kinetics', deps: ['e'] },
      { id: 'h', title: 'Synthesis', deps: ['g', 'f'] },
    ],
  },

  deep: {
    name: 'Six floors',
    nodes: [
      { id: 'p0', title: 'Bytes', deps: [] },
      { id: 'p1', title: 'Types', deps: ['p0'] },
      { id: 'p2', title: 'Structs', deps: ['p1'] },
      { id: 'p3', title: 'Pointers', deps: ['p1'] },
      { id: 'p4', title: 'Allocation', deps: ['p2', 'p3'] },
      { id: 'p5', title: 'Ownership', deps: ['p4'] },
      { id: 'p6', title: 'Lifetimes', deps: ['p5'] },
      { id: 'p7', title: 'Concurrency', deps: ['p5', 'p3'] },
      { id: 'p8', title: 'Async runtimes', deps: ['p6', 'p7'] },
    ],
  },
  /* Cross-linked enough that the routes cannot all be drawn in the plane: this
   * is the one that exercises the crossing slice. */
  tangled: {
    name: 'Paths that must cross',
    nodes: [
      { id: 'gram', title: 'Grammar', deps: [] },
      { id: 'vocab', title: 'Vocabulary', deps: ['gram'] },
      { id: 'read', title: 'Reading', deps: ['vocab', 'gram'] },
      { id: 'listen', title: 'Listening', deps: ['gram'] },
      { id: 'speak', title: 'Speaking', deps: ['listen', 'read'] },
      { id: 'write', title: 'Writing', deps: ['listen', 'read'] },
      { id: 'idiom', title: 'Idiom', deps: ['listen', 'gram'] },
      { id: 'humour', title: 'Humour', deps: ['idiom', 'gram'] },
      { id: 'fluency', title: 'Fluency', deps: ['gram', 'speak', 'write', 'humour'] },
    ],
  },
};

/* Random DAGs, for stress-testing the stitcher over shapes nobody authored. */
export function randomGraph(seed, n = 8) {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const deps = [];
    if (i > 0) {
      const k = 1 + Math.floor(rnd() * Math.min(2, i));
      while (deps.length < k) {
        const p = `r${Math.floor(rnd() * i)}`;
        if (!deps.includes(p)) deps.push(p);
      }
    }
    nodes.push({ id: `r${i}`, title: `Node ${i}`, deps });
  }
  return { name: `random ${seed}`, nodes };
}
