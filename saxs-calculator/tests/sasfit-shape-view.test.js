'use strict';
/**
 * sasfit-shape-view.js：視角、正交投影、亮度、粗線、比例尺、nm 標註與文字描述（計畫 M4 Task 4 Step 1）。
 * 繪製順序在 sasfit-shape-order.test.js。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitShapeGeom: G, SasFitShapeView: V, SasFitForm: Form } = require('./load.js');

const SIZE = Object.freeze({ width: 600, height: 400 });
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

/** 表單：模型＋一串 reduce 動作。 */
const formOf = (model, actions = []) => actions.reduce((form, action) => Form.reduce(form, action), Form.create(model));
const setValue = (name, value) => ({ type: 'setValue', name, value: String(value) });

/** 一個點在畫面上的位置（本檔自己的投影，用來檢查不變量）。 */
function screenOf(point, view, size, ppa) {
    const { right, up } = V.basis(view);
    return [size.width / 2 + ppa * dot(point, right), size.height / 2 - ppa * dot(point, up)];
}

// ---------------------------------------------------------------- 視角 reducer
test('[shape-view] 常數：預設視角、縮放範圍、鍵盤步進', () => {
    assert.deepEqual(V.DEFAULT_VIEW, { yaw: 45, pitch: 20, zoom: 1 });
    assert.deepEqual([...V.ZOOM_RANGE], [0.5, 4]);
    assert.equal(V.KEY_STEP, 5);
    assert.ok(Object.isFrozen(V.DEFAULT_VIEW) && Object.isFrozen(V));
});

test('[shape-view] rotate 累加 yaw（維持在 [0, 360)）、把 pitch 夾在 ±89°；不修改傳入的 view', () => {
    const view = Object.freeze({ yaw: 350, pitch: 80, zoom: 2 });
    assert.deepEqual(V.reduce(view, { type: 'rotate', dYaw: 30, dPitch: 5 }), { yaw: 20, pitch: 85, zoom: 2 });
    assert.deepEqual(V.reduce(view, { type: 'rotate', dYaw: -400, dPitch: 50 }), { yaw: 310, pitch: 89, zoom: 2 });
    assert.deepEqual(V.reduce(view, { type: 'rotate', dYaw: 0, dPitch: -500 }), { yaw: 350, pitch: -89, zoom: 2 });
    assert.deepEqual(view, { yaw: 350, pitch: 80, zoom: 2 });
    assert.ok(Object.isFrozen(V.reduce(view, { type: 'rotate', dYaw: 1, dPitch: 1 })));
});

test('[shape-view] zoom 乘上係數並夾在 ZOOM_RANGE；reset 回到預設', () => {
    const view = V.DEFAULT_VIEW;
    assert.equal(V.reduce(view, { type: 'zoom', factor: 2 }).zoom, 2);
    assert.equal(V.reduce(view, { type: 'zoom', factor: 100 }).zoom, 4);
    assert.equal(V.reduce(view, { type: 'zoom', factor: 0.01 }).zoom, 0.5);
    assert.deepEqual(V.reduce({ yaw: 10, pitch: -40, zoom: 3 }, { type: 'reset' }), V.DEFAULT_VIEW);
});

