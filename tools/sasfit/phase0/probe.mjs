// Phase 0 probe (throwaway): replay sasmodels kernel calls on the wasm builds.
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
  const nout = c.haveFq ? 2 : 1, nres = c.nq * nout + 4;
  const pD = ex.malloc(c.details.length * 4), pV = ex.malloc(c.values.length * 8);
  const pQ = ex.malloc(c.q.length * 8), pR = ex.malloc(nres * 8);
  new Int32Array(ex.memory.buffer, pD, c.details.length).set(c.details);
  new Float64Array(ex.memory.buffer, pV, c.values.length).set(c.values);
  new Float64Array(ex.memory.buffer, pQ, c.q.length).set(c.q);
  const fn = ex[`${c.model}_Iq`];
  for (let start = 0; start < c.numEval; start += 100) {
    fn(c.nq, start, Math.min(start + 100, c.numEval), pD, pV, pQ, pR, c.cutoff, c.reffMode);
  }
  const out = Array.from(new Float64Array(ex.memory.buffer, pR, nres));
  for (const p of [pD, pV, pQ, pR]) ex.free(p);
  return out;
}
function worst(got, want) {
  const maxRef = Math.max(...want.map(Math.abs));
  let ratio = 0, rel = 0;
  got.forEach((g, i) => {
    const d = Math.abs(g - want[i]);
    ratio = Math.max(ratio, d / (1e-9 * Math.abs(want[i]) + 1e-12 * maxRef));
    if (want[i] !== 0) rel = Math.max(rel, d / Math.abs(want[i]));
  });
  return { ratio, rel };
}
let ok = true;
for (const k of ref.cases) {
  for (const c of k.calls) {
    const got = runCall(await load(c.model), c);
    const w = worst(got, c.result);
    const pass = w.ratio <= 1 && got.every(Number.isFinite);
    ok &&= pass;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${k.label.padEnd(28)} kernel ${c.model.padEnd(20)} evals ${String(c.numEval).padStart(4)}  max rel ${w.rel.toExponential(2)}  tol-ratio ${w.ratio.toExponential(2)}`);
  }
  if (k.calls.length === 1) {   // plain P: I = scale/<V_shell> * <F^2> + background (spec 4.2)
    const c = k.calls[0], r = runCall(await load(c.model), c), nout = c.haveFq ? 2 : 1, n = c.nq * nout;
    const bkg = k.pars.background ?? 0.001;
    const tw = r[n] || 1, shell = (r[n + 2] / tw) || 1, scale = c.values[0];
    const I = Array.from({ length: c.nq }, (_, i) => scale / shell * (r[i * nout] / tw) + bkg);
    const w = worst(I, k.Iq); const pass = w.ratio <= 1; ok &&= pass;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${k.label.padEnd(28)} I(q) vs DirectModel${' '.repeat(22)}max rel ${w.rel.toExponential(2)}  tol-ratio ${w.ratio.toExponential(2)}`);
  }
}
// Benchmark: median of 20 after warm-up, 400 q points.
const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
for (const label of ['sphere_default', 'sphere_schulz_0.2_ns3', 'cylinder_2pd', 'core_shell_cylinder_2pd']) {
  const c0 = ref.cases.find((k) => k.label === label).calls[0];
  const q = Array.from({ length: 400 }, (_, i) => 10 ** (-3 + 3 * i / 399));
  const c = { ...c0, q, nq: 400 }, ex = await load(c.model), t = [];
  for (let i = 0; i < 25; i++) { const t0 = performance.now(); runCall(ex, c); if (i >= 5) t.push(performance.now() - t0); }
  console.log(`BENCH ${label.padEnd(28)} evals ${String(c.numEval).padStart(4)}  400 q  median ${med(t).toFixed(2)} ms`);
}
console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
