'use strict';
/**
 * sasfit-shape3d.js 的 create：圖卡的「曲線｜結構」切換、3D 區的重畫時機、文字、匯出（計畫 M4 Task 6），
 * 以及互動（Task 7）。stub DOM 與假相依見 tests/sasfit-ui-helpers.js、tests/sasfit-m4-helpers.js。
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
require('./load.js');
const ui = require('./sasfit-ui-helpers.js');
const m4 = require('./sasfit-m4-helpers.js');

const V = globalThis.SasFitShapeView;
const Form = globalThis.SasFitForm;
const ChartTheme = window.ChartTheme;
const setValue = (name, value) => ({ type: 'setValue', name, value: String(value) });
const setModel = (model) => ({ type: 'setModel', model });

after(() => m4.restore());

/** 目前畫面上最後一次重畫用的填色（每個多邊形一個）。 */
function lastFills(page) {
    const calls = page.context.calls;
    const from = calls.map((call) => call.name).lastIndexOf('clearRect');
    return calls.slice(from).filter((call) => call.name === 'fill').map((call) => call.style.fillStyle);
}

// ---------------------------------------------------------------- 模組與註冊
test('[shape3d-ui] 模組匯出 paint 與 create；section-sasfit 把它當第四個模組建立（不是分頁），既有三個的順序不變', () => {
    const page = m4.shapePage();
    assert.equal(typeof globalThis.SasFitShape3d.create, 'function');
    assert.deepEqual(page.Section.SEGMENT_MODULES.map((m) => m.key + ':' + m.global),
        ['data:SasFitDataUi', 'model:SasFitParamsUi', 'fit:SasFitFitUi', 'shape:SasFitShape3d', 'sequence:SasFitSeqUi', 'export:SasFitExportUi']);
    assert.equal(page.observers.length, 1, 'create 只觀察舞台一次');
    assert.equal(page.observers[0].element, page.stage);
});

test('[shape3d-ui] 啟動時是曲線檢視：不建網格、不取 context、不排任何 frame', () => {
    const page = m4.shapePage();
    assert.equal(page.Section.getState().plotView, 'curve');
    assert.equal(page.$('sfViewCurve').getAttribute('aria-pressed'), 'true');
    assert.equal(page.$('sfViewShape').getAttribute('aria-pressed'), 'false');
    assert.ok(page.$('sfViewCurve').classList.contains('active') && !page.$('sfViewShape').classList.contains('active'));
    assert.deepEqual(['sfCurveView', 'sfCurveTools', 'sfShapeView', 'sfShapeTools'].map((id) => page.$(id).hidden), [false, false, true, true]);
    page.act(setValue('radius', 80));
    page.act(setModel('core_shell_sphere'));
    page.observers[0].fn();
    page.document.fire('tps:themechange', { theme: 'dark' });
    assert.equal(page.builds(), 0, '曲線檢視不建網格');
    assert.equal(page.canvas.contexts, 0, '曲線檢視不取 context');
    assert.equal(page.frames.requested, 0);
});

// ---------------------------------------------------------------- 切換
test('[shape3d-ui] 按「結構」：dispatch setPlotView、兩個鈕與兩組區塊互換；按「曲線」換回並多重繪一次', () => {
    const page = m4.shapePage();
    page.$('sfViewShape').fire('click');
    assert.equal(page.Section.getState().plotView, 'shape');
    assert.equal(page.$('sfViewShape').getAttribute('aria-pressed'), 'true');
    assert.equal(page.$('sfViewCurve').getAttribute('aria-pressed'), 'false');
    assert.ok(page.$('sfViewShape').classList.contains('active') && !page.$('sfViewCurve').classList.contains('active'));
    assert.deepEqual(['sfCurveView', 'sfCurveTools', 'sfShapeView', 'sfShapeTools'].map((id) => page.$(id).hidden), [true, true, false, false]);
    assert.equal(page.$('sfPlotTitle').textContent, '結構示意');
    const before = page.plots.views.length;
    page.$('sfViewShape').fire('click');
    assert.equal(page.plots.views.length, before, '已經是結構檢視：不重繪');
    page.$('sfViewCurve').fire('click');
    assert.equal(page.Section.getState().plotView, 'curve');
    assert.deepEqual(['sfCurveView', 'sfCurveTools', 'sfShapeView', 'sfShapeTools'].map((id) => page.$(id).hidden), [false, false, true, true]);
    assert.equal(page.plots.views.length, before + 2, '切回曲線後多一次 ctx.refresh()：圖表在隱藏期間的更新要補畫');
    assert.notEqual(page.$('sfPlotTitle').textContent, '結構示意', '標題交還給資料分段');
});

