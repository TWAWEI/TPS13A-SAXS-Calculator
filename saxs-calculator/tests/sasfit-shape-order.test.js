'use strict';
/**
 * sasfit-shape-view.js：繪製順序（計畫 M4 Task 4 Step 2）。
 * 真正擋住錯誤實作的是「射線判定」：tests/sasfit-shape-oracle.js 以解析幾何算出每個畫面點最先被什麼擋住，
 * 繪製清單在那個點最上層的多邊形必須是同一個角色與同一個 PART。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitShapeGeom: G, SasFitShapeView: V } = require('./load.js');
const O = require('./sasfit-shape-oracle.js');

const { PART } = G;
const SIZE = Object.freeze({ width: 600, height: 400 });
const isCut = (item) => item.part === PART.CUT_A || item.part === PART.CUT_B;

/** 核殼球、囊泡、核殼圓柱：預設值、薄殼、厚殼。 */
const SHELL_CASES = [
    ['core_shell_sphere', { radius: 60, thickness: 10 }],
    ['core_shell_sphere', { radius: 200, thickness: 0.5 }],
    ['core_shell_sphere', { radius: 30, thickness: 60 }],
    ['vesicle', { radius: 100, thickness: 30 }],
    ['vesicle', { radius: 200, thickness: 0.5 }],
    ['vesicle', { radius: 30, thickness: 60 }],
    ['core_shell_cylinder', { radius: 20, thickness: 20, length: 400 }],
    ['core_shell_cylinder', { radius: 200, thickness: 0.5, length: 5 }],
    ['core_shell_cylinder', { radius: 40, thickness: 30, length: 60 }],
];
const SOLID_CASES = [
    ['sphere', { radius: 50 }], ['ellipsoid', { radius_polar: 20, radius_equatorial: 400 }],
    ['ellipsoid', { radius_polar: 400, radius_equatorial: 20 }], ['cylinder', { radius: 20, length: 400 }],
    ['cylinder', { radius: 200, length: 5 }], ['lamellar', { thickness: 50 }],
];
const label = (model, params) => model + ' ' + JSON.stringify(params);

/** 200 個視角的總計與最差的視角。 */
function survey(model, params, listOf) {
    const scene = G.build(model, params);
    const shape = O.solid(model, params);
    const total = { counted: 0, agreed: 0, objectCounted: 0, objectAgreed: 0, central: 0, centralAgreed: 0 };
    let worst = { rate: 1, view: null };
    O.VIEWS.forEach((view) => {
        const stats = O.compare(shape, scene, view, (size) => listOf(scene, view, size));
        Object.keys(total).forEach((key) => { total[key] += stats[key]; });
        const rate = stats.objectCounted === 0 ? 1 : stats.objectAgreed / stats.objectCounted;
        if (rate < worst.rate) worst = { rate, view };
    });
    return { total, worst, rate: total.objectAgreed / total.objectCounted };
}

const ruleList = (scene, view, size) => V.drawList(scene, view, size);

