'use strict';
/**
 * 3D 示意圖繪製順序的「射線判定」（計畫 M4 Task 4）。與 js/sasfit-shape-view.js 完全獨立的解析幾何：
 * 不看網格、不看繪製清單，只由模型的尺寸算出某個視角下某個畫面點最先被什麼擋住。
 *
 *   firstHit(shape, view, [X, Y]) -> { role, part } | null
 *       shape：solid(model, params) 的回傳；view：{ yaw, pitch }（度）；[X, Y]：畫面座標（Å，原點在物體中心，
 *       X 向右、Y 向上）。回傳最靠近觀察者的表面：角色（shapeSolid／shapeCore／shapeShell）與 PART。
 *   solid(model, params)   解析形狀；支援 sphere、ellipsoid、cylinder、lamellar、core_shell_sphere、vesicle、
 *                          core_shell_cylinder
 *   topmost(items, pixels) -> 每個畫面點最上層多邊形的 { role, part } | null（依清單順序，後畫的蓋住先畫的）
 *   compare(shape, scene, view, listOf, options?) -> 一個視角的統計（見 compare 的註解）
 *   byCentroidDepth(scene, view, size, ppa) -> 對照用的錯誤實作：全部正面依質心深度由遠到近排序
 *   VIEWS                  固定的 200 個視角：yaw 每 30°（12 個）× pitch −75°…75°（15 個）＋ 20 個固定種子的亂數視角
 *
 * 視角慣例（本檔自己推導，與被測模組的實作無關）：觀察者在物體座標的 v＝(cos p cos y, cos p sin y, sin p) 方向；
 * 畫面的右＝(−sin y, cos y, 0)，上＝(−sin p cos y, −sin p sin y, cos p)。
 * 射線：點(τ)＝o − τ·v（o 在過原點、垂直 v 的平面上），τ 小的先被看到。
 */
const { SasFitShapeGeom: G } = require('./load.js');

const { PART } = G;
const DEG = Math.PI / 180;
const EPS = 1e-9;
const GRID = 21;
const EDGE = 0.015;                 // 「邊的附近」：物體畫面範圍短邊的 1.5%（網格與解析曲面的弦高差遠小於它）
const CENTRAL = 3;                  // 「中央區域」：周圍 3 倍邊距內的判定都相同
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function axes({ yaw, pitch }) {
    const [cy, sy, cp, sp] = [Math.cos(yaw * DEG), Math.sin(yaw * DEG), Math.cos(pitch * DEG), Math.sin(pitch * DEG)];
    return { right: [-sy, cy, 0], up: [-sp * cy, -sp * sy, cp], toward: [cp * cy, cp * sy, sp] };
}

// ---------------------------------------------------------------- 射線與凸體的交集區間 [in, out]（空集合為 null）

/** a τ² + b τ + c ≤ 0 的 τ 區間。 */
function quadratic(a, b, c) {
    if (Math.abs(a) < 1e-300) return c <= 0 ? [-Infinity, Infinity] : null;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    return [(-b - root) / (2 * a), (-b + root) / (2 * a)];
}

/** lower ≤ o_k − τ v_k ≤ upper 的 τ 區間。 */
function slab(o, v, k, lower, upper) {
    if (Math.abs(v[k]) < 1e-300) return o[k] >= lower && o[k] <= upper ? [-Infinity, Infinity] : null;
    const t1 = (o[k] - lower) / v[k];
    const t2 = (o[k] - upper) / v[k];
    return [Math.min(t1, t2), Math.max(t1, t2)];
}

function intersect(...intervals) {
    if (intervals.some((i) => i === null)) return null;
    const lower = Math.max(...intervals.map((i) => i[0]));
    const upper = Math.min(...intervals.map((i) => i[1]));
    return lower < upper ? [lower, upper] : null;
}

/** (x² + y²)/a² + z²/c² ≤ 1 */
function ellipsoid(a, c) {
    return (o, v) => quadratic(
        (v[0] * v[0] + v[1] * v[1]) / (a * a) + v[2] * v[2] / (c * c),
        -2 * ((o[0] * v[0] + o[1] * v[1]) / (a * a) + o[2] * v[2] / (c * c)),
        (o[0] * o[0] + o[1] * o[1]) / (a * a) + o[2] * o[2] / (c * c) - 1);
}

/** x² + y² ≤ r²、|z| ≤ half */
function cylinder(r, half) {
    return (o, v) => intersect(
        quadratic(v[0] * v[0] + v[1] * v[1], -2 * (o[0] * v[0] + o[1] * v[1]), o[0] * o[0] + o[1] * o[1] - r * r),
        slab(o, v, 2, -half, half));
}

const box = (hx, hy, hz) => (o, v) => intersect(slab(o, v, 0, -hx, hx), slab(o, v, 1, -hy, hy), slab(o, v, 2, -hz, hz));

/** 被切掉的楔形：x > 0 且 y > 0。 */
const wedge = (o, v) => intersect(slab(o, v, 0, 0, Infinity), slab(o, v, 1, 0, Infinity));

