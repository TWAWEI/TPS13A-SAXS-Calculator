'use strict';
/**
 * js/sasfit-worker.js, the Worker entry (design spec 3.3, 4.10): run in a vm
 * context that looks like a Worker global, whose importScripts executes the
 * real module files and whose fetch serves the real .wasm files. What is
 * proven here by behaviour (and therefore not by reading the source in
 * structure.test.js): every importScripts and wasm URL carries the ?v= of the
 * Worker's own URL, URL-encoded; without a v no query is added; only C models
 * of SasFitMeta ever reach a wasm URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SasFitEvaluate } = require('./load.js');
const { loadWasm, WORKER_MODULES } = require('./sasfit-helpers.js');
const { CLIENT_VERSION: VERSION, EVAL_Q: Q, directKernels } = require('./sasfit-fit-helpers.js');

const JS_DIR = path.join(__dirname, '..', 'js');

/**
 * Run js/sasfit-worker.js in a fresh context that looks like a Worker global:
 * importScripts executes the real module files, fetch serves the real wasm.
 */
function runWorkerEntry(search, options) {
    const opts = options || {};
    const log = { imports: [], fetches: [], posts: [], errors: [], timers: 0 };
    const waiting = [];
    const sandbox = {
        URLSearchParams,
        console: { error: (...args) => { log.errors.push(args); } },
        location: { search },
        setTimeout: (fn, ms) => { log.timers += 1; return setTimeout(fn, ms); },
        postMessage: (message) => {
            log.posts.push(message);
            waiting.splice(0).forEach((resolve) => resolve(message));
        },
        importScripts: (...urls) => {
            urls.forEach((url) => {
                log.imports.push(url);
                const file = url.split('?')[0];
                if (file === opts.failImport) throw new Error('NetworkError: failed to load ' + url);
                assert.match(file, /^sasfit-[a-z-]+\.js$/, 'importScripts URL is relative to the worker script: ' + url);
                vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), sandbox, { filename: file });
            });
            // record what the entry hands to the core (loadWasm, post, yieldTask); the core itself is the real one
            const real = sandbox.SasFitWorkerCore;
            sandbox.SasFitWorkerCore = Object.assign({}, real, {
                create: (deps) => { log.deps = deps; return real.create(deps); },
            });
        },
        fetch: (url) => {
            log.fetches.push(url);
            const status = opts.status || 200;
            const name = /^\.\.\/wasm\/sas-([a-z_]+)\.wasm/.exec(url);
            assert.ok(name, 'wasm URL is relative to the worker script: ' + url);
            return Promise.resolve({
                ok: status >= 200 && status < 300, status, url,
                arrayBuffer: () => Promise.resolve(loadWasm(name[1])),
            });
        },
    };
    sandbox.self = sandbox;
    if (opts.onLog) opts.onLog({ log });
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, 'sasfit-worker.js'), 'utf8'), sandbox, { filename: 'sasfit-worker.js' });
    /** Deliver a message built inside the context (typed arrays must belong to its realm). */
    const deliver = (message) => {
        sandbox.__incoming = JSON.stringify(message);
        const data = vm.runInContext('(() => { const m = JSON.parse(__incoming); if (m.q) m.q = Float64Array.from(m.q); return m; })()', sandbox);
        return sandbox.onmessage({ data });
    };
    /** The next message the worker posts (event-driven: resolved by postMessage itself, no polling). */
    const nextPost = () => new Promise((resolve) => { waiting.push(resolve); });
    return { sandbox, log, deliver, nextPost };
}

test('worker entry: importScripts the module list with ?v=, fetches versioned wasm, answers an evaluate', async () => {
    const w = runWorkerEntry('?v=' + VERSION);
    assert.deepEqual(w.log.imports, WORKER_MODULES.map((file) => file + '?v=' + VERSION));
    assert.equal(typeof w.sandbox.onmessage, 'function');
    assert.deepEqual(w.log.fetches, [], 'no wasm is fetched before it is needed');

    w.deliver({ type: 'evaluate', reqId: 1, modelSpec: { model: 'sphere', structure: 'hardsphere' }, params: {}, q: Array.from(Q) });
    const curve = await w.nextPost();
    assert.equal(curve.type, 'curve', JSON.stringify(curve).slice(0, 300));
    assert.equal(curve.reqId, 1);
    assert.deepEqual([...w.log.fetches].sort(),
        ['../wasm/sas-hardsphere.wasm?v=' + VERSION, '../wasm/sas-sphere.wasm?v=' + VERSION]);
    assert.ok(w.log.timers >= 1, 'yieldTask goes through setTimeout (a later task)');
    const kernels = await directKernels(['sphere', 'hardsphere']);
    const want = SasFitEvaluate.evaluate({ model: 'sphere', structure: 'hardsphere' }, {}, Q, { cutoff: 1e-5 }, kernels).I;
    assert.deepEqual(Array.from(curve.I), Array.from(want));

    w.deliver({ type: 'evaluate', reqId: 2, modelSpec: { model: 'sphere' }, params: {}, q: Array.from(Q) });
    await w.nextPost();
    assert.equal(w.log.fetches.length, 2, 'each wasm is fetched once');
});

