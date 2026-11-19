'use strict';
/**
 * sasfit-sequence.js 的執行器 run（M4 計畫 Task 8）：假 client、事件順序、初值規則、停止、錯誤分流、
 * onEvent 丟例外時中止。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
require('./load.js');
const ui = require('./sasfit-ui-helpers.js');
const { seqFiles, sphereForm, seqClient } = require('./sasfit-m4-helpers.js');

const Seq = globalThis.SasFitSequence;
const Format = globalThis.SasFitFormat;

const FILES = seqFiles();
const UNEDITED = Object.freeze({ qMin: 0.005, qMax: 0.35, userEdited: false });
const SETTINGS = Object.freeze({ weighting: 'sigma', maxSteps: 77, rangeEdited: false });

/** 跑一次序列：回傳 { end, events, client }。script 是 seqClient 的腳本。 */
async function runWith(script, { chain = true, form = sphereForm(), onEvent, files = FILES, range = UNEDITED, hook } = {}) {
    const client = seqClient(script);
    const plan = Seq.plan({ files, selected: {}, options: { chain, sort: true }, range, weighting: 'sigma', form });
    const events = [];
    if (hook) hook(client);
    const end = await Seq.run({
        plan, form, settings: SETTINGS, chain,
        datasetOf: (id) => files.find((file) => file.id === id).dataset,
        fitOne: (job, onProgress) => client.fit(job, { onProgress }),
        onEvent: (event) => { events.push(event); if (onEvent) onEvent(event, client); },
    });
    return { end, events, client, plan, form };
}
const rowsOf = (events) => events.filter((event) => event.type === 'row');
const finalRows = (events) => rowsOf(events).filter((event) => event.row.state !== 'running');

test('[sasfit-sequence] run：三筆都收斂、chain 開 → 每筆從前一筆的結果出發；上下限與勾選三筆相同', async () => {
    const { end, client, plan } = await runWith([
        { values: { radius: 50.1234567891 }, errors: { radius: 0.05 } }, { values: { radius: 52.2 } }, { values: { radius: 54.3 } }]);
    assert.deepEqual(end, { outcome: 'finished' });
    assert.equal(client.jobs.length, 3);
    assert.equal(client.jobs[0].params.radius, 50);
    assert.equal(client.jobs[1].params.radius, Format.inputValue(50.1234567891, 0.05, [0, Infinity]), '經捨入');
    assert.notEqual(client.jobs[1].params.radius, 50.1234567891);
    assert.equal(client.jobs[2].params.radius, 52.2);
    client.jobs.forEach((job, i) => {
        assert.deepEqual(job.fitFlags, client.jobs[0].fitFlags);
        assert.deepEqual(job.bounds, client.jobs[0].bounds);
        assert.deepEqual(job.range, plan.items[i].range);
        assert.equal(job.weighting, 'sigma');
        assert.equal(job.options.maxSteps, 77);
    });
});

test('[sasfit-sequence] run：初值取最後一筆可用的結果；maxiter、χ²ᵣ 過大、failed 都不更新它', async () => {
    const a = await runWith([{ values: { radius: 50.1 } }, { values: { radius: 70 }, status: 'maxiter' }, {}]);
    assert.equal(a.client.jobs[2].params.radius, 50.1);
    assert.deepEqual(finalRows(a.events).map((e) => e.row.startedFrom), [null, 'd1', 'd1']);
    const b = await runWith([{ values: { radius: 61 }, chi2r: 800 }, {}]);
    assert.equal(b.client.jobs[1].params.radius, 50, 'χ²ᵣ 過大：從 form0 出發');
    assert.equal(finalRows(b.events)[1].row.startedFrom, null);
    const c = await runWith([{ values: { radius: 61 }, status: 'failed' }, {}]);
    assert.equal(c.client.jobs[1].params.radius, 50);
});

test('[sasfit-sequence] run：chain 關 → 每筆的參數都等於 form0 的', async () => {
    const { client, events } = await runWith([{ values: { radius: 51 } }, { values: { radius: 52 } }, {}], { chain: false });
    client.jobs.forEach((job) => assert.deepEqual(job.params, client.jobs[0].params));
    finalRows(events).forEach((event) => assert.equal(event.row.startedFrom, null));
});

