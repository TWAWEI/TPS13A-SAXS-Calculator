'use strict';
/**
 * sasfit-seq-ui.js（M4 計畫 Task 11）：序列的執行、停止、鎖定、擬合列與每一條解鎖路徑；
 * 以及 sasfit-fit-ui.js 為序列新增的 forgetRevert／setBarProgress。假 client（m4.seqClient）＋假計時器。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert/strict');
require('./load.js');
const ui = require('./sasfit-ui-helpers.js');
const m4 = require('./sasfit-m4-helpers.js');

const Jobs = globalThis.SasFitJobs;
const REAL_SEQUENCE = globalThis.SasFitSequence;
const RADII = [{ values: { radius: 50.12 } }, { values: { radius: 52.07 } }, { values: { radius: 53.95 } }];
const phases = (page) => [page.Section.getState().fit.phase, page.Section.getState().seq.phase];
const run = (page) => page.$('sfSeqRun').fire('click');
const alertText = (page) => page.$('sfAlert').descendants().map((node) => node.textContent).join(' ');
/** 等執行器把目前能做的都做完（每筆擬合之間要幾個 microtask／macrotask）。 */
async function settle() {
    for (let i = 0; i < 4; i++) await ui.flush();
}

afterEach(() => {
    globalThis.SasFitSequence = REAL_SEQUENCE;
    m4.restore();
});

// ---------------------------------------------------------------- 執行
test('[seq-ui] 執行三個檔：依排程順序擬合；執行前取消預覽；期間整頁鎖定；結束後解鎖、結果入庫、焦點回執行鈕', async () => {
    const page = m4.seqPage({ script: [RADII[0], { wait: true, ...RADII[1] }, RADII[2]] });
    page.$('sfTabSeq').fire('click');
    assert.equal(page.$('sfSeqRun').disabled, false);
    page.ctx.preview.schedule();
    run(page);
    await settle();
    page.timers.advance(200);
    assert.equal(page.client.evaluations.length, 0, '排著的預覽已取消');
    assert.deepEqual(phases(page), ['running', 'running']);
    assert.equal(page.ctx.sequence.running(), true);
    assert.equal(page.Section.getState().fit.datasetId, 'd2');
    assert.equal(page.client.jobs.length, 2);
    for (const id of ['sfDataLock', 'sfModelLock', 'sfSeqLock']) assert.equal(page.$(id).hidden, false, id);
    page.timers.advance(250);                                  // 節流的重繪：鎖定後的表格
    assert.ok(['d1', 'd2', 'd3'].every((id) => page.pick(id).disabled && page.load(id).disabled));
    assert.ok(['sfSeqChain', 'sfSeqSort', 'sfSeqAll', 'sfSeqNone', 'sfSeqRun', 'sfFitStart'].every((id) => page.$(id).disabled));
    assert.equal(page.$('sfFitStop').disabled, false);
    assert.equal(page.$('sfFitStop').focusCount, 1, '執行鈕停用了：焦點到「停止」');
    assert.match(page.$('sfSeqLive').textContent, /第 1／3 筆 SYNTH_sphere_10\.dat：已收斂|序列擬合開始，共 3 筆/);

    page.client.release();
    await settle();
    assert.deepEqual(phases(page), ['idle', 'idle']);
    assert.equal(page.Section.getState().seq.outcome, 'finished');
    assert.equal(page.client.jobs.length, 3);
    assert.deepEqual(page.client.jobs.map((job) => job.range), page.Section.getState().seq.order.map((id) => page.Section.getState().seq.rows[id].range));
    assert.deepEqual(Object.keys(page.Section.getState().fitResults), ['d1', 'd2', 'd3']);
    assert.equal(page.client.jobs[2].params.radius, 52.07, '以前一筆結果為初值');
    for (const id of ['sfDataLock', 'sfModelLock', 'sfSeqLock']) assert.equal(page.$(id).hidden, true, id);
    assert.equal(page.$('sfSeqRun').disabled, false);
    assert.equal(page.$('sfSeqRun').focusCount, 1, '在序列分段：焦點回執行鈕');
    assert.equal(page.$('sfSeqLive').textContent, '序列擬合完成，共 3／3 筆');
    assert.equal(page.$('sfSeqProgress').textContent, '序列擬合完成，共 3／3 筆');
    assert.equal(page.ctx.sequence.running(), false);
    assert.equal(page.ctx.sequence.barText(), '');
});