test('[shape3d-ui] 擬合進行中也能切換檢視', async () => {
    const page = m4.shapePage();
    const input = page.$('sfFileInput');
    input.files = [ui.fixtureFile('SYNTH_sphere_10.dat')];
    input.fire('change');
    await ui.flush();
    await ui.flush();
    page.ctx.dispatch({ type: 'fitStarted' });
    assert.equal(page.Section.getState().fit.phase, 'running');
    page.$('sfViewShape').fire('click');
    assert.equal(page.Section.getState().plotView, 'shape');
    page.frames.flush();
    assert.equal(page.paints(), 1);
    page.$('sfViewCurve').fire('click');
    assert.equal(page.Section.getState().plotView, 'curve');
});

// ---------------------------------------------------------------- 有形狀的模型
test('[shape3d-ui] 切到結構：建網格一次，一個 frame 內重畫一次；畫布的替代文字、尺寸清單、說明都寫入', () => {
    const page = m4.shapePage();
    page.$('sfViewShape').fire('click');
    assert.equal(page.builds(), 1);
    assert.equal(page.paints(), 0, '重畫合併在 requestAnimationFrame 裡');
    assert.equal(page.frames.pending(), 1);
    page.frames.flush();
    assert.equal(page.paints(), 1);
    assert.equal(page.canvas.contexts, 1);
    const text = V.describe(page.ctx.getForm());
    assert.equal(page.canvas.getAttribute('aria-label'), text.alt);
    assert.equal(page.canvas.getAttribute('aria-label'), '均勻球的 3D 示意圖：半徑 R 5.0 nm');
    assert.equal(page.$('sfShapeDims').innerHTML, V.dimsHtml(text.dims));
    assert.match(page.$('sfShapeDims').innerHTML, /<dt>半徑 R<\/dt><dd>5\.0 nm<\/dd>/);
    assert.equal(page.$('sfShapeExtras').textContent, '');
    assert.equal(page.$('sfShapeStatus').textContent, '');
    assert.equal(page.$('sfShapeStage').hidden, false);
    assert.equal(page.$('sfShapeReset').disabled, false);
    // 畫的是球：每個多邊形的顏色來自 shade3d('shapeSolid', k)
    assert.ok(lastFills(page).length > 600);
    assert.ok(lastFills(page).every((colour) => /^rgb\(/.test(colour)));
});

test('[shape3d-ui] 再 render 而形狀參數沒變：不重建、不重畫；只改 scale 或 sld：不重建；改 radius：重建並重畫', () => {
    const page = m4.shapePage();
    page.showShape();
    assert.deepEqual([page.builds(), page.paints()], [1, 1]);
    page.ctx.refresh();
    page.ctx.refresh();
    page.frames.flush();
    assert.deepEqual([page.builds(), page.paints(), page.frames.pending()], [1, 1, 0], '沒變就不排 frame');
    page.act(setValue('scale', 2));
    page.act(setValue('sld', 3));
    page.act({ type: 'setFit', name: 'radius', fit: true });
    page.frames.flush();
    assert.deepEqual([page.builds(), page.paints()], [1, 1]);
    page.act(setValue('radius', 80));
    assert.equal(page.builds(), 2);
    page.act(setValue('radius', 81));
    page.act(setValue('radius', 82));
    assert.equal(page.frames.pending(), 1, '連改三次只排一個 frame');
    page.frames.flush();
    assert.deepEqual([page.builds(), page.paints()], [4, 2]);
    assert.match(page.$('sfShapeDims').innerHTML, /8\.2 nm/);
    assert.equal(page.canvas.getAttribute('aria-label'), '均勻球的 3D 示意圖：半徑 R 8.2 nm');
});

test('[shape3d-ui] 多分散與 S(Q) 只改文字，不重建網格、不重畫', () => {
    const page = m4.shapePage();
    page.showShape();
    page.act({ type: 'togglePd', name: 'radius' });
    page.act({ type: 'setPdField', name: 'radius', field: 'width', value: '0.1' });
    page.act({ type: 'setStructure', structure: 'hardsphere' });
    page.frames.flush();
    assert.deepEqual([page.builds(), page.paints()], [1, 1]);
    assert.equal(page.$('sfShapeExtras').textContent, '半徑 R = 5.0 ± 0.5 nm（gaussian）\nS(Q)：hardsphere，φ = 0.20，R_eff 由模型決定');
});

test('[shape3d-ui] 表單有錯：保留上一張圖並在狀態行說明；改回來後清掉', () => {
    const page = m4.shapePage();
    page.showShape();
    const dims = page.$('sfShapeDims').innerHTML;
    page.act(setValue('radius', 'abc'));
    page.frames.flush();
    assert.equal(page.$('sfShapeStatus').textContent, '參數表有錯誤，示意圖未更新');
    assert.deepEqual([page.builds(), page.paints()], [1, 1]);
    assert.equal(page.$('sfShapeDims').innerHTML, dims);
    assert.equal(page.$('sfShapeStage').hidden, false);
    page.act(setValue('radius', 0));
    assert.equal(page.$('sfShapeStatus').textContent, '這組尺寸畫不出形狀，示意圖未更新');
    page.frames.flush();
    assert.equal(page.paints(), 1);
    page.act(setValue('radius', 50));
    page.frames.flush();
    assert.equal(page.$('sfShapeStatus').textContent, '');
    assert.equal(page.paints(), 1, '回到原來的形狀：畫面上就是它，不必重畫');
});

test('[shape3d-ui] 柔性圓柱：狀態行註明是一個代表性構形，清單是粗線；層狀：說明橫向只是示意', () => {
    const page = m4.shapePage();
    page.showShape();
    page.act(setModel('flexible_cylinder'));
    page.frames.flush();
    assert.equal(page.$('sfShapeStatus').textContent, '圖中是一個代表性構形');
    assert.match(page.$('sfShapeExtras').textContent, /固定亂數種子，未考慮排除體積/);
    assert.match(page.canvas.getAttribute('aria-label'), /柔性圓柱.*一個代表性構形/);
    assert.equal(page.context.only('clip').length, 80, '80 段中心線各一次裁切');
    page.act(setModel('lamellar'));
    page.frames.flush();
    assert.equal(page.$('sfShapeStatus').textContent, '');
    assert.equal(page.$('sfShapeExtras').textContent, '層狀模型的橫向為無限延伸，圖中的寬度只是示意');
});

test('[shape3d-ui] 投影不到 2 像素的尺寸在說明裡多一句（比例取預設縮放）', () => {
    const page = m4.shapePage();
    page.showShape();
    page.act(setModel('core_shell_sphere'));
    page.act(setValue('radius', 2000));
    page.act(setValue('thickness', 1));
    assert.match(page.$('sfShapeExtras').textContent, /殼厚 0\.1 nm 在這個比例下小於 2 像素/);
});

// ---------------------------------------------------------------- 沒有形狀的模型
test('[shape3d-ui] 與形狀無關的模型：狀態行「此模型沒有固定形狀」，舞台、說明與文字收起，清空，重設視角停用', () => {
    const page = m4.shapePage();
    page.showShape();
    for (const model of ['guinier', 'guinier_porod', 'power_law', 'mono_gauss_coil', 'gaussian_peak']) {
        page.act(setModel(model));
        page.frames.flush();
        assert.equal(page.$('sfShapeStatus').textContent, '此模型沒有固定形狀', model);
        assert.deepEqual(['sfShapeStage', 'sfShapeHelp', 'sfShapeText'].map((id) => page.$(id).hidden), [true, true, true], model);
        assert.equal(page.$('sfShapeDims').innerHTML, '');
        assert.equal(page.$('sfShapeExtras').textContent, '');
        assert.equal(page.$('sfShapeReset').disabled, true);
        assert.equal(page.canvas.getAttribute('aria-label'), '尚無示意圖');
    }
    assert.deepEqual([page.builds(), page.paints()], [1, 1], '沒有形狀時不建網格、不重畫');
    page.act(setModel('sphere'));
    page.frames.flush();
    assert.deepEqual(['sfShapeStage', 'sfShapeHelp', 'sfShapeText'].map((id) => page.$(id).hidden), [false, false, false]);
    assert.equal(page.$('sfShapeReset').disabled, false);
    assert.deepEqual([page.builds(), page.paints()], [2, 2], '回到有形狀的模型：重建並重畫');
});

// ---------------------------------------------------------------- 跳脫
test('[shape3d-ui] 尺寸清單的 HTML 已跳脫（標籤或數值含 < 的假資料）；說明以 textContent 寫入', () => {
    const html = V.dimsHtml([{ label: '<img src=x onerror=1>', text: '5.0 <b>nm</b> & "more"' }]);
    assert.ok(!/<img|<b>/.test(html), html);
    assert.match(html, /&lt;img src=x onerror=1&gt;/);
    assert.match(html, /5\.0 &lt;b&gt;nm&lt;\/b&gt; &amp; &quot;more&quot;/);
    const page = m4.shapePage();
    page.showShape();
    assert.equal(page.$('sfShapeExtras').htmlSets, 0, '說明不經 innerHTML');
    assert.equal(page.$('sfShapeStatus').htmlSets, 0);
    assert.ok(page.$('sfShapeDims').htmlSets >= 1);
});

// ---------------------------------------------------------------- 畫布尺寸
test('[shape3d-ui] 後備解析度＝CSS 尺寸 × min(devicePixelRatio, 2)，context 以同一個比例縮放', () => {
    for (const [ratio, used] of [[1, 1], [2, 2], [3, 2], [1.5, 1.5]]) {
        const page = m4.shapePage({ ratio });
        page.showShape();
        assert.deepEqual([page.canvas.width, page.canvas.height], [Math.round(575 * used), Math.round(414 * used)], `devicePixelRatio ${ratio}`);
        assert.deepEqual(page.context.only('setTransform')[0].args, [used, 0, 0, used, 0, 0]);
        assert.deepEqual(page.context.only('clearRect')[0].args, [0, 0, 575, 414], '繪製座標是 CSS 像素');
    }
});

test('[shape3d-ui] 尺寸改變：observeResize 的回呼在一個 frame 內重畫一次；尺寸沒變不重畫；尺寸是 0 不畫', () => {
    const page = m4.shapePage();
    page.showShape();
    page.observers[0].fn();
    page.observers[0].fn();
    assert.equal(page.frames.pending(), 0, '尺寸沒變：不排 frame');
    [page.stage.clientWidth, page.stage.clientHeight] = [420, 368];
    page.observers[0].fn();
    page.observers[0].fn();
    assert.equal(page.frames.pending(), 1);
    page.frames.flush();
    assert.equal(page.paints(), 2);
    assert.deepEqual([page.canvas.width, page.canvas.height], [420, 368]);
    assert.equal(page.builds(), 1, '不重建網格');
    [page.stage.clientWidth, page.stage.clientHeight] = [0, 0];
    page.observers[0].fn();
    page.frames.flush();
    assert.equal(page.paints(), 2);
});

test('[shape3d-ui] 舞台還沒有尺寸時切到結構：先不畫，尺寸出現後才畫', () => {
    const page = m4.shapePage({ size: [0, 0] });
    page.showShape();
    assert.equal(page.paints(), 0);
    assert.equal(page.builds(), 1);
    [page.stage.clientWidth, page.stage.clientHeight] = [448, 353];
    page.observers[0].fn();
    page.frames.flush();
    assert.equal(page.paints(), 1);
});

// ---------------------------------------------------------------- 主題與列印
test('[shape3d-ui] 主題切換：以新主題重畫一次，不重建網格；曲線檢視時不畫', () => {
    const page = m4.shapePage();
    page.showShape();
    const light = lastFills(page);
    page.document.fire('tps:themechange', { theme: 'dark' });
    assert.equal(page.frames.pending(), 1);
    page.frames.flush();
    assert.deepEqual([page.builds(), page.paints()], [1, 2]);
    const dark = lastFills(page);
    assert.notDeepEqual(dark, light);
    assert.ok(dark.includes(ChartTheme.shade3d('shapeSolid', 1, 'dark')) || dark.every((colour) => colour !== ChartTheme.shade3d('shapeSolid', 1, 'light')));
    page.document.fire('tps:themechange', { theme: 'dark' });
    assert.equal(page.frames.pending(), 0, '同一個主題：不重畫');
    page.$('sfViewCurve').fire('click');
    page.document.fire('tps:themechange', { theme: 'light' });
    page.frames.flush();
    assert.equal(page.paints(), 2);
    page.showShape();
    assert.equal(page.paints(), 3, '回到結構檢視時以目前的主題補畫');
    assert.deepEqual(lastFills(page), light);
});

test('[shape3d-ui] 列印：beforeprint 立刻以淺色重畫，afterprint 換回；曲線檢視時不畫', () => {
    const page = m4.shapePage();
    assert.equal(page.windowListeners.beforeprint.length, 1);
    assert.equal(page.windowListeners.afterprint.length, 1);
    page.windowListeners.beforeprint[0].fn();
    assert.equal(page.paints(), 0);
    page.windowListeners.afterprint[0].fn();
    page.showShape();
    const light = lastFills(page);
    page.document.fire('tps:themechange', { theme: 'dark' });
    page.frames.flush();
    const dark = lastFills(page);
    page.windowListeners.beforeprint[0].fn();
    assert.equal(page.paints(), 3, '同步重畫（frame 來不及）');
    assert.deepEqual(lastFills(page), light);
    page.windowListeners.afterprint[0].fn();
    assert.equal(page.paints(), 4);
    assert.deepEqual(lastFills(page), dark);
});

// ---------------------------------------------------------------- 匯出
test('[shape3d-ui] exportBlob：離屏畫布、淺色白底、寬 1200、同一個視角與比例尺；畫面上的畫布不被動到', async () => {
    const page = m4.shapePage();
    const { segment } = page;
    assert.equal(await segment.exportBlob(), null, '曲線檢視：null');
    page.showShape();
    page.document.fire('tps:themechange', { theme: 'dark' });
    page.frames.flush();
    const before = page.context.calls.length;
    const blob = await segment.exportBlob();
    assert.equal(page.context.calls.length, before, '畫面上的畫布沒有任何新的繪製呼叫');
    assert.equal(page.canvases.length, 1);
    assert.deepEqual([blob.type, blob.width, blob.height], ['image/png', 1200, Math.round(414 * 1200 / 575)]);
    const off = blob.context;
    assert.deepEqual(off.only('setTransform')[0].args, [1200 / 575, 0, 0, 1200 / 575, 0, 0]);
    assert.equal(off.only('fillRect')[0].style.fillStyle, ChartTheme.palette('light').surface);
    assert.equal(off.only('clearRect').length, 0);
    assert.equal(off.only('fillText')[0].args[0], '2 nm', '含比例尺');
    const fills = off.only('fill').map((call) => call.style.fillStyle);
    const list = V.drawList(globalThis.SasFitShapeGeom.build('sphere', { radius: 50 }), V.DEFAULT_VIEW, { width: 575, height: 414 });
    assert.equal(fills.length, list.items.length);
    assert.equal(fills[0], ChartTheme.shade3d('shapeSolid', Math.round(list.items[0].k * 255) / 255, 'light'), '深色主題下匯出仍是淺色');
    page.act({ type: 'setModel', model: 'guinier' });
    assert.equal(await segment.exportBlob(), null, '沒有形狀：null');
});

// ================================================================ 互動（Task 7）
const view = (page) => page.segment.view();
const spinning = (page) => page.$('sfShapeSpin').getAttribute('aria-pressed') === 'true';
const down = (page, id, x, y, extra) => page.stage.fire('pointerdown', { pointerId: id, clientX: x, clientY: y, pointerType: 'mouse', button: 0, ...extra });
const move = (page, id, x, y, extra) => page.stage.fire('pointermove', { pointerId: id, clientX: x, clientY: y, pointerType: 'mouse', ...extra });
const up = (page, id, type = 'pointerup') => page.stage.fire(type, { pointerId: id });

test('[shape3d-ui] 拖曳：水平移動改 yaw、垂直移動改 pitch（滑鼠），合併在一個 frame 重畫；放開後結束', () => {
    const page = m4.shapePage();
    page.showShape();
    assert.deepEqual(view(page), V.DEFAULT_VIEW);
    down(page, 1, 100, 100);
    assert.ok(page.stage.classList.contains('is-dragging'));
    assert.deepEqual(page.captures, [1], '捕捉指標：拖出畫布外仍然跟得上');
    move(page, 1, 140, 100);
    assert.deepEqual(view(page), { yaw: 25, pitch: 20, zoom: 1 }, '往右拖 40 px：物體跟著指標轉（yaw 減少 20°）');
    move(page, 1, 140, 110);
    move(page, 1, 140, 120);
    assert.deepEqual(view(page), { yaw: 25, pitch: 30, zoom: 1 }, '往下拖：從上方看（pitch 增加）');
    assert.equal(page.frames.pending(), 1, '三次移動只排一個 frame');
    page.frames.flush();
    assert.equal(page.paints(), 2);
    assert.equal(page.builds(), 1, '旋轉不重建網格');
    up(page, 1);
    assert.ok(!page.stage.classList.contains('is-dragging'));
    assert.deepEqual(page.captures, []);
    move(page, 1, 300, 300);
    assert.deepEqual(view(page), { yaw: 25, pitch: 30, zoom: 1 }, '放開後的移動不再旋轉');
    down(page, 2, 0, 0);
    up(page, 2, 'pointercancel');
    assert.ok(!page.stage.classList.contains('is-dragging'), 'pointercancel 也結束拖曳');
    move(page, 2, 50, 0);
    assert.deepEqual(view(page), { yaw: 25, pitch: 30, zoom: 1 });
});

test('[shape3d-ui] 拖曳：滑鼠只認主鍵；pitch 夾在 ±89°；觸控只改 yaw', () => {
    const page = m4.shapePage();
    page.showShape();
    down(page, 1, 0, 0, { button: 2 });
    move(page, 1, 100, 0);
    assert.deepEqual(view(page), V.DEFAULT_VIEW, '右鍵不旋轉');
    up(page, 1);
    down(page, 1, 0, 0);
    move(page, 1, 0, 1000);
    assert.equal(view(page).pitch, 89);
    up(page, 1);
    const before = view(page);
    down(page, 5, 200, 200, { pointerType: 'touch' });
    move(page, 5, 180, 260, { pointerType: 'touch' });
    assert.deepEqual(view(page), { yaw: before.yaw + 10, pitch: before.pitch, zoom: 1 }, '觸控：垂直位移不改仰角');
    up(page, 5);
});

test('[shape3d-ui] setPointerCapture 丟例外（合成事件、指標已不在）時拖曳照常運作', () => {
    const page = m4.shapePage();
    page.showShape();
    page.stage.setPointerCapture = () => { throw new Error('No active pointer with the given id is found.'); };
    page.stage.releasePointerCapture = () => { throw new Error('No active pointer with the given id is found.'); };
    down(page, 9, 10, 10, { pointerType: 'touch' });
    move(page, 9, 30, 10, { pointerType: 'touch' });
    up(page, 9);
    assert.deepEqual(view(page), { yaw: 35, pitch: 20, zoom: 1 });
    assert.ok(!page.stage.classList.contains('is-dragging'));
});

test('[shape3d-ui] 兩指：距離加倍 → zoom 約 ×2，不旋轉；縮回去 → 回到原來的 zoom；夾在範圍內', () => {
    const page = m4.shapePage();
    page.showShape();
    down(page, 1, 100, 100, { pointerType: 'touch' });
    down(page, 2, 200, 100, { pointerType: 'touch' });
    move(page, 2, 300, 100, { pointerType: 'touch' });
    assert.ok(Math.abs(view(page).zoom - 2) < 1e-9);
    assert.deepEqual([view(page).yaw, view(page).pitch], [45, 20], '兩指時不旋轉');
    move(page, 1, 200, 100, { pointerType: 'touch' });
    assert.ok(Math.abs(view(page).zoom - 1) < 1e-9);
    move(page, 2, 5000, 100, { pointerType: 'touch' });
    assert.equal(view(page).zoom, 4);
    up(page, 2);
    move(page, 1, 210, 100, { pointerType: 'touch' });
    assert.equal(view(page).yaw, 40, '剩一指：回到旋轉，位置不跳');
    up(page, 1);
});

test('[shape3d-ui] 鍵盤：方向鍵旋轉、+ − 縮放、0 與 Home 重設，都取消預設行為；其他鍵不處理', () => {
    const page = m4.shapePage();
    page.showShape();
    const key = (name, extra) => page.stage.fire('keydown', { key: name, ...extra });
    const left = key('ArrowLeft');
    assert.equal(left.defaultPrevented, true);
    assert.deepEqual(view(page), { yaw: 40, pitch: 20, zoom: 1 });
    assert.equal(page.frames.pending(), 1);
    page.frames.flush();
    assert.equal(page.paints(), 2);
    for (const [name, expected] of [['ArrowRight', { yaw: 45, pitch: 20, zoom: 1 }], ['ArrowUp', { yaw: 45, pitch: 25, zoom: 1 }],
        ['ArrowDown', { yaw: 45, pitch: 20, zoom: 1 }]]) {
        assert.equal(key(name).defaultPrevented, true, name);
        assert.deepEqual(view(page), expected, name);
    }
    assert.equal(key('+').defaultPrevented, true);
    assert.ok(Math.abs(view(page).zoom - 1.1) < 1e-9);
    key('-');
    key('-');
    assert.ok(Math.abs(view(page).zoom - 1 / 1.1) < 1e-9);
    key('ArrowLeft');
    assert.equal(key('Home').defaultPrevented, true);
    assert.deepEqual(view(page), V.DEFAULT_VIEW);
    key('ArrowUp');
    assert.equal(key('0').defaultPrevented, true);
    assert.deepEqual(view(page), V.DEFAULT_VIEW);
    page.frames.flush();
    const paints = page.paints();
    for (const name of ['a', 'Tab', 'Enter', ' ', 'PageDown', 'Escape']) {
        assert.equal(key(name).defaultPrevented, false, name);
        assert.equal(page.frames.pending(), 0, name);
    }
    assert.equal(page.paints(), paints);
    // 瀏覽器自己的快速鍵（Ctrl/⌘ ＋ 加減、0）不攔
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
        assert.equal(key('+', extra).defaultPrevented, false);
        assert.equal(key('0', extra).defaultPrevented, false);
        assert.deepEqual(view(page), V.DEFAULT_VIEW);
    }
});