test('[shape-view] key：方向鍵改 yaw／pitch，+ = 放大 1.1 倍，- 縮小，0 與 Home 重設；其他鍵回傳同一個物件', () => {
    const view = Object.freeze({ yaw: 100, pitch: 10, zoom: 1 });
    const key = (name) => V.reduce(view, { type: 'key', key: name });
    assert.deepEqual(key('ArrowLeft'), { yaw: 95, pitch: 10, zoom: 1 });
    assert.deepEqual(key('ArrowRight'), { yaw: 105, pitch: 10, zoom: 1 });
    assert.deepEqual(key('ArrowUp'), { yaw: 100, pitch: 15, zoom: 1 });
    assert.deepEqual(key('ArrowDown'), { yaw: 100, pitch: 5, zoom: 1 });
    assert.ok(close(key('+').zoom, 1.1) && close(key('=').zoom, 1.1) && close(key('-').zoom, 1 / 1.1));
    assert.deepEqual(key('0'), V.DEFAULT_VIEW);
    assert.deepEqual(key('Home'), V.DEFAULT_VIEW);
    for (const other of ['a', 'Enter', 'Tab', ' ', 'PageDown', 'End', 'Escape', '1']) assert.equal(key(other), view, other);
    // 有處理的鍵一律回傳新物件（即使數值沒變）：呼叫端據此取消預設的捲動
    const top = Object.freeze({ yaw: 0, pitch: 89, zoom: 4 });
    assert.notEqual(V.reduce(top, { type: 'key', key: 'ArrowUp' }), top);
    assert.notEqual(V.reduce(top, { type: 'key', key: '+' }), top);
    assert.notEqual(V.reduce(V.DEFAULT_VIEW, { type: 'key', key: 'Home' }), V.DEFAULT_VIEW);
});

test('[shape-view] 不合法的 view 或動作丟 Error', () => {
    assert.throws(() => V.reduce(V.DEFAULT_VIEW, { type: 'spin' }), /Unknown view action/);
    assert.throws(() => V.reduce(V.DEFAULT_VIEW, null), /action/);
    assert.throws(() => V.reduce({ yaw: NaN, pitch: 0, zoom: 1 }, { type: 'reset' }), /view/);
    assert.throws(() => V.reduce(V.DEFAULT_VIEW, { type: 'zoom', factor: 0 }), /factor/);
    assert.throws(() => V.reduce(V.DEFAULT_VIEW, { type: 'rotate', dYaw: 'x', dPitch: 0 }), /dYaw/);
});

// ---------------------------------------------------------------- 視角慣例
test('[shape-view] viewDirection：預設視角在切口的平分面上，兩個切面都朝前', () => {
    const v = V.viewDirection(V.DEFAULT_VIEW);
    assert.ok(v[0] > 0 && v[1] > 0, '兩個切面（外法線 +y 與 +x）都朝向觀察者');
    assert.ok(close(v[0], v[1]), '方位 45°：在楔形的平分面上');
    assert.ok(close(Math.hypot(...v), 1));
    assert.ok(close(v[2], Math.sin(20 * Math.PI / 180)));
});

test('[shape-view] 基底正交、右手系；物體的 +z 投影到畫面正上方；yaw 轉 360° 回到原處', () => {
    for (const view of [V.DEFAULT_VIEW, { yaw: 200, pitch: -60, zoom: 1 }, { yaw: 0, pitch: 89, zoom: 2 }, { yaw: 123.4, pitch: 0, zoom: 1 }]) {
        const { right, up, toward } = V.basis(view);
        for (const [a, b, want] of [[right, right, 1], [up, up, 1], [toward, toward, 1], [right, up, 0], [right, toward, 0], [up, toward, 0]]) {
            assert.ok(Math.abs(dot(a, b) - want) < 1e-12);
        }
        assert.ok(cross(right, up).every((x, k) => Math.abs(x - toward[k]) < 1e-12), '行列式 +1');
        assert.ok(Math.abs(dot([0, 0, 1], right)) < 1e-12 && dot([0, 0, 1], up) > 0, '+z 在畫面上只有向上的分量');
        const again = V.basis({ ...view, yaw: view.yaw + 360 });
        assert.ok(again.right.every((x, k) => Math.abs(x - right[k]) < 1e-12) && again.up.every((x, k) => Math.abs(x - up[k]) < 1e-12));
    }
    const top = V.drawList(G.build('cylinder', { radius: 20, length: 400 }), V.DEFAULT_VIEW, SIZE);
    const ys = top.items.flatMap((item) => item.points.filter((_, i) => i % 2 === 1));
    const xs = top.items.flatMap((item) => item.points.filter((_, i) => i % 2 === 0));
    assert.ok(Math.max(...ys) - Math.min(...ys) > 4 * (Math.max(...xs) - Math.min(...xs)), '沿 z 的長圓柱在畫面上是直立的');
});

