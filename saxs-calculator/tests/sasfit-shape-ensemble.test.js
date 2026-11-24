'use strict';
/**
 * sasfit-shape-ensemble.js：選了結構因子時，3D 示意畫一群相同的顆粒（v5.8，規格 §6、決策 43）。
 * 排列（固定種子的隨機擺放／打亂的晶格）、按比例的箱子、易讀性的下限、面數預算、旋轉、場景與說明文字。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SasFitShapeEnsemble: E, SasFitShapeGeom: G, SasFitForm: Form, SasFitJobs: Jobs, SasFitShapeView: V } = require('./load.js');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'sasfit-shape-ensemble.js'), 'utf8');
const BALL = 4 * Math.PI / 3;
const sq = (radiusEffective, volfraction, extra) => ({ structure: 'hardsphere', radiusEffective, volfraction, ...extra });
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const centres = (scene) => scene.placements.map((p) => p.centre);
const minGap = (points) => {
    let gap = Infinity;
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) gap = Math.min(gap, distance(points[i], points[j]));
    return gap;
};
const triples = (flat) => Array.from({ length: flat.length / 3 }, (_, i) => [flat[3 * i], flat[3 * i + 1], flat[3 * i + 2]]);
const faces = (scene) => scene.objects.reduce((n, m) => n + m.faces.length, 0);
const DEFAULTS = {
    sphere: { radius: 50 }, core_shell_sphere: { radius: 60, thickness: 10 }, vesicle: { radius: 100, thickness: 30 },
    ellipsoid: { radius_polar: 20, radius_equatorial: 400 }, cylinder: { radius: 20, length: 400 },
    core_shell_cylinder: { radius: 20, thickness: 20, length: 400 },
};

// ---------------------------------------------------------------- module
test('[ensemble] module: frozen, the constants of decision 43, pure (no DOM, no Math.random, no colour)', () => {
    assert.ok(Object.isFrozen(E));
    assert.equal(E.COUNT, 12);
    assert.equal(E.FACE_BUDGET, 8000);
    assert.equal(E.MIN_PARTICLE_PX, 28);
    assert.equal(E.REFERENCE_SIDE_PX, 300);
    assert.ok(E.RANDOM_PACKING > 0.2 && E.RANDOM_PACKING < 0.35);
    assert.doesNotMatch(SOURCE, /\bdocument\b|\bwindow\b|Math\.random|setTimeout|requestAnimationFrame/);
    assert.doesNotMatch(SOURCE, /(?<![&\w])#[0-9a-fA-F]{3,8}\b|\brgba?\(/);
    assert.doesNotMatch(SOURCE, /toFixed|toPrecision/, 'numbers go through SasFitShapeView.nm and SasFitFormat');
});

// ---------------------------------------------------------------- arrangement
test('[ensemble] arrangement, random: N points from a fixed seed, centred, no two closer than the spheres allow at RANDOM_PACKING', () => {
    for (const count of [2, 5, 8, 12]) {
        const a = E.arrangement({ count, packing: 0.1 });
        assert.equal(a.kind, 'random');
        assert.equal(a.points.length, 3 * count);
        assert.deepEqual(E.arrangement({ count, packing: 0.1 }), a, 'the same every time');
        const pts = triples(a.points);
        [0, 1, 2].forEach((k) => assert.ok(Math.abs(pts.reduce((s, p) => s + p[k], 0)) < 1e-12, 'centred'));
        const side = Math.cbrt(count * BALL / E.RANDOM_PACKING);           // box side in particle radii at the design packing
        assert.ok(minGap(pts) * side >= 2 - 1e-9, `${count}: ${minGap(pts) * side}`);
        assert.ok(pts.every((p) => p.every((x) => Math.abs(x) <= 1)), 'inside one box width of the centre');
        assert.equal(a.packing, 0.1);
        assert.equal(a.capped, false);
    }
    assert.notDeepEqual(triples(E.arrangement({ count: 12, packing: 0.1 }).points).slice(0, 2), triples(E.arrangement({ count: 8, packing: 0.1 }).points).slice(0, 2));
});

test('[ensemble] arrangement: the random points do not depend on the packing below RANDOM_PACKING (φ changes only the box)', () => {
    const low = E.arrangement({ count: 12, packing: 0.001 });
    const high = E.arrangement({ count: 12, packing: E.RANDOM_PACKING });
    assert.deepEqual(Array.from(low.points), Array.from(high.points));
});

test('[ensemble] arrangement, lattice: above RANDOM_PACKING a jittered lattice whose spheres never touch; capped at its densest packing', () => {
    const at = (packing) => E.arrangement({ count: 12, packing });
    const dense = at(0.4);
    assert.equal(dense.kind, 'lattice');
    assert.equal(dense.capped, false);
    const side = (packing) => Math.cbrt(12 * BALL / packing);
    assert.ok(minGap(triples(dense.points)) * side(0.4) >= 2 - 1e-9);
    const max = at(0.74);
    assert.equal(max.capped, true);
    assert.ok(max.packing < 0.74 && max.packing >= 0.45, 'twelve of the 16 sites of a bcc box: 0.51');
    assert.ok(Math.abs(minGap(triples(max.points)) * side(max.packing) - 2) < 1e-9, 'at the cap the spheres touch');
    // continuous in the packing: a small step moves every point a little
    const a = triples(at(0.4).points);
    const b = triples(at(0.401).points);
    assert.ok(a.every((p, i) => distance(p, b[i]) < 0.01));
});

// ---------------------------------------------------------------- scenes
test('[ensemble] build sphere@hardsphere φ 0.20: 12 particles, bounding spheres apart, the box holds φ, the scale is the particle\'s', () => {
    const scene = E.build('sphere', { radius: 50 }, sq(50, 0.2));
    assert.equal(scene.kind, 'ensemble');
    assert.equal(scene.placements.length, 12);
    assert.equal(scene.info.count, 12);
    assert.equal(scene.info.spacing, 'scale');
    assert.equal(scene.info.arrangement, 'random');
    assert.ok(minGap(centres(scene)) >= 2 * scene.particle.radius - 1e-9);
    const { boxSide } = scene.info;                                          // Angstrom
    assert.ok(Math.abs(12 * BALL * 50 ** 3 / boxSide ** 3 - 0.2) < 1e-12, 'N (4/3)π R_eff³ / V_box = φ');
    assert.ok(scene.placements.every((p) => p.rotation.join() === '1,0,0,0,1,0,0,0,1'), 'a sphere is not turned: the cut faces the viewer');
    let far = 0;
    scene.placements.forEach(({ centre }) => { far = Math.max(far, Math.hypot(...centre)); });
    assert.ok(scene.radius <= far + scene.particle.radius + 1e-9 && scene.radius >= far, 'the circumscribed sphere of everything');
    assert.ok(Object.isFrozen(scene) && Object.isFrozen(scene.placements) && Object.isFrozen(scene.info));
});

test('[ensemble] spacing: φ 1e-4 is clamped to the legible spacing (and says so), φ 0.2 is to scale, φ 0.6 is capped (denser in reality)', () => {
    const sparse = E.build('sphere', { radius: 50 }, sq(50, 1e-4));
    assert.equal(sparse.info.spacing, 'sparse');
    const particlePx = 2 * sparse.particle.radius * (1 - 2 * V.MARGIN) * E.REFERENCE_SIDE_PX / (2 * sparse.radius);
    assert.ok(particlePx >= E.MIN_PARTICLE_PX - 1e-6, `a particle is ${particlePx} px on the reference stage`);
    assert.ok(Math.abs(particlePx - E.MIN_PARTICLE_PX) < 2, 'clamped to (about) the threshold, not further');
    assert.equal(E.build('sphere', { radius: 50 }, sq(50, 0.2)).info.spacing, 'scale');
    const dense = E.build('sphere', { radius: 50 }, sq(50, 0.6));
    assert.equal(dense.info.spacing, 'dense');
    assert.equal(dense.info.arrangement, 'lattice');
    assert.ok(minGap(centres(dense)) >= 100 - 1e-9);
});

test('[ensemble] stability: changing the radius rescales the same layout; changing φ only resizes the box; the same input gives the same scene', () => {
    const a = E.build('sphere', { radius: 50 }, sq(50, 0.1));
    const b = E.build('sphere', { radius: 60 }, sq(60, 0.1));
    centres(a).forEach((c, i) => c.forEach((x, k) => assert.ok(Math.abs(x * 1.2 - centres(b)[i][k]) < 1e-9)));
    const c = E.build('sphere', { radius: 50 }, sq(50, 0.05));
    const ratio = Math.cbrt(0.1 / 0.05);
    centres(a).forEach((p, i) => p.forEach((x, k) => assert.ok(Math.abs(x * ratio - centres(c)[i][k]) < 1e-9)));
    assert.deepEqual(E.build('sphere', { radius: 50 }, sq(50, 0.1)), a);
});

test('[ensemble] anisotropic particles: random orientations; placed by their bounding sphere, so a cylinder at φ 0.2 is denser in reality', () => {
    const scene = E.build('cylinder', DEFAULTS.cylinder, sq(73.3, 0.2));
    const rotations = scene.placements.map((p) => p.rotation.join());
    assert.equal(new Set(rotations).size, scene.placements.length, 'each its own orientation');
    scene.placements.forEach(({ rotation: r }) => {
        const rows = [r.slice(0, 3), r.slice(3, 6), r.slice(6, 9)];
        rows.forEach((row, i) => rows.forEach((other, j) => {
            const dot = row[0] * other[0] + row[1] * other[1] + row[2] * other[2];
            assert.ok(Math.abs(dot - (i === j ? 1 : 0)) < 1e-12, 'orthonormal');
        }));
    });
    assert.ok(minGap(centres(scene)) >= 2 * scene.particle.radius - 1e-9, 'bounding spheres apart: never interpenetrating');
    assert.equal(scene.info.spacing, 'dense');
    assert.ok(scene.info.placementRadius > scene.info.radiusEffective);
});

test('[ensemble] a user-entered R_eff smaller than the particle: placement uses the bounding radius', () => {
    const scene = E.build('core_shell_sphere', DEFAULTS.core_shell_sphere, sq(30, 0.1));
    assert.equal(scene.info.placementRadius, scene.particle.radius);
    assert.ok(minGap(centres(scene)) >= 2 * scene.particle.radius - 1e-9);
});

test('[ensemble] face budget: count x faces <= FACE_BUDGET for the six models (defaults and extremes), the finest level that fits', () => {
    const cases = Object.entries(DEFAULTS).concat([['cylinder', { radius: 5, length: 2000 }], ['core_shell_sphere', { radius: 200, thickness: 0.5 }]]);
    cases.forEach(([model, params]) => {
        const scene = E.build(model, params, sq(50, 0.1));
        const total = scene.placements.length * faces(scene.particle);
        assert.ok(total <= E.FACE_BUDGET, `${model}: ${total}`);
        assert.ok(G.DETAILS.indexOf(scene.info.detail) >= 0);
        const finer = G.DETAILS[G.DETAILS.indexOf(scene.info.detail) - 1];
        if (finer !== undefined) assert.ok(scene.placements.length * faces(G.build(model, params, { detail: finer })) > E.FACE_BUDGET, model + ' could be finer');
        assert.equal(scene.info.faces, total);
    });
});

test('[ensemble] build returns null without a usable R_eff or φ, or without a shape', () => {
    assert.equal(E.build('sphere', { radius: 50 }, sq(0, 0.2)), null);
    assert.equal(E.build('sphere', { radius: 50 }, sq(NaN, 0.2)), null);
    assert.equal(E.build('sphere', { radius: 50 }, sq(50, NaN)), null);
    assert.equal(E.build('sphere', { radius: -1 }, sq(50, 0.2)), null);
    assert.equal(E.build('guinier', { rg: 60 }, sq(50, 0.2)), null);
});

// ---------------------------------------------------------------- the form and the texts
const formOf = (model, actions) => actions.reduce((form, action) => Form.reduce(form, action), Form.create(model));
const setValue = (name, value) => ({ type: 'setValue', name, value: String(value) });

test('[ensemble] sqInfo: null without S(Q); hardsphere: φ, R_eff and its mode; hayter_msa adds the charge and the Debye length', () => {
    assert.equal(E.sqInfo(Form.create('sphere')), null);
    const hard = E.sqInfo(formOf('sphere', [{ type: 'setStructure', structure: 'hardsphere' }]));
    assert.deepEqual({ ...hard }, { structure: 'hardsphere', volfraction: 0.2, radiusEffective: 50, mode: 1, modeName: '半徑（radius）' });
    const msa = E.sqInfo(formOf('core_shell_sphere', [{ type: 'setStructure', structure: 'hayter_msa' }]));
    assert.equal(msa.radiusEffective, 70);
    assert.equal(msa.charge, 19);
    assert.equal(msa.debyeLength, 205.95140248819612, 'hayter_msa.c with R_eff 70 Å (tests/sasfit-sq-derived.test.js)');
    const user = E.sqInfo(formOf('sphere', [{ type: 'setStructure', structure: 'hardsphere' }, { type: 'setRadiusMode', mode: 0 }]));
    assert.equal(user.modeName, '自行輸入');
    assert.equal(user.radiusEffective, Jobs.params(formOf('sphere', [{ type: 'setStructure', structure: 'hardsphere' }, { type: 'setRadiusMode', mode: 0 }])).radius_effective);
    assert.equal(E.sqInfo(formOf('sphere', [{ type: 'setStructure', structure: 'hardsphere' }, setValue('radius', 'x')])), null, 'a form with an error');
});

test('[ensemble] lines: S(Q) name, N drawn, φ, R_eff with the mode in Chinese; the not-to-scale sentence only when it applies', () => {
    const form = (phi) => formOf('sphere', [{ type: 'setStructure', structure: 'hardsphere' }, setValue('volfraction', phi)]);
    const lines = (phi) => E.lines(E.sqInfo(form(phi)), E.build('sphere', { radius: 50 }, E.sqInfo(form(phi))).info);
    const normal = lines(0.2);
    assert.ok(normal.includes('S(Q)：hardsphere 硬球，圖中 12 顆相同的顆粒，φ = 0.20'), normal.join('｜'));
    assert.ok(normal.includes('有效半徑 R_eff = 5.0 nm，模式：半徑（radius）'), normal.join('｜'));
    assert.ok(!normal.some((line) => /未按比例/.test(line)));
    const sparse = lines(1e-4);
    assert.ok(sparse.includes('體積分率很低，顆粒間距未按比例（實際更疏）'), sparse.join('｜'));
    const dense = lines(0.7);
    assert.ok(dense.some((line) => /未按比例（實際更密）/.test(line)), dense.join('｜'));
    assert.ok(dense.some((line) => /晶格/.test(line)), 'the lattice is named, not passed off as a random liquid');
});

test('[ensemble] lines: hayter_msa lists the charge and κ⁻¹ (not drawn); a cylinder says why it is drawn sparser', () => {
    const msa = E.sqInfo(formOf('core_shell_sphere', [{ type: 'setStructure', structure: 'hayter_msa' }]));
    const text = E.lines(msa, E.build('core_shell_sphere', DEFAULTS.core_shell_sphere, msa).info);
    assert.ok(text.some((line) => line.startsWith('S(Q)：hayter_msa Hayter–Penfold MSA（帶電球），圖中 ')), text.join('｜'));
    assert.ok(text.includes('電荷 19.0 e，Debye 屏蔽長度 κ⁻¹ = 20.6 nm（由溫度、鹽濃度、介電常數與反離子算出，與 hayter_msa 相同；圖中不畫屏蔽雲）'), text.join('｜'));
    const cyl = E.sqInfo(formOf('cylinder', [{ type: 'setStructure', structure: 'hardsphere' }]));
    const rods = E.lines(cyl, E.build('cylinder', DEFAULTS.cylinder, cyl).info);
    assert.ok(rods.some((line) => /外接球/.test(line) && /實際更密/.test(line)), rods.join('｜'));
    assert.ok(rods.includes('有效半徑 R_eff = 7.3 nm，模式：排除體積（excluded volume）'), rods.join('｜'));
    assert.ok(E.lines(cyl, null).some((line) => /只畫一顆/.test(line)), 'no ensemble: one particle, and it says so');
    assert.ok(text.concat(rods).every((line) => typeof line === 'string' && !/[<>]/.test(line)));
});