test('[shape3d-ui] 滾輪：沒按 Ctrl 不攔截（頁面照常捲動）；Ctrl＋滾輪縮放並取消預設；以 passive: false 註冊', () => {
    const page = m4.shapePage();
    page.showShape();
    assert.deepEqual(page.stage.listenerOptions.wheel, [{ passive: false }]);
    const plain = page.stage.fire('wheel', { deltaY: -120, ctrlKey: false });
    assert.equal(plain.defaultPrevented, false);
    assert.deepEqual(view(page), V.DEFAULT_VIEW);
    assert.equal(page.frames.pending(), 0);
    const zoomIn = page.stage.fire('wheel', { deltaY: -10, ctrlKey: true });
    assert.equal(zoomIn.defaultPrevented, true);
    assert.ok(view(page).zoom > 1 && view(page).zoom < 1.3);
    const afterIn = view(page).zoom;
    page.stage.fire('wheel', { deltaY: 10, ctrlKey: true });
    assert.ok(Math.abs(view(page).zoom - 1) < 1e-9, '反方向同樣的量回到原來的倍率');
    page.stage.fire('wheel', { deltaY: -100000, ctrlKey: true });
    assert.ok(view(page).zoom <= afterIn * 1.5, '單一事件的倍率有上限（滑鼠滾輪一格不會跳好幾倍）');
    for (let i = 0; i < 60; i++) page.stage.fire('wheel', { deltaY: -500, ctrlKey: true });
    assert.equal(view(page).zoom, 4);
    assert.equal(page.frames.pending(), 1);
});

