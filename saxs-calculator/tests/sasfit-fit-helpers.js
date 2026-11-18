'use strict';
/**
 * Shared helpers for the sasfit fitter / worker tests (no test cases here).
 *
 *   pseudoGaussian(seed)     deterministic pseudo-noise: () -> a number of mean 0, variance 1
 *   decayProblem(overrides)  a cheap smooth 3-parameter SasFitFitter problem,
 *                            y = a*exp(-b*x) + c on 40 points (truth 5, 1.3, 0.5; start 3, 0.7, 0.2)
 *   expDecay                 the reviewer's 2-parameter wall problem a*exp(-k*t), true k = 0.70:
 *                            { exact(p) -> residuals, problem(residuals, start) }
 *   recordCalls(residuals)   { residuals, calls }: the same function, recording every p it is given
 */

/** Sum of 12 uniform numbers of a 32-bit LCG, minus 6 (mean 0, variance 1). */
function pseudoGaussian(seed) {
    let state = seed >>> 0;
    const uniform = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
    return () => {
        let sum = 0;
        for (let k = 0; k < 12; k++) sum += uniform();
        return sum - 6;
    };
}

/** y = a*exp(-b*x) + c with a fixed pseudo-noise; cheap, smooth, three parameters. */
function decayProblem(overrides) {
    const x = Array.from({ length: 40 }, (_, i) => 0.1 * i);
    const y = x.map((xi, i) => 5 * Math.exp(-1.3 * xi) + 0.5 + 0.02 * Math.sin(12.9898 * (i + 1)));
    const residuals = (p) => x.map((xi, i) => (y[i] - (p[0] * Math.exp(-p[1] * xi) + p[2])) / 0.02);
    return {
        names: ['a', 'b', 'c'], start: [3, 0.7, 0.2],
        lower: [0, 0, -Infinity], upper: [Infinity, 10, Infinity], residuals, ...overrides,
    };
}

const EXP_T = Object.freeze(Array.from({ length: 30 }, (_, i) => 0.2 * i));
const EXP_SIGMA = 0.05;
const EXP_Y = Object.freeze((() => {
    const noise = pseudoGaussian(7);
    return EXP_T.map((t) => 10 * Math.exp(-0.70 * t) + EXP_SIGMA * noise());
})());

const expDecay = Object.freeze({
    exact: (p) => EXP_T.map((t, i) => (EXP_Y[i] - p[0] * Math.exp(-p[1] * t)) / EXP_SIGMA),
    problem: (residuals, start) => ({
        names: ['a', 'k'], start: start || [8, 1.2], lower: [0, 0], upper: [Infinity, 10], residuals,
    }),
});

function recordCalls(residuals) {
    const calls = [];
    return { calls, residuals: (p) => { calls.push(Array.from(p)); return residuals(p); } };
}

module.exports = { pseudoGaussian, decayProblem, expDecay, recordCalls };
