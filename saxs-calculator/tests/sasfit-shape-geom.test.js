'use strict';
/**
 * sasfit-shape-geom.js: the meshes of the shape models and the fixed-seed
 * worm-like chain (design spec 6; plan M4 Task 3).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitShapeGeom: G, SasFitMeta: Meta } = require('./load.js');

const { PART } = G;
const MESH_MODELS = G.SHAPE_MODELS.filter((m) => m !== 'flexible_cylinder');
const SHELL_MODELS = ['core_shell_sphere', 'vesicle', 'core_shell_cylinder'];
const DIMENSIONS = ['radius', 'thickness', 'length', 'radius_polar', 'radius_equatorial', 'kuhn_length'];
const AZIMUTH = 48;                    // the grid the plan gives as its example: a solid sphere is 48 x 32 = 1536 faces
const POLAR = 32;
const SCENE_MAX_FACES = 8000;

/** The model's default dimensions (sasfit-meta.js), other parameters left out. */
function defaults(model) {
    const entries = Meta.models[model].params.filter((p) => DIMENSIONS.includes(p.name)).map((p) => [p.name, p.def]);
    return Object.fromEntries(entries);
}

/** A second parameter set per model with extreme proportions (plan: R = 5, L = 2000; t = 0.5, R = 200). */
const EXTREME = {
    sphere: [{ radius: 0.5 }, { radius: 2000 }],
    ellipsoid: [{ radius_polar: 5, radius_equatorial: 2000 }, { radius_polar: 2000, radius_equatorial: 5 }],
    cylinder: [{ radius: 5, length: 2000 }, { radius: 2000, length: 5 }],
    core_shell_sphere: [{ radius: 200, thickness: 0.5 }, { radius: 0.5, thickness: 200 }],
    vesicle: [{ radius: 200, thickness: 0.5 }, { radius: 0.5, thickness: 200 }],
    core_shell_cylinder: [{ radius: 5, thickness: 0.5, length: 2000 }, { radius: 200, thickness: 0.5, length: 5 }],
    lamellar: [{ thickness: 0.5 }, { thickness: 2000 }],
};
/** Every [model, params] of a mesh model: the defaults and the extreme sets. */
const CASES = MESH_MODELS.flatMap((model) => [defaults(model)].concat(EXTREME[model]).map((params) => [model, params]));
const label = (model, params) => model + ' ' + JSON.stringify(params);

// ------------------------------------------------------------------ mesh measurements (the tests' own maths)

const point = (mesh, v) => [mesh.vertices[3 * v], mesh.vertices[3 * v + 1], mesh.vertices[3 * v + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);

/** Area, unit normal (Newell) and centroid of face f. */
function faceInfo(mesh, f) {
    const pts = Array.from(mesh.faces[f], (v) => point(mesh, v));
    const n = [0, 0, 0];
    pts.forEach((p, i) => {
        const c = cross(p, pts[(i + 1) % pts.length]);
        n[0] += c[0] / 2; n[1] += c[1] / 2; n[2] += c[2] / 2;
    });
    const area = norm(n);
    const centroid = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length);
    return { pts, area, normal: n.map((x) => x / area), centroid };
}

const faceIndices = (mesh, part) => Array.from(mesh.part.keys()).filter((f) => part === undefined || mesh.part[f] === part);
const facesOf = (mesh, part) => faceIndices(mesh, part).map((f) => faceInfo(mesh, f));
const areaOf = (mesh, part) => facesOf(mesh, part).reduce((s, f) => s + f.area, 0);

/** Volume by the divergence theorem (each face as a fan of triangles). */
function volume(mesh) {
    let six = 0;
    mesh.faces.forEach((face) => {
        const p0 = point(mesh, face[0]);
        for (let i = 1; i + 1 < face.length; i++) six += dot(p0, cross(point(mesh, face[i]), point(mesh, face[i + 1])));
    });
    return six / 6;
}

/** { edges, bad }: the number of undirected edges, and those not used exactly once in each direction. */
function edgeReport(mesh) {
    const uses = new Map();
    mesh.faces.forEach((face) => face.forEach((a, i) => {
        const b = face[(i + 1) % face.length];
        const key = Math.min(a, b) + '-' + Math.max(a, b);
        uses.set(key, (uses.get(key) || []).concat(a < b ? 1 : -1));
    }));
    const bad = Array.from(uses).filter(([, dirs]) => dirs.length !== 2 || dirs[0] + dirs[1] !== 0);
    return { edges: uses.size, bad: bad.map(([key, dirs]) => key + ':' + dirs.join('/')) };
}

function extent(scene) {
    return [0, 1, 2].map((k) => scene.bounds.max[k] - scene.bounds.min[k]);
}