test('[shape3d-ui] 「重設視角」回到預設視角；放大時狀態行提醒只看得到中央', () => {
    const page = m4.shapePage();
    page.showShape();
    page.stage.fire('keydown', { key: 'ArrowLeft' });
    page.stage.fire('keydown', { key: '+' });
    assert.match(page.$('sfShapeStatus').textContent, /已放大/);
    page.$('sfShapeReset').fire('click');
    assert.deepEqual(view(page), V.DEFAULT_VIEW);
    assert.equal(page.$('sfShapeStatus').textContent, '');
    page.frames.flush();
    assert.equal(page.paints(), 1, '轉走再轉回，中間沒有畫過：畫面上還是預設視角那一張，不必重畫');
    page.stage.fire('keydown', { key: '-' });
    assert.equal(page.$('sfShapeStatus').textContent, '', '縮小不需要提醒');
});

test('[shape3d-ui] 曲線檢視或沒有形狀時，舞台上的事件不改視角、不排 frame', () => {
    const page = m4.shapePage();
    down(page, 1, 0, 0);
    move(page, 1, 50, 50);
    up(page, 1);
    assert.equal(page.stage.fire('keydown', { key: 'ArrowLeft' }).defaultPrevented, false);
    assert.equal(page.stage.fire('wheel', { deltaY: -10, ctrlKey: true }).defaultPrevented, false);
    assert.deepEqual(view(page), V.DEFAULT_VIEW);
    assert.equal(page.frames.requested, 0);
});