// ---------------------------------------------------------------- 投影不變量
test('[shape-view] 預設縮放：外接球落在畫面內並留 8% 邊距；zoom 加倍則比例加倍；旋轉不改變比例', () => {
    const scene = G.build('core_shell_cylinder', { radius: 20, thickness: 20, length: 400 });
    const ppa = V.pixelsPerAngstrom(scene, V.DEFAULT_VIEW, SIZE);
    assert.ok(close(2 * scene.radius * ppa, (1 - 0.16) * 400), '外接球直徑＝短邊的 84%');
    assert.ok(close(V.pixelsPerAngstrom(scene, { ...V.DEFAULT_VIEW, zoom: 2 }, SIZE), 2 * ppa));
    assert.ok(close(V.pixelsPerAngstrom(scene, { yaw: 222, pitch: -71, zoom: 1 }, SIZE), ppa));
    assert.equal(V.drawList(scene, V.DEFAULT_VIEW, SIZE).pixelsPerAngstrom, ppa);
    assert.throws(() => V.drawList(scene, V.DEFAULT_VIEW, { width: 0, height: 10 }), /size/);
    assert.throws(() => V.drawList(null, V.DEFAULT_VIEW, SIZE), /scene/);
});

test('[shape-view] 極端比例仍完整落在畫面內（圓柱 L＝400、R＝20；橢球；柔性圓柱 L＝1000、R＝20）', () => {
    const cases = [['cylinder', { radius: 20, length: 400 }], ['ellipsoid', { radius_polar: 20, radius_equatorial: 400 }],
        ['ellipsoid', { radius_polar: 400, radius_equatorial: 20 }], ['flexible_cylinder', { length: 1000, kuhn_length: 100, radius: 20 }],
        ['lamellar', { thickness: 50 }], ['core_shell_sphere', { radius: 60, thickness: 10 }]];
    for (const [model, params] of cases) {
        const scene = G.build(model, params);
        for (const view of [V.DEFAULT_VIEW, { yaw: 300, pitch: -80, zoom: 1 }, { yaw: 90, pitch: 0, zoom: 1 }]) {
            const { items } = V.drawList(scene, view, SIZE);
            assert.ok(items.length > 0, model);
            items.forEach((item) => {
                const pad = item.kind === 'stroke' ? item.width / 2 : 0;
                for (let i = 0; i < item.points.length; i += 2) {
                    assert.ok(item.points[i] - pad >= 0 && item.points[i] + pad <= SIZE.width, model + ' x');
                    assert.ok(item.points[i + 1] - pad >= 0.08 * 400 - 1e-9 && item.points[i + 1] + pad <= 0.92 * 400 + 1e-9, model + ' y 超出 8% 邊距');
                }
            });
        }
    }
});

test('[shape-view] 正交投影：螢幕距離 ≤ 3D 距離 × 比例，與視線垂直的線段恰好相等', () => {
    const scene = G.build('lamellar', { thickness: 50 });
    const mesh = scene.objects[0];
    const view = { yaw: 30, pitch: 40, zoom: 1.3 };
    const ppa = V.pixelsPerAngstrom(scene, view, SIZE);
    const points = Array.from({ length: mesh.vertices.length / 3 }, (_, i) => Array.from(mesh.vertices.slice(3 * i, 3 * i + 3)));
    points.forEach((p) => points.forEach((q) => {
        const [a, b] = [screenOf(p, view, SIZE, ppa), screenOf(q, view, SIZE, ppa)];
        assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) <= Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * ppa + 1e-9);
    }));
    // 清單裡的頂點就是這個投影
    const list = V.drawList(scene, view, SIZE);
    const drawn = new Set(list.items.flatMap((item) => item.points.map((x) => x.toFixed(6))));
    const visible = points.filter((p) => screenOf(p, view, SIZE, ppa).every((x) => drawn.has(x.toFixed(6))));
    assert.ok(visible.length >= 4);
    // 沿 z 的邊在仰角 0 時與視線垂直：畫面長度＝厚度 × 比例
    const flat = { yaw: 30, pitch: 0, zoom: 1 };
    const flatPpa = V.pixelsPerAngstrom(scene, flat, SIZE);
    const [top, bottom] = [screenOf([150, 150, 25], flat, SIZE, flatPpa), screenOf([150, 150, -25], flat, SIZE, flatPpa)];
    assert.ok(close(Math.hypot(top[0] - bottom[0], top[1] - bottom[1]), 50 * flatPpa));
    assert.ok(close(top[0], bottom[0]) && top[1] < bottom[1], '+z 在畫面上方');
});