const inside = (interval, tau) => interval !== null && tau > interval[0] && tau < interval[1];

// ---------------------------------------------------------------- 形狀

function solid(model, p) {
    const single = (body) => ({ single: body });
    const shell = (inner, outer, withCore) => ({ inner, outer, withCore });
    switch (model) {
        case 'sphere': return single(ellipsoid(p.radius, p.radius));
        case 'ellipsoid': return single(ellipsoid(p.radius_equatorial, p.radius_polar));
        case 'cylinder': return single(cylinder(p.radius, p.length / 2));
        case 'lamellar': return single(box(G.LATERAL_FACTOR * p.thickness / 2, G.LATERAL_FACTOR * p.thickness / 2, p.thickness / 2));
        case 'core_shell_sphere':
        case 'vesicle': {
            const outer = p.radius + p.thickness;
            return shell(ellipsoid(p.radius, p.radius), ellipsoid(outer, outer), model === 'core_shell_sphere');
        }
        case 'core_shell_cylinder':
            return shell(cylinder(p.radius, p.length / 2), cylinder(p.radius + p.thickness, p.length / 2 + p.thickness), true);
        default: throw new Error('oracle: no analytic solid for ' + model);
    }
}

/** 殼（外形減內形減楔形）最先被射線碰到的地方：{ tau, part } | null。 */
function shellHit(shape, o, v) {
    const outer = shape.outer(o, v);
    if (outer === null) return null;
    const inner = shape.inner(o, v);
    const cut = wedge(o, v);
    const scale = Math.max(1, Math.abs(outer[0]), Math.abs(outer[1]));
    const solidAt = (tau) => inside(outer, tau) && !inside(inner, tau) && !inside(cut, tau);
    const candidates = [{ tau: outer[0], part: PART.OUTER }];
    if (inner !== null) candidates.push({ tau: inner[1], part: PART.CAVITY });
    if (cut !== null && Number.isFinite(cut[1])) {
        const at = [o[0] - cut[1] * v[0], o[1] - cut[1] * v[1]];
        candidates.push({ tau: cut[1], part: Math.abs(at[1]) < Math.abs(at[0]) ? PART.CUT_A : PART.CUT_B });
    }
    const hits = candidates.filter((c) => solidAt(c.tau + EPS * scale)).sort((a, b) => a.tau - b.tau);
    return hits.length > 0 ? hits[0] : null;
}

function firstHit(shape, view, [X, Y]) {
    const { right, up, toward } = axes(view);
    const o = [0, 1, 2].map((k) => X * right[k] + Y * up[k]);
    if (shape.single !== undefined) {
        return shape.single(o, toward) === null ? null : { role: 'shapeSolid', part: PART.SOLID };
    }
    const shell = shellHit(shape, o, toward);
    const core = shape.withCore ? shape.inner(o, toward) : null;
    if (core !== null && (shell === null || core[0] < shell.tau)) return { role: 'shapeCore', part: PART.SOLID };
    return shell === null ? null : { role: 'shapeShell', part: shell.part };
}

// ---------------------------------------------------------------- 繪製清單 → 每個畫面點最上層的多邊形

/** 點是否在凸多邊形內（清單裡的面都是凸的三角形或四邊形；兩種繞向都接受）。 */
function contains(points, x, y) {
    let sign = 0;
    for (let i = 0; i < points.length; i += 2) {
        const j = (i + 2) % points.length;
        const cross = (points[j] - points[i]) * (y - points[i + 1]) - (points[j + 1] - points[i + 1]) * (x - points[i]);
        if (cross === 0) continue;
        if (sign === 0) sign = Math.sign(cross);
        else if (Math.sign(cross) !== sign) return false;
    }
    return sign !== 0;
}

/** pixels：[[x, y]]（畫面像素座標）。回傳每個點最上層多邊形的 { role, part }，沒有則 null。 */
function topmost(items, pixels) {
    const top = pixels.map(() => null);
    items.forEach((item) => {
        if (item.kind !== 'polygon') return;
        const p = item.points;
        let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
        for (let i = 0; i < p.length; i += 2) {
            x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]);
            y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
        }
        const hit = { role: item.role, part: item.part };
        for (let at = 0; at < pixels.length; at++) {
            const [x, y] = pixels[at];
            if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && contains(p, x, y)) top[at] = hit;
        }
    });
    return top;
}

// ---------------------------------------------------------------- 比對

const same = (a, b) => (a === null || b === null ? a === b : a.role === b.role && a.part === b.part);