// ---------------------------------------------------------------- 自動旋轉
test('[shape3d-ui] 自動旋轉預設關閉；按下後 aria-pressed、以 raf 排程，yaw 的增量與時間差成正比', () => {
    const page = m4.shapePage();
    page.showShape();
    assert.equal(spinning(page), false);
    assert.equal(page.$('sfShapeSpin').disabled, false);
    assert.equal(page.frames.pending(), 0, '沒開自動旋轉就沒有任何 frame 在排');
    page.$('sfShapeSpin').fire('click');
    assert.equal(spinning(page), true);
    assert.equal(page.frames.pending(), 1);
    page.frames.flush(1000);                 // 第一格只記時間
    assert.deepEqual(view(page), V.DEFAULT_VIEW);
    page.frames.flush(1100);
    const first = view(page).yaw - 45;
    assert.ok(first > 0, '往同一個方向轉');
    page.frames.flush(1300);
    const second = view(page).yaw - 45 - first;
    assert.ok(Math.abs(second - 2 * first) < 1e-9, `200 ms 的增量是 100 ms 的兩倍（${first}、${second}）`);
    assert.equal(view(page).pitch, 20);
    assert.equal(page.paints(), 3, '每一格重畫一次');
    assert.equal(page.frames.pending(), 1, '只有一個迴圈');
    assert.equal(page.builds(), 1);
});