// ---------------------------------------------------------------- 亮度
test('[shape-view] 亮度：k 在 [0, 1]；法線正對光源的面 k＝1，垂直或背光的面 k＝0', () => {
    assert.ok(close(Math.hypot(...V.LIGHT), 1));
    assert.ok(V.LIGHT[0] < 0 && V.LIGHT[1] > 0 && V.LIGHT[2] > 0, '光源在觀察座標的左上前方');
    const scene = G.build('lamellar', { thickness: 50 });
    for (const view of [V.DEFAULT_VIEW, { yaw: 200, pitch: -50, zoom: 1 }, { yaw: 80, pitch: 70, zoom: 1 }]) {
        const { right, up, toward } = V.basis(view);
        const list = V.drawList(scene, view, SIZE);
        assert.ok(list.items.length >= 1 && list.items.length <= 3, '長方體最多看到三個面');
        list.items.forEach((item) => assert.ok(item.k >= 0 && item.k <= 1));
        // 六個面的法線是 ±x、±y、±z：朝前的那些，k＝max(0, n·l)
        const expected = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
            .filter((n) => dot(n, toward) > 0)
            .map((n) => Math.max(0, dot([dot(n, right), dot(n, up), dot(n, toward)], V.LIGHT)));
        assert.deepEqual(list.items.map((item) => item.k.toFixed(12)).sort(), expected.map((k) => k.toFixed(12)).sort());
    }
    // 讓 +z 面正對光源：view 的 toward、up、right 使 n_view＝LIGHT
    const sphere = V.drawList(G.build('sphere', { radius: 50 }), V.DEFAULT_VIEW, SIZE);
    const ks = sphere.items.map((item) => item.k);
    assert.ok(Math.max(...ks) > 0.99 && Math.min(...ks) === 0, '球面上有正對光源的面，也有背光的面');
});

test('[shape-view] 旋轉物體時明暗跟著變（光源固定在觀察座標）', () => {
    const scene = G.build('cylinder', { radius: 20, length: 100 });
    const a = V.drawList(scene, { yaw: 0, pitch: 40, zoom: 1 }, SIZE).items.map((item) => item.k);
    const b = V.drawList(scene, { yaw: 0, pitch: -40, zoom: 1 }, SIZE).items.map((item) => item.k);
    assert.notDeepEqual(a, b);
});