const close = (actual, expected, rel, what) => assert.ok(
    Math.abs(actual - expected) <= rel * Math.abs(expected), what + ': ' + actual + ' vs ' + expected);
const shellOf = (scene) => scene.objects.find((m) => m.role === 'shapeShell');
const coreOf = (scene) => scene.objects.find((m) => m.role === 'shapeCore');
const isDeepFrozen = (o) => o === null || typeof o !== 'object' || ArrayBuffer.isView(o)
    || (Object.isFrozen(o) && Object.values(o).every(isDeepFrozen));

const PI = Math.PI;
const ball = (r) => 4 * PI * r ** 3 / 3;
const rod = (r, l) => PI * r * r * l;
/** Analytic volume of every object of the scene, in the order of scene.objects. */
const VOLUMES = {
    sphere: (p) => [ball(p.radius)],
    ellipsoid: (p) => [4 * PI * p.radius_equatorial ** 2 * p.radius_polar / 3],
    cylinder: (p) => [rod(p.radius, p.length)],
    core_shell_sphere: (p) => [ball(p.radius), 0.75 * (ball(p.radius + p.thickness) - ball(p.radius))],
    vesicle: (p) => [0.75 * (ball(p.radius + p.thickness) - ball(p.radius))],
    core_shell_cylinder: (p) => [rod(p.radius, p.length),
        0.75 * (rod(p.radius + p.thickness, p.length + 2 * p.thickness) - rod(p.radius, p.length))],
    lamellar: (p) => [p.thickness * (G.LATERAL_FACTOR * p.thickness) ** 2],
};
/** The physical size along x, y, z (the plan's table). */
const SIZES = {
    sphere: (p) => [2 * p.radius, 2 * p.radius, 2 * p.radius],
    ellipsoid: (p) => [2 * p.radius_equatorial, 2 * p.radius_equatorial, 2 * p.radius_polar],
    cylinder: (p) => [2 * p.radius, 2 * p.radius, p.length],
    core_shell_sphere: (p) => [0, 0, 0].map(() => 2 * (p.radius + p.thickness)),
    vesicle: (p) => [0, 0, 0].map(() => 2 * (p.radius + p.thickness)),
    core_shell_cylinder: (p) => [2 * (p.radius + p.thickness), 2 * (p.radius + p.thickness), p.length + 2 * p.thickness],
    lamellar: (p) => [G.LATERAL_FACTOR * p.thickness, G.LATERAL_FACTOR * p.thickness, p.thickness],
};

// ------------------------------------------------------------------ module

test('module: frozen, the constants and the model list of the plan', () => {
    assert.ok(Object.isFrozen(G));
    assert.equal(G.MAX_FACES, 4000);
    assert.equal(G.LATERAL_FACTOR, 6);
    assert.ok(Number.isInteger(G.SEED));
    assert.deepEqual({ ...G.PART }, { SOLID: 0, CAVITY: 1, CUT_A: 2, CUT_B: 3, OUTER: 4 });
    assert.deepEqual([...G.SHAPE_MODELS], ['sphere', 'ellipsoid', 'cylinder', 'core_shell_sphere', 'vesicle',
        'core_shell_cylinder', 'flexible_cylinder', 'lamellar']);
    assert.ok(Object.isFrozen(G.PART) && Object.isFrozen(G.SHAPE_MODELS));
    assert.deepEqual(Object.keys(G).sort(), ['LATERAL_FACTOR', 'MAX_FACES', 'PART', 'SEED', 'SHAPE_MODELS',
        'build', 'hasShape', 'prng', 'wormChain']);
});

test('hasShape: the 8 shape models; not the shape-independent models, the structure factors or anything else', () => {
    G.SHAPE_MODELS.forEach((model) => assert.equal(G.hasShape(model), true, model));
    const others = Meta.order.filter((model) => !G.SHAPE_MODELS.includes(model));
    assert.deepEqual(others, ['guinier', 'guinier_porod', 'power_law', 'mono_gauss_coil', 'gaussian_peak', 'hardsphere', 'hayter_msa']);
    others.concat(['', 'Sphere', 'toString', 'constructor', undefined, null, 3]).forEach((model) => {
        assert.equal(G.hasShape(model), false, String(model));
        assert.equal(G.build(model, { radius: 50, thickness: 10, length: 100, rg: 60, radius_effective: 50 }), null, String(model));
    });
});

// ------------------------------------------------------------------ meshes: structure