test('[seq-ui] 不在序列分段時結束：焦點回「開始擬合」', async () => {
    const page = m4.seqPage({ script: RADII });
    run(page);
    await settle();
    assert.deepEqual(phases(page), ['idle', 'idle']);
    assert.equal(page.$('sfFitStart').focusCount, 1);
    assert.equal(page.$('sfSeqRun').focusCount, 0);
});

test('[seq-ui] 不逐次整頁重繪：三筆、每筆 5 個進度事件，計時器不前進時只有開始與結束各一次', async () => {
    const page = m4.seqPage({ script: RADII.map((step) => ({ ...step, progress: 5 })) });
    const before = page.refreshes();
    const seen = [];
    const progress = page.$('sfFitProgress');
    let text = progress.textContent;
    Object.defineProperty(progress, 'textContent', { get: () => text, set(value) { text = value; seen.push(value); } });
    run(page);
    await settle();
    assert.equal(page.refreshes() - before, 2, '開始一次＋結束一次');
    assert.equal(seen.filter((line) => /^序列擬合 第 \d／3 筆/.test(line)).length, 3 * (1 + 5), '進度行每個事件都更新');
    for (const k of [1, 2, 3]) assert.ok(seen.some((line) => line.startsWith('序列擬合 第 ' + k + '／3 筆：SYNTH_sphere_' + k + '0.dat')), '第 ' + k + ' 筆');
    assert.ok(seen.includes('序列擬合 第 2／3 筆：SYNTH_sphere_20.dat；第 5 步，約化 χ²＝2.00'));
    assert.equal(page.timers.pendingCount(), 0, '結束後沒有留下計時器');
});

test('[seq-ui] 節流：執行中每 250 ms 最多重繪一次', async () => {
    const page = m4.seqPage({ script: [{ wait: true, progress: 3, ...RADII[0] }, RADII[1], RADII[2]] });
    const before = page.refreshes();
    run(page);
    await settle();
    assert.equal(page.refreshes() - before, 1);
    page.timers.advance(249);
    assert.equal(page.refreshes() - before, 1);
    page.timers.advance(1);
    assert.equal(page.refreshes() - before, 2);
    page.timers.advance(1000);
    assert.equal(page.refreshes() - before, 2, '沒有新事件就不再重繪');
    page.client.release();
    await settle();
    assert.equal(page.refreshes() - before, 3, '結束時一定一次');
    assert.deepEqual(phases(page), ['idle', 'idle']);
});

test('[seq-ui] 500 個檔、每筆立刻結束：整頁重繪 2 次，全部入庫', async () => {
    const [dataset] = m4.seqDatasets();
    const files = Array.from({ length: 500 }, (_, i) => ({ fileName: 'f' + i + '.dat', dataset, issues: [], notes: {} }));
    const page = m4.seqPage({ files });
    const before = page.refreshes();
    run(page);
    for (let i = 0; i < 40 && page.Section.getState().seq.phase === 'running'; i++) await settle();
    assert.deepEqual(phases(page), ['idle', 'idle']);
    assert.equal(page.client.jobs.length, 500);
    assert.equal(Object.keys(page.Section.getState().fitResults).length, 500);
    assert.equal(page.refreshes() - before, 2);
    assert.equal(page.rowIds().length, 500);
    assert.equal(page.$('sfSeqLive').textContent, '序列擬合完成，共 500／500 筆');
});

