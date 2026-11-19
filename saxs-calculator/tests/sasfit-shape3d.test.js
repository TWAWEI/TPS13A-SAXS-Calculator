'use strict';
/**
 * sasfit-shape3d.js：Canvas 繪製器 paint（計畫 M4 Task 5）。假的 2D context 記錄每一個呼叫與當時的樣式；
 * ChartTheme、SasFitShapeView、SasFitShapeGeom 都用真的。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SasFitShape3d: S, SasFitShapeView: V, SasFitShapeGeom: G, ChartTheme } = require('./load.js');

const SIZE = Object.freeze({ width: 400, height: 300 });
const STYLE_KEYS = ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'font', 'textAlign', 'textBaseline'];
const METHODS = ['save', 'restore', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke',
    'arc', 'clip', 'fillText'];

/** 假的 2D context：calls 是 { name, args, style }（style＝呼叫當下的樣式）；save／restore 會還原樣式。 */
function fakeContext() {
    const calls = [];
    const stack = [];
    let style = { fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', font: '', textAlign: 'start', textBaseline: 'alphabetic' };
    const ctx = { calls };
    STYLE_KEYS.forEach((key) => Object.defineProperty(ctx, key, { get: () => style[key], set: (value) => { style = { ...style, [key]: value }; } }));
    METHODS.forEach((name) => {
        ctx[name] = (...args) => {
            if (name === 'save') stack.push(style);
            if (name === 'restore') style = stack.pop();
            calls.push({ name, args, style });
        };
    });
    ctx.depth = () => stack.length;
    return ctx;
}

const names = (ctx) => ctx.calls.map((call) => call.name);
const only = (ctx, name) => ctx.calls.filter((call) => call.name === name);
const shadeOf = (role, k, theme) => ChartTheme.shade3d(role, Math.round(k * 255) / 255, theme);
const polygon = (points, role = 'shapeSolid', k = 0.5) => ({ kind: 'polygon', points, role, k, part: 0 });

test('[shape3d] 模組只匯出凍結的物件；頂層不碰 document（Node 載入時沒有 document）', () => {
    assert.equal(typeof document, 'undefined');
    assert.equal(typeof S.paint, 'function');
    assert.ok(Object.isFrozen(S));
});

test('[shape3d] polygon：路徑、以 shade3d 的顏色填滿，再以同一個顏色描 0.75 px 的邊', () => {
    const ctx = fakeContext();
    S.paint(ctx, { items: [polygon([10, 20, 30, 20, 30, 40, 10, 40], 'shapeCore', 0.4)] }, { theme: 'light', size: SIZE });
    assert.deepEqual(names(ctx), ['save', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'lineTo', 'lineTo', 'closePath', 'fill', 'stroke', 'restore']);
    assert.deepEqual(only(ctx, 'moveTo')[0].args, [10, 20]);
    assert.deepEqual(only(ctx, 'lineTo').map((call) => call.args), [[30, 20], [30, 40], [10, 40]]);
    const colour = shadeOf('shapeCore', 0.4, 'light');
    assert.equal(only(ctx, 'fill')[0].style.fillStyle, colour);
    const stroke = only(ctx, 'stroke')[0].style;
    assert.equal(stroke.strokeStyle, colour, '邊與面同色：蓋掉相鄰多邊形之間的反鋸齒細縫');
    assert.equal(stroke.lineWidth, 0.75);
    assert.equal(stroke.lineJoin, 'round');
    assert.deepEqual(only(ctx, 'clearRect')[0].args, [0, 0, 400, 300]);
});

test('[shape3d] 面不以輪廓色描邊；淺色與深色的顏色不同；角色不同顏色不同', () => {
    const scene = G.build('core_shell_sphere', { radius: 60, thickness: 10 });
    const list = V.drawList(scene, V.DEFAULT_VIEW, SIZE);
    const paintIn = (theme) => { const ctx = fakeContext(); S.paint(ctx, list, { theme, size: SIZE }); return ctx; };
    const [light, dark] = [paintIn('light'), paintIn('dark')];
    assert.equal(only(light, 'fill').length, list.items.length);
    assert.equal(only(light, 'stroke').length, list.items.length);
    for (const [ctx, theme] of [[light, 'light'], [dark, 'dark']]) {
        const edge = ChartTheme.palette(theme).shapeEdge;
        assert.ok(only(ctx, 'stroke').every((call) => call.style.strokeStyle !== edge), '沒有任何面以 shapeEdge 描邊');
        only(ctx, 'fill').forEach((call, i) => {
            assert.equal(call.style.fillStyle, shadeOf(list.items[i].role, list.items[i].k, theme));
            assert.equal(only(ctx, 'stroke')[i].style.strokeStyle, call.style.fillStyle);
        });
    }
    assert.notDeepEqual(only(light, 'fill').map((c) => c.style.fillStyle), only(dark, 'fill').map((c) => c.style.fillStyle));
    const colours = (role) => new Set(only(light, 'fill').filter((_, i) => list.items[i].role === role).map((c) => c.style.fillStyle));
    const [core, shell] = [colours('shapeCore'), colours('shapeShell')];
    assert.ok(core.size > 5 && shell.size > 5);
    assert.ok([...core].every((colour) => !shell.has(colour)), '核與殼的顏色不重疊');
    assert.ok(light.calls.every((call) => /^rgb\(\d+, \d+, \d+\)$|^$/.test(String(call.style.fillStyle))), '面的顏色都來自 shade3d');
});

test('[shape3d] stroke：先裁切到自己的輪廓，畫輪廓色的圓頭粗線（寬＋2），再依序畫 fill 的各條線，最後還原', () => {
    const fill = [{ points: [5, 5, 50, 50], width: 20, k: 0.2 }, { points: [50, 50, 90, 50], width: 20, k: 0.6 }, { points: [47, 46, 87, 46], width: 8, k: 0.9 }];
    const item = { kind: 'stroke', points: [50, 50, 90, 50], width: 20, role: 'shapeSolid', k: 0.6, depth: 0, fill };
    const ctx = fakeContext();
    S.paint(ctx, { items: [item] }, { theme: 'dark', size: SIZE });
    assert.deepEqual(names(ctx), ['save', 'clearRect', 'save', 'beginPath', 'arc', 'arc', 'closePath', 'clip',
        'beginPath', 'moveTo', 'lineTo', 'stroke', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'beginPath', 'moveTo', 'lineTo', 'stroke',
        'beginPath', 'moveTo', 'lineTo', 'stroke', 'restore', 'restore']);
    // 裁切的路徑：兩端各一個半圓，半徑＝寬/2＋1
    const arcs = only(ctx, 'arc');
    assert.deepEqual(arcs.map((call) => call.args.slice(0, 3)), [[90, 50, 11], [50, 50, 11]]);
    assert.ok(Math.abs(arcs[0].args[3] + Math.PI / 2) < 1e-12 && Math.abs(arcs[0].args[4] - Math.PI / 2) < 1e-12, '水平線段的右端：−90° 到 90°');
    const strokes = only(ctx, 'stroke');
    assert.equal(strokes[0].style.strokeStyle, ChartTheme.palette('dark').shapeEdge);
    assert.equal(strokes[0].style.lineWidth, 22);
    assert.ok(strokes.every((call) => call.style.lineCap === 'round'));
    assert.deepEqual(strokes.slice(1).map((call) => call.style.lineWidth), [20, 20, 8]);
    assert.deepEqual(strokes.slice(1).map((call) => call.style.strokeStyle), fill.map((part) => shadeOf('shapeSolid', part.k, 'dark')));
    assert.deepEqual(only(ctx, 'moveTo').map((call) => call.args), [[50, 50], [5, 5], [50, 50], [47, 46]]);
    assert.equal(only(ctx, 'fill').length, 0);
});

test('[shape3d] 柔性圓柱的整份清單：每一段一次 clip，save／restore 成對', () => {
    const scene = G.build('flexible_cylinder', { length: 1000, kuhn_length: 100, radius: 20 });
    const list = V.drawList(scene, V.DEFAULT_VIEW, SIZE);
    const ctx = fakeContext();
    S.paint(ctx, list, { theme: 'light', size: SIZE });
    assert.equal(only(ctx, 'clip').length, scene.segments);
    assert.equal(only(ctx, 'save').length, scene.segments + 1);
    assert.equal(only(ctx, 'restore').length, scene.segments + 1);
    assert.equal(ctx.depth(), 0);
    assert.equal(only(ctx, 'stroke').length, list.items.reduce((sum, item) => sum + 1 + item.fill.length, 0));
});

test('[shape3d] 比例尺：左下角一條輪廓色的線與文字色的標籤', () => {
    const ctx = fakeContext();
    const bar = V.scaleBar(2, 400);
    S.paint(ctx, { items: [] }, { theme: 'light', size: SIZE, bar });
    const palette = ChartTheme.palette('light');
    const stroke = only(ctx, 'stroke')[0];
    assert.equal(stroke.style.strokeStyle, palette.shapeEdge);
    assert.equal(stroke.style.lineCap, 'butt');
    const xs = only(ctx, 'moveTo').concat(only(ctx, 'lineTo')).map((call) => call.args[0]);
    const ys = only(ctx, 'moveTo').concat(only(ctx, 'lineTo')).map((call) => call.args[1]);
    assert.equal(Math.max(...xs) - Math.min(...xs), bar.pixels, '線長＝比例尺的像素數');
    assert.ok(Math.min(...xs) < 20 && Math.max(...ys) > SIZE.height - 20 && Math.max(...ys) < SIZE.height, '在左下角、畫布之內');
    const text = only(ctx, 'fillText')[0];
    assert.equal(text.args[0], bar.label);
    assert.equal(text.style.fillStyle, palette.text);
    assert.ok(text.style.font.includes(ChartTheme.FONT) && /^\d+px /.test(text.style.font));
    assert.ok(text.args[2] < Math.max(...ys), '標籤在線的上方');
    // 沒有比例尺就不畫
    const none = fakeContext();
    S.paint(none, { items: [] }, { theme: 'light', size: SIZE, bar: null });
    assert.deepEqual(names(none), ['save', 'clearRect', 'restore']);
});

test('[shape3d] background: true 先以淺色的卡片底色填滿（PNG 用），不 clearRect；深色主題下也是淺色底', () => {
    for (const theme of ['light', 'dark']) {
        const ctx = fakeContext();
        S.paint(ctx, { items: [polygon([0, 0, 10, 0, 10, 10])] }, { theme, size: SIZE, background: true });
        assert.deepEqual(names(ctx).slice(0, 3), ['save', 'fillRect', 'beginPath']);
        assert.equal(only(ctx, 'fillRect')[0].style.fillStyle, ChartTheme.palette('light').surface);
        assert.deepEqual(only(ctx, 'fillRect')[0].args, [0, 0, 400, 300]);
        assert.equal(only(ctx, 'clearRect').length, 0);
    }
});

test('[shape3d] 清單為空、list 為 null 都不丟錯；缺 size 丟 Error；畫到一半出錯也會 restore', () => {
    for (const list of [{ items: [] }, null, undefined, {}]) {
        const ctx = fakeContext();
        S.paint(ctx, list, { theme: 'light', size: SIZE });
        assert.deepEqual(names(ctx), ['save', 'clearRect', 'restore']);
    }
    assert.throws(() => S.paint(fakeContext(), { items: [] }, { theme: 'light' }), /size/);
    assert.throws(() => S.paint(fakeContext(), { items: [] }), /size/);
    const ctx = fakeContext();
    assert.throws(() => S.paint(ctx, { items: [polygon([0, 0, 1, 0, 1, 1], 'noSuchRole')] }, { theme: 'light', size: SIZE }), /3D 角色/);
    assert.equal(ctx.depth(), 0, '出錯後 save／restore 仍成對');
});

test('[shape3d] 省略 theme 時用目前生效的主題；不認得的項目種類略過', () => {
    const ctx = fakeContext();
    S.paint(ctx, { items: [polygon([0, 0, 10, 0, 10, 10], 'shapeShell', 1), { kind: 'label', text: 'x' }] }, { size: SIZE });
    assert.equal(only(ctx, 'fill')[0].style.fillStyle, ChartTheme.shade3d('shapeShell', 1));
    assert.equal(only(ctx, 'fill').length, 1);
});

test('[shape3d] 原始碼沒有顏色字面值，顏色只經 ChartTheme（shade3d 與 palette 的鍵）', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'sasfit-shape3d.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(source, /(?<![&\w])#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/);
    assert.match(source, /shade3d\(/);
    assert.match(source, /palette\.shapeEdge/);
});