CASES.forEach(([model, params]) => {
    test('mesh ' + label(model, params) + ': face budget, valid indices, no degenerate face, finite vertices', () => {
        const scene = G.build(model, params);
        assert.equal(scene.kind, 'mesh');
        let total = 0;
        scene.objects.forEach((mesh) => {
            const count = mesh.faces.length;
            total += count;
            assert.ok(count > 0 && count <= G.MAX_FACES, mesh.role + ': ' + count + ' faces');
            assert.ok(mesh.vertices instanceof Float64Array && mesh.vertices.length % 3 === 0);
            assert.ok(mesh.part instanceof Uint8Array);
            assert.equal(mesh.part.length, count);
            assert.equal(mesh.closed, true);
            assert.ok(mesh.vertices.every(Number.isFinite));
            const n = mesh.vertices.length / 3;
            mesh.faces.forEach((face, f) => {
                assert.ok(face instanceof Uint32Array && face.length >= 3 && face.length <= 4, 'face ' + f);
                assert.ok(face.every((v) => v < n), 'face ' + f + ' index');
                assert.equal(new Set(face).size, face.length, 'face ' + f + ' repeats a vertex');
                assert.ok(faceInfo(mesh, f).area > 0, 'face ' + f + ' has no area');
            });
            const used = new Set(mesh.faces.flatMap((face) => Array.from(face)));
            assert.equal(used.size, n, 'every vertex is used');
        });
        assert.ok(total <= SCENE_MAX_FACES, 'scene: ' + total + ' faces');
    });

    test('mesh ' + label(model, params) + ': closed manifold, outward orientation, volume within 2% of the analytic one', () => {
        const scene = G.build(model, params);
        const expected = VOLUMES[model](params);
        assert.equal(scene.objects.length, expected.length);
        scene.objects.forEach((mesh, k) => {
            const report = edgeReport(mesh);
            assert.deepEqual(report.bad.slice(0, 5), [], mesh.role + ': edges not shared by two faces in opposite directions');
            const faces = mesh.faces.length;
            const vertices = mesh.vertices.length / 3;
            assert.equal(vertices - report.edges + faces, 2, mesh.role + ': Euler characteristic of a sphere');
            const v = volume(mesh);
            assert.ok(v > 0, mesh.role + ': volume ' + v);
            close(v, expected[k], 0.02, mesh.role + ' volume');
        });
    });

    test('mesh ' + label(model, params) + ': bounds are the physical dimensions; radius is the circumscribed sphere', () => {
        const scene = G.build(model, params);
        const size = SIZES[model](params);
        extent(scene).forEach((e, k) => close(e, size[k], 1e-9, 'xyz'[k] + ' extent'));
        [0, 1, 2].forEach((k) => close(scene.bounds.min[k], -scene.bounds.max[k], 1e-9, 'centred on the origin, ' + 'xyz'[k]));
        let far = 0;
        let min = [Infinity, Infinity, Infinity];
        let max = [-Infinity, -Infinity, -Infinity];
        scene.objects.forEach((mesh) => {
            for (let v = 0; v < mesh.vertices.length / 3; v++) {
                const p = point(mesh, v);
                far = Math.max(far, norm(p));
                min = min.map((m, k) => Math.min(m, p[k]));
                max = max.map((m, k) => Math.max(m, p[k]));
            }
        });
        assert.deepEqual([...scene.bounds.min], min, 'bounds.min is the vertex minimum');
        assert.deepEqual([...scene.bounds.max], max);
        assert.equal(scene.radius, far);
    });
});

test('roles and parts: single solids are one shapeSolid mesh of SOLID faces; default face counts', () => {
    const counts = {};
    ['sphere', 'ellipsoid', 'cylinder', 'lamellar'].forEach((model) => {
        const scene = G.build(model, defaults(model));
        assert.deepEqual(scene.objects.map((m) => m.role), ['shapeSolid'], model);
        assert.ok(scene.objects[0].part.every((p) => p === PART.SOLID), model);
        counts[model] = scene.objects[0].faces.length;
    });
    assert.equal(counts.sphere, AZIMUTH * POLAR, 'the plan\'s example: 48 x 32 = 1536');
    assert.equal(counts.ellipsoid, counts.sphere);
    assert.equal(counts.lamellar, 6);
    assert.deepEqual(G.build('core_shell_sphere', defaults('core_shell_sphere')).objects.map((m) => m.role), ['shapeCore', 'shapeShell']);
    assert.deepEqual(G.build('core_shell_cylinder', defaults('core_shell_cylinder')).objects.map((m) => m.role), ['shapeCore', 'shapeShell']);
    assert.deepEqual(G.build('vesicle', defaults('vesicle')).objects.map((m) => m.role), ['shapeShell']);
});