// ---------------------------------------------------------------- 擬合列
test('[seq-ui] 擬合列：序列進行中進度行是 barText、量度行留白、開始停用、停止可按；結束後進度行清空、量度行回來', async () => {
    const page = m4.seqPage({ script: [RADII[0], { wait: true, progress: 2, ...RADII[1] }, RADII[2]] });
    run(page);
    await settle();
    page.timers.advance(250);
    const bar = page.ctx.sequence.barText();
    assert.equal(bar, '序列擬合 第 2／3 筆：SYNTH_sphere_20.dat；第 2 步，約化 χ²＝5.00');
    assert.equal(page.$('sfFitProgress').textContent, bar);
    assert.equal(page.$('sfSeqProgress').textContent, bar);
    assert.equal(page.$('sfFitMeasure').innerHTML, '');
    assert.equal(page.$('sfFitStart').disabled, true);
    assert.equal(page.$('sfFitStop').disabled, false);
    page.client.release();
    await settle();
    assert.equal(page.$('sfFitProgress').textContent, '');
    assert.match(page.$('sfFitMeasure').innerHTML, /sf-fitbar-value/);
    assert.equal(page.$('sfFitStart').disabled, false);
    assert.equal(page.$('sfFitStop').disabled, true);
});

test('[seq-ui] 權重不是 σ 時進度行的量度名稱是「加權殘差均方」', async () => {
    const page = m4.seqPage({ script: [{ wait: true, progress: 1 }] });
    page.ctx.dispatch({ type: 'setWeighting', mode: 'none' });
    run(page);
    await settle();
    assert.match(page.$('sfFitProgress').textContent, /第 1 步，加權殘差均方＝10\.0$/);
    assert.doesNotMatch(page.$('sfFitProgress').textContent, /χ/);
    page.$('sfFitStop').fire('click');
    await settle();
});

// ---------------------------------------------------------------- 停止
test('[seq-ui] 停止：擬合列的「停止」→ client.stop 一次；已完成的保留、進行中的回到 pending、頁面解鎖；沒有續跑', async () => {
    const page = m4.seqPage({ script: [RADII[0], { wait: true }, RADII[2], RADII[0], RADII[1], RADII[2]] });
    run(page);
    await settle();
    page.$('sfFitStop').fire('click');
    await settle();
    assert.equal(page.client.stops, 1);
    const state = page.Section.getState();
    assert.deepEqual(phases(page), ['idle', 'idle']);
    assert.equal(state.seq.outcome, 'stopped');
    assert.deepEqual(['d1', 'd2', 'd3'].map((id) => state.seq.rows[id].state), ['done', 'pending', 'pending']);
    assert.deepEqual(Object.keys(state.fitResults), ['d1']);
    assert.equal(page.client.jobs.length, 2, '第 3 筆沒被送出');
    assert.equal(page.$('sfFitProgress').textContent, '序列已停止，完成 1／3 筆');
    assert.equal(page.$('sfSeqLive').textContent, '序列已停止，完成 1／3 筆');
    assert.equal(page.$('sfModelLock').hidden, true);
    assert.equal(page.timers.pendingCount(), 0, '停止的保險計時器已取消');
    // 可改參數
    page.ctx.setForm(globalThis.SasFitForm.reduce(page.ctx.getForm(), { type: 'setValue', name: 'radius', value: '51' }));
    assert.doesNotThrow(() => page.ctx.dispatch({ type: 'setSeqSelected', id: 'd1', selected: true }));
    // 再按執行：從頭重跑
    assert.equal(page.$('sfSeqRun').disabled, false);
    run(page);
    assert.deepEqual(Object.values(page.Section.getState().seq.rows).map((row) => row.state), ['pending', 'pending', 'pending']);
    await settle();
    assert.equal(page.client.jobs.length, 5);
    assert.equal(page.client.jobs[2].params.radius, 51, '重跑從表單出發，不是接續');
    assert.equal(page.Section.getState().seq.outcome, 'finished');
});

test('[seq-ui] 連按執行只會開始一次；序列進行中擋下單筆擬合', async () => {
    const page = m4.seqPage({ script: [{ wait: true }] });
    run(page);
    run(page);
    page.$('sfFitStart').fire('click');
    await settle();
    assert.equal(page.client.jobs.length, 1);
    page.client.release();
    await settle();
    assert.deepEqual(phases(page), ['idle', 'idle']);
    assert.equal(page.client.jobs.length, 3);
});