test('[sasfit-sequence] run：事件順序 start → 每筆 running → progress → 結果列（next）→ end', async () => {
    const { events, plan } = await runWith([{ progress: 2 }, {}, {}]);
    assert.deepEqual(events.map((e) => e.type), ['start', 'row', 'progress', 'progress', 'row', 'row', 'row', 'row', 'row', 'end']);
    assert.deepEqual(events[0], { type: 'start', total: 3, fittable: 3 });
    assert.deepEqual(events[2], { type: 'progress', id: 'd1', iteration: 1, chi2r: 10 });
    const rows = rowsOf(events);
    assert.deepEqual(rows.map((e) => [e.id, e.row.state]), [['d1', 'running'], ['d1', 'done'], ['d2', 'running'], ['d2', 'done'], ['d3', 'running'], ['d3', 'done']]);
    assert.deepEqual(finalRows(events).map((e) => e.next), ['d2', 'd3', null]);
    finalRows(events).forEach((event, i) => {
        assert.equal(event.row.id, event.id);
        assert.deepEqual(event.row.range, plan.items[i].range);
        assert.equal(event.row.result.status, 'converged');
        assert.equal(event.row.note, '');
        assert.ok(Object.isFrozen(event) && Object.isFrozen(event.row));
    });
    assert.deepEqual(events[events.length - 1], { type: 'end', outcome: 'finished' });
});

test('[sasfit-sequence] run：被跳過的項目不發事件，next 跳過它們；列帶著範圍被截的註記', async () => {
    const generic = Object.freeze({
        id: 'd2', fileName: 'g.txt', issues: [], issueOverflow: 0, notes: {}, condition: 15,
        dataset: globalThis.SasFitDataIo.parse(ui.fixtureText('generic-2col.txt'), { fileName: 'g.txt', qUnit: 'A' }).dataset,
    });
    const files = [FILES[0], generic, FILES[2]];
    const { events, client, end } = await runWith([{}, {}], { files, range: Object.freeze({ qMin: 0.001, qMax: 0.2, userEdited: true }) });
    assert.equal(end.outcome, 'finished');
    assert.deepEqual(events[0], { type: 'start', total: 3, fittable: 2 });
    assert.equal(client.jobs.length, 2);
    assert.deepEqual(finalRows(events).map((e) => [e.id, e.next]), [['d1', 'd3'], ['d3', null]]);
    assert.match(finalRows(events)[0].row.note, /^擬合範圍截為/);
});

test('[sasfit-sequence] run：中途停止 → 已完成的保留、進行中的回到 pending、後面的不送', async () => {
    const { end, events, client } = await runWith([{}, { wait: true }, {}], {
        onEvent: (event, c) => { if (event.type === 'row' && event.id === 'd2' && event.row.state === 'running') setImmediate(() => c.stop()); },
    });
    assert.deepEqual(end, { outcome: 'stopped' });
    assert.equal(client.jobs.length, 2);
    assert.deepEqual(finalRows(events).map((e) => [e.id, e.row.state, e.next]), [['d1', 'done', 'd2'], ['d2', 'pending', null]]);
    assert.equal(finalRows(events)[1].row.result, null);
    assert.deepEqual(events[events.length - 1], { type: 'end', outcome: 'stopped' });
});

for (const code of ['WASM_LOAD', 'WORKER_CRASH', 'WORKER_START_FAILED', 'BUSY', 'SUPERSEDED', 'STOPPED']) {
    test('[sasfit-sequence] run：' + code + ' → 中止整個序列，之後不再送', async () => {
        const { end, events, client } = await runWith([{}, { reject: code }, {}]);
        assert.equal(end.outcome, 'aborted');
        assert.equal(end.error.code, code);
        assert.equal(client.jobs.length, 2);
        assert.deepEqual(finalRows(events).map((e) => e.id), ['d1'], '沒有文字的錯誤列不會出現');
        assert.equal(events[events.length - 1].outcome, 'aborted');
        assert.equal(events[events.length - 1].error, end.error);
    });
}

test('[sasfit-sequence] run：BAD_PARAMS 只標記該列，序列繼續；出錯的筆不當初值', async () => {
    const { end, events, client } = await runWith([{ values: { radius: 50.4 } }, { reject: 'BAD_PARAMS' }, {}]);
    assert.equal(end.outcome, 'finished');
    assert.equal(client.jobs.length, 3);
    const rows = finalRows(events);
    assert.deepEqual(rows.map((e) => [e.id, e.row.state, e.next]), [['d1', 'done', 'd2'], ['d2', 'error', 'd3'], ['d3', 'done', null]]);
    assert.equal(rows[1].row.note, '錯誤 BAD_PARAMS');
    assert.equal(rows[1].row.result, null);
    assert.equal(client.jobs[2].params.radius, 50.4);
});