test('[shape3d-ui] 自動旋轉上限 30 fps：太快來的 frame 不畫也不轉；停很久之後不會一次轉一大步', () => {
    const page = m4.shapePage();
    page.showShape();
    page.$('sfShapeSpin').fire('click');
    page.frames.flush(0);
    page.frames.flush(100);
    const yaw = view(page).yaw;
    const paints = page.paints();
    page.frames.flush(110);
    page.frames.flush(120);
    assert.equal(view(page).yaw, yaw);
    assert.equal(page.paints(), paints);
    assert.equal(page.frames.pending(), 1);
    page.frames.flush(134);
    assert.ok(view(page).yaw > yaw, '滿 1/30 秒才前進');
    const before = view(page).yaw;
    page.frames.flush(60000);
    assert.ok(view(page).yaw - before < 10, '分頁被節流後的第一格不會轉一大步');
});

test('[shape3d-ui] 自動旋轉：再按一次 cancelRaf；任何路徑都只有一個迴圈', () => {
    const page = m4.shapePage();
    page.showShape();
    const spin = page.$('sfShapeSpin');
    spin.fire('click');
    page.ctx.refresh();
    page.ctx.refresh();
    page.observers[0].fn();
    page.document.fire('visibilitychange');
    page.document.fire('click');
    assert.equal(page.frames.pending(), 1);
    spin.fire('click');
    assert.equal(spinning(page), false);
    assert.equal(page.frames.pending(), 0);
    assert.equal(page.frames.cancelled, 1);
    spin.fire('click');
    spin.fire('click');
    spin.fire('click');
    assert.equal(page.frames.pending(), 1);
    page.frames.flush(0);
    page.frames.flush(50);
    assert.equal(page.frames.pending(), 1);
});