test('notToScale: only the lamellar slab (its lateral size is a sketch); it is LATERAL_FACTOR x the thickness wide', () => {
    MESH_MODELS.filter((m) => m !== 'lamellar').forEach((model) => assert.deepEqual([...G.build(model, defaults(model)).notToScale], [], model));
    const scene = G.build('lamellar', { thickness: 50 });
    assert.deepEqual([...scene.notToScale], ['層狀模型的橫向為無限延伸，圖中的寬度只是示意']);
    assert.deepEqual(extent(scene), [300, 300, 50]);
    assert.equal(G.build('flexible_cylinder', defaults('flexible_cylinder')).notToScale.length, 0);
});

// ------------------------------------------------------------------ the quarter cut

const SHELL_CASES = CASES.filter(([model]) => SHELL_MODELS.includes(model));

SHELL_CASES.forEach(([model, params]) => {
    test('cut ' + label(model, params) + ': CUT_A faces look along +y, CUT_B along +x, and lie in their half planes', () => {
        const shell = shellOf(G.build(model, params));
        const outer = params.radius + params.thickness;
        const cutA = facesOf(shell, PART.CUT_A);
        const cutB = facesOf(shell, PART.CUT_B);
        assert.ok(cutA.length > 0 && cutA.length === cutB.length);
        cutA.forEach((f) => {
            assert.ok(Math.abs(f.normal[0]) <= 1e-12 && Math.abs(f.normal[1] - 1) <= 1e-12 && Math.abs(f.normal[2]) <= 1e-12, 'normal +y');
            assert.ok(f.pts.every((p) => p[1] === 0 && p[0] >= 0), 'in the plane y = 0, x >= 0');
            assert.ok(f.centroid[0] > 0);
        });
        cutB.forEach((f) => {
            assert.ok(Math.abs(f.normal[0] - 1) <= 1e-12 && Math.abs(f.normal[1]) <= 1e-12 && Math.abs(f.normal[2]) <= 1e-12, 'normal +x');
            assert.ok(f.pts.every((p) => p[0] === 0 && p[1] >= 0), 'in the plane x = 0, y >= 0');
            assert.ok(f.centroid[1] > 0);
        });
        const section = model === 'core_shell_cylinder'
            ? outer * (params.length + 2 * params.thickness) - params.radius * params.length            // the frame
            : PI * (outer ** 2 - params.radius ** 2) / 2;                                                // half an annulus
        close(areaOf(shell, PART.CUT_A), section, 0.01, 'CUT_A area');
        close(areaOf(shell, PART.CUT_B), section, 0.01, 'CUT_B area');
    });

    test('cut ' + label(model, params) + ': the removed wedge is azimuth 0-90 degrees; CAVITY faces look inwards, OUTER faces outwards', () => {
        const scene = G.build(model, params);
        const shell = shellOf(scene);
        const eps = 1e-9 * scene.radius;
        assert.deepEqual([...new Set(shell.part)].sort(), [PART.CAVITY, PART.CUT_A, PART.CUT_B, PART.OUTER]);
        facesOf(shell).forEach((f) => {
            assert.equal(f.centroid[0] > eps && f.centroid[1] > eps, false, 'no face inside the removed wedge');
        });
        const cavity = facesOf(shell, PART.CAVITY);
        const outer = facesOf(shell, PART.OUTER);
        assert.equal(cavity.length > 0 && outer.length > 0, true);
        cavity.forEach((f) => assert.ok(dot(f.normal, f.centroid) < 0, 'a cavity face looks at the inside'));
        outer.forEach((f) => assert.ok(dot(f.normal, f.centroid) > 0, 'an outer face looks away'));
        // the side walls: towards / away from the symmetry axis
        const radial = (f) => f.normal[0] * f.centroid[0] + f.normal[1] * f.centroid[1];
        cavity.filter((f) => Math.abs(f.normal[2]) < 0.5).forEach((f) => assert.ok(radial(f) < 0, 'towards the axis'));
        outer.filter((f) => Math.abs(f.normal[2]) < 0.5).forEach((f) => assert.ok(radial(f) > 0, 'away from the axis'));
        const core = coreOf(scene);
        if (model !== 'vesicle') {
            assert.ok(core.part.every((p) => p === PART.SOLID), 'the core is whole and all SOLID');
            const full = faceIndices(core).some((f) => faceInfo(core, f).centroid[0] > eps && faceInfo(core, f).centroid[1] > eps);
            assert.equal(full, true, 'the core is not cut');
        } else assert.equal(core, undefined, 'a vesicle has no core: the inside is solvent');
    });

    test('cut ' + label(model, params) + ': no face of the scene has vertices on both sides of the plane x = 0 or y = 0', () => {
        G.build(model, params).objects.forEach((mesh) => {
            facesOf(mesh).forEach((f, at) => {
                [0, 1].forEach((k) => {
                    const values = f.pts.map((p) => p[k]);
                    assert.equal(Math.min(...values) < 0 && Math.max(...values) > 0, false, mesh.role + ' face ' + at + ' crosses ' + 'xy'[k] + ' = 0');
                });
            });
        });
    });
});

