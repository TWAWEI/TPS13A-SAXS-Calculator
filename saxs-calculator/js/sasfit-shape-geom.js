/**
 * sasfit-shape-geom.js -- the geometry of the 3D structure sketch of the SAS
 * fitting page: one mesh per part of a shape model, and the centreline of a
 * worm-like chain (design spec 6; plan M4 Task 3). Original code.
 *
 *   hasShape(model)       true for the 8 models of SHAPE_MODELS
 *   build(model, params)  -> scene | null. Lengths in Angstrom, z is the symmetry axis, the origin is the centre.
 *       params: the model's dimensions by their sasmodels names (radius, thickness, length, radius_polar,
 *       radius_equatorial, kuhn_length); everything else in it is ignored. null when the model has no shape,
 *       a dimension is missing, not a finite number or negative, nothing solid is left, or a size overflows.
 *     scene (mesh) = { kind: 'mesh', objects: [mesh], bounds: { min: [x, y, z], max: [x, y, z] },
 *                      radius, notToScale: [string] }
 *     scene (tube) = { kind: 'tube', centreline: Float64Array(3 (n + 1)), tubeRadius, segments, bounds, radius,
 *                      notToScale }                                         -- flexible_cylinder only
 *     mesh = { role: 'shapeSolid' | 'shapeCore' | 'shapeShell', vertices: Float64Array(3 n),
 *              faces: [Uint32Array -- 3 or 4 vertex indices, anticlockwise seen from outside],
 *              part: Uint8Array (one PART per face), closed: true }
 *     bounds is the box of the vertices (tube: of the centreline, widened by the tube radius); radius is the
 *     sphere round the origin that holds everything (the default zoom of the view does not depend on the
 *     rotation). notToScale: sentences for the reader about what is only a sketch.
 *   prng(seed)            mulberry32: () => a number in [0, 1), from 32-bit integer arithmetic only
 *   wormChain({ length, kuhnLength, seed = SEED }) -> { points: Float64Array(3 (segments + 1)), segments, ds }
 *
 * The solids
 *   sphere, ellipsoid, cylinder     one solid (shapeSolid), every face SOLID
 *   core_shell_sphere               the core: a whole sphere of radius R (shapeCore, SOLID); the shell: R to
 *                                   R + t with a quarter cut away (shapeShell)
 *   vesicle                         the shell only; the inside is solvent and is not drawn
 *   core_shell_cylinder             the core: radius R, length L; the shell covers the side AND both ends
 *                                   (the sasmodels definition: outer radius R + t, length L + 2 t), cut the same way
 *   lamellar                        one uniform slab, thickness along z, LATERAL_FACTOR x the thickness wide
 *                                   (the model is infinite sideways: notToScale says so)
 *   flexible_cylinder               no mesh. A tube mesh would fold over itself: with the default values the
 *                                   joints turn by 42 degrees (rms) and the steps are shorter than the radius.
 *                                   The view draws the centreline as a thick line instead.
 *   A shell of zero thickness is left out (the core alone); a core of zero size leaves one whole solid of
 *   shell material.
 *
 * The cut. The wedge of azimuth 0 to 90 degrees is removed from a shell. What is left has two flat faces:
 *   CUT_A  in the plane y = 0 (the half x > 0), outward normal +y
 *   CUT_B  in the plane x = 0 (the half y > 0), outward normal +x
 * (the material is on the y < 0 side of CUT_A and on the x < 0 side of CUT_B). The inner wall of the shell is
 * CAVITY (its normals point into the hollow), its outer surface OUTER.
 *
 * The grid. Core, inner wall and outer surface use the same azimuths (AZIMUTH steps from 0, a multiple of 4)
 * and the same polar angles or axial levels, so their vertices lie exactly on the planes x = 0 and y = 0, on
 * the poles and on the equator: no face crosses a cut plane, the bounds are exactly the physical size, and
 * the error of a shell's volume does not depend on its thickness. Vertices are welded by position, which is
 * safe because every surface computes a shared point with the same expression.
 *
 * The chain. Persistence length lp = b / 2 (b = Kuhn length). segments = clamp(round(8 L / b), 16, 200) steps of
 * ds = L / segments. After each step the tangent turns by a Gaussian angle (standard deviation sqrt(ds / lp))
 * about one transverse axis of its frame and then about the other, which makes <t_i . t_i+1> = exp(-ds / lp)
 * exactly; the frame follows by parallel transport. No excluded volume. The points are moved to their centroid.
 * The random numbers depend on the seed only (never on the radius). The same input gives the same points
 * element by element in one engine; across engines the random integers are identical and the coordinates agree
 * to rounding (Math.sin / cos / log are not specified bit for bit).
 *
 * Nothing given is modified. Scenes, meshes and chains are frozen; their typed arrays cannot be, and must not
 * be written to. Pure: no DOM, no timers, no colours (a mesh only names its role), no other module.
 */

