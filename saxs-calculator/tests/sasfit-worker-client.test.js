'use strict';
/**
 * sasfit-worker-client.js (main thread); design spec 3.3, 4.10 and plan M2
 * Task 5 with review section D.
 *
 * Node has no Worker, so the client is tested in layers:
 *   1. against a hand-driven fake Worker (the test feeds the replies) -- here,
 *      and in sasfit-worker-client-settle.test.js for the paths on which a
 *      promise could be left hanging;
 *   2. the Worker entry file run in a vm context: sasfit-worker-entry.test.js;
 *   3. client + the real SasFitWorkerCore behind a fake Worker that passes
 *      every message through structuredClone on a macrotask, with real wasm --
 *      here; this is what catches a protocol mismatch between the two sides.
 * A real browser Worker is exercised by tools/sasfit/smoke_browser.py.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SasFitEvaluate, SasFitWorkerCore, SasFitWorkerClient } = require('./load.js');
const { loadWasm } = require('./sasfit-helpers.js');
const {
    FIT_RESULT_FIELDS, G4, CLIENT_VERSION: VERSION, EVAL_Q: Q, caseOf, fitJob, evalRequest, fakeWorkers, rejection,
    directKernels, settle,
} = require('./sasfit-fit-helpers.js');

const JS_DIR = path.join(__dirname, '..', 'js');
const CASE_1 = caseOf('1 sphere');
const WORKER_URL = 'js/sasfit-worker.js?v=' + VERSION;

// ------------------------------------------------------------ 1. the client

test('module: frozen, loads without document, lists its error codes', () => {
    assert.equal(typeof document, 'undefined', 'this test file runs without a DOM');
    assert.ok(Object.isFrozen(SasFitWorkerClient));
    assert.equal(typeof SasFitWorkerClient.create, 'function');
    assert.equal(SasFitWorkerClient.WORKER_PATH, 'js/sasfit-worker.js');
    assert.ok(Object.isFrozen(SasFitWorkerClient.ERROR_CODES));
    assert.deepEqual([...SasFitWorkerClient.ERROR_CODES],
        ['SUPERSEDED', 'BUSY', 'STOPPED', 'WORKER_CRASH', 'WORKER_START_FAILED', 'DISPOSED', 'POST_FAILED']);
    assert.equal(SasFitWorkerClient.scriptVersion, null, 'no document.currentScript in Node');
});

test('create: the version is required (no currentScript in Node) and must be URL-safe; the client is frozen', () => {
    assert.throws(() => SasFitWorkerClient.create(), /version/);
    assert.throws(() => SasFitWorkerClient.create({ createWorker: () => ({}) }), /version/);
    for (const bad of ['', '5.2&x=1', '5 2', 52, null]) {
        assert.throws(() => SasFitWorkerClient.create({ createWorker: () => ({}), version: bad }), /version/, String(bad));
    }
    assert.throws(() => SasFitWorkerClient.create({ createWorker: 'Worker', version: VERSION }), /createWorker/);
    const { client, workers } = fakeWorkers();
    assert.ok(Object.isFrozen(client));
    assert.equal(client.version, VERSION);
    assert.equal(workers.length, 0, 'no Worker until the first request');
});

test('evaluate: posts the request, resolves on the matching curve; the Worker URL carries ?v=<version>', async () => {
    const { client, workers } = fakeWorkers();
    const request = evalRequest();
    const pending = client.evaluate(request);
    assert.equal(workers.length, 1);
    assert.equal(workers[0].url, WORKER_URL);
    assert.equal(workers[0].sent.length, 1);
    const sent = workers[0].sent[0];
    assert.deepEqual(Object.keys(sent).sort(), ['modelSpec', 'opts', 'params', 'q', 'reqId', 'type']);
    assert.equal(sent.type, 'evaluate');
    assert.equal(sent.reqId, 1);
    assert.equal(sent.q, Q);
    assert.deepEqual(sent.modelSpec, request.modelSpec);
    assert.deepEqual(sent.params, request.params);

    const I = Float64Array.from(Q, (q) => 1 / q);
    workers[0].reply({ type: 'curve', reqId: 1, I, extras: { radiusEffective: 3 } });
    const result = await pending;
    assert.equal(result.I, I);
    assert.deepEqual(result.extras, { radiusEffective: 3 });
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.extras));

    const second = client.evaluate(evalRequest({ opts: undefined }));
    assert.equal(workers.length, 1, 'the same worker is reused');
    assert.equal(workers[0].sent[1].reqId, 2, 'ids come from a per-client counter');
    workers[0].reply({ type: 'curve', reqId: 2, I, extras: {} });
    await second;
});

test('evaluate is latest-wins: the older request rejects with superseded, its late reply is ignored', async () => {
    const { client, workers } = fakeWorkers();
    const first = client.evaluate(evalRequest());
    const second = client.evaluate(evalRequest({ params: { radius: 60 } }));
    const err = await rejection(first);
    assert.equal(err.superseded, true);
    assert.equal(err.code, 'SUPERSEDED');
    assert.deepEqual(workers[0].sent.map((m) => m.reqId), [1, 2]);

    let settled = false;
    second.then(() => { settled = true; }, () => { settled = true; });
    workers[0].reply({ type: 'curve', reqId: 1, I: new Float64Array(1), extras: {} });      // stale
    workers[0].reply({ type: 'error', reqId: 1, code: 'BAD_PARAMS', message: '舊請求', detail: '' });   // stale
    await settle();
    assert.equal(settled, false, 'a stale reqId settles nothing');
    const I = new Float64Array(3);
    workers[0].reply({ type: 'curve', reqId: 2, I, extras: {} });
    assert.equal((await second).I, I);
});

test('evaluate: an error message rejects with an Error carrying code, the Chinese message and the detail', async () => {
    const { client, workers } = fakeWorkers();
    const pending = client.evaluate(evalRequest());
    workers[0].reply({ type: 'error', reqId: 1, code: 'UNKNOWN_MODEL', message: '找不到指定的模型。', detail: 'Unknown model: x' });
    const err = await rejection(pending);
    assert.equal(err.code, 'UNKNOWN_MODEL');
    assert.equal(err.message, '找不到指定的模型。');
    assert.equal(err.detail, 'Unknown model: x');
    assert.ok(!err.superseded);
});

test('fit: progress goes to onProgress, the result resolves frozen, ids are not shared with evaluate', async () => {
    const { client, workers } = fakeWorkers();
    const job = fitJob(CASE_1);
    const seen = [];
    const pending = client.fit(job, { onProgress: (p) => seen.push(p) });
    const sent = workers[0].sent[0];
    assert.deepEqual(Object.keys(sent).sort(),
        ['bounds', 'data', 'fitFlags', 'jobId', 'modelSpec', 'options', 'params', 'range', 'type', 'weighting']);
    assert.equal(sent.type, 'fit');
    assert.equal(sent.jobId, 1);
    assert.deepEqual(Object.keys(sent.data).sort(), ['I', 'kind', 'q', 'sigma']);
    assert.equal(sent.data.q, job.data.q);
    assert.equal(sent.weighting, 'sigma');
    assert.deepEqual(sent.bounds, job.bounds);

    workers[0].reply({ type: 'progress', jobId: 1, iteration: 1, chi2r: 9 });
    workers[0].reply({ type: 'progress', jobId: 99, iteration: 5, chi2r: 1 });   // not this job
    workers[0].reply({ type: 'progress', jobId: 1, iteration: 2, chi2r: 4 });
    assert.deepEqual(seen, [{ iteration: 1, chi2r: 9 }, { iteration: 2, chi2r: 4 }]);
    assert.ok(seen.every(Object.isFrozen));

    const fitResult = {
        params: { radius: 50 }, names: ['radius'], errors: { radius: 1 }, errorsScaled: { radius: 2 }, displayErrorsScaled: false,
        covariance: [[1]], correlation: [[1]], chi2: 4, chi2r: 4, dof: 1, iterations: 2, status: 'converged', atBound: {},
        illConditioned: false, blockedByNonFinite: false, jacobianNonFinite: false, nonFiniteCurvePoints: 0,
        curve: new Float64Array(2), residuals: new Float64Array(2),
        settings: { modelSpec: { model: 'sphere', structure: null, lowQPowerLaw: false }, range: { qMin: 0, qMax: 1 } },
    };
    workers[0].reply({ type: 'result', jobId: 1, fitResult });
    const result = await pending;
    assert.deepEqual(result, fitResult);
    for (const part of [result, result.params, result.errors, result.errorsScaled, result.atBound, result.settings,
        result.settings.modelSpec, result.settings.range, result.names, result.covariance, result.covariance[0],
        result.correlation]) assert.ok(Object.isFrozen(part));
    assert.ok(!Object.isFrozen(fitResult.covariance) && !Object.isFrozen(fitResult.covariance[0]), 'the message itself is left alone');

    // the next request of either kind gets the next id
    const next = client.evaluate(evalRequest());
    assert.equal(workers[0].sent[1].reqId, 2);
    workers[0].reply({ type: 'curve', reqId: 2, I: new Float64Array(1), extras: {} });
    await next;
    const again = client.fit(job);                         // onProgress may be left out
    assert.equal(workers[0].sent[2].jobId, 3);
    workers[0].reply({ type: 'progress', jobId: 3, iteration: 1, chi2r: 9 });
    workers[0].reply({ type: 'error', jobId: 3, code: 'TOO_FEW_POINTS', message: '資料點太少', detail: '2 points' });
    const err = await rejection(again);
    assert.deepEqual([err.code, err.message, err.detail], ['TOO_FEW_POINTS', '資料點太少', '2 points']);
});

test('fit while a fit is running rejects with BUSY and leaves the running fit alone', async () => {
    const { client, workers } = fakeWorkers();
    const running = client.fit(fitJob(CASE_1));
    const err = await rejection(client.fit(fitJob(CASE_1)));
    assert.equal(err.code, 'BUSY');
    assert.match(err.message, /[一-鿿]/);
    assert.equal(workers[0].sent.length, 1, 'the second job was not posted');
    workers[0].reply({ type: 'result', jobId: 1, fitResult: { status: 'converged', params: {}, settings: {} } });
    assert.equal((await running).status, 'converged');
    const after = client.fit(fitJob(CASE_1));               // free again
    assert.equal(workers[0].sent.length, 2);
    workers[0].reply({ type: 'result', jobId: 2, fitResult: { status: 'maxiter', params: {}, settings: {} } });
    assert.equal((await after).status, 'maxiter');
});

test('fit: a job the core would refuse outright is rejected before anything is posted', async () => {
    const { client, workers } = fakeWorkers();
    const err = await rejection(client.fit(fitJob(CASE_1, { weighting: 'poisson' })));
    assert.equal(err.code, 'BAD_WEIGHTING');
    assert.match(err.message, /[一-鿿]/);
    assert.equal((await rejection(client.fit(null))).code, 'BAD_MESSAGE');
    assert.equal((await rejection(client.fit(fitJob(CASE_1), { onProgress: 5 }))).code, 'BAD_MESSAGE');
    assert.equal((await rejection(client.evaluate(null))).code, 'BAD_MESSAGE');
    assert.equal(workers.length, 0);
    const ok = client.fit(fitJob(CASE_1));                  // a refused job does not leave the client busy
    assert.equal(workers[0].sent.length, 1);
    client.stop();
    await ok;
});

test('stop(): terminate, the fit resolves as the synthetic stopped result, evaluate rejects; the next request gets a fresh worker', async () => {
    const { client, workers } = fakeWorkers();
    const job = fitJob(CASE_1, { weighting: 'none' });
    const fit = client.fit(job);
    const evaluation = client.evaluate(evalRequest());
    workers[0].reply({ type: 'progress', jobId: 1, iteration: 1, chi2r: 9 });
    workers[0].reply({ type: 'progress', jobId: 1, iteration: 4, chi2r: 3 });
    client.stop();
    assert.equal(workers[0].terminated, 1);
    assert.equal(workers.length, 1, 'the replacement is started by the next request');

    const result = await fit;
    assert.deepEqual(Object.keys(result).sort(), [...FIT_RESULT_FIELDS].sort());
    assert.deepEqual(result, {
        status: 'stopped', params: job.params, names: [], errors: {}, errorsScaled: {}, displayErrorsScaled: true,
        covariance: [], correlation: [], chi2: null, chi2r: null, dof: null, iterations: 4, atBound: {},
        illConditioned: false, blockedByNonFinite: false, jacobianNonFinite: false, nonFiniteCurvePoints: 0,
        curve: null, residuals: null, settings: SasFitWorkerCore.settingsOf(job),
    });
    for (const part of [result.names, result.covariance, result.correlation]) assert.ok(Object.isFrozen(part));
    assert.notEqual(result.params, job.params, 'a copy: the caller\'s object is not frozen');
    assert.ok(!Object.isFrozen(job.params));
    for (const part of [result, result.params, result.errors, result.errorsScaled, result.atBound, result.settings,
        result.settings.modelSpec, result.settings.range]) assert.ok(Object.isFrozen(part));
    const err = await rejection(evaluation);
    assert.equal(err.code, 'STOPPED');
    assert.ok(!err.superseded);

    // late messages of the dead worker are ignored; the new worker serves the next requests
    workers[0].reply({ type: 'result', jobId: 1, fitResult: { status: 'converged' } });
    workers[0].onerror({ message: 'late' });
    assert.equal(workers.length, 1);
    const next = client.fit(fitJob(CASE_1));
    assert.equal(workers.length, 2);
    assert.equal(workers[1].url, WORKER_URL);
    assert.equal(workers[1].sent[0].jobId, 3);
    workers[1].reply({ type: 'result', jobId: 3, fitResult: { status: 'converged', params: {}, settings: {} } });
    assert.equal((await next).status, 'converged');
});

test('stop(): sigma weighting and no progress yet -> displayErrorsScaled false, iterations 0; idle stop is harmless', async () => {
    const { client, workers } = fakeWorkers();
    client.stop();                                          // nothing running, no worker yet
    assert.equal(workers.length, 0);
    const fit = client.fit(fitJob(CASE_1));
    client.stop();
    const result = await fit;
    assert.equal(result.status, 'stopped');
    assert.equal(result.displayErrorsScaled, false);
    assert.equal(result.iterations, 0);
    client.stop();                                          // idle: nothing to stop
    assert.equal(workers.length, 1);
    assert.deepEqual(workers.map((w) => w.terminated), [1]);
});

test('Worker onerror: pending requests reject with WORKER_CRASH, the worker is replaced, later requests work', async () => {
    const { client, workers } = fakeWorkers();
    const fit = client.fit(fitJob(CASE_1));
    const evaluation = client.evaluate(evalRequest());
    workers[0].onerror({ message: 'Uncaught RangeError: out of memory', filename: 'sasfit-worker.js', lineno: 3 });
    for (const pending of [fit, evaluation]) {
        const err = await rejection(pending);
        assert.equal(err.code, 'WORKER_CRASH');
        assert.match(err.message, /[一-鿿]/);
        assert.match(err.detail, /out of memory/);
    }
    assert.equal(workers[0].terminated, 1, 'the crashed worker is terminated');
    assert.equal(workers.length, 1, 'not respawned on its own: a script that cannot load would respawn for ever');

    const next = client.evaluate(evalRequest());
    assert.equal(workers.length, 2, 'the next request gets a new worker');
    assert.equal(workers[1].url, WORKER_URL);
    workers[1].reply({ type: 'curve', reqId: workers[1].sent[0].reqId, I: new Float64Array(1), extras: {} });
    await next;
    const fitAgain = client.fit(fitJob(CASE_1));            // not BUSY after the crash
    workers[1].onmessageerror({});                          // an undeserialisable message counts as a crash too
    assert.equal((await rejection(fitAgain)).code, 'WORKER_CRASH');
});

test('postMessage that throws: the request rejects with POST_FAILED and the client stays usable', async () => {
    const { client, workers } = fakeWorkers();
    const first = client.evaluate(evalRequest());
    workers[0].postMessage = () => { throw new Error('DataCloneError: could not be cloned'); };
    const err = await rejection(client.fit(fitJob(CASE_1)));
    assert.equal(err.code, 'POST_FAILED');
    assert.match(err.detail, /DataCloneError/);
    const evalErr = await rejection(client.evaluate(evalRequest()));
    assert.equal(evalErr.code, 'POST_FAILED');
    assert.equal((await rejection(first)).code, 'SUPERSEDED');
    workers[0].postMessage = (message) => { workers[0].sent.push(message); };
    const again = client.fit(fitJob(CASE_1));               // not BUSY
    client.stop();
    assert.equal((await again).status, 'stopped');
});

test('an error message without an id rejects everything pending; malformed messages are ignored', async () => {
    const { client, workers } = fakeWorkers();
    const fit = client.fit(fitJob(CASE_1));
    const evaluation = client.evaluate(evalRequest());
    workers[0].reply(null);
    workers[0].reply({ type: 'mystery' });
    workers[0].reply({ type: 'error', code: 'INTERNAL', message: '計算時發生未預期的錯誤。', detail: 'no id' });
    assert.equal((await rejection(fit)).code, 'INTERNAL');
    assert.equal((await rejection(evaluation)).code, 'INTERNAL');
});

test('dispose(): terminate without a new worker; pending and later requests reject with DISPOSED', async () => {
    const { client, workers } = fakeWorkers();
    const fit = client.fit(fitJob(CASE_1));
    const evaluation = client.evaluate(evalRequest());
    client.dispose();
    assert.equal(workers[0].terminated, 1);
    assert.equal(workers.length, 1);
    assert.equal((await rejection(fit)).code, 'DISPOSED');
    assert.equal((await rejection(evaluation)).code, 'DISPOSED');
    assert.equal((await rejection(client.evaluate(evalRequest()))).code, 'DISPOSED');
    assert.equal((await rejection(client.fit(fitJob(CASE_1)))).code, 'DISPOSED');
    client.stop();
    client.dispose();
    assert.equal(workers.length, 1);
    assert.equal(workers[0].terminated, 1);
});

test('the client does not modify what it is given', async () => {
    const { client, workers } = fakeWorkers();
    const job = fitJob(CASE_1);
    const request = evalRequest();
    const before = structuredClone([job, request]);
    const fit = client.fit(job, { onProgress: () => {} });
    const evaluation = client.evaluate(request);
    client.stop();
    await fit;
    await rejection(evaluation);
    assert.deepEqual([job, request], before);
    assert.ok(!Object.isFrozen(job) && !Object.isFrozen(job.params) && !Object.isFrozen(request.params));
    assert.equal(workers[0].sent.length, 2);
});

test('script version: read from document.currentScript.src at load time, and used for the default Worker URL', () => {
    const source = fs.readFileSync(path.join(JS_DIR, 'sasfit-worker-client.js'), 'utf8');
    const made = [];
    class FakeWorker {
        constructor(url) { made.push(url); }
        postMessage() {}
        terminate() {}
    }
    const load = (src) => {
        const sandbox = { URLSearchParams, Worker: FakeWorker, document: { currentScript: src === null ? null : { src } } };
        vm.createContext(sandbox);
        vm.runInContext(source, sandbox);
        sandbox.document.currentScript = null;              // as after the script has run
        return sandbox.SasFitWorkerClient;
    };
    const mod = load('https://example.org/saxs-calculator/js/sasfit-worker-client.js?v=7.31');
    assert.equal(mod.scriptVersion, '7.31');
    const client = mod.create();
    assert.equal(client.version, '7.31');
    client.evaluate(evalRequest()).catch(() => {});
    assert.deepEqual(made, ['js/sasfit-worker.js?v=7.31']);
    client.dispose();

    // A version with URL metacharacters: read decoded, and refused before it can reach a URL
    // (were it accepted, workerUrl() would encode it -- see the entry test for the Worker's side).
    const odd = load('https://example.org/js/sasfit-worker-client.js?v=5.2%26x%3D1');
    assert.equal(odd.scriptVersion, '5.2&x=1');
    assert.throws(() => odd.create(), /version/);
    assert.equal(made.length, 1, 'no Worker was created for it');
    // the first of several query parameters named v, whatever comes with it
    assert.equal(load('https://example.org/js/sasfit-worker-client.js?x=1&v=8.0&y=2').scriptVersion, '8.0');

    assert.equal(load('https://example.org/js/sasfit-worker-client.js').scriptVersion, null);
    assert.equal(load(null).scriptVersion, null);
    assert.throws(() => load('https://example.org/js/sasfit-worker-client.js').create(), /version/);
});

// ------------------------------------- 3. client + real core, end to end

/**
 * A Worker stand-in around the real SasFitWorkerCore: every message crosses
 * through structuredClone on its own macrotask in both directions, and
 * terminate() cuts both directions, as with a real Worker.
 */
