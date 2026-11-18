/**
 * sasfit-kernel.js -- call-details / values assembly and chunked dispatch of
 * the sasmodels kernels compiled to WebAssembly.
 *
 * Ported from sasmodels 1.0.12:
 *   details.py       CallDetails buffer layout, make_details, make_kernel_args
 *   direct_model.py  call_kernel, call_Fq, get_mesh, _pop_par_weights
 *   kernel.py        Kernel.Fq, Kernel.Iq
 *   kerneldll.py     DllKernel._call_kernel (100 mesh points per call)
 * Copyright (c) 2009-2022, SasView Developers -- BSD 3-Clause,
 * see wasm/LICENSE-sasmodels.txt
 *
 * Pure computation, usable in a Web Worker and in Node: the wasm bytes are
 * handed in by the caller, no inputs are mutated, and nothing is cached
 * between calls (every call allocates and frees its own wasm buffers).
 *
 * A trap or an out-of-memory condition inside the wasm instance
 * (WebAssembly.RuntimeError, RangeError) is rethrown as
 * Error('wasm kernel <name> failed: ...') with the original as `cause`. The
 * buffers of the call are still freed, but the instance may be left in an
 * undefined state (a trap can interrupt the allocator): discard the exports
 * and instantiate the module again before the next evaluation.
 * Not ported: magnetic kernels (only <model>_Iq is built), 2D, and the
 * deprecated correct_theta_weights.
 *
 * Deliberate deviations from the sasmodels source:
 *   - cutoff is a required option of Fq and Iq. sasmodels' own defaults
 *     disagree (0 in call_kernel / call_Fq, 1e-5 in DirectModel); the only
 *     default lives in SasFitEvaluate.
 *   - radiusEffectiveMode is a required option of Fq (call_Fq defaults to 1,
 *     Kernel.Iq uses 0) and must be an integer in 0..reffModes.length;
 *     sasmodels pops radius_effective_mode from pars and applies int().
 *   - Parameter values must be numbers (sasmodels applies float()).
 *   - q must be a Float64Array of 1..MAX_Q_POINTS points; *_pd_n is limited to
 *     MAX_PD_POINTS and the mesh to MAX_EVAL_POINTS (SasFitValidate); non-finite
 *     *_pd, *_pd_n, *_pd_nsigma are an Error. sasmodels has no limits and lets
 *     NaN through (int(nan) raises ValueError). Within the limits *_pd_n keeps
 *     the sasmodels semantics: int() truncation, fewer than 2 points = centre.
 *   - Magnetic parameter names (up_*, <sld>_M0 / _mtheta / _mphi) are
 *     rejected as unused; sasmodels accepts them. Their slots in the values
 *     vector keep the sasmodels defaults (up_theta = 90, the rest 0).
 *   - The result buffer is zero-filled before the kernel runs (sasmodels uses
 *     np.empty), so an empty dispersity mesh yields zeros instead of garbage.
 *   - values[1] holds the real background, as in call_kernel; DirectModel
 *     zeroes it and adds the background afterwards. The C kernel ignores it.
 */