test('[shape3d-ui] 自動旋轉在切回曲線、擬合進行中、頁面隱藏、離開本分頁、拖曳中都停止排程；條件恢復後續轉', async () => {
    const page = m4.shapePage();
    const input = page.$('sfFileInput');
    input.files = [ui.fixtureFile('SYNTH_sphere_10.dat')];
    input.fire('change');
    await ui.flush();
    await ui.flush();
    page.showShape();
    page.$('sfShapeSpin').fire('click');
    const running = () => page.frames.pending() === 1;
    const settle = () => { page.frames.flush(0); page.frames.flush(40); page.frames.flush(80); };
    settle();
    assert.ok(running());

    page.$('sfViewCurve').fire('click');
    settle();
    assert.ok(!running(), '曲線檢視');
    assert.equal(spinning(page), true, '開關的狀態保留');
    page.$('sfViewShape').fire('click');
    assert.ok(page.frames.pending() >= 1, '回到結構檢視：續轉');
    settle();

    page.ctx.dispatch({ type: 'fitStarted' });
    settle();
    assert.ok(!running(), '擬合進行中');
    page.ctx.dispatch({ type: 'fitSettled', result: null });
    assert.ok(running(), '擬合結束：續轉');

    page.document.hidden = true;
    page.document.fire('visibilitychange');
    settle();
    assert.ok(!running(), '頁面隱藏');
    page.document.hidden = false;
    page.document.fire('visibilitychange');
    assert.ok(running());

    page.$('section-sasfit').classList.remove('active');
    settle();
    assert.ok(!running(), '離開本分頁');
    page.$('section-sasfit').classList.add('active');
    page.document.fire('click');
    assert.ok(running(), '側欄點回來：續轉');

    down(page, 1, 0, 0);
    settle();
    assert.ok(!running(), '拖曳中');
    up(page, 1);
    assert.ok(running());

    const before = view(page).yaw;
    page.frames.flush(1000);
    page.frames.flush(1100);
    assert.ok(view(page).yaw > before, '恢復後確實在轉');
});

