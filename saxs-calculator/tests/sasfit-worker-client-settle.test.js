'use strict';
/**
 * sasfit-worker-client.js: every promise the client hands out settles, on
 * every path (M2 code review H1-H3, M3, L6). Driven by hand-made fake Workers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SasFitWorkerCore, SasFitWorkerClient } = require('./load.js');
const { caseOf, fitJob, evalRequest, fakeWorkers, rejection, outcome, CLIENT_VERSION } = require('./sasfit-fit-helpers.js');

const CASE_1 = caseOf('1 sphere');
const WORKER_URL = 'js/sasfit-worker.js?v=' + CLIENT_VERSION;
const curveFor = (worker) => ({ type: 'curve', reqId: worker.sent[worker.sent.length - 1].reqId, I: new Float64Array(2), extras: {} });
const okResult = { status: 'converged', params: {}, settings: {} };

test('error codes of the client', () => {
    assert.deepEqual([...SasFitWorkerClient.ERROR_CODES],
        ['SUPERSEDED', 'BUSY', 'STOPPED', 'WORKER_CRASH', 'WORKER_START_FAILED', 'DISPOSED', 'POST_FAILED']);
});

// ------------------------------------------------------------- H1: stop

test('stop() is lazy: it terminates and settles, and the next request starts the new Worker', async () => {
    const { client, workers } = fakeWorkers();
    const fit = client.fit(fitJob(CASE_1));
    const evaluation = client.evaluate(evalRequest());
    client.stop();
    assert.equal(workers[0].terminated, 1);
    assert.equal(workers.length, 1, 'no Worker is started by stop() itself');
    assert.equal((await fit).status, 'stopped');
    assert.equal((await rejection(evaluation)).code, 'STOPPED');
    const next = client.evaluate(evalRequest());
    assert.equal(workers.length, 2);
    assert.equal(workers[1].url, WORKER_URL);
    workers[1].reply(curveFor(workers[1]));
    await next;
});

test('stop() with nothing pending leaves a warm Worker alone', async () => {
    const { client, workers } = fakeWorkers();
    client.stop();                                          // no Worker yet
    assert.equal(workers.length, 0);
    const first = client.evaluate(evalRequest());
    workers[0].reply(curveFor(workers[0]));
    await first;
    client.stop();
    client.stop();
    assert.equal(workers[0].terminated, 0, 'an idle stop does not throw away the loaded wasm');
    const second = client.evaluate(evalRequest());
    assert.equal(workers.length, 1, 'the same Worker serves the next request');
    workers[0].reply(curveFor(workers[0]));
    await second;
});

test('stop() settles everything even when terminate() throws', async () => {
    const { client, workers } = fakeWorkers();
    const fit = client.fit(fitJob(CASE_1));
    const evaluation = client.evaluate(evalRequest());
    workers[0].terminate = () => { throw new Error('terminate exploded'); };
    assert.throws(() => client.stop(), /terminate exploded/, 'the exception reaches the caller, after everything is settled');
    assert.equal((await fit).status, 'stopped');
    assert.equal((await rejection(evaluation)).code, 'STOPPED');
    const next = client.fit(fitJob(CASE_1));               // not BUSY, on a new Worker
    assert.equal(workers.length, 2);
    workers[1].reply({ type: 'result', jobId: workers[1].sent[0].jobId, fitResult: okResult });
    assert.equal((await next).status, 'converged');
});

// ------------------------------------------- M3: the Worker cannot start

test('createWorker that throws -> WORKER_START_FAILED (not POST_FAILED); nothing hangs and a later request can succeed', async () => {
    const { client, workers, created } = fakeWorkers({ onCreate: (count) => { if (count === 2) throw new Error('SecurityError: worker blocked'); } });
    const running = client.fit(fitJob(CASE_1));
    client.stop();
    assert.equal((await running).status, 'stopped');
    assert.equal(created(), 1, 'stop() did not try to start a Worker');

    const failedEval = client.evaluate(evalRequest());     // second createWorker call: throws
    const err = await rejection(failedEval);
    assert.equal(err.code, 'WORKER_START_FAILED');
    assert.match(err.message, /[一-鿿]/);
    assert.match(err.detail, /SecurityError: worker blocked/);
    assert.equal(created(), 2);

    const fit = client.fit(fitJob(CASE_1));                 // third call: works again, and the client is not BUSY
    assert.equal(created(), 3);
    assert.equal(workers.length, 2);
    workers[1].reply({ type: 'result', jobId: workers[1].sent[0].jobId, fitResult: okResult });
    assert.equal((await fit).status, 'converged');
});

test('createWorker failing on the very first request, for fit and for evaluate; a non-Worker return value counts as a failure', async () => {
    const always = fakeWorkers({ onCreate: () => { throw new Error('no workers here'); } });
    assert.equal((await rejection(always.client.fit(fitJob(CASE_1)))).code, 'WORKER_START_FAILED');
    assert.equal((await rejection(always.client.evaluate(evalRequest()))).code, 'WORKER_START_FAILED');
    assert.equal((await rejection(always.client.fit(fitJob(CASE_1)))).code, 'WORKER_START_FAILED', 'not BUSY');
    const odd = fakeWorkers({ onCreate: () => null });
    const err = await rejection(odd.client.evaluate(evalRequest()));
    assert.equal(err.code, 'WORKER_START_FAILED');
});

test('postMessage that throws is still POST_FAILED', async () => {
    const { client, workers } = fakeWorkers();
    const first = client.evaluate(evalRequest());
    workers[0].postMessage = () => { throw new Error('DataCloneError: could not be cloned'); };
    assert.equal((await rejection(client.fit(fitJob(CASE_1)))).code, 'POST_FAILED');
    assert.equal((await rejection(client.evaluate(evalRequest()))).code, 'POST_FAILED');
    assert.equal((await rejection(first)).code, 'SUPERSEDED');
});

// ------------------------------------------------ H2: malformed messages

test('a malformed result or curve message rejects with WORKER_CRASH instead of throwing inside onmessage', async () => {
    const badResults = [undefined, null, 'converged', 7, []];
    for (const fitResult of badResults) {
        const { client, workers } = fakeWorkers();
        const fit = client.fit(fitJob(CASE_1));
        const evaluation = client.evaluate(evalRequest());
        assert.doesNotThrow(() => workers[0].reply({ type: 'result', jobId: 1, fitResult }), String(fitResult));
        const err = await rejection(fit);
        assert.equal(err.code, 'WORKER_CRASH', String(fitResult));
        assert.match(err.detail, /result/);
        assert.equal((await rejection(evaluation)).code, 'WORKER_CRASH', 'the Worker is reset: everything pending ends');
        assert.equal(workers[0].terminated, 1);
        const again = client.fit(fitJob(CASE_1));           // usable, on a new Worker
        assert.equal(workers.length, 2);
        workers[1].reply({ type: 'result', jobId: workers[1].sent[0].jobId, fitResult: okResult });
        await again;
    }
    const badCurves = [{ extras: {} }, { I: [1, 2], extras: {} }, { I: new Float64Array(1) }, { I: new Float64Array(1), extras: null }];
    for (const body of badCurves) {
        const { client, workers } = fakeWorkers();
        const evaluation = client.evaluate(evalRequest());
        assert.doesNotThrow(() => workers[0].reply(Object.assign({ type: 'curve', reqId: 1 }, body)));
        const err = await rejection(evaluation);
        assert.equal(err.code, 'WORKER_CRASH', JSON.stringify(body));
        assert.match(err.detail, /curve/);
    }
});

// -------------------------------------------------- H3: onProgress throws

/** The client module loaded in its own context, with queueMicrotask captured instead of run. */
function sandboxedClient() {
    const queued = [];
    const sandbox = { URLSearchParams, SasFitWorkerCore, queueMicrotask: (fn) => { queued.push(fn); } };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'sasfit-worker-client.js'), 'utf8'), sandbox);
    return { Client: sandbox.SasFitWorkerClient, queued };
}

