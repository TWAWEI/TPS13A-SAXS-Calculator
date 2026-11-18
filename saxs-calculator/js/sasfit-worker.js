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

    self.importScripts(...MODULES.map(versioned));

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
    });

    self.onmessage = (event) => { core.handle(event.data); };
})();