/** 物體在這個視角下的畫面範圍（Å）：外框八個角的投影。 */
function extentOf(scene, view) {
    const { right, up } = axes(view);
    const { min, max } = scene.bounds;
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => [n & 1 ? max[0] : min[0], n & 2 ? max[1] : min[1], n & 4 ? max[2] : min[2]]);
    const xs = corners.map((c) => dot(c, right));
    const ys = corners.map((c) => dot(c, up));
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** grid × grid 個畫面點（Å），鋪在物體的畫面範圍內（每格的中心）。 */
function gridPoints(scene, view, grid = GRID) {
    const { x0, x1, y0, y1 } = extentOf(scene, view);
    const points = [];
    for (let i = 0; i < grid; i++) {
        for (let j = 0; j < grid; j++) points.push([x0 + (x1 - x0) * (i + 0.5) / grid, y0 + (y1 - y0) * (j + 0.5) / grid]);
    }
    return points;
}

/** 畫面點周圍 distance 內的判定是否都與它自己相同。 */
function steady(shape, view, point, hit, distance) {
    return NEIGHBOURS.every(([dx, dy]) => same(hit, firstHit(shape, view, [point[0] + dx * distance, point[1] + dy * distance])));
}

/**
 * 一個視角的比對。listOf(size) -> { items, pixelsPerAngstrom }；options：{ grid = GRID, edge = EDGE }。
 * 回傳 { counted, agreed, objectCounted, objectAgreed, central, centralAgreed, misses }：
 *   counted／agreed              不在邊附近的畫面點，與其中「最上層多邊形＝射線判定」者
 *   objectCounted／objectAgreed  同上，但只算射線判定或清單至少有一邊說「有東西」的點（背景對背景不算）
 *   central／centralAgreed       射線判定是核或切面、而且在中央區域的點
 */
function compare(shape, scene, view, listOf, options = {}) {
    const size = { width: 600, height: 600 };
    const list = listOf(size);
    const ppa = list.pixelsPerAngstrom;
    const points = gridPoints(scene, view, options.grid);
    const tops = topmost(list.items, points.map(([X, Y]) => [size.width / 2 + ppa * X, size.height / 2 - ppa * Y]));
    const stats = { counted: 0, agreed: 0, objectCounted: 0, objectAgreed: 0, central: 0, centralAgreed: 0, misses: [] };
    const extent = extentOf(scene, view);
    const edge = (options.edge === undefined ? EDGE : options.edge) * Math.min(extent.x1 - extent.x0, extent.y1 - extent.y0);
    points.forEach((point, at) => {
        const hit = firstHit(shape, view, point);
        if (!steady(shape, view, point, hit, edge)) return;
        const ok = same(hit, tops[at]);
        stats.counted += 1;
        stats.agreed += ok ? 1 : 0;
        if (hit !== null || tops[at] !== null) {
            stats.objectCounted += 1;
            stats.objectAgreed += ok ? 1 : 0;
        }
        const special = hit !== null && (hit.role === 'shapeCore' || hit.part === PART.CUT_A || hit.part === PART.CUT_B);
        if (special && steady(shape, view, point, hit, CENTRAL * edge)) {
            stats.central += 1;
            stats.centralAgreed += ok ? 1 : 0;
        }
        if (!ok) stats.misses.push({ point, expected: hit, got: tops[at] });
    });
    return stats;
}

// ---------------------------------------------------------------- 對照用的錯誤實作

/** 全部正面依質心深度由遠到近排序（計畫明說不可以這樣做）：{ items, pixelsPerAngstrom }。 */
function byCentroidDepth(scene, view, size, ppa) {
    const { right, up, toward } = axes(view);
    const faces = [];
    scene.objects.forEach((mesh) => mesh.faces.forEach((face, f) => {
        const pts = Array.from(face, (v) => [mesh.vertices[3 * v], mesh.vertices[3 * v + 1], mesh.vertices[3 * v + 2]]);
        const n = [0, 0, 0];
        pts.forEach((p, i) => {
            const q = pts[(i + 1) % pts.length];
            n[0] += p[1] * q[2] - p[2] * q[1];
            n[1] += p[2] * q[0] - p[0] * q[2];
            n[2] += p[0] * q[1] - p[1] * q[0];
        });
        if (dot(n, toward) <= 0) return;
        const centre = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length);
        faces.push({
            depth: dot(centre, toward), role: mesh.role, part: mesh.part[f], kind: 'polygon',
            points: pts.flatMap((p) => [size.width / 2 + ppa * dot(p, right), size.height / 2 - ppa * dot(p, up)]),
        });
    }));
    return { items: faces.sort((a, b) => a.depth - b.depth), pixelsPerAngstrom: ppa };
}

// ---------------------------------------------------------------- 視角

function views() {
    const list = [];
    for (let y = 0; y < 12; y++) {
        for (let p = 0; p < 15; p++) list.push({ yaw: 30 * y, pitch: -75 + 150 * p / 14, zoom: 1 });
    }
    const next = G.prng(20261119);
    for (let i = 0; i < 20; i++) list.push({ yaw: 360 * next(), pitch: -85 + 170 * next(), zoom: 1 });
    return Object.freeze(list.map(Object.freeze));
}

module.exports = { PART, GRID, VIEWS: views(), axes, solid, firstHit, topmost, contains, compare, byCentroidDepth, gridPoints };