test('a throwing onProgress does not break the fit: later progress still arrives, the fit resolves, the error resurfaces asynchronously', async () => {
    const { Client, queued } = sandboxedClient();
    const { client, workers } = fakeWorkers({ Client });
    const seen = [];
    const boom = new Error('the page\'s progress handler is broken');
    const fit = client.fit(fitJob(CASE_1), { onProgress: (p) => { seen.push(p.iteration); if (p.iteration === 1) throw boom; } });
    assert.doesNotThrow(() => workers[0].reply({ type: 'progress', jobId: 1, iteration: 1, chi2r: 9 }));
    assert.equal(queued.length, 1, 'rethrown later, from a microtask');
    workers[0].reply({ type: 'progress', jobId: 1, iteration: 2, chi2r: 4 });
    workers[0].reply({ type: 'progress', jobId: 1, iteration: 3, chi2r: 2 });
    assert.deepEqual(seen, [1, 2, 3]);
    workers[0].reply({ type: 'result', jobId: 1, fitResult: okResult });
    assert.equal((await fit).status, 'converged');
    assert.equal(workers[0].terminated, 0, 'the Worker is not blamed for the page\'s error');
    assert.equal(queued.length, 1);
    assert.throws(() => queued[0](), (err) => err === boom);
    // and stop() still reports the last iteration that was delivered
    const second = client.fit(fitJob(CASE_1), { onProgress: () => { throw boom; } });
    workers[0].reply({ type: 'progress', jobId: 2, iteration: 6, chi2r: 1 });
    client.stop();
    assert.equal((await second).iterations, 6);
});