function coreBackedWorkers() {
    const stats = { created: 0, loads: [], posted: [] };
    const createWorker = () => {
        stats.created += 1;
        const worker = { onmessage: null, onerror: null, onmessageerror: null, dead: false };
        const core = SasFitWorkerCore.create({
            loadWasm: (name) => { stats.loads.push(name); return Promise.resolve(loadWasm(name)); },
            yieldTask: () => new Promise((resolve) => setImmediate(resolve)),
            post: (message) => {
                const data = structuredClone(message);
                stats.posted.push(data.type);
                setImmediate(() => { if (!worker.dead) worker.onmessage({ data }); });
            },
        });
        worker.postMessage = (message) => {
            const data = structuredClone(message);
            setImmediate(() => { if (!worker.dead) core.handle(data); });
        };
        worker.terminate = () => { worker.dead = true; };
        return worker;
    };
    return { stats, client: SasFitWorkerClient.create({ createWorker, version: VERSION }) };
}

test('end to end: client.evaluate through the real core equals a direct evaluation; latest-wins holds on both sides', async () => {
    const { client, stats } = coreBackedWorkers();
    const spec = { model: 'sphere', structure: 'hayter_msa', lowQPowerLaw: true };
    const params = { radius: 35, volfraction: 0.08, lowq_scale: 1e-9, lowq_power: 3.5 };
    const result = await client.evaluate({ modelSpec: spec, params, q: Q, opts: { cutoff: 1e-5 } });
    const kernels = await directKernels(['sphere', 'hayter_msa']);
    const want = SasFitEvaluate.evaluate(spec, params, Q, { cutoff: 1e-5 }, kernels);
    assert.ok(result.I instanceof Float64Array);
    assert.deepEqual(Array.from(result.I), Array.from(want.I));
    assert.deepEqual(Array.from(result.extras.S), Array.from(want.extras.S));
    assert.equal(result.extras.radiusEffective, want.extras.radiusEffective);
    assert.deepEqual([...stats.loads].sort(), ['hayter_msa', 'sphere']);

    // three requests in one go: the client rejects the first two, the core computes only the third
    const curvesBefore = stats.posted.filter((type) => type === 'curve').length;
    const burst = [20, 30, 45].map((radius) => client.evaluate({ modelSpec: { model: 'sphere' }, params: { radius }, q: Q }));
    const [first, second, third] = await Promise.allSettled(burst);
    assert.equal(first.reason.superseded, true);
    assert.equal(second.reason.superseded, true);
    const direct = SasFitEvaluate.evaluate({ model: 'sphere' }, { radius: 45 }, Q, undefined, kernels).I;
    assert.deepEqual(Array.from(third.value.I), Array.from(direct));
    await settle();
    assert.equal(stats.posted.filter((type) => type === 'curve').length, curvesBefore + 1, 'the core answered once');

    // an error travels back with its code and Chinese message
    const err = await rejection(client.evaluate({ modelSpec: { model: 'sphere' }, params: { nonsense: 1 }, q: Q }));
    assert.equal(err.code, 'BAD_PARAMS');
    assert.match(err.message, /[一-鿿]/);
    assert.match(err.detail, /nonsense/);
    client.dispose();
});