// ---------------------------------------------------------------- 粗線
test('[shape-view] 柔性圓柱：清單全是 stroke，數目＝segments，寬度＝2R × 比例，由遠到近', () => {
    const scene = G.build('flexible_cylinder', { length: 1000, kuhn_length: 100, radius: 20 });
    const view = { yaw: 60, pitch: 25, zoom: 1 };
    const list = V.drawList(scene, view, SIZE);
    assert.equal(list.items.length, scene.segments);
    assert.ok(list.items.every((item) => item.kind === 'stroke' && item.role === 'shapeSolid' && item.points.length === 4));
    list.items.forEach((item) => {
        assert.equal(item.width, 2 * 20 * list.pixelsPerAngstrom);
        assert.ok(item.k >= 0 && item.k <= 1);
    });
    for (let i = 1; i < list.items.length; i++) assert.ok(list.items[i].depth >= list.items[i - 1].depth, '由遠到近');
    assert.deepEqual(V.drawList(scene, view, SIZE), list);
    // 每一段的兩個端點就是中心線上相鄰兩點的投影
    const line = scene.centreline;
    const ends = new Set(list.items.map((item) => item.points.map((x) => x.toFixed(6)).join(',')));
    for (let i = 0; i < scene.segments; i++) {
        const a = screenOf([line[3 * i], line[3 * i + 1], line[3 * i + 2]], view, SIZE, list.pixelsPerAngstrom);
        const b = screenOf([line[3 * i + 3], line[3 * i + 4], line[3 * i + 5]], view, SIZE, list.pixelsPerAngstrom);
        assert.ok(ends.has(a.concat(b).map((x) => x.toFixed(6)).join(',')), `第 ${i} 段`);
    }
});

test('[shape-view] 粗線的 fill：自己與沿鏈相鄰幾段的本體（由遠到近），再加各段受光側較亮的細線', () => {
    const scene = G.build('flexible_cylinder', { length: 1000, kuhn_length: 100, radius: 20 });
    const list = V.drawList(scene, V.DEFAULT_VIEW, SIZE);
    list.items.forEach((item) => {
        const bodies = item.fill.filter((f) => f.width === item.width);
        const shines = item.fill.filter((f) => f.width < item.width);
        assert.ok(bodies.length >= 2 && bodies.length <= 17, `本體 ${bodies.length} 段`);
        assert.equal(shines.length, bodies.length);
        assert.deepEqual(item.fill.slice(0, bodies.length), bodies, '本體先畫，亮線後畫');
        assert.ok(bodies.some((f) => f.points === item.points && f.k === item.k), '包含自己');
        item.fill.forEach((f) => assert.ok(f.points.length === 4 && f.k >= 0 && f.k <= 1 && f.width > 0));
        // 亮線整條落在自己那一段的本體裡：位移＋半寬 < 本體半寬
        shines.forEach((shine, n) => {
            const shift = Math.hypot(shine.points[0] - bodies[n].points[0], shine.points[1] - bodies[n].points[1]);
            assert.ok(shift + shine.width / 2 < item.width / 2);
            assert.ok(shine.points[0] < bodies[n].points[0] && shine.points[1] < bodies[n].points[1], '往左上（光源那一側）');
            assert.ok(shine.k >= bodies[n].k);
        });
    });
    // 剛性的短鏈（段長遠大於半徑）：只需要左右各一段
    const stiff = V.drawList(G.build('flexible_cylinder', { length: 1000, kuhn_length: 20000, radius: 2 }), V.DEFAULT_VIEW, SIZE);
    assert.ok(stiff.items.every((item) => item.fill.length <= 6));
});

test('[shape-view] 粗線的亮度沿鏈平滑：相鄰兩段的 k 相差不大（各段重疊，顏色不能跳）', () => {
    const scene = G.build('flexible_cylinder', { length: 1000, kuhn_length: 100, radius: 20 });
    const list = V.drawList(scene, V.DEFAULT_VIEW, SIZE);
    const line = scene.centreline;
    const { right, up } = V.basis(V.DEFAULT_VIEW);
    // 依鏈上的順序排回去：以第一個端點的畫面位置對照中心線
    const key = (x, y) => x.toFixed(6) + ',' + y.toFixed(6);
    const byStart = new Map(list.items.map((item) => [key(item.points[0], item.points[1]), item]));
    const ordered = Array.from({ length: scene.segments }, (_, i) => {
        const p = [line[3 * i], line[3 * i + 1], line[3 * i + 2]];
        return byStart.get(key(SIZE.width / 2 + list.pixelsPerAngstrom * dot(p, right), SIZE.height / 2 - list.pixelsPerAngstrom * dot(p, up)));
    });
    assert.ok(ordered.every((item) => item !== undefined));
    for (let i = 1; i < ordered.length; i++) assert.ok(Math.abs(ordered[i].k - ordered[i - 1].k) < 0.2, `第 ${i} 段`);
});