// ---------------------------------------------------------------- 每一條解鎖路徑
test('[seq-ui] 解鎖：WASM_LOAD → 中止、頁面層級訊息、detail 進 console.warn', async () => {
    const page = m4.seqPage({ script: [RADII[0], { reject: 'WASM_LOAD' }] });
    const warned = await ui.captureConsole('warn', async () => { run(page); await settle(); });
    assert.deepEqual(phases(page), ['idle', 'idle']);
    assert.equal(page.Section.getState().seq.outcome, 'aborted');
    assert.match(alertText(page), /錯誤 WASM_LOAD/);
    assert.ok(warned.some((line) => line.includes('detail of WASM_LOAD')));
    assert.equal(page.$('sfFitProgress').textContent, '序列中止');
    assert.equal(page.$('sfSeqProgress').textContent, '序列中止，完成 1／3 筆');
    assert.deepEqual(Object.keys(page.Section.getState().fitResults), ['d1'], '中止前的結果保留');
    assert.equal(page.$('sfSeqRun').disabled, false);
});

for (const code of ['WORKER_CRASH', 'WORKER_START_FAILED']) {
    test('[seq-ui] 解鎖：' + code + ' → 整個序列中止（下一筆只會重演）', async () => {
        const page = m4.seqPage({ script: [{ reject: code }] });
        await ui.captureConsole('warn', async () => { run(page); await settle(); });
        assert.deepEqual(phases(page), ['idle', 'idle']);
        assert.equal(page.client.jobs.length, 1);
        assert.match(alertText(page), new RegExp('錯誤 ' + code));
    });
}

for (const code of ['BUSY', 'SUPERSEDED', 'STOPPED']) {
    test('[seq-ui] 解鎖：' + code + '（errorNotice 分到 ignore）→ 中止並說明，不是一列沒有文字的錯誤', async () => {
        const page = m4.seqPage({ script: [{ reject: code }] });
        await ui.captureConsole('warn', async () => { run(page); await settle(); });
        assert.deepEqual(phases(page), ['idle', 'idle']);
        assert.equal(page.Section.getState().seq.outcome, 'aborted');
        assert.equal(page.client.jobs.length, 1);
        assert.match(alertText(page), /序列擬合已中止：擬合的狀態與頁面不一致/);
        assert.ok(Object.values(page.Section.getState().seq.rows).every((row) => row.state === 'pending'));
    });
}

test('[seq-ui] 其他錯誤（BAD_PARAMS）只標記該列，序列繼續', async () => {
    const page = m4.seqPage({ script: [RADII[0], { reject: 'BAD_PARAMS' }, RADII[2]] });
    run(page);
    await settle();
    const state = page.Section.getState();
    assert.equal(state.seq.outcome, 'finished');
    assert.deepEqual(['d1', 'd2', 'd3'].map((id) => state.seq.rows[id].state), ['done', 'error', 'done']);
    assert.equal(state.seq.rows.d2.note, '錯誤 BAD_PARAMS');
    assert.equal(alertText(page), '');
    assert.equal(page.$('sfSeqLive').textContent, '序列擬合完成，共 3／3 筆');
});

test('[seq-ui] 解鎖：ctx.client 的 getter 丟例外（Worker 建不起來）', async () => {
    const page = m4.seqPage({ deps: { createClient: () => { throw new Error('no worker here'); } } });
    const warned = await ui.captureConsole('warn', async () => { run(page); await settle(); });
    assert.deepEqual(phases(page), ['idle', 'idle']);
    assert.equal(page.Section.getState().seq.outcome, 'aborted');
    assert.match(alertText(page), /發生未預期的錯誤/);
    assert.ok(warned.some((line) => line.includes('no worker here')));
});

test('[seq-ui] 解鎖：SasFitSequence.run reject 或同步丟例外', async () => {
    for (const fake of [() => Promise.reject(new Error('runner broke')), () => { throw new Error('runner threw'); }]) {
        globalThis.SasFitSequence = Object.freeze({ ...REAL_SEQUENCE, run: fake });
        const page = m4.seqPage();
        await ui.captureConsole('warn', async () => { run(page); await settle(); });
        assert.deepEqual(phases(page), ['idle', 'idle']);
        assert.equal(page.Section.getState().seq.outcome, 'aborted');
        assert.match(alertText(page), /發生未預期的錯誤/);
        assert.equal(page.$('sfSeqRun').disabled, false);
        m4.restore();
    }
});