test('shared grid: vertices lie exactly on the azimuths 0 / 90 / 180 / 270 degrees, on the poles and on the equator', () => {
    const sphere = G.build('sphere', { radius: 50 }).objects[0];
    const keys = new Set();
    for (let v = 0; v < sphere.vertices.length / 3; v++) keys.add(point(sphere, v).join(','));
    [[50, 0, 0], [0, 50, 0], [-50, 0, 0], [0, -50, 0], [0, 0, 50], [0, 0, -50]].forEach((p) => assert.ok(keys.has(p.join(',')), p.join(',')));
    const onEquator = Array.from(keys).filter((key) => key.endsWith(',0')).length;
    assert.equal(onEquator, AZIMUTH, 'a full ring of vertices at z = 0');
    assert.equal(keys.size, AZIMUTH * (POLAR - 1) + 2);
});

test('shared grid: every vertex of the shell\'s inner wall is a vertex of the core, bit for bit (core-shell sphere and cylinder)', () => {
    ['core_shell_sphere', 'core_shell_cylinder'].forEach((model) => {
        const scene = G.build(model, defaults(model));
        const core = coreOf(scene);
        const shell = shellOf(scene);
        const coreKeys = new Set();
        for (let v = 0; v < core.vertices.length / 3; v++) coreKeys.add(point(core, v).join(','));
        const wall = new Set();
        faceIndices(shell, PART.CAVITY).forEach((f) => shell.faces[f].forEach((v) => wall.add(point(shell, v).join(','))));
        wall.forEach((key) => assert.ok(coreKeys.has(key), model + ': ' + key + ' is not a core vertex'));
        // and the other way round: every core vertex outside the removed wedge is on the wall
        const kept = Array.from(coreKeys).filter((key) => {
            const [x, y] = key.split(',').map(Number);
            return !(x > 0 && y > 0);
        });
        assert.equal(wall.size, kept.length, model);
    });
    // the outer surface uses the same angles: scaling a wall vertex of the sphere by (R + t) / R gives an outer vertex
    const shell = shellOf(G.build('core_shell_sphere', { radius: 50, thickness: 50 }));
    const outer = new Set();
    faceIndices(shell, PART.OUTER).forEach((f) => shell.faces[f].forEach((v) => outer.add(point(shell, v).join(','))));
    faceIndices(shell, PART.CAVITY).forEach((f) => shell.faces[f].forEach((v) => {
        assert.ok(outer.has(point(shell, v).map((x) => 2 * x).join(',')));
    }));
});

test('cut faces are divided at least twice along the radial direction', () => {
    const shell = shellOf(G.build('vesicle', { radius: 100, thickness: 30 }));
    const radii = new Set();
    faceIndices(shell, PART.CUT_A).forEach((f) => shell.faces[f].forEach((v) => radii.add(Math.round(norm(point(shell, v)) * 1e6) / 1e6)));
    assert.ok(radii.size >= 3, 'radial levels: ' + Array.from(radii).join(', '));
    assert.deepEqual([Math.min(...radii), Math.max(...radii)], [100, 130]);
});

// ------------------------------------------------------------------ degenerate and invalid input

test('zero thickness: the shell is left out and the bounds are those of the core; a vesicle without a membrane is null', () => {
    const sphere = G.build('core_shell_sphere', { radius: 60, thickness: 0 });
    assert.deepEqual(sphere.objects.map((m) => m.role), ['shapeCore']);
    assert.deepEqual(extent(sphere), [120, 120, 120]);
    close(sphere.radius, 60, 1e-12, 'circumscribed radius');
    const cyl = G.build('core_shell_cylinder', { radius: 20, thickness: 0, length: 400 });
    assert.deepEqual(cyl.objects.map((m) => m.role), ['shapeCore']);
    assert.deepEqual(extent(cyl), [40, 40, 400]);
    assert.equal(G.build('vesicle', { radius: 100, thickness: 0 }), null);
    // a thickness too small to change the radius in double precision counts as zero
    assert.deepEqual(G.build('core_shell_sphere', { radius: 1e20, thickness: 1 }).objects.map((m) => m.role), ['shapeCore']);
});

