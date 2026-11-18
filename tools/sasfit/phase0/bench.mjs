// Phase 0 wasm benchmark; median of 20 after 5 warm-ups. Usage: node bench.mjs phase0-ref.json
import fs from 'node:fs';
const ref = JSON.parse(fs.readFileSync(process.argv[2]));
const WASM = new URL('../../../saxs-calculator/wasm/', import.meta.url);
const cache = new Map();
async function load(name) {
  if (!cache.has(name)) {
    const bytes = fs.readFileSync(new URL(`sas-${name}.wasm`, WASM));
    const { instance } = await WebAssembly.instantiate(bytes, { env: { emscripten_notify_memory_growth() {} } });
    instance.exports._initialize();
    cache.set(name, instance.exports);
  }
  return cache.get(name);
}
function runCall(ex, c) {
  const nres = c.nq * (c.haveFq ? 2 : 1) + 4;
  const ptrs = [ex.malloc(c.details.length * 4), ex.malloc(c.values.length * 8), ex.malloc(c.q.length * 8), ex.malloc(nres * 8)];
  const [pD, pV, pQ, pR] = ptrs;
  new Int32Array(ex.memory.buffer, pD, c.details.length).set(c.details);
  new Float64Array(ex.memory.buffer, pV, c.values.length).set(c.values);
  new Float64Array(ex.memory.buffer, pQ, c.q.length).set(c.q);
  const fn = ex[`${c.model}_Iq`];
  for (let s = 0; s < c.numEval; s += 100) fn(c.nq, s, Math.min(s + 100, c.numEval), pD, pV, pQ, pR, c.cutoff, c.reffMode);
  ptrs.forEach((p) => ex.free(p));
}
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const qs = (n) => Array.from({ length: n }, (_, i) => 10 ** (-3 + 3 * i / (n - 1)));
const BENCH = [
  ['sphere_default', 400], ['sphere_schulz_0.2_ns3', 400], ['cylinder_2pd', 400], ['core_shell_cylinder_2pd', 400],
  ['core_shell_cylinder_2pd', 100], ['core_shell_cylinder_2pd_n15', 400], ['core_shell_cylinder_1pd_n35', 400],
];
for (const [label, nq] of BENCH) {
  const k = ref.cases.find((x) => x.label === label);
  if (!k) { console.error(`missing ref case ${label}`); process.exit(1); }
  const c = { ...k.calls[0], q: qs(nq), nq }, ex = await load(c.model), t = [];
  for (let i = 0; i < 25; i++) { const t0 = performance.now(); runCall(ex, c); if (i >= 5) t.push(performance.now() - t0); }
  console.log(`WASM ${label.padEnd(32)} ${String(nq).padStart(4)} q  evals ${String(c.numEval).padStart(4)}  median ${med(t).toFixed(3)} ms`);
}