// ---------------------------------------------------------------- 比例尺
test('[shape-view] scaleBar：1–2–5 級距中長度不超過寬度 30% 的最大者', () => {
    assert.deepEqual(V.scaleBar(1, 600), { nm: 10, pixels: 100, label: '10 nm' });          // 上限 18 nm
    assert.deepEqual(V.scaleBar(1, 300), { nm: 5, pixels: 50, label: '5 nm' });             // 上限 9 nm
    assert.deepEqual(V.scaleBar(2, 300), { nm: 2, pixels: 40, label: '2 nm' });             // 上限 4.5 nm
    assert.equal(V.scaleBar(20, 400).label, '0.5 nm');                                       // 上限 0.6 nm
    assert.equal(V.scaleBar(0.01, 800).label, '2000 nm');                                    // 上限 2400 nm
    assert.equal(V.scaleBar(0.05, 600).label, '200 nm');                                     // 上限 360 nm
    assert.equal(V.scaleBar(300, 600).label, '0.05 nm');                                     // 上限 0.06 nm
    for (const [ppa, width] of [[0.37, 575], [1.9, 420], [0.0123, 658], [45, 448]]) {
        const bar = V.scaleBar(ppa, width);
        assert.ok(bar.pixels <= 0.3 * width + 1e-9 && bar.pixels > 0.3 * width / 2.5 - 1e-9, `${ppa}：${bar.pixels}`);
        assert.ok(close(bar.pixels, bar.nm * 10 * ppa));
        assert.match(bar.label, /^(?:[125]0*|0\.0*[125]) nm$/);
    }
    for (const bad of [0, -1, NaN, Infinity]) assert.equal(V.scaleBar(bad, 600), null);
    assert.equal(V.scaleBar(1, 0), null);
    assert.ok(Object.isFrozen(V.scaleBar(1, 600)));
});

// ---------------------------------------------------------------- nm
test('[shape-view] nm：Å → nm 一位小數；小於 0.1 nm 的改兩位有效數字；負數與非有限是 —', () => {
    assert.equal(V.nm(50), '5.0');
    assert.equal(V.nm(54.96), '5.5');
    assert.equal(V.nm(1000), '100.0');
    assert.equal(V.nm(0.4), '0.04');
    assert.equal(V.nm(0.5), '0.05');
    assert.equal(V.nm(0.96), '0.096');
    assert.equal(V.nm(1), '0.1');
    assert.equal(V.nm(0.0123), '0.0012');
    assert.equal(V.nm(0), '0.0');
    for (const bad of [-1, NaN, Infinity, undefined, '5']) assert.equal(V.nm(bad), '—');
});

// ---------------------------------------------------------------- shapeParams 與 describe
test('[shape-view] shapeParams：表單 → build 需要的尺寸；無形狀的模型與有欄位錯誤的表單回 null', () => {
    assert.deepEqual(V.shapeParams(formOf('sphere')), { radius: 50 });
    assert.deepEqual(V.shapeParams(formOf('core_shell_cylinder')), { radius: 20, thickness: 20, length: 400 });
    assert.deepEqual(V.shapeParams(formOf('flexible_cylinder', [setValue('radius', 7)])), { length: 1000, kuhn_length: 100, radius: 7 });
    assert.ok(Object.isFrozen(V.shapeParams(formOf('sphere'))));
    for (const model of ['guinier', 'guinier_porod', 'power_law', 'mono_gauss_coil', 'gaussian_peak']) {
        assert.equal(V.shapeParams(formOf(model)), null, model);
        assert.equal(V.describe(formOf(model)), null, model);
    }
    assert.equal(V.shapeParams(formOf('sphere', [setValue('radius', 'abc')])), null);
    assert.equal(V.describe(formOf('sphere', [setValue('radius', '')])), null);
    // 每個形狀模型的預設表單都建得出場景
    G.SHAPE_MODELS.forEach((model) => assert.notEqual(G.build(model, V.shapeParams(formOf(model))), null, model));
});