test('[seq-ui] 解鎖：seqStep 的 dispatch 丟例外（事件的 id 不對）→ 序列中止並有訊息，不是默默吞掉', async () => {
    const wrongId = (event) => (event.type === 'row' && event.row.state === 'done' && event.id === 'd2'
        ? { ...event, id: 'd9', row: { ...event.row, id: 'd9' } } : event);
    globalThis.SasFitSequence = Object.freeze({
        ...REAL_SEQUENCE, run: (input) => REAL_SEQUENCE.run({ ...input, onEvent: (event) => input.onEvent(wrongId(event)) }),
    });
    const page = m4.seqPage({ script: RADII });
    const warned = await ui.captureConsole('warn', async () => { run(page); await settle(); });
    assert.deepEqual(phases(page), ['idle', 'idle']);
    assert.equal(page.Section.getState().seq.outcome, 'aborted');
    assert.equal(page.client.jobs.length, 2, '第 3 筆沒被送出');
    assert.match(alertText(page), /發生未預期的錯誤/);
    assert.ok(warned.some((line) => /seqStep/.test(line)), 'console.warn 有技術細節');
    assert.deepEqual(Object.keys(page.Section.getState().fitResults), ['d1']);
});

test('[seq-ui] 解鎖：擬合列的 stop() 丟例外而且那一筆永遠不結束 → 寬限時間後放棄這次序列並解鎖', async () => {
    const page = m4.seqPage({ script: [RADII[0], { wait: true }, RADII[2]] });
    page.client.stopThrows = true;
    run(page);
    await settle();
    await ui.captureConsole('warn', async () => { page.$('sfFitStop').fire('click'); });
    assert.deepEqual(phases(page), ['running', 'running'], '還在等那一筆');
    page.timers.advance(999);
    assert.deepEqual(phases(page), ['running', 'running']);
    page.timers.advance(1);
    assert.deepEqual(phases(page), ['idle', 'idle']);
    assert.equal(page.Section.getState().seq.outcome, 'aborted');
    assert.match(alertText(page), /停止沒有成功，序列已中止/);
    assert.equal(page.$('sfFitProgress').textContent, '序列中止');
    assert.deepEqual(Object.keys(page.Section.getState().fitResults), ['d1']);
    // 被放棄的那一筆後來才結束：不寫進狀態、不再送下一筆
    page.client.stopThrows = false;
    page.client.release();
    await settle();
    assert.equal(page.client.jobs.length, 2);
    assert.deepEqual(Object.keys(page.Section.getState().fitResults), ['d1']);
    assert.deepEqual(phases(page), ['idle', 'idle']);
});

test('[seq-ui] 停止時正好在兩筆之間（沒有等待中的擬合）：下一筆不再送出', async () => {
    const page = m4.seqPage({ script: [{ wait: true, ...RADII[0] }, RADII[1], RADII[2]] });
    run(page);
    await settle();
    const realStop = page.client.stop;
    page.client.stop = () => { page.client.stops += 1; };          // stop() 沒有東西可停（真的 client 在閒置時什麼都不做）
    page.$('sfFitStop').fire('click');
    page.client.stop = realStop;
    page.client.release();
    await settle();
    assert.deepEqual(phases(page), ['idle', 'idle']);
    assert.equal(page.Section.getState().seq.outcome, 'stopped');
    assert.equal(page.client.jobs.length, 1);
    assert.deepEqual(Object.keys(page.Section.getState().fitResults), ['d1']);
});

// ---------------------------------------------------------------- 結束後的表單
test('[seq-ui] 結束後：擬合對象在序列中 → 表單是它的結果、沒有「參數已改動」、還原鈕停用', async () => {
    const page = m4.seqPage({ script: RADII });
    assert.equal(page.Section.getState().activeId, 'd1');
    run(page);
    await settle();
    const state = page.Section.getState();
    assert.equal(Number(page.ctx.getForm().fields.radius.value), 50.12);
    assert.equal(Jobs.resultMatchesForm(page.ctx.getForm(), state.fitResults.d1), true);
    assert.doesNotMatch(page.$('sfFitMeasure').innerHTML, /參數已改動/);
    assert.equal(page.$('sfFitRevert').disabled, true);
    assert.equal(page.$('sfFitRevertNote').textContent, '');
    const hints = page.$('sfSeqHints').descendants().map((node) => node.textContent).join(' ');
    assert.match(hints, /已把 SYNTH_sphere_10\.dat 的序列結果載入參數表；其他資料可由下表逐列載入/);
});