(function () {
    'use strict';

    const NUM_COMMON_PARS = 2;      // scale, background (modelinfo.py:54)
    const NUM_MAGFIELD_PARS = 4;    // modelinfo.py:55
    const NUM_MAGNETIC_PARS = 3;    // M0, mtheta, mphi per sld (modelinfo.py:56)
    // Defaults of up_frac_i, up_frac_f, up_theta, up_phi (modelinfo.py:640-647);
    // the per-sld M0 / mtheta / mphi slots default to 0.
    const MAGFIELD_DEFAULTS = Object.freeze([0, 0, 90, 0]);
    const VALUES_ALIGN = 32;        // details.py:247-249
    const PD_STEP = 100;            // kerneldll.py:468
    const RESULT_EXTRA = 4;         // total weight, form volume, shell volume, R_eff
    const DETAILS_TAIL = 4;         // num_eval, num_weights, num_active, theta_par
    const MIN_ALLOC_BYTES = 8;
    const BYTES_F64 = Float64Array.BYTES_PER_ELEMENT;
    // direct_model.py:139-142
    const PD_DEFAULTS = Object.freeze({ n: 0, width: 0, nsigma: 3, type: 'gaussian' });

    const {
        has, assertObject, readNumber, readFinite, readPdCount, checkQ, readCutoff,
        isPolydisperse, knownNames, assertNoUnusedPars, assertEvalPoints,
    } = globalThis.SasFitValidate;
    const BUILD_HINT = 'rebuild with tools/sasfit/build_wasm.py';

    /** _pop_par_weights (direct_model.py:127-152): { value, x, w } for one kernel parameter. */
    function parWeights(param, pars) {
        const value = readNumber(pars, param.name, param.def);
        if (!isPolydisperse(param)) return { value, x: [value], w: [1] };
        const npts = readPdCount(pars, param.name + '_pd_n', PD_DEFAULTS.n);
        const width = readFinite(pars, param.name + '_pd', PD_DEFAULTS.width);
        const nsigma = readFinite(pars, param.name + '_pd_nsigma', PD_DEFAULTS.nsigma);
        const type = has(pars, param.name + '_pd_type') ? pars[param.name + '_pd_type'] : PD_DEFAULTS.type;
        if (npts === 0 || width === 0 || !param.pd) {
            // orientation parameters carry the jitter (0), not the viewing angle
            return { value, x: [param.relativePd ? value : 0], w: [1] };
        }
        const dist = globalThis.SasFitWeights.getWeights(
            type, value, width, npts, nsigma, param.min, param.max, param.relativePd);
        return { value, x: dist.x, w: dist.w };
    }

    /**
     * make_details (details.py:182-220). The buffer is
     *   pd_par[maxPd] pd_length[maxPd] pd_offset[maxPd] pd_stride[maxPd]
     *   num_eval num_weights num_active theta_par
     */
    function makeDetails(layout, lengths, offsets, numWeights) {
        const maxPd = layout.maxPd;
        const numActive = lengths.filter((n) => n > 1).length;
        if (numActive > maxPd) throw new Error('Too many polydisperse parameters');
        // np.argsort(length)[::-1][:max_pd]: longest first, larger index first on ties
        const idx = lengths.map((_, i) => i)
            .sort((a, b) => lengths[a] - lengths[b] || a - b)
            .reverse()
            .slice(0, maxPd);
        const details = new Int32Array(4 * maxPd + DETAILS_TAIL);
        let stride = 1;
        idx.forEach((par, k) => {
            details[k] = par;
            details[maxPd + k] = lengths[par];
            details[2 * maxPd + k] = offsets[par];
            details[3 * maxPd + k] = stride;
            stride *= lengths[par];
        });
        details.set([stride, numWeights, numActive, layout.thetaOffset], 4 * maxPd);
        return details;
    }

    function assertLayout(meta) {
        const { npars, nmagnetic, nvalues } = meta.layout;
        const magnetic = nmagnetic > 0 ? NUM_MAGFIELD_PARS + NUM_MAGNETIC_PARS * nmagnetic : 0;
        if (meta.params.length !== npars || nvalues !== NUM_COMMON_PARS + npars + magnetic) {
            throw new Error('Inconsistent kernel layout for model ' + meta.name);
        }
    }

    /** The scalar block: scale, background, kernel parameters, magnetic slots. */
    function fillScalars(values, meta, pars, mesh) {
        values[0] = readNumber(pars, 'scale', meta.common.scale.def);
        values[1] = readNumber(pars, 'background', meta.common.background.def);
        mesh.forEach((m, i) => { values[NUM_COMMON_PARS + i] = m.value; });
        if (meta.layout.nmagnetic > 0) {
            values.set(MAGFIELD_DEFAULTS, NUM_COMMON_PARS + meta.layout.npars);
        }
    }

    /**
     * get_mesh + make_kernel_args (direct_model.py:98-124, details.py:223-257).
     * values = scalars[nvalues], one dispersity vector per kernel parameter,
     * one weight vector per kernel parameter, zero padding to a multiple of 32.
     */
    function makeKernelArgs(meta, pars) {
        assertObject(pars, 'pars');
        assertLayout(meta);
        assertNoUnusedPars(meta.name, pars, knownNames(meta));
        const mesh = meta.params.map((p) => parWeights(p, pars));
        const lengths = mesh.map((m) => m.w.length);
        // each distribution is at most MAX_PD_POINTS long; the mesh is their product
        assertEvalPoints(meta.name, meta.params.map((p) => p.name), lengths);
        const offsets = [];
        let numWeights = 0;
        lengths.forEach((n) => { offsets.push(numWeights); numWeights += n; });
        const details = makeDetails(meta.layout, lengths, offsets, numWeights);
        const nvalues = meta.layout.nvalues;
        const dataLen = nvalues + 2 * numWeights;
        const extra = (VALUES_ALIGN - dataLen % VALUES_ALIGN) % VALUES_ALIGN;
        const values = new Float64Array(dataLen + extra);
        fillScalars(values, meta, pars, mesh);
        mesh.forEach((m, i) => {
            values.set(m.x, nvalues + offsets[i]);
            values.set(m.w, nvalues + numWeights + offsets[i]);
        });
        const numEval = details[details.length - DETAILS_TAIL];
        return { details, values, numEval, numWeights };
    }

    function alloc(ex, bytes, owned, name) {
        const ptr = ex.malloc(Math.max(bytes, MIN_ALLOC_BYTES));
        if (!ptr) throw new Error('wasm malloc failed for ' + bytes + ' bytes (' + name + ')');
        owned.push(ptr);
        return ptr;
    }

    /** A trap or an allocation failure of the wasm side, as a plain Error (see the file header). */
    function wasmFailure(name, err) {
        const isWasmError = err instanceof WebAssembly.RuntimeError || err instanceof RangeError;
        return isWasmError ? new Error('wasm kernel ' + name + ' failed: ' + err.message, { cause: err }) : err;
    }

    /**
     * DllKernel._call_kernel (kerneldll.py:446-472): the mesh is walked in
     * chunks of 100 points. Returns a copy of the raw result buffer
     * (nq*nout values, then total weight, form volume, shell volume, R_eff).
     * Views are taken from memory.buffer only after the last malloc and again
     * after the calls, because growing the memory detaches earlier views.
     */
    function callKernel(ex, fn, name, args, q, nout, cutoff, mode) {
        const nq = q.length;
        const nres = nq * nout + RESULT_EXTRA;
        const owned = [];
        try {
            const pDetails = alloc(ex, args.details.byteLength, owned, name);
            const pValues = alloc(ex, args.values.byteLength, owned, name);
            const pQ = alloc(ex, nq * BYTES_F64, owned, name);
            const pResult = alloc(ex, nres * BYTES_F64, owned, name);
            const buffer = ex.memory.buffer;
            new Int32Array(buffer, pDetails, args.details.length).set(args.details);
            new Float64Array(buffer, pValues, args.values.length).set(args.values);
            new Float64Array(buffer, pQ, nq).set(q);
            // sasmodels uses np.empty here; zeroing keeps an empty mesh deterministic
            new Float64Array(buffer, pResult, nres).fill(0);
            for (let start = 0; start < args.numEval; start += PD_STEP) {
                const stop = Math.min(start + PD_STEP, args.numEval);
                fn(nq, start, stop, pDetails, pValues, pQ, pResult, cutoff, mode);
            }
            return new Float64Array(ex.memory.buffer, pResult, nres).slice();
        } catch (err) {
            throw wasmFailure(name, err);
        } finally {
            owned.forEach((ptr) => ex.free(ptr));
        }
    }

    /** Kernel.Fq (kernel.py:167-188): normalise the raw result by the total weight. */
    function unpackFq(result, nq, nout) {
        const end = nout * nq;
        // total_weight = sum(weight > cutoff); zero means I(q) etc. are zero as well
        const totalWeight = result[end] === 0 ? 1 : result[end];
        const formVolume = result[end + 1] / totalWeight;
        let shellVolume = result[end + 2] / totalWeight;
        const radiusEffective = result[end + 3] / totalWeight;
        if (shellVolume === 0) shellVolume = 1;
        const F2 = new Float64Array(nq);
        const F1 = nout === 2 ? new Float64Array(nq) : null;
        for (let i = 0; i < nq; i++) {
            F2[i] = result[i * nout] / totalWeight;
            if (F1) F1[i] = result[i * nout + 1] / totalWeight;
        }
        return { F1, F2, radiusEffective, shellVolume, volumeRatio: formVolume / shellVolume };
    }

    function readMode(meta, opts) {
        const mode = opts ? opts.radiusEffectiveMode : undefined;
        if (!Number.isInteger(mode) || mode < 0 || mode > meta.reffModes.length) {
            throw new Error('radiusEffectiveMode must be an integer in 0..' + meta.reffModes.length
                + ' for ' + meta.name + ', got ' + mode);
        }
        return mode;
    }

    function checkExports(meta, ex) {
        if (meta.kind !== 'c') throw new Error('Model ' + meta.name + ' has no wasm kernel');
        const fnName = meta.name + '_Iq';
        const usable = ex && typeof ex[fnName] === 'function' && typeof ex.malloc === 'function'
            && typeof ex.free === 'function' && ex.memory && ex.memory.buffer;
        if (!usable) {
            throw new Error('wasm exports must provide ' + fnName + ', malloc, free and memory; ' + BUILD_HINT);
        }
        return ex[fnName];
    }

    /**
     * create(modelMeta, wasmExports) -> { name, Fq, Iq }
     *   Fq(q, pars, { cutoff, radiusEffectiveMode })  -- call_Fq
     *   Iq(q, pars, { cutoff })                       -- call_kernel / Kernel.Iq
     * cutoff and radiusEffectiveMode are required (see the file header).
     */
    function create(modelMeta, wasmExports) {
        const fn = checkExports(modelMeta, wasmExports);
        const nout = modelMeta.haveFq ? 2 : 1;

        function run(q, pars, cutoff, mode) {
            checkQ(q);
            const args = makeKernelArgs(modelMeta, pars);
            const result = callKernel(wasmExports, fn, modelMeta.name, args, q, nout, cutoff, mode);
            return { values: args.values, fq: unpackFq(result, q.length, nout) };
        }

        function Fq(q, pars, opts) {
            return run(q, pars, readCutoff(opts), readMode(modelMeta, opts)).fq;
        }

        /** Kernel.Iq (kernel.py:82-98): scale/shell_volume * F2 + background, mode 0. */
        function Iq(q, pars, opts) {
            const { values, fq } = run(q, pars, readCutoff(opts), 0);
            const combinedScale = values[0] / fq.shellVolume;
            const background = values[1];
            return fq.F2.map((f2) => combinedScale * f2 + background);
        }

        return Object.freeze({ name: modelMeta.name, Fq, Iq });
    }

    /** A build_wasm.py module exports _initialize, malloc, free, memory and one <model>_Iq. */
    function assertModule(ex) {
        const missing = ['_initialize', 'malloc', 'free'].filter((name) => typeof ex[name] !== 'function');
        if (!(ex.memory instanceof WebAssembly.Memory)) missing.push('memory');
        if (!Object.keys(ex).some((name) => /_Iq$/.test(name) && typeof ex[name] === 'function')) {
            missing.push('<model>_Iq');
        }
        if (missing.length > 0) throw new Error('wasm module lacks ' + missing.join(', ') + '; ' + BUILD_HINT);
    }

    /** Instantiate one standalone model module (Phase 0 report: env import + _initialize). */
    async function instantiate(bytes) {
        if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) {
            throw new Error('instantiate needs the wasm bytes as an ArrayBuffer or typed array');
        }
        // Emscripten calls this when the memory grows so that JS can refresh its views. Doing
        // nothing is safe here: callKernel re-reads memory.buffer after its last malloc and keeps no view.
        const imports = { env: { emscripten_notify_memory_growth() {} } };
        const { instance } = await WebAssembly.instantiate(bytes, imports);
        assertModule(instance.exports);
        instance.exports._initialize();
        return instance.exports;
    }

    globalThis.SasFitKernel = Object.freeze({ instantiate, create, makeKernelArgs });
})();