test('zero core: what is left is one whole solid of shell material with the outer dimensions', () => {
    const cases = [
        ['core_shell_sphere', { radius: 0, thickness: 10 }, [20, 20, 20]],
        ['vesicle', { radius: 0, thickness: 30 }, [60, 60, 60]],
        ['core_shell_cylinder', { radius: 0, thickness: 20, length: 400 }, [40, 40, 440]],
        ['core_shell_cylinder', { radius: 20, thickness: 20, length: 0 }, [80, 80, 40]],
    ];
    cases.forEach(([model, params, size]) => {
        const scene = G.build(model, params);
        assert.deepEqual(scene.objects.map((m) => m.role), ['shapeShell'], label(model, params));
        assert.ok(scene.objects[0].part.every((p) => p === PART.SOLID));
        assert.deepEqual(edgeReport(scene.objects[0]).bad, []);
        extent(scene).forEach((e, k) => close(e, size[k], 1e-9, label(model, params)));
    });
});

test('invalid dimensions: negative, non-finite, non-numeric, missing or all zero give null, never an exception', () => {
    G.SHAPE_MODELS.forEach((model) => {
        const good = defaults(model);
        assert.notEqual(G.build(model, good), null, model);
        Object.keys(good).forEach((name) => {
            [-1, NaN, Infinity, -Infinity, '50', null, undefined, {}].forEach((value) => {
                assert.equal(G.build(model, { ...good, [name]: value }), null, model + '.' + name + ' = ' + String(value));
            });
            const missing = { ...good };
            delete missing[name];
            assert.equal(G.build(model, missing), null, model + ' without ' + name);
        });
        const zero = Object.fromEntries(Object.keys(good).map((name) => [name, 0]));
        assert.equal(G.build(model, zero), null, model + ' all zero');
        [null, undefined, 5, 'x', []].forEach((params) => assert.equal(G.build(model, params), null, model + ' ' + String(params)));
    });
});

test('invalid dimensions: a zero that leaves no solid is null; sizes that overflow are null', () => {
    assert.equal(G.build('sphere', { radius: 0 }), null);
    assert.equal(G.build('ellipsoid', { radius_polar: 0, radius_equatorial: 400 }), null);
    assert.equal(G.build('ellipsoid', { radius_polar: 20, radius_equatorial: 0 }), null);
    assert.equal(G.build('cylinder', { radius: 0, length: 400 }), null);
    assert.equal(G.build('cylinder', { radius: 20, length: 0 }), null);
    assert.equal(G.build('lamellar', { thickness: 0 }), null);
    assert.equal(G.build('flexible_cylinder', { length: 0, kuhn_length: 100, radius: 20 }), null);
    assert.equal(G.build('flexible_cylinder', { length: 1000, kuhn_length: 0, radius: 20 }), null);
    assert.equal(G.build('flexible_cylinder', { length: 1000, kuhn_length: 100, radius: 0 }), null);
    assert.equal(G.build('core_shell_sphere', { radius: 1e308, thickness: 1e308 }), null);
    assert.equal(G.build('core_shell_cylinder', { radius: 20, thickness: 1e308, length: 1e308 }), null);
    assert.equal(G.build('lamellar', { thickness: 1e308 }), null);
    assert.notEqual(G.build('sphere', { radius: 1e-300 }), null, 'tiny but valid');
    assert.notEqual(G.build('sphere', { radius: 1e300 }), null, 'huge but finite');
});

test('build does not modify its parameters, ignores the ones it does not need and returns frozen scenes', () => {
    G.SHAPE_MODELS.forEach((model) => {
        const params = Object.freeze({ ...defaults(model), sld: 1, sld_solvent: 6, scale: 1, background: 0, theta: 60 });
        const before = JSON.stringify(params);
        const scene = G.build(model, params);
        assert.equal(JSON.stringify(params), before, model);
        assert.ok(isDeepFrozen(scene), model + ': everything but the typed arrays is frozen');
        const again = G.build(model, { ...defaults(model) });
        assert.notEqual(again, scene, 'a new scene every call');
        assert.deepEqual(again, scene, model + ': the same parameters give the same scene');
    });
});

// ------------------------------------------------------------------ PRNG

/** The first five 32-bit integers of mulberry32 for these seeds (computed once with exact integer arithmetic). */
const PRNG_INTEGERS = {
    0: [1144304738, 1416247, 958946056, 627933444, 2007157716],
    1: [2693262067, 11749833, 2265367787, 4213581821, 4159151403],
    13: [2432337258, 1546691432, 303185372, 206875054, 157929676],
};

test('prng: mulberry32 -- the first values are pinned (changing them would change everybody\'s chain)', () => {
    Object.entries(PRNG_INTEGERS).forEach(([seed, integers]) => {
        const next = G.prng(Number(seed));
        assert.deepEqual(integers.map(() => next() * 4294967296), integers, 'seed ' + seed);
    });
});