test('[shape-view] describe：各模型的尺寸清單（nm、一位小數）', () => {
    const dims = (model, actions) => V.describe(formOf(model, actions)).dims.map((dim) => dim.label + ' ' + dim.text);
    assert.deepEqual(dims('sphere'), ['半徑 R 5.0 nm']);
    assert.deepEqual(dims('ellipsoid'), ['極半徑 R_polar 2.0 nm', '赤道半徑 R_equatorial 40.0 nm']);
    assert.deepEqual(dims('cylinder'), ['半徑 R 2.0 nm', '長度 L 40.0 nm']);
    assert.deepEqual(dims('core_shell_sphere'), ['核半徑 6.0 nm', '殼厚 1.0 nm', '外徑 14.0 nm']);
    assert.deepEqual(dims('vesicle'), ['內半徑 10.0 nm', '膜厚 3.0 nm']);
    assert.deepEqual(dims('core_shell_cylinder'), ['核半徑 2.0 nm', '殼厚 2.0 nm', '核長度 L 40.0 nm', '總長 44.0 nm']);
    assert.deepEqual(dims('flexible_cylinder'), ['輪廓長度 L 100.0 nm', 'Kuhn 長度 b 10.0 nm', '半徑 R 2.0 nm']);
    assert.deepEqual(dims('lamellar'), ['厚度 δ 5.0 nm']);
    assert.equal(V.describe(formOf('sphere')).title, '均勻球');
    assert.deepEqual(V.describe(formOf('sphere')).extras, []);
});

test('[shape-view] describe：柔性圓柱與層狀的說明、替代文字', () => {
    const chain = V.describe(formOf('flexible_cylinder'));
    assert.ok(chain.extras.includes('圖中是一個代表性構形（固定亂數種子，未考慮排除體積）'));
    assert.match(chain.alt, /一個代表性構形/);
    const slab = V.describe(formOf('lamellar'));
    assert.ok(slab.extras.includes('層狀模型的橫向為無限延伸，圖中的寬度只是示意'));
    assert.equal(V.describe(formOf('core_shell_sphere')).alt, '核殼球的 3D 示意圖：核半徑 6.0 nm、殼厚 1.0 nm、外徑 14.0 nm；切開四分之一以顯示內部');
    assert.equal(V.describe(formOf('sphere')).alt, '均勻球的 3D 示意圖：半徑 R 5.0 nm');
    assert.match(V.describe(formOf('vesicle')).alt, /切開四分之一/);
});

test('[shape-view] describe：多分散以文字標示（± ＝ 寬度 × 平均值；lognormal 只寫寬度）', () => {
    const pd = (type, width) => [{ type: 'togglePd', name: 'radius' }, { type: 'setPdField', name: 'radius', field: 'type', value: type },
        { type: 'setPdField', name: 'radius', field: 'width', value: width }];
    assert.ok(V.describe(formOf('sphere', pd('schulz', '0.1'))).extras.includes('半徑 R = 5.0 ± 0.5 nm（schulz）'));
    assert.ok(V.describe(formOf('sphere', pd('lognormal', '0.1'))).extras.includes('半徑 R：寬度 0.10（lognormal）'));
    assert.deepEqual(V.describe(formOf('sphere', pd('gaussian', '0'))).extras, [], '寬度 0 不算');
    assert.deepEqual(V.describe(formOf('sphere', pd('gaussian', '0.2').concat([{ type: 'togglePd', name: 'radius' }]))).extras, [], '收起來的不算');
});

