/**
 * sasfit-worker.js -- Web Worker entry of the SAS model fitting (design spec
 * 3.3, 4.10). Classic Worker, started by sasfit-worker-client.js; it is not a
 * page script (not in index.html, not in tests/load.js). All logic lives in
 * sasfit-worker-core.js; this file only connects it to the Worker globals.
 *
 * Cache version: the client starts this file as sasfit-worker.js?v=<version>;
 * the same query is added to every importScripts and wasm URL, so a release
 * never mixes files of two versions. Without a v the URLs carry no query.
 * URLs are relative to this script: the modules sit next to it, the wasm
 * files in ../wasm/.
 *
 * Two errors are reported by this file itself, as { type: 'error', code,
 * detail } without ids and without a message (the client has the texts):
 * WORKER_START_FAILED when importScripts throws, BAD_MESSAGE on messageerror.
 */

(function () {
    'use strict';

    // Load order = the order of these files in index.html (tests/structure.test.js checks both).
    const MODULES = Object.freeze([
        'sasfit-meta.js',
        'sasfit-validate.js',
        'sasfit-weights.js',
        'sasfit-kernel.js',
        'sasfit-product.js',
        'sasfit-py-models.js',
        'sasfit-evaluate.js',
        'sasfit-weighting.js',
        'sasfit-linalg.js',
        'sasfit-fitter.js',
        'sasfit-worker-core.js',
    ]);
    const WASM_DIR = '../wasm/';

    const version = new URLSearchParams(self.location.search).get('v');
    const query = version ? '?v=' + encodeURIComponent(version) : '';
    const versioned = (url) => url + query;

    try {
        self.importScripts(...MODULES.map(versioned));
    } catch (err) {
        // Tell the client why before the script dies (it also gets the error event); the client supplies the user's text.
        self.postMessage({ type: 'error', code: 'WORKER_START_FAILED', detail: 'importScripts failed: ' + String((err && err.message) || err) });
        throw err;
    }

    /** Bytes of one model. Only the names of C models in SasFitMeta ever become part of a URL. */
    function loadWasm(name) {
        const models = self.SasFitMeta.models;
        if (!self.SasFitValidate.has(models, name) || models[name].kind !== 'c') {
            return Promise.reject(new Error('Not a wasm model: ' + String(name)));
        }
        return fetch(versioned(WASM_DIR + 'sas-' + name + '.wasm')).then((response) => {
            if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + response.url);
            return response.arrayBuffer();
        });
    }

    const core = self.SasFitWorkerCore.create({
        loadWasm,
        post: (message) => self.postMessage(message),
        // A later task, not a microtask: queued messages get in first (latest-wins, see the core).
        yieldTask: () => new Promise((resolve) => setTimeout(resolve, 0)),
        // Nothing can be posted any more (not even the error about it): the console is all that is left.
        onFatal: (err) => { console.error('sasfit worker: a message could not be posted', err); },
    });

    self.onmessage = (event) => { core.handle(event.data); };
    // A message that could not be deserialised has no data and no id: every pending request of the client ends.
    self.onmessageerror = () => {
        self.postMessage({ type: 'error', code: 'BAD_MESSAGE', detail: 'the Worker could not deserialise a message' });
    };
})();
