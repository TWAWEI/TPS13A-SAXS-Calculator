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
        ['data:SasFitDataUi', 'model:SasFitParamsUi', 'fit:SasFitFitUi', 'shape:SasFitShape3d']);
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