test('prng: same seed, same sequence; values in [0, 1); seeds are 32-bit integers', () => {
    const a = G.prng(G.SEED);
    const b = G.prng(G.SEED);
    const other = G.prng(G.SEED + 1);
    const values = Array.from({ length: 5000 }, () => a());
    assert.deepEqual(values, Array.from({ length: 5000 }, () => b()));
    assert.notDeepEqual(values.slice(0, 5), Array.from({ length: 5 }, () => other()));
    assert.ok(values.every((v) => v >= 0 && v < 1));
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    assert.ok(Math.abs(mean - 0.5) < 0.02, 'mean ' + mean);
    assert.deepEqual([1, 2].map(G.prng(4294967296 + 7)), [1, 2].map(G.prng(7)), 'a seed is taken modulo 2^32');
    [1.5, NaN, Infinity, '3', null, undefined].forEach((seed) => assert.throws(() => G.prng(seed), /seed/, String(seed)));
});

test('the source uses no Math.random (the configuration must be reproducible)', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'sasfit-shape-geom.js'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal(/Math\.random/.test(code), false);
    assert.equal(/\b(?:window|document|setTimeout|setInterval|requestAnimationFrame)\b/.test(code), false);
    assert.ok(/Math\.log\(1 - /.test(code), 'Box-Muller takes log(1 - u): u may be 0');
});

// ------------------------------------------------------------------ worm-like chain

const chainPoint = (chain, i) => [chain.points[3 * i], chain.points[3 * i + 1], chain.points[3 * i + 2]];
const endToEnd = (chain) => norm(sub(chainPoint(chain, chain.segments), chainPoint(chain, 0)));

test('wormChain: segments = clamp(round(8 L / b), 16, 200), ds = L / segments, equal steps, centred on its centroid', () => {
    [[0.5, 16], [10, 80], [100, 200], [2, 16], [2.06, 16], [2.07, 17], [25, 200]].forEach(([ratio, segments]) => {
        const chain = G.wormChain({ length: 100 * ratio, kuhnLength: 100 });
        assert.equal(chain.segments, segments, 'L / b = ' + ratio);
        assert.equal(chain.ds, 100 * ratio / segments);
        assert.ok(chain.points instanceof Float64Array);
        assert.equal(chain.points.length, 3 * (segments + 1));
        assert.ok(chain.points.every(Number.isFinite));
        for (let i = 0; i < segments; i++) {
            close(norm(sub(chainPoint(chain, i + 1), chainPoint(chain, i))), chain.ds, 1e-9, 'step ' + i);
        }
        [0, 1, 2].forEach((k) => {
            let sum = 0;
            for (let i = 0; i <= segments; i++) sum += chain.points[3 * i + k];
            assert.ok(Math.abs(sum / (segments + 1)) <= 1e-9 * 100 * ratio, 'centroid ' + 'xyz'[k]);
        });
        assert.ok(Object.isFrozen(chain));
    });
});

test('wormChain: the same (L, b, seed) gives the same points element by element; another L, b or seed another chain', () => {
    const a = G.wormChain({ length: 1000, kuhnLength: 100 });
    const b = G.wormChain({ length: 1000, kuhnLength: 100 });
    assert.notEqual(a.points, b.points);
    assert.deepEqual(a.points, b.points);
    assert.deepEqual(G.wormChain({ length: 1000, kuhnLength: 100, seed: G.SEED }).points, a.points, 'SEED is the default seed');
    assert.notDeepEqual(G.wormChain({ length: 1000, kuhnLength: 100, seed: G.SEED + 1 }).points, a.points);
    assert.notDeepEqual(G.wormChain({ length: 1001, kuhnLength: 100 }).points, a.points);
    assert.notDeepEqual(G.wormChain({ length: 1000, kuhnLength: 101 }).points, a.points);
    const input = Object.freeze({ length: 1000, kuhnLength: 100 });
    assert.deepEqual(G.wormChain(input).points, a.points, 'a frozen input is fine: nothing is written to it');
});

test('wormChain: stiff when L << b, coiled when L >> b', () => {
    const stiff = G.wormChain({ length: 50, kuhnLength: 1000 });       // L / b = 0.05
    assert.ok(endToEnd(stiff) > 0.99 * 50, 'end to end ' + endToEnd(stiff));
    assert.ok(endToEnd(stiff) <= 50 * (1 + 1e-12));
    const coiled = G.wormChain({ length: 5000, kuhnLength: 100 });     // L / b = 50
    assert.ok(endToEnd(coiled) < 0.6 * 5000, 'end to end ' + endToEnd(coiled));
});