test('[shape3d-ui] 沒有形狀的模型：自動旋轉停用並停止', () => {
    const page = m4.shapePage();
    page.showShape();
    page.$('sfShapeSpin').fire('click');
    page.act(setModel('guinier'));
    page.frames.flush(0);
    page.frames.flush(50);
    assert.equal(page.$('sfShapeSpin').disabled, true);
    assert.equal(page.frames.pending(), 0);
    page.act(setModel('sphere'));
    assert.equal(page.$('sfShapeSpin').disabled, false);
    assert.ok(page.frames.pending() >= 1);
});

test('[shape3d-ui] prefers-reduced-motion：自動旋轉停用、title 與說明補一句，不排任何 frame', () => {
    const page = m4.shapePage({ reducedMotion: true });
    assert.deepEqual(page.queries, [], '曲線檢視時不查詢');
    page.showShape();
    assert.ok(page.queries.includes('(prefers-reduced-motion: reduce)'));
    const spin = page.$('sfShapeSpin');
    assert.equal(spin.disabled, true);
    assert.equal(spin.getAttribute('title'), '系統設定為減少動態效果，已停用自動旋轉');
    assert.match(page.$('sfShapeHelp').textContent, /系統設定為減少動態效果，已停用自動旋轉/);
    spin.fire('click');
    assert.equal(spinning(page), false);
    assert.equal(page.frames.pending(), 0);
    // 沒有這個設定時：沒有 title，說明是原來那一句
    const normal = m4.shapePage();
    normal.showShape();
    assert.equal(normal.$('sfShapeSpin').getAttribute('title'), null);
    assert.equal(normal.$('sfShapeHelp').textContent, '拖曳旋轉；Ctrl＋滾輪或兩指縮放；按比例繪製（正交投影），不能平移');
});

test('[shape3d-ui] 開著自動旋轉時系統改成減少動態：下一次重繪就停', () => {
    const page = m4.shapePage();
    page.showShape();
    page.$('sfShapeSpin').fire('click');
    page.media.matches = true;
    page.ctx.refresh();
    page.frames.flush(0);
    page.frames.flush(50);
    assert.equal(page.frames.pending(), 0);
    assert.equal(spinning(page), false);
    assert.equal(page.$('sfShapeSpin').disabled, true);
});

test('[shape3d-ui] 觸控裝置（pointer: coarse）：說明補一句只能左右旋轉', () => {
    const page = m4.shapePage({ coarse: true });
    page.showShape();
    assert.match(page.$('sfShapeHelp').textContent, /觸控時只能左右旋轉/);
});

test('[shape3d-ui] create 綁定的監聽器數目固定；section 只建立一次', () => {
    const page = m4.shapePage();
    assert.equal(page.creates(), 1);
    assert.equal(page.Section.init(), true);
    assert.equal(page.creates(), 1, '第二次 init 不再 create');
    const counts = Object.fromEntries(['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'keydown', 'wheel']
        .map((type) => [type, page.stage.listenerCount(type)]));
    assert.deepEqual(counts, { pointerdown: 1, pointermove: 1, pointerup: 1, pointercancel: 1, keydown: 1, wheel: 1 });
    for (const id of ['sfViewCurve', 'sfViewShape', 'sfShapeReset', 'sfShapeSpin']) assert.equal(page.$(id).listenerCount('click'), 1, id);
    assert.equal(page.document.listenerCount('visibilitychange'), 1);
    assert.equal(page.windowListeners.beforeprint.length, 1);
    assert.equal(page.observers.length, 1);
});