// ------------------------------------------------ L6 and remote messages

test('Worker onerror: the detail carries message, file name and line when the event has them', async () => {
    const { client, workers } = fakeWorkers();
    const fit = client.fit(fitJob(CASE_1));
    workers[0].onerror({ message: 'Uncaught SyntaxError: bad token', filename: 'https://x.test/js/sasfit-fitter.js?v=9.87', lineno: 42 });
    const err = await rejection(fit);
    assert.equal(err.code, 'WORKER_CRASH');
    assert.match(err.detail, /Uncaught SyntaxError: bad token/);
    assert.match(err.detail, /sasfit-fitter\.js\?v=9\.87:42/);
    const garbled = fakeWorkers();
    const pending = garbled.client.evaluate(evalRequest());
    garbled.workers[0].onmessageerror({});
    const lost = await rejection(pending);
    assert.equal(lost.code, 'WORKER_CRASH');
    assert.match(lost.detail, /deserialised/);
    const noLine = fakeWorkers();
    const third = noLine.client.evaluate(evalRequest());
    noLine.workers[0].onerror({ message: 'failed to load', filename: 'js/sasfit-worker.js' });
    assert.match((await rejection(third)).detail, /failed to load \(js\/sasfit-worker\.js\)/);
});

test('an error event without a message (the Worker script could not be fetched) is WORKER_START_FAILED, and the next request starts over', async () => {
    const { client, workers } = fakeWorkers();
    const fit = client.fit(fitJob(CASE_1));
    const evaluation = client.evaluate(evalRequest());
    workers[0].onerror({ type: 'error' });
    for (const pending of [fit, evaluation]) {
        const err = await rejection(pending);
        assert.equal(err.code, 'WORKER_START_FAILED');
        assert.match(err.message, /[一-鿿]/);
        assert.match(err.detail, /could not be loaded/);
    }
    assert.equal(workers[0].terminated, 1);
    const next = client.evaluate(evalRequest());
    assert.equal(workers.length, 2);
    workers[1].reply(curveFor(workers[1]));
    await next;
});