/** 把規則排好的清單改成固定的分層（對照用的錯誤實作）。 */
function layered(rank) {
    return (scene, view, size) => {
        const list = V.drawList(scene, view, size);
        const items = list.items.map((item, at) => [item, at]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((pair) => pair[0]);
        return { items, pixelsPerAngstrom: list.pixelsPerAngstrom };
    };
}
const coreThenCuts = layered((item) => (item.part === PART.CAVITY ? 0 : item.part === PART.SOLID ? 1 : isCut(item) ? 2 : 3));
const cutsThenCore = layered((item) => (item.part === PART.CAVITY ? 0 : isCut(item) ? 1 : item.part === PART.SOLID ? 2 : 3));

// ---------------------------------------------------------------- 射線判定本身
test('[shape-order] 射線判定：球心、球外、切口內看到核、切口旁看到外表面與切面', () => {
    const shape = O.solid('core_shell_sphere', { radius: 60, thickness: 10 });
    const view = { yaw: 45, pitch: 0 };
    assert.deepEqual(O.firstHit(shape, view, [0, 0]), { role: 'shapeCore', part: PART.SOLID });
    assert.equal(O.firstHit(shape, view, [0, 71]), null);
    // 畫面的右＝(−sin y, cos y, 0)：往左（−X）離開核之後是切面 A（y = 0、x > 0），往右是切面 B（x = 0、y > 0）
    assert.deepEqual(O.firstHit(shape, view, [-45, 0]), { role: 'shapeShell', part: PART.CUT_A });
    assert.deepEqual(O.firstHit(shape, view, [45, 0]), { role: 'shapeShell', part: PART.CUT_B });
    // 從背面看（yaw 225°）：只看得到外表面
    assert.deepEqual(O.firstHit(shape, { yaw: 225, pitch: 0 }, [0, 0]), { role: 'shapeShell', part: PART.OUTER });
    // 囊泡從切口看進去：中央是遠端的內壁
    const vesicle = O.solid('vesicle', { radius: 100, thickness: 30 });
    assert.deepEqual(O.firstHit(vesicle, view, [0, 0]), { role: 'shapeShell', part: PART.CAVITY });
    assert.deepEqual(O.firstHit(O.solid('sphere', { radius: 50 }), view, [49, 0]), { role: 'shapeSolid', part: PART.SOLID });
    assert.equal(O.firstHit(O.solid('sphere', { radius: 50 }), view, [51, 0]), null);
});

test('[shape-order] 視角清單固定 200 個（12 × 15 ＋ 20 個固定種子），每次相同', () => {
    assert.equal(O.VIEWS.length, 200);
    assert.deepEqual(O.VIEWS[0], { yaw: 0, pitch: -75, zoom: 1 });
    assert.deepEqual(O.VIEWS[179], { yaw: 330, pitch: 75, zoom: 1 });
    assert.ok(O.VIEWS.slice(180).every((view) => view.yaw >= 0 && view.yaw < 360 && Math.abs(view.pitch) <= 85));
});

// ---------------------------------------------------------------- 剔除
test('[shape-order] 剔除：單位球在任何視角剩下約一半的面，清單裡沒有背面，也不需要排序', () => {
    const scene = G.build('sphere', { radius: 1 });
    const faces = scene.objects[0].faces.length;
    O.VIEWS.filter((_, i) => i % 9 === 0).forEach((view) => {
        const { items } = V.drawList(scene, view, SIZE);
        assert.ok(items.length > 0.44 * faces && items.length < 0.56 * faces, `${JSON.stringify(view)}：${items.length}／${faces}`);
        assert.ok(items.every((item) => item.kind === 'polygon' && item.role === 'shapeSolid' && item.part === PART.SOLID));
        // 正面的多邊形在畫面上是逆時針（y 朝下時面積為負），背面會反過來
        items.forEach((item) => {
            let twice = 0;
            for (let i = 0; i < item.points.length; i += 2) {
                const j = (i + 2) % item.points.length;
                twice += item.points[i] * item.points[j + 1] - item.points[j] * item.points[i + 1];
            }
            assert.ok(twice <= 1e-9, '清單裡有背面');
        });
    });
});

// ---------------------------------------------------------------- 規則 2、3：各組的先後
/** 清單裡每個多邊形所屬的組：cavity、core、cutA、cutB、outer。 */
const groupOf = (item) => (item.role === 'shapeCore' ? 'core'
    : { [PART.CAVITY]: 'cavity', [PART.CUT_A]: 'cutA', [PART.CUT_B]: 'cutB', [PART.OUTER]: 'outer', [PART.SOLID]: 'core' }[item.part]);

/** 連續相同的組壓成一段。 */
const runs = (items) => items.map(groupOf).filter((group, i, all) => i === 0 || group !== all[i - 1]);

test('[shape-order] 核殼球的分組順序：兩個切面都朝前、只有 A、只有 B、都不朝前', () => {
    const scene = G.build('core_shell_sphere', { radius: 60, thickness: 10 });
    const order = (yaw) => runs(V.drawList(scene, { yaw, pitch: 20, zoom: 1 }, SIZE).items);
    assert.deepEqual(order(45), ['cavity', 'core', 'cutA', 'core', 'cutB', 'core', 'outer']);
    assert.deepEqual(order(135), ['cavity', 'core', 'cutA', 'core', 'outer']);
    assert.deepEqual(order(315), ['cavity', 'core', 'cutB', 'core', 'outer']);
    assert.deepEqual(order(225), ['cavity', 'core', 'outer'], '從背面看：兩個切面都被剔除；內壁朝前的面最先畫，之後被核與外表面蓋住');
});

test('[shape-order] 兩個切面都朝前時，核的三段分別在 y < 0、(y > 0, x < 0)、(y > 0, x > 0)', () => {
    const scene = G.build('core_shell_cylinder', { radius: 20, thickness: 20, length: 400 });
    const view = { yaw: 30, pitch: 35, zoom: 1 };
    const { items } = V.drawList(scene, view, SIZE);
    const segments = [];
    items.forEach((item) => {
        const group = groupOf(item);
        if (segments.length === 0 || segments[segments.length - 1].group !== group) segments.push({ group, items: [] });
        segments[segments.length - 1].items.push(item);
    });
    assert.deepEqual(segments.map((s) => s.group), ['cavity', 'core', 'cutA', 'core', 'cutB', 'core', 'outer']);
    // 由畫面座標反推不出 3D 位置；改用網格：核的三段的面數各等於核在該區朝前的面數
    const core = scene.objects.find((mesh) => mesh.role === 'shapeCore');
    const toward = V.viewDirection(view);
    const counts = [0, 0, 0];
    core.faces.forEach((face) => {
        const pts = Array.from(face, (v) => [core.vertices[3 * v], core.vertices[3 * v + 1], core.vertices[3 * v + 2]]);
        const n = [0, 0, 0];
        pts.forEach((p, i) => {
            const q = pts[(i + 1) % pts.length];
            n[0] += p[1] * q[2] - p[2] * q[1]; n[1] += p[2] * q[0] - p[0] * q[2]; n[2] += p[0] * q[1] - p[1] * q[0];
        });
        if (n[0] * toward[0] + n[1] * toward[1] + n[2] * toward[2] <= 0) return;
        const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        counts[cy < 0 ? 0 : (cx < 0 ? 1 : 2)] += 1;
    });
    assert.deepEqual(segments.filter((s) => s.group === 'core').map((s) => s.items.length), counts);
    assert.ok(counts.every((n) => n > 0));
});

test('[shape-order] 囊泡沒有核：內壁 → 朝前的切面 → 外表面', () => {
    const scene = G.build('vesicle', { radius: 100, thickness: 30 });
    assert.deepEqual(runs(V.drawList(scene, { yaw: 45, pitch: 20, zoom: 1 }, SIZE).items), ['cavity', 'cutA', 'cutB', 'outer']);
    assert.deepEqual(runs(V.drawList(scene, { yaw: 225, pitch: 20, zoom: 1 }, SIZE).items), ['cavity', 'outer']);
});

// ---------------------------------------------------------------- 射線判定對 200 個視角
for (const [model, params] of SHELL_CASES) {
    test(`[shape-order] 射線判定 ${label(model, params)}：200 個視角 × 21×21 點，最上層多邊形＝最先被擋住的表面`, () => {
        const { total, worst, rate } = survey(model, params, ruleList);
        assert.ok(total.objectCounted > 20000, `有效的畫面點只有 ${total.objectCounted} 個`);
        assert.ok(rate >= 0.99, `一致率 ${(100 * rate).toFixed(3)}%（最差的視角 ${JSON.stringify(worst.view)}：${(100 * worst.rate).toFixed(2)}%）`);
        assert.ok(worst.rate >= 0.99, `最差的視角 ${JSON.stringify(worst.view)} 只有 ${(100 * worst.rate).toFixed(2)}%`);
        assert.equal(total.centralAgreed, total.central, '核與切面的中央區域必須 100% 一致');
        assert.equal(total.agreed, total.counted, '這些網格下規則是精確的：背景點也不得出錯');
    });
}

for (const [model, params] of SOLID_CASES) {
    test(`[shape-order] 射線判定 ${label(model, params)}：單一凸體的輪廓與解析形狀一致`, () => {
        const { total, rate } = survey(model, params, ruleList);
        assert.ok(total.objectCounted > 10000, `有效的畫面點只有 ${total.objectCounted} 個`);
        assert.ok(rate >= 0.99, `一致率 ${(100 * rate).toFixed(3)}%`);
    });
}

// ---------------------------------------------------------------- 測試的鑑別力
test('[shape-order] 鑑別力：不依切面分段的兩種分層（核全部先畫／切面全部先畫）與反序都過不了同一個判定', () => {
    const cases = [['core_shell_sphere', { radius: 60, thickness: 10 }], ['core_shell_cylinder', { radius: 40, thickness: 30, length: 60 }]];
    cases.forEach(([model, params]) => {
        const right = survey(model, params, ruleList);
        assert.equal(right.total.centralAgreed, right.total.central);
        for (const [name, wrong] of [['核先畫完', coreThenCuts], ['切面先畫完', cutsThenCore]]) {
            const { total, worst } = survey(model, params, wrong);
            assert.ok(worst.rate < 0.99, `${label(model, params)}「${name}」最差的視角竟有 ${(100 * worst.rate).toFixed(2)}%`);
            assert.ok(total.agreed < total.counted, `${name} 應該有畫錯的點`);
        }
        const reversed = survey(model, params, (scene, view, size) => {
            const list = V.drawList(scene, view, size);
            return { items: list.items.slice().reverse(), pixelsPerAngstrom: list.pixelsPerAngstrom };
        });
        assert.ok(reversed.rate < 0.9, `反序的一致率 ${(100 * reversed.rate).toFixed(1)}%`);
    });
    // 核全部先畫：切口裡的核被切面蓋掉，中央區域一定出錯
    const wrong = survey('core_shell_sphere', { radius: 60, thickness: 10 }, coreThenCuts);
    assert.ok(wrong.total.centralAgreed < wrong.total.central);
});

test('[shape-order] 對照：全部正面依質心深度排序——在這些細網格上與射線判定一致（計畫預期它會錯，實測沒有；見完成紀錄）', () => {
    // 記錄事實，不是需求：若日後把網格改粗，這個對照實作會先壞掉，規則排序不會。
    const model = 'core_shell_sphere';
    const params = { radius: 200, thickness: 0.5 };
    const { total } = survey(model, params, (scene, view, size) => O.byCentroidDepth(scene, view, size, V.pixelsPerAngstrom(scene, view, size)));
    assert.ok(total.objectAgreed / total.objectCounted >= 0.99);
});

// ---------------------------------------------------------------- 決定性與不可變
test('[shape-order] 同一個場景與視角呼叫兩次，清單逐元素相同；清單與項目都是凍結的；場景不被修改', () => {
    const scene = G.build('core_shell_sphere', { radius: 60, thickness: 10 });
    const before = scene.objects.map((mesh) => Array.from(mesh.vertices));
    const view = { yaw: 70, pitch: -30, zoom: 1.5 };
    const a = V.drawList(scene, view, SIZE);
    const b = V.drawList(scene, view, SIZE);
    assert.deepEqual(a, b);
    assert.ok(Object.isFrozen(a) && Object.isFrozen(a.items) && a.items.every((item) => Object.isFrozen(item) && Object.isFrozen(item.points)));
    assert.deepEqual(scene.objects.map((mesh) => Array.from(mesh.vertices)), before);
});