(function () {
    'use strict';

    const MAX_FACES = 4000;                       // per mesh (design spec 6)
    const SEED = 13;
    const LATERAL_FACTOR = 6;
    const PART = Object.freeze({ SOLID: 0, CAVITY: 1, CUT_A: 2, CUT_B: 3, OUTER: 4 });
    const SHAPE_MODELS = Object.freeze(['sphere', 'ellipsoid', 'cylinder', 'core_shell_sphere', 'vesicle',
        'core_shell_cylinder', 'flexible_cylinder', 'lamellar']);
    const ROLE = Object.freeze({ solid: 'shapeSolid', core: 'shapeCore', shell: 'shapeShell' });
    const LAMELLAR_NOTE = '層狀模型的橫向為無限延伸，圖中的寬度只是示意';

    const AZIMUTH = 48;                           // steps round the axis; a multiple of 4
    const POLAR = 32;                             // steps from pole to pole; even (the equator is a grid line)
    const CUT_STEPS = 2;                          // steps across the thickness of a shell
    const CAP_STEPS = 4;                          // rings of a cylinder's end face
    const SIDE_STEPS = 8;                         // steps along a cylinder's side
    const WHOLE = Object.freeze([0, AZIMUTH]);
    const KEPT = Object.freeze([AZIMUTH / 4, AZIMUTH]);                 // what the quarter cut leaves
    const CUTS = Object.freeze([
        Object.freeze({ part: PART.CUT_A, at: 0, normal: Object.freeze([0, 1, 0]) }),
        Object.freeze({ part: PART.CUT_B, at: AZIMUTH / 4, normal: Object.freeze([1, 0, 0]) }),
    ]);
    const CHAIN = Object.freeze({ perKuhn: 8, min: 16, max: 200 });
    const UINT32 = 4294967296;
    const MULBERRY_STEP = 0x6D2B79F5;
    const QUARTER_TURNS = Object.freeze([[1, 0], [0, 1], [-1, 0], [0, -1]]);

    const isObject = (v) => v !== null && typeof v === 'object';
    const isLength = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    const isPositive = (v) => Number.isFinite(v) && v > 0;

    // ------------------------------------------------------------- grid

    /** [cos, sin] of k / n of a full turn; exact at the quarter turns. */
    function turn(k, n) {
        const m = ((k % n) + n) % n;
        if ((4 * m) % n === 0) return QUARTER_TURNS[(4 * m) / n];
        const angle = 2 * Math.PI * m / n;
        return [Math.cos(angle), Math.sin(angle)];
    }

    const AZIMUTHS = Object.freeze(Array.from({ length: AZIMUTH + 1 }, (_, i) => turn(i, AZIMUTH)));
    const POLARS = Object.freeze(Array.from({ length: POLAR + 1 }, (_, j) => turn(j, 2 * POLAR)));      // pole to pole
    const POLAR_INDEX = Object.freeze(POLARS.map((_, j) => j));

    /** n + 1 values from `from` to `to`, both ends exact. */
    function levels(from, to, n) {
        return Array.from({ length: n + 1 }, (_, k) => (k === n ? to : from + (to - from) * k / n));
    }

    const isMonotone = (values) => values.every((v, k) => k === 0 || v !== values[k - 1]);

    /** The point [rho, z] of the half plane, turned to azimuth step i. (+ 0 turns -0 into 0.) */
    function place([rho, z], i) {
        const [cos, sin] = AZIMUTHS[i];
        return [rho * cos + 0, rho * sin + 0, z + 0];
    }

    // ------------------------------------------------------------- mesh

    /** Twice the area vector of a polygon (Newell): it points to the side the polygon is anticlockwise from. */
    function areaVector(points) {
        const n = [0, 0, 0];
        points.forEach((p, i) => {
            const q = points[(i + 1) % points.length];
            n[0] += p[1] * q[2] - p[2] * q[1];
            n[1] += p[2] * q[0] - p[0] * q[2];
            n[2] += p[0] * q[1] - p[1] * q[0];
        });
        return n;
    }

    /** The polygon, turned over when needed so that it is anticlockwise seen from where `normal` points. */
    function facing(points, normal) {
        const n = areaVector(points);
        return n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] < 0 ? points.slice().reverse() : points;
    }

    /**
     * Collects faces given as lists of points and welds equal points into one vertex. A quad with two equal
     * corners (on the axis) becomes a triangle; what has fewer than three corners left is dropped.
     */
    function meshBuilder() {
        const index = new Map();
        const coords = [];
        const faces = [];
        const parts = [];
        const vertex = (p) => {
            const key = p[0] + ',' + p[1] + ',' + p[2];
            if (!index.has(key)) {
                index.set(key, coords.length / 3);
                coords.push(p[0], p[1], p[2]);
            }
            return index.get(key);
        };
        const face = (points, part) => {
            const ids = points.map(vertex).filter((id, k, all) => id !== all[(k + all.length - 1) % all.length]);
            if (ids.length < 3) return;
            faces.push(Uint32Array.from(ids));
            parts.push(part);
        };
        const finish = (role) => Object.freeze({
            role, vertices: Float64Array.from(coords), faces: Object.freeze(faces.slice()), part: Uint8Array.from(parts), closed: true,
        });
        return Object.freeze({ face, finish });
    }

    // ------------------------------------------------------------- surface generators

    /**
     * The surface a profile sweeps over the azimuth steps [from, to]. The profile runs from the top of the
     * axis round the outside of the solid to the bottom; `inward` turns the faces over (a cavity wall).
     */
    function revolve(mesh, profile, [from, to], part, inward) {
        for (let j = 0; j + 1 < profile.length; j++) {
            for (let i = from; i < to; i++) {
                const quad = [place(profile[j], i), place(profile[j + 1], i), place(profile[j + 1], i + 1), place(profile[j], i + 1)];
                mesh.face(inward ? quad.reverse() : quad, part);
            }
        }
    }

    /** A flat cut face: cells of the half plane, placed at the cut's azimuth and facing its normal. */
    function section(mesh, cells, cut) {
        cells.forEach((cell) => mesh.face(facing(cell.map((p) => place(p, cut.at)), cut.normal), cut.part));
    }

    /** The quads between neighbouring levels of two lists; at(u, v) -> [rho, z]. */
    function gridCells(us, vs, at) {
        const cells = [];
        for (let k = 0; k + 1 < us.length; k++) {
            for (let j = 0; j + 1 < vs.length; j++) {
                cells.push([at(us[k], vs[j]), at(us[k + 1], vs[j]), at(us[k + 1], vs[j + 1]), at(us[k], vs[j + 1])]);
            }
        }
        return cells;
    }

    /** Pole-to-pole profile of an ellipse with semi-axes rho (equator) and z (pole); a circle when they are equal. */
    const arc = (rho, z) => POLARS.map(([cos, sin]) => [rho * sin, z * cos]);
    const onArc = (r, j) => [r * POLARS[j][1], r * POLARS[j][0]];
    const flat = (rho, z) => [rho, z];

    /** Closed profile of a cylinder: the top face outwards, down the side, the bottom face back to the axis. */
    function canProfile(rhos, zs) {
        const rim = rhos[rhos.length - 1];
        return rhos.map((rho) => [rho, zs[0]])
            .concat(zs.slice(1, -1).map((z) => [rim, z]), rhos.slice().reverse().map((rho) => [rho, zs[zs.length - 1]]));
    }

    /** One whole solid of revolution, every face SOLID. */
    function solid(profile, role) {
        const mesh = meshBuilder();
        revolve(mesh, profile, WHOLE, PART.SOLID, false);
        return mesh.finish(role);
    }

    const ball = (rho, z, role) => solid(arc(rho, z), role);
    const can = (radius, length, role) => solid(
        canProfile(levels(0, radius, CAP_STEPS), levels(length / 2, -length / 2, SIDE_STEPS)), role);

    // ------------------------------------------------------------- shells with the quarter cut away

    /** Inner wall, outer surface and the two cut faces of a shell, from its two profiles and the cells between them. */
    function cutShell(innerProfile, outerProfile, cells) {
        const mesh = meshBuilder();
        revolve(mesh, innerProfile, KEPT, PART.CAVITY, true);
        CUTS.forEach((cut) => section(mesh, cells, cut));
        revolve(mesh, outerProfile, KEPT, PART.OUTER, false);
        return mesh.finish(ROLE.shell);
    }

    /** null when the thickness is too small to separate the levels in double precision. */
    function sphereShell(inner, outer) {
        const radii = levels(inner, outer, CUT_STEPS);
        if (!isMonotone(radii)) return null;
        return cutShell(arc(inner, inner), arc(outer, outer), gridCells(radii, POLAR_INDEX, onArc));
    }

    /**
     * The shell of a core-shell cylinder. Its cut face is a frame (outer rectangle minus the core's), made of
     * three bands: over the top, down the side, under the bottom. null as for sphereShell.
     */
    function cylinderShell(radius, thickness, length) {
        const half = length / 2;
        const coreRho = levels(0, radius, CAP_STEPS);
        const wallRho = levels(radius, radius + thickness, CUT_STEPS);
        const coreZ = levels(half, -half, SIDE_STEPS);
        const topZ = levels(half + thickness, half, CUT_STEPS);
        const bottomZ = levels(-half, -half - thickness, CUT_STEPS);
        if (!isMonotone(wallRho) || !isMonotone(topZ)) return null;
        const allRho = coreRho.concat(wallRho.slice(1));
        const allZ = topZ.concat(coreZ.slice(1), bottomZ.slice(1));
        const frame = gridCells(allRho, topZ, flat).concat(gridCells(wallRho, coreZ, flat), gridCells(allRho, bottomZ, flat));
        return cutShell(canProfile(coreRho, coreZ), canProfile(allRho, allZ), frame);
    }

    /** A box centred on the origin; half = its half sizes along x, y, z. */
    function box(half, role) {
        const mesh = meshBuilder();
        const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        [0, 1, 2].forEach((axis) => [-1, 1].forEach((side) => {
            const others = [0, 1, 2].filter((k) => k !== axis);
            const corners = ring.map(([a, b]) => {
                const p = [0, 0, 0];
                p[axis] = side * half[axis];
                p[others[0]] = a * half[others[0]];
                p[others[1]] = b * half[others[1]];
                return p;
            });
            const normal = [0, 0, 0];
            normal[axis] = side;
            mesh.face(facing(corners, normal), PART.SOLID);
        }));
        return mesh.finish(role);
    }

    // ------------------------------------------------------------- scenes

    /** Box of the points of every array (widened by pad) and the largest distance from the origin. */
    function extentOf(arrays, pad) {
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        let far = 0;
        arrays.forEach((points) => {
            for (let at = 0; at < points.length; at += 3) {
                far = Math.max(far, Math.hypot(points[at], points[at + 1], points[at + 2]));
                for (let k = 0; k < 3; k++) {
                    min[k] = Math.min(min[k], points[at + k] - pad);
                    max[k] = Math.max(max[k], points[at + k] + pad);
                }
            }
        });
        return { bounds: Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) }), radius: far + pad };
    }

    const isUsableExtent = ({ bounds, radius }) => isPositive(radius) && bounds.min.concat(bounds.max).every(Number.isFinite);

    function meshScene(objects, notToScale) {
        if (objects.length === 0) return null;
        const extent = extentOf(objects.map((mesh) => mesh.vertices), 0);
        if (!isUsableExtent(extent)) return null;
        return Object.freeze({
            kind: 'mesh', objects: Object.freeze(objects), bounds: extent.bounds, radius: extent.radius,
            notToScale: Object.freeze(notToScale || []),
        });
    }

    /** The named dimensions as numbers, or null when one is missing, not a finite number or negative. */
    function dimensions(params, names) {
        if (!isObject(params)) return null;
        const values = names.map((name) => params[name]);
        return values.every(isLength) ? values : null;
    }

    const sizes = (...values) => (values.every(isPositive) ? values : null);

    /** Core (optional) and cut shell between the radii `inner` and inner + thickness. */
    function coreShellSphere(inner, thickness, withCore) {
        const outer = inner + thickness;
        if (!Number.isFinite(outer)) return null;
        if (inner === 0) return outer > 0 ? meshScene([ball(outer, outer, ROLE.shell)]) : null;
        const shell = thickness > 0 ? sphereShell(inner, outer) : null;
        return meshScene((withCore ? [ball(inner, inner, ROLE.core)] : []).concat(shell === null ? [] : [shell]));
    }

    function coreShellCylinder(radius, thickness, length) {
        const outer = sizes(radius + thickness, length + 2 * thickness);
        if (outer === null) return null;
        if (radius === 0 || length === 0) return meshScene([can(outer[0], outer[1], ROLE.shell)]);
        const shell = thickness > 0 ? cylinderShell(radius, thickness, length) : null;
        return meshScene([can(radius, length, ROLE.core)].concat(shell === null ? [] : [shell]));
    }

    function tubeScene(length, kuhnLength, radius) {
        const chain = wormChain({ length, kuhnLength });
        const extent = extentOf([chain.points], radius);
        if (!isUsableExtent(extent)) return null;
        return Object.freeze({
            kind: 'tube', centreline: chain.points, tubeRadius: radius, segments: chain.segments,
            bounds: extent.bounds, radius: extent.radius, notToScale: Object.freeze([]),
        });
    }

    /** model -> { names: the dimensions it needs, scene(...those) -> scene | null } */
    const BUILDERS = Object.freeze({
        sphere: { names: ['radius'], scene: (r) => sizes(r) && meshScene([ball(r, r, ROLE.solid)]) },
        ellipsoid: {
            names: ['radius_polar', 'radius_equatorial'],
            scene: (polar, equatorial) => sizes(polar, equatorial) && meshScene([ball(equatorial, polar, ROLE.solid)]),
        },
        cylinder: { names: ['radius', 'length'], scene: (r, l) => sizes(r, l) && meshScene([can(r, l, ROLE.solid)]) },
        core_shell_sphere: { names: ['radius', 'thickness'], scene: (r, t) => coreShellSphere(r, t, true) },
        vesicle: { names: ['radius', 'thickness'], scene: (r, t) => coreShellSphere(r, t, false) },
        core_shell_cylinder: { names: ['radius', 'thickness', 'length'], scene: coreShellCylinder },
        flexible_cylinder: {
            names: ['length', 'kuhn_length', 'radius'],
            scene: (l, b, r) => sizes(l, b, r) && tubeScene(l, b, r),
        },
        lamellar: {
            names: ['thickness'],
            scene: (t) => sizes(t, LATERAL_FACTOR * t)
                && meshScene([box([LATERAL_FACTOR * t / 2, LATERAL_FACTOR * t / 2, t / 2], ROLE.solid)], [LAMELLAR_NOTE]),
        },
    });

    const hasShape = (model) => SHAPE_MODELS.indexOf(model) >= 0;

    function build(model, params) {
        if (!hasShape(model)) return null;
        const builder = BUILDERS[model];
        const values = dimensions(params, builder.names);
        return values === null ? null : builder.scene(...values);
    }

    // ------------------------------------------------------------- worm-like chain

    /** mulberry32: 32-bit integer arithmetic only, so every engine gives the same sequence for a seed. */
    function prng(seed) {
        if (!Number.isInteger(seed)) throw new Error('prng needs seed: an integer, got ' + String(seed));
        let state = seed >>> 0;
        return function next() {
            state = (state + MULBERRY_STEP) | 0;
            let t = Math.imul(state ^ (state >>> 15), 1 | state);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / UINT32;
        };
    }

    /** Two independent standard normal numbers (Box-Muller); log(1 - u) because u may be 0. */
    function gaussianPair(next) {
        const radius = Math.sqrt(-2 * Math.log(1 - next()));
        const angle = 2 * Math.PI * next();
        return [radius * Math.cos(angle), radius * Math.sin(angle)];
    }

    /** a cos(angle) + b sin(angle) */
    const mix = (a, b, cos, sin) => [a[0] * cos + b[0] * sin, a[1] * cos + b[1] * sin, a[2] * cos + b[2] * sin];

    /** The frame { t, u, v } after turning by angle a about u and then by angle b about the new v. */
    function bend({ t, u, v }, a, b) {
        const t1 = mix(t, v, Math.cos(a), Math.sin(a));
        const v1 = mix(v, t, Math.cos(a), -Math.sin(a));
        const t2 = mix(t1, u, Math.cos(b), Math.sin(b));
        const u1 = mix(u, t1, Math.cos(b), -Math.sin(b));
        const norm = Math.hypot(t2[0], t2[1], t2[2]);
        return { t: [t2[0] / norm, t2[1] / norm, t2[2] / norm], u: u1, v: v1 };
    }

    const START_FRAME = Object.freeze({ t: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] });

    /** A copy of the points, moved so that their centroid is the origin. */
    function centred(points) {
        const count = points.length / 3;
        const mean = [0, 1, 2].map((k) => points.reduce((sum, value, at) => (at % 3 === k ? sum + value : sum), 0) / count);
        return points.map((value, at) => value - mean[at % 3]);
    }

    function chainInput(input) {
        if (!isObject(input)) throw new Error('wormChain needs { length, kuhnLength, seed? }');
        const { length, kuhnLength } = input;
        if (typeof length !== 'number' || !isPositive(length)) throw new Error('wormChain: length must be a finite number > 0');
        if (typeof kuhnLength !== 'number' || !isPositive(kuhnLength)) throw new Error('wormChain: kuhnLength must be a finite number > 0');
        return { length, kuhnLength, seed: input.seed === undefined ? SEED : input.seed };
    }

    function wormChain(input) {
        const { length, kuhnLength, seed } = chainInput(input);
        const next = prng(seed);
        const wanted = Math.round(CHAIN.perKuhn * length / kuhnLength);
        const segments = Math.min(CHAIN.max, Math.max(CHAIN.min, wanted));
        const ds = length / segments;
        const sigma = Math.sqrt(ds / (kuhnLength / 2));
        const points = new Float64Array(3 * (segments + 1));
        let frame = START_FRAME;
        for (let i = 1; i <= segments; i++) {
            for (let k = 0; k < 3; k++) points[3 * i + k] = points[3 * (i - 1) + k] + ds * frame.t[k];
            const [a, b] = gaussianPair(next);
            frame = bend(frame, sigma * a, sigma * b);
        }
        return Object.freeze({ points: centred(points), segments, ds });
    }

    globalThis.SasFitShapeGeom = Object.freeze({
        MAX_FACES, SEED, LATERAL_FACTOR, PART, SHAPE_MODELS, hasShape, build, prng, wormChain,
    });
})();