test('end to end: client.fit through the real core reaches the bumps reference; stop() ends a queued fit', async () => {
    const { client, stats } = coreBackedWorkers();
    const progress = [];
    const job = fitJob(CASE_1);
    const result = await client.fit(job, { onProgress: (p) => progress.push(p) });
    assert.equal(result.status, 'converged');
    assert.ok(progress.length >= 2);
    assert.deepEqual(progress.map((p) => p.iteration), progress.map((_, i) => i + 1));
    assert.equal(progress[progress.length - 1].chi2r, result.chi2r);
    assert.equal(result.iterations, progress.length);
    for (const name of CASE_1.names) {
        const off = Math.abs(result.params[name] - CASE_1.ref.values[name]) / CASE_1.ref.stderr[name];
        assert.ok(off < G4.PARAM_SIGMA, name + ' off by ' + off + ' sigma');
        assert.ok(Math.abs(result.errors[name] - CASE_1.ref.stderr[name]) <= G4.STDERR_REL * CASE_1.ref.stderr[name], name);
    }
    assert.equal(result.params.sld, CASE_1.params.sld);
    assert.equal(result.curve.length, job.data.q.length);
    assert.ok(result.curve instanceof Float64Array && result.residuals instanceof Float64Array);
    assert.deepEqual(result.settings, SasFitWorkerCore.settingsOf(job));
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.params) && Object.isFrozen(result.settings));
    assert.equal(result.displayErrorsScaled, false);

    // a refused job: the code set by the core comes back through the client
    const few = await rejection(client.fit(fitJob(CASE_1, { range: { qMin: job.data.q[3], qMax: job.data.q[4] } })));
    assert.equal(few.code, 'TOO_FEW_POINTS');

    // stop before the worker gets to run the job: the synthetic result, then a working new worker
    const stopped = client.fit(job);
    client.stop();
    const out = await stopped;
    assert.equal(out.status, 'stopped');
    assert.deepEqual(Object.keys(out).sort(), Object.keys(result).sort(), 'the synthetic stopped result has the keys of a real one');
    assert.deepEqual(Object.keys(result).sort(), [...FIT_RESULT_FIELDS].sort());
    for (const part of [result.names, result.covariance, result.covariance[0], result.correlation, result.correlation[0]]) {
        assert.ok(Object.isFrozen(part), 'the arrays of a received result are frozen');
    }
    assert.deepEqual(out.params, job.params);
    assert.equal(stats.created, 1, 'stop() does not start the replacement');
    await settle();
    assert.equal(stats.posted.filter((type) => type === 'result').length, 1, 'the stopped job produced no result');
    const again = await client.fit(fitJob(caseOf('9a ')));
    assert.equal(again.status, 'converged');
    assert.equal(again.displayErrorsScaled, true);
    assert.equal(stats.created, 2, 'the fit after stop() started it');
    client.dispose();
});
