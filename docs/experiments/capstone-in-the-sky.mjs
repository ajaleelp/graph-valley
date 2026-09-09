/* If the capstone floats above the clouds instead of sitting in the world,
 * the summit stops pinning the revealed bounding box. How much does the view
 * actually shrink? */
import { build } from '../../world/build.js';
import { GRAPHS } from '../../world/graphs.js';
import { screenBox } from '../../world/iso.js';

const V = [1440, 810];
const statusOf = (n, done) => done.has(n.id) ? 'complete' : n.deps.every(d=>done.has(d)) ? 'available' : 'locked';

function revealed(world, done, pinSummit) {
  const nodes = world.graph.nodes;
  const byId = new Map(nodes.map(n=>[n.id,n]));
  const maxD = world.graph.maxDepth;
  const goals = new Set(nodes.filter(n=>n.depth===maxD).map(n=>n.id));
  const veil = new Map(nodes.map(n=>{
    if (statusOf(n,done)!=='locked') return [n.id,'clear'];
    if (goals.has(n.id)) return [n.id, pinSummit ? 'near' : 'far'];
    return [n.id, n.deps.some(d=>statusOf(byId.get(d),done)!=='locked') ? 'near':'far'];
  }));
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for (const s of world.slices) {
    let v='near';
    if (s.kind==='court') v=veil.get(s.id);
    else { const m=/^(.+?)>(.+?):/.exec(s.id); if(m){const R={far:0,near:1,clear:2};
      v = R[veil.get(m[1])]>=R[veil.get(m[2])]?veil.get(m[1]):veil.get(m[2]);} }
    if (v==='far') continue;
    for (const g of s.groups){const b=screenBox(g);
      x0=Math.min(x0,b.x0);x1=Math.max(x1,b.x1);y0=Math.min(y0,b.y0);y1=Math.max(y1,b.y1);}
  }
  const W=x1-x0,H=y1-y0,k=Math.min(V[0]/W,V[1]/H);
  return { area:W*H, fill:(W*k*H*k)/(V[0]*V[1]) };
}

console.log('world       step   pinned summit      capstone in the sky   view shrinks to');
for (const [name,g] of Object.entries(GRAPHS)) {
  const w = build(g);
  const order = w.graph.nodes.slice().sort((a,b)=>a.depth-b.depth);
  const total = revealed(w,new Set(),true).area;
  const done = new Set();
  for (let k=0;k<Math.min(3,order.length);k++){
    const a = revealed(w,done,true), b = revealed(w,done,false);
    console.log(`${name.padEnd(11)} ${k}      fill ${a.fill.toFixed(2)} (${Math.round(100*a.area/total)}%)   `
      + `fill ${b.fill.toFixed(2)} (${Math.round(100*b.area/total)}%)      ${Math.round(100*b.area/a.area)}% of before`);
    done.add(order[k].id);
  }
}