/** <R_ee^2> over the seeds 1..200, divided by the Kratky-Porod value 2 lp L [1 - (lp / L)(1 - exp(-L / lp))]. */
function kratkyPorodRatio(length, kuhnLength) {
    const lp = kuhnLength / 2;
    const expected = 2 * lp * length * (1 - (lp / length) * (1 - Math.exp(-length / lp)));
    let sum = 0;
    for (let seed = 1; seed <= 200; seed++) sum += endToEnd(G.wormChain({ length, kuhnLength, seed })) ** 2;
    return sum / 200 / expected;
}

[1, 10, 50].forEach((ratio) => {
    test('wormChain: <R^2> of 200 fixed seeds is within 15% of Kratky-Porod with lp = b / 2 at L / b = ' + ratio, () => {
        const measured = kratkyPorodRatio(100 * ratio, 100);
        assert.ok(Math.abs(measured - 1) <= 0.15, 'ratio ' + measured);
    });
});

test('wormChain: the tangent correlation of neighbouring segments is exp(-ds / lp) on average', () => {
    const length = 1000;
    const kuhnLength = 100;
    let sum = 0;
    let count = 0;
    let ds = 0;
    for (let seed = 1; seed <= 50; seed++) {
        const chain = G.wormChain({ length, kuhnLength, seed });
        ds = chain.ds;
        for (let i = 0; i + 2 <= chain.segments; i++) {
            const t0 = sub(chainPoint(chain, i + 1), chainPoint(chain, i));
            const t1 = sub(chainPoint(chain, i + 2), chainPoint(chain, i + 1));
            sum += dot(t0, t1) / (ds * ds);
            count += 1;
        }
    }
    close(sum / count, Math.exp(-ds / (kuhnLength / 2)), 0.03, 'mean cosine of ' + count + ' joints');
});

test('wormChain: invalid input is an Error naming it', () => {
    assert.throws(() => G.wormChain({ length: 0, kuhnLength: 100 }), /length/);
    assert.throws(() => G.wormChain({ length: NaN, kuhnLength: 100 }), /length/);
    assert.throws(() => G.wormChain({ length: 100, kuhnLength: -1 }), /kuhnLength/);
    assert.throws(() => G.wormChain({ length: 100, kuhnLength: Infinity }), /kuhnLength/);
    assert.throws(() => G.wormChain({ length: 100, kuhnLength: 100, seed: 1.5 }), /seed/);
    assert.throws(() => G.wormChain(null), /wormChain/);
});

// ------------------------------------------------------------------ flexible cylinder

test('flexible_cylinder: a tube scene -- the centreline of wormChain and the radius, no mesh', () => {
    const params = defaults('flexible_cylinder');
    assert.deepEqual(params, { length: 1000, kuhn_length: 100, radius: 20 });
    const scene = G.build('flexible_cylinder', params);
    const chain = G.wormChain({ length: 1000, kuhnLength: 100 });
    assert.equal(scene.kind, 'tube');
    assert.equal('objects' in scene, false, 'no tube mesh: it would fold over itself');
    assert.deepEqual(scene.centreline, chain.points);
    assert.equal(scene.segments, 80);
    assert.equal(scene.tubeRadius, 20);
    let far = 0;
    [0, 1, 2].forEach((k) => {
        const values = Array.from({ length: 81 }, (_, i) => chain.points[3 * i + k]);
        assert.equal(scene.bounds.min[k], Math.min(...values) - 20, 'centreline extent minus the radius');
        assert.equal(scene.bounds.max[k], Math.max(...values) + 20);
    });
    for (let i = 0; i <= 80; i++) far = Math.max(far, norm(chainPoint(chain, i)));
    assert.equal(scene.radius, far + 20);
});

test('flexible_cylinder: the radius changes only the tube radius; L and b change the configuration', () => {
    const base = G.build('flexible_cylinder', { length: 1000, kuhn_length: 100, radius: 20 });
    const thick = G.build('flexible_cylinder', { length: 1000, kuhn_length: 100, radius: 55 });
    assert.deepEqual(thick.centreline, base.centreline);
    assert.equal(thick.tubeRadius, 55);
    assert.notDeepEqual(G.build('flexible_cylinder', { length: 1200, kuhn_length: 100, radius: 20 }).centreline, base.centreline);
    assert.notDeepEqual(G.build('flexible_cylinder', { length: 1000, kuhn_length: 120, radius: 20 }).centreline, base.centreline);
    assert.deepEqual(G.build('flexible_cylinder', { length: 1000, kuhn_length: 100, radius: 20 }).centreline, base.centreline);
});