test('[sasfit-sequence] run：fitOne 同步丟例外、或 resolve 的不是結果 → 中止', async () => {
    const thrown = await runWith([{}, { throws: true }, {}]);
    assert.equal(thrown.end.outcome, 'aborted');
    assert.match(thrown.end.error.message, /scripted throw/);
    assert.equal(thrown.client.jobs.length, 2);
    const odd = await runWith([{ raw: undefined }, {}]);
    assert.equal(odd.end.outcome, 'aborted');
    assert.equal(odd.client.jobs.length, 1);
});

test('[sasfit-sequence] run：onEvent 在結果列丟例外 → 中止、不再送、Promise 仍 resolve 並帶著那個例外', async () => {
    const boom = new Error('dispatch failed');
    const { end, client, events } = await runWith([{}, {}, {}], {
        onEvent: (event) => { if (event.type === 'row' && event.id === 'd2' && event.row.state === 'done') throw boom; },
    });
    assert.equal(end.outcome, 'aborted');
    assert.equal(end.error, boom);
    assert.equal(client.jobs.length, 2);
    assert.equal(events[events.length - 1].type, 'end');
});

test('[sasfit-sequence] run：onEvent 在進度或 start 丟例外也中止；end 事件再丟例外只記錄，Promise 照樣 resolve', async () => {
    const inProgress = await runWith([{ progress: 3 }, {}, {}], {
        onEvent: (event) => { if (event.type === 'progress') throw new Error('progress failed'); },
    });
    assert.equal(inProgress.end.outcome, 'aborted');
    assert.match(inProgress.end.error.message, /progress failed/);
    assert.equal(inProgress.client.jobs.length, 1);
    const atStart = await runWith([{}], { onEvent: (event) => { if (event.type === 'start') throw new Error('start failed'); } });
    assert.equal(atStart.end.outcome, 'aborted');
    assert.equal(atStart.client.jobs.length, 0);
    let end = null;
    const logged = await ui.captureConsole('error', async () => {
        end = (await runWith([{}, {}, {}], { onEvent: (event) => { if (event.type === 'end') throw new Error('end failed'); } })).end;
    });
    assert.equal(end.outcome, 'finished');
    assert.equal(logged.length, 1);
    assert.match(logged[0], /end failed/);
});

test('[sasfit-sequence] run：不修改 plan 與 form；輸入不合時 Promise 仍 resolve（aborted）', async () => {
    const { plan, form } = await runWith([{}, {}, {}]);
    assert.ok(Object.isFrozen(plan) && Object.isFrozen(form));
    const end = await Seq.run({ plan: null });
    assert.equal(end.outcome, 'aborted');
    assert.ok(end.error instanceof Error);
});

test('[sasfit-sequence] run：上一筆未能決定的參數不沿用，從 form0 的原始值出發，並寫進該列註記（D1，2026-11-19）', async () => {
    const { client, events } = await runWith([
        { values: { radius: 51.5, scale: 1.3 }, errors: { radius: 0.2, scale: 5 } }, { values: { radius: 52 } }, {}]);
    assert.equal(client.jobs[1].params.radius, 51.5, '定得出來的沿用');
    assert.equal(client.jobs[1].params.scale, client.jobs[0].params.scale, '定不出來的用 form0');
    const rows = finalRows(events);
    assert.equal(rows[0].row.note, '');
    assert.match(rows[1].row.note, /scale/);
    assert.match(rows[1].row.note, /未沿用/);
    assert.equal(rows[1].row.startedFrom, 'd1');
    assert.equal(rows[2].row.note, '', '第二筆的結果都定得出來');
    const running = rowsOf(events).filter((event) => event.row.state === 'running');
    assert.match(running[1].row.note, /未沿用/, '執行中的列就帶著註記');
});

test('[sasfit-sequence] run：illConditioned 的結果不當初值（E1）', async () => {
    const { client, events } = await runWith([{ values: { radius: 61 }, illConditioned: true }, {}, {}]);
    assert.equal(client.jobs[1].params.radius, 50);
    assert.equal(finalRows(events)[1].row.startedFrom, null);
});