test('[seq-ui] 結束後：先前單筆擬合留下的還原點被清掉（表單已換成序列的結果）', async () => {
    const page = m4.seqPage({ script: [{ values: { radius: 49 } }].concat(RADII) });
    page.$('sfFitStart').fire('click');
    await settle();
    assert.equal(page.$('sfFitRevert').disabled, false, '單筆擬合後可還原');
    run(page);
    await settle();
    assert.equal(page.$('sfFitRevert').disabled, true);
    assert.equal(Number(page.ctx.getForm().fields.radius.value), 50.12);
});

test('[seq-ui] 結束後：擬合對象沒勾選 → 表單不變，提示可逐列載入；沒有任何完成的列 → 不提示', async () => {
    const page = m4.seqPage({ script: RADII });
    page.ctx.dispatch({ type: 'setSeqSelected', id: 'd1', selected: false });
    const before = page.ctx.getForm();
    run(page);
    await settle();
    assert.equal(page.ctx.getForm(), before);
    assert.equal(page.client.jobs.length, 2);
    const hints = page.$('sfSeqHints').descendants().map((node) => node.textContent).join(' ');
    assert.match(hints, /序列結果可由下表逐列載入/);
    // 換了選取（rows 沒變）提示還在；重新執行並中止後提示消失
    const aborted = m4.seqPage({ script: [{ reject: 'WASM_LOAD' }] });
    await ui.captureConsole('warn', async () => { run(aborted); await settle(); });
    assert.equal(aborted.$('sfSeqHints').querySelector('[data-hint="seq-end"]'), null);
});

// ---------------------------------------------------------------- fit-ui 的兩個掛鉤
test('[sasfit-fit-ui] forgetRevert()：還原鈕停用、說明留白', async () => {
    const page = m4.seqPage({ script: [{ values: { radius: 49 } }] });
    page.$('sfFitStart').fire('click');
    await settle();
    assert.equal(page.$('sfFitRevert').disabled, false);
    page.ctx.fit.forgetRevert();
    page.ctx.refresh();
    assert.equal(page.$('sfFitRevert').disabled, true);
    assert.equal(page.$('sfFitRevertNote').textContent, '');
    page.ctx.dispatch({ type: 'setActive', id: 'd2' });
    assert.equal(page.$('sfFitRevertNote').textContent, '', '不再說「可還原的是…」');
});

test('[sasfit-fit-ui] setBarProgress(text)：寫進 #sfFitProgress；之後換擬合對象時照既有規則清掉', () => {
    const page = m4.seqPage();
    page.ctx.fit.setBarProgress('序列已停止，完成 1／3 筆');
    assert.equal(page.$('sfFitProgress').textContent, '序列已停止，完成 1／3 筆');
    assert.equal(page.$('sfFitLive').textContent, '', '不朗讀');
    page.ctx.refresh();
    assert.equal(page.$('sfFitProgress').textContent, '序列已停止，完成 1／3 筆');
    page.ctx.dispatch({ type: 'setActive', id: 'd2' });
    assert.equal(page.$('sfFitProgress').textContent, '');
    page.ctx.fit.setBarProgress(undefined);
    assert.equal(page.$('sfFitProgress').textContent, '');
});

test('[sasfit-section] ctx.fit 轉給擬合分段；沒有擬合分段時是空動作', () => {
    const page = m4.seqPage({ modules: ['SasFitDataUi', 'SasFitSeqUi'] });
    assert.ok(Object.isFrozen(page.ctx.fit));
    assert.doesNotThrow(() => { page.ctx.fit.forgetRevert(); page.ctx.fit.setBarProgress('x'); });
    assert.equal(page.$('sfFitProgress').textContent, '');
});