test('[shape-view] describe：S(Q) 以文字標示；有效半徑由模型決定時照寫；hayter_msa 另列電荷', () => {
    const hard = V.describe(formOf('sphere', [{ type: 'setStructure', structure: 'hardsphere' }, { type: 'setRadiusMode', mode: 0 }]));
    assert.ok(hard.extras.includes('S(Q)：hardsphere，φ = 0.20，R_eff = 5.0 nm'), hard.extras.join('｜'));
    const derived = V.describe(formOf('sphere', [{ type: 'setStructure', structure: 'hardsphere' }]));
    assert.ok(derived.extras.includes('S(Q)：hardsphere，φ = 0.20，R_eff 由模型決定'), derived.extras.join('｜'));
    const msa = V.describe(formOf('core_shell_sphere', [{ type: 'setStructure', structure: 'hayter_msa' }]));
    assert.ok(msa.extras.some((line) => /^S\(Q\)：hayter_msa，φ = 0\.019，R_eff 由模型決定，電荷 19\.0 e$/.test(line)), msa.extras.join('｜'));
});

test('[shape-view] describe：投影不到 2 像素的尺寸另加一句（給了 pixelsPerAngstrom 才判斷）', () => {
    const form = formOf('core_shell_sphere', [setValue('radius', 200), setValue('thickness', 0.5)]);
    assert.ok(!V.describe(form).extras.some((line) => /像素/.test(line)));
    const small = V.describe(form, { pixelsPerAngstrom: 1 });
    assert.ok(small.extras.includes('殼厚 0.05 nm 在這個比例下小於 2 像素'), small.extras.join('｜'));
    assert.ok(!V.describe(form, { pixelsPerAngstrom: 10 }).extras.some((line) => /像素/.test(line)));
});

test('[shape-view] describe 的回傳是凍結的純文字，不含 <', () => {
    G.SHAPE_MODELS.forEach((model) => {
        const d = V.describe(formOf(model, model === 'sphere' ? [{ type: 'setStructure', structure: 'hayter_msa' }] : []), { pixelsPerAngstrom: 0.001 });
        assert.ok(Object.isFrozen(d) && Object.isFrozen(d.dims) && Object.isFrozen(d.extras));
        const texts = [d.title, d.alt].concat(d.extras, d.dims.flatMap((dim) => [dim.label, dim.text]));
        texts.forEach((text) => { assert.equal(typeof text, 'string'); assert.ok(!text.includes('<'), text); });
    });
});

test('[shape-view] describe 的 scene 選項：直接用已建好的場景，不再建一次；dimsHtml 是跳脫過的定義清單', () => {
    const form = formOf('lamellar');
    const real = globalThis.SasFitShapeGeom;
    const scene = real.build('lamellar', V.shapeParams(form));
    let builds = 0;
    globalThis.SasFitShapeGeom = Object.freeze({ ...real, build(...args) { builds += 1; return real.build(...args); } });
    try {
        assert.deepEqual(V.describe(form, { scene }), V.describe(form));
        assert.equal(builds, 1, '只有沒給 scene 的那一次會建');
    } finally {
        globalThis.SasFitShapeGeom = real;
    }
    const html = V.dimsHtml(V.describe(formOf('core_shell_sphere')).dims);
    assert.equal(html, '<dl class="sf-shape-dims"><div class="sf-shape-dim"><dt>核半徑</dt><dd>6.0 nm</dd></div>'
        + '<div class="sf-shape-dim"><dt>殼厚</dt><dd>1.0 nm</dd></div><div class="sf-shape-dim"><dt>外徑</dt><dd>14.0 nm</dd></div></dl>');
    assert.equal(V.dimsHtml([{ label: 'a<b', text: '"1" & 2' }]),
        '<dl class="sf-shape-dims"><div class="sf-shape-dim"><dt>a&lt;b</dt><dd>&quot;1&quot; &amp; 2</dd></div></dl>');
    assert.equal(V.dimsHtml([]), '<dl class="sf-shape-dims"></dl>');
});