test('worker entry: without ?v= it still works and adds no query; an odd version is URL-encoded', async () => {
    for (const search of ['', '?other=1', '?v=']) {
        const w = runWorkerEntry(search);
        assert.deepEqual(w.log.imports, [...WORKER_MODULES], 'search ' + JSON.stringify(search));
        w.deliver({ type: 'evaluate', reqId: 1, modelSpec: { model: 'sphere' }, params: {}, q: Array.from(Q) });
        assert.equal((await w.nextPost()).type, 'curve');
        assert.deepEqual(w.log.fetches, ['../wasm/sas-sphere.wasm']);
    }
    const odd = runWorkerEntry('?v=' + encodeURIComponent('5.2&x=../'));
    assert.deepEqual(odd.log.imports, WORKER_MODULES.map((file) => file + '?v=5.2%26x%3D..%2F'));
    odd.deliver({ type: 'evaluate', reqId: 1, modelSpec: { model: 'sphere' }, params: {}, q: Array.from(Q) });
    assert.equal((await odd.nextPost()).type, 'curve');
    assert.deepEqual(odd.log.fetches, ['../wasm/sas-sphere.wasm?v=5.2%26x%3D..%2F'], 'the wasm URL carries the same encoded version');
});

test('worker entry: a non-2xx wasm response becomes WASM_LOAD with the status in the detail', async () => {
    const w = runWorkerEntry('?v=' + VERSION, { status: 404 });
    w.deliver({ type: 'evaluate', reqId: 5, modelSpec: { model: 'sphere' }, params: {}, q: Array.from(Q) });
    const err = await w.nextPost();
    assert.deepEqual([err.type, err.code, err.reqId], ['error', 'WASM_LOAD', 5]);
    assert.match(err.detail, /404/);
});

test('worker entry: only C models of SasFitMeta ever reach a wasm URL; yieldTask is a later task', async () => {
    const w = runWorkerEntry('?v=' + VERSION);
    const { loadWasm: entryLoadWasm, yieldTask, post, onFatal } = w.log.deps;
    const lost = new Error('DataCloneError');
    onFatal(lost);
    assert.equal(w.log.errors.length, 1, 'onFatal reports through console.error');
    assert.equal(w.log.errors[0][w.log.errors[0].length - 1], lost);
    for (const name of ['../../secret', 'constructor', '__proto__', 'toString', 'sphere?x=1', '', 'power_law', 'guinier_porod', undefined]) {
        await assert.rejects(Promise.resolve().then(() => entryLoadWasm(name)), /model/, String(name));
    }
    assert.deepEqual(w.log.fetches, [], 'nothing was fetched for a name that is not a C model');
    const bytes = await entryLoadWasm('cylinder');
    assert.ok(bytes.byteLength > 1000);
    assert.deepEqual(w.log.fetches, ['../wasm/sas-cylinder.wasm?v=' + VERSION]);

    let resolved = false;
    const yielded = yieldTask().then(() => { resolved = true; });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(resolved, false, 'not resolved in a microtask');
    await yielded;
    assert.equal(w.log.timers, 1);
    post({ type: 'probe' });
    assert.deepEqual(w.log.posts, [{ type: 'probe' }]);
});

test('worker entry: importScripts failing -> one error message WORKER_START_FAILED with the cause, then the exception goes on', () => {
    let thrown = null;
    let log = null;
    try {
        runWorkerEntry('?v=' + VERSION, { failImport: 'sasfit-linalg.js', onLog: (entry) => { log = entry.log; } });
    } catch (err) {
        thrown = err;
    }
    assert.ok(thrown, 'the entry script still fails (the client gets the error event as well)');
    assert.match(thrown.message, /failed to load sasfit-linalg\.js\?v=9\.87/);
    assert.equal(log.posts.length, 1);
    assert.deepEqual(Object.keys(log.posts[0]).sort(), ['code', 'detail', 'type']);
    assert.deepEqual([log.posts[0].type, log.posts[0].code], ['error', 'WORKER_START_FAILED']);
    assert.match(log.posts[0].detail, /importScripts/);
    assert.match(log.posts[0].detail, /failed to load sasfit-linalg\.js/);
});

test('worker entry: a message that cannot be deserialised (messageerror) is answered with BAD_MESSAGE', () => {
    const w = runWorkerEntry('?v=' + VERSION);
    assert.equal(typeof w.sandbox.onmessageerror, 'function');
    w.sandbox.onmessageerror({ data: null });
    assert.equal(w.log.posts.length, 1);
    assert.deepEqual(Object.keys(w.log.posts[0]).sort(), ['code', 'detail', 'type']);
    assert.deepEqual([w.log.posts[0].type, w.log.posts[0].code], ['error', 'BAD_MESSAGE']);
    assert.equal(typeof w.log.posts[0].detail, 'string');
});

test('worker entry is short and has no top-level declarations', () => {
    const source = fs.readFileSync(path.join(JS_DIR, 'sasfit-worker.js'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => line.trim() !== '');
    assert.ok(code.length < 60, 'code lines: ' + code.length);
    assert.equal(code[0], '(function () {');
    assert.equal(code[code.length - 1], '})();');
});