test('error messages the Worker entry posts without text get the client\'s own Chinese message', async () => {
    const { client, workers } = fakeWorkers();
    const fit = client.fit(fitJob(CASE_1));
    const evaluation = client.evaluate(evalRequest());
    workers[0].reply({ type: 'error', code: 'WORKER_START_FAILED', detail: 'importScripts failed: NetworkError' });
    for (const pending of [fit, evaluation]) {
        const err = await rejection(pending);
        assert.equal(err.code, 'WORKER_START_FAILED');
        assert.match(err.message, /[一-鿿]/);
        assert.match(err.detail, /importScripts failed/);
    }
    assert.equal(workers[0].terminated, 1, 'a Worker that said it cannot start is not used again');
    workers[0].onerror({ message: 'Uncaught NetworkError', filename: 'js/sasfit-worker.js', lineno: 42 });   // its own death: ignored
    const next = client.evaluate(evalRequest());
    assert.equal(workers.length, 2);
    workers[1].reply({ type: 'error', code: 'BAD_MESSAGE', detail: 'the Worker could not read a message' });
    const bad = await rejection(next);
    assert.equal(bad.code, 'BAD_MESSAGE');
    assert.match(bad.message, /[一-鿿]/);
});

// ------------------------------------------- every path settles everything

test('on every path, a pending fit and a pending evaluate both settle', async () => {
    const paths = {
        'stop()': (h) => h.client.stop(),
        'stop() with a throwing terminate': (h) => { h.workers[0].terminate = () => { throw new Error('x'); }; h.client.stop(); },
        'dispose()': (h) => h.client.dispose(),
        'dispose() with a throwing terminate': (h) => { h.workers[0].terminate = () => { throw new Error('x'); }; h.client.dispose(); },
        'worker error event': (h) => h.workers[0].onerror({ message: 'boom' }),
        'worker messageerror event': (h) => h.workers[0].onmessageerror({}),
        'error message without an id': (h) => h.workers[0].reply({ type: 'error', code: 'INTERNAL', message: '錯誤', detail: '' }),
        'malformed result': (h) => h.workers[0].reply({ type: 'result', jobId: 1 }),
        'malformed curve': (h) => h.workers[0].reply({ type: 'curve', reqId: 2 }),
        'their own replies': (h) => {
            h.workers[0].reply({ type: 'result', jobId: 1, fitResult: okResult });
            h.workers[0].reply({ type: 'curve', reqId: 2, I: new Float64Array(1), extras: {} });
        },
        'their own error replies': (h) => {
            h.workers[0].reply({ type: 'error', jobId: 1, code: 'BAD_PARAMS', message: '參數', detail: '' });
            h.workers[0].reply({ type: 'error', reqId: 2, code: 'BAD_PARAMS', message: '參數', detail: '' });
        },
    };
    for (const [label, trigger] of Object.entries(paths)) {
        const h = fakeWorkers();
        const fit = h.client.fit(fitJob(CASE_1), { onProgress: () => {} });
        const evaluation = h.client.evaluate(evalRequest());
        assert.deepEqual([await outcome(fit), await outcome(evaluation)], ['pending', 'pending'], label);
        if (label.includes('throwing terminate')) assert.throws(() => trigger(h), /^Error: x$/, label);
        else assert.doesNotThrow(() => trigger(h), label);
        assert.notEqual(await outcome(fit), 'pending', label + ': the fit settles');
        assert.notEqual(await outcome(evaluation), 'pending', label + ': the evaluate settles');
        // afterwards the client is either disposed or usable: it never stays BUSY
        const after = await Promise.race([h.client.fit(fitJob(CASE_1)).then(() => 'resolved', (err) => err.code), outcome(Promise.resolve()).then(() => 'pending')]);
        assert.ok(after === 'pending' || after === 'DISPOSED', label + ': afterwards ' + after);
    }
    // requests that cannot even be sent settle at once
    const blocked = fakeWorkers({ onCreate: () => { throw new Error('blocked'); } });
    assert.equal(await outcome(blocked.client.fit(fitJob(CASE_1))), 'rejected');
    assert.equal(await outcome(blocked.client.evaluate(evalRequest())), 'rejected');
});
