/**
 * sasfit-shape-ensemble.js -- the 3D sketch of a model with a structure factor
 * (P@hardsphere, P@hayter_msa): an ensemble of identical particles instead of
 * one (design spec 6; decision 43, conventions = engineering). Original code.
 *
 *   sqInfo(form) -> null | { structure, volfraction, radiusEffective, mode, modeName[, charge, debyeLength] }
 *       null without a structure factor or with a field error. radiusEffective is the number the model hands
 *       to S(Q) (SasFitSqDerived; mode 0 = what the user typed), volfraction the one S(Q) uses (vesicle: its
 *       own), debyeLength (Angstrom, hayter_msa only) kappa^-1 of hayter_msa.c.
 *   arrangement({ count, packing, seed = SEED }) -> { kind: 'random' | 'lattice', points, packing, capped }
 *       count points (Float64Array, 3 per point) in units of the box side, centred on the origin, for spheres
 *       of radius 1 in a box of side boxSide(count, packing) = cbrt(count (4/3) pi / packing):
 *         packing <= RANDOM_PACKING  'random': random sequential addition in a periodic unit box with the
 *                   minimum distance of RANDOM_PACKING, from a fixed seed. The SAME points for every packing
 *                   below it, so a change of the volume fraction only resizes the box.
 *         above     'lattice': the densest of sc / bcc / fcc boxes with at least count sites, count of them
 *                   picked by the seed, each point moved from its site by a fixed random vector scaled to the
 *                   room left between neighbours (continuous in the packing; none at the lattice's densest
 *                   packing). packing beyond that is capped (capped: true, packing = the lattice's).
 *   build(model, params, sq) -> ensemble scene | null
 *       { kind: 'ensemble', particle (a mesh scene of SasFitShapeGeom), placements: [{ centre: [x, y, z],
 *         rotation: [9] (row-major, world = rotation . local + centre) }], bounds, radius, notToScale, info }
 *       null without a finite R_eff > 0, a finite volume fraction >= 0, or a mesh for these dimensions.
 *       info = { structure, count, detail, faces, arrangement, packing, spacing: 'scale' | 'sparse' | 'dense',
 *                radiusEffective, volfraction, boundingRadius, placementRadius, boxSide (Angstrom) }
 *   sceneFor(model, params, sq | null) -> the scene to draw: the ensemble when sq is given and it can be
 *       built, else the single particle of SasFitShapeGeom.build (null when there is none).
 *   sceneKey(model, params, sq | null) -> string: the scene changes exactly when this does.
 *   lines(sq, info | null) -> [string]   the text-list lines about S(Q) (plain text; the caller escapes)
 *
 * The rules (decision 43):
 *   count       COUNT particles; fewer only if the face budget cannot be met even with the coarsest mesh.
 *   meshes      the finest SasFitShapeGeom detail level with count x faces <= FACE_BUDGET (a frame stays well
 *               under 8 ms at 1440 x 900); all particles drawn at the centre values of their sizes.
 *   placement   no two particles closer than 2 R_place, R_place = max(R_eff, bounding radius of the particle):
 *               the bounding spheres never overlap, so the drawn particles never interpenetrate and sorting the
 *               particles by the depth of their centres is an exact painter's order between particles.
 *   to scale    the box holds the volume fraction: count (4/3) pi R_eff^3 / box^3 = phi, i.e. the arrangement
 *               at packing phi (R_place / R_eff)^3, box = boxSide x R_place.
 *   too sparse  when a particle (its bounding diameter) would be drawn smaller than MIN_PARTICLE_PX on a stage
 *               whose smaller side is REFERENCE_SIDE_PX (the smallest two-column stage) at the default zoom,
 *               the box is shrunk to the largest that keeps it at that size: spacing 'sparse'.
 *   too dense   when the lattice cannot reach the packing, it is capped: spacing 'dense' (a box larger than
 *               the volume fraction says; for elongated particles this happens already at small phi, because
 *               they are placed by their bounding sphere).
 *   orientation identity for particles that look the same from every side (sphere, core-shell sphere,
 *               vesicle, an ellipsoid with equal radii: the cut faces the viewer as in the single sketch), a
 *               uniformly random rotation from the seed for elongated ones.
 *   stability   positions are generated in units of R_place from the fixed seed: a new radius rescales the
 *               same picture, a new phi resizes the box, another model or count regenerates it.
 *
 * Pure: no DOM, no timers, no colours; SasFitShapeGeom, SasFitShapeView, SasFitSqDerived, SasFitMeta, SasFitForm,
 * SasFitJobs, SasFitFormat and SasFitLabels are read at call time. The arrangements (they depend on count and seed
 * only) and the face count of each model and level are memoised. Everything returned is frozen; typed arrays cannot be and must not be written to.
 */

(function () {
    'use strict';

    const COUNT = 12;
    const FACE_BUDGET = 8000;
    const MIN_COUNT = 2;
    const MIN_PARTICLE_PX = 28;
    const REFERENCE_SIDE_PX = 300;
    const RANDOM_PACKING = 0.30;              // random sequential addition jams near 0.38; with the seed, 2-12 points fit at 0.30 in < 1200 tries
    const RANDOM_TRIES = 20000;               // per point
    const STREAMS = Object.freeze({ positions: 0, turns: 1, lattice: 2 });     // seed offsets of independent sequences
    const ISOTROPIC = 1 + 1e-9;               // bounding radius / smallest half size of a particle that looks the same all round
    const BALL = 4 * Math.PI / 3;
    const IDENTITY = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const LATTICES = Object.freeze([
        Object.freeze({ name: 'sc', basis: [[0, 0, 0]], neighbour: 1 }),
        Object.freeze({ name: 'bcc', basis: [[0, 0, 0], [0.5, 0.5, 0.5]], neighbour: Math.sqrt(3) / 2 }),
        Object.freeze({ name: 'fcc', basis: [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]], neighbour: Math.SQRT1_2 }),
    ]);
    const PHI_DIGITS = 2;
    const CHARGE_DIGITS = 3;
    const TEXT = Object.freeze({
        sparse: '體積分率很低，顆粒間距未按比例（實際更疏）',
        dense: '體積分率很高，畫不出這麼密的排列：顆粒間距未按比例（實際更密）',
        bounding: '顆粒以外接球互不重疊地擺放，畫不出這麼密的排列：顆粒間距未按比例（實際更密）',
        lattice: '顆粒很密：位置取自略為打亂的晶格（隨機擺放放不下），排列只是示意',
        boundingLattice: '以外接球計算時顆粒很密：位置取自略為打亂的晶格（隨機擺放放不下），排列只是示意',
        single: 'R_eff 或 φ 不能用來排列顆粒，圖中只畫一顆顆粒',
        screening: '（由溫度、鹽濃度、介電常數與反離子算出，與 hayter_msa 相同；圖中不畫屏蔽雲）',
        noScreening: 'Debye 屏蔽長度無法計算（沒有離子）',
    });

    const isObject = (v) => v !== null && typeof v === 'object';
    const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
    const geom = () => globalThis.SasFitShapeGeom;
    const boxSide = (count, packing) => Math.cbrt(count * BALL / packing);

    // ------------------------------------------------------------- arrangements (box units)

    const memo = new Map();
    function remembered(key, make) {
        if (!memo.has(key)) memo.set(key, make());
        return memo.get(key);
    }

    /** Points moved so that their centroid is the origin (a new array). */
    function centred(points) {
        const count = points.length / 3;
        const mean = [0, 1, 2].map((k) => points.reduce((sum, value, at) => (at % 3 === k ? sum + value : sum), 0) / count);
        return Float64Array.from(points, (value, at) => value - mean[at % 3]);
    }

    function periodicDistance(a, b) {
        const d = [0, 1, 2].map((k) => { const x = Math.abs(a[k] - b[k]); return Math.min(x, 1 - x); });
        return Math.hypot(d[0], d[1], d[2]);
    }

    /** Random sequential addition in the periodic unit box: no two points closer than at RANDOM_PACKING. */
    function randomPoints(count, seed) {
        const next = geom().prng(seed + STREAMS.positions);
        const nearest = 2 / boxSide(count, RANDOM_PACKING);
        const placed = [];
        for (let i = 0; i < count; i++) {
            let point = null;
            for (let tries = 0; tries < RANDOM_TRIES && point === null; tries++) {
                const candidate = [next(), next(), next()];
                if (placed.every((p) => periodicDistance(p, candidate) >= nearest)) point = candidate;
            }
            if (point === null) throw new Error('arrangement: ' + count + ' points do not fit at the random packing');
            placed.push(point);
        }
        return centred(placed.flat());
    }

    /** The densest box of one lattice type with at least count sites: { sites, neighbour (box units), cap }. */
    function latticeBox(type, count) {
        let cells = 1;
        while (type.basis.length * cells ** 3 < count) cells += 1;
        const sites = [];
        for (let i = 0; i < cells ** 3; i++) {
            const cell = [i % cells, Math.floor(i / cells) % cells, Math.floor(i / cells ** 2)];
            type.basis.forEach((b) => sites.push(cell.map((c, k) => (c + b[k]) / cells)));
        }
        const neighbour = type.neighbour / cells;
        return { sites, neighbour, cap: count * BALL * (neighbour / 2) ** 3 };
    }

    /** A point uniformly in the unit ball: a uniform direction times the cube root of a uniform number. */
    function inBall(next) {
        const z = 2 * next() - 1;
        const angle = 2 * Math.PI * next();
        const across = Math.sqrt(1 - z * z);
        const r = Math.cbrt(next());
        return [r * across * Math.cos(angle), r * across * Math.sin(angle), r * z];
    }

    /** The lattice of a count: the best box, the sites picked by the seed (centred) and one jitter vector each. */
    function latticeOf(count, seed) {
        const box = LATTICES.map((type) => latticeBox(type, count)).reduce((best, b) => (b.cap > best.cap ? b : best));
        const next = geom().prng(seed + STREAMS.lattice);
        const order = box.sites.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {                       // Fisher-Yates
            const j = Math.floor(next() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        const sites = centred(order.slice(0, count).flatMap((i) => box.sites[i]));
        const jitter = Float64Array.from(Array.from({ length: count }, () => inBall(next)).flat());
        return Object.freeze({ sites, jitter, neighbour: box.neighbour, cap: box.cap });
    }

    function latticeAt(count, seed, packing) {
        const lattice = remembered('lattice:' + count + ':' + seed, () => latticeOf(count, seed));
        const used = Math.min(packing, lattice.cap);
        const room = Math.max(0, (lattice.neighbour - 2 / boxSide(count, used)) / 2);
        const points = centred(Float64Array.from(lattice.sites, (site, at) => site + room * lattice.jitter[at]));
        return Object.freeze({ kind: 'lattice', points, packing: used, capped: packing > lattice.cap });
    }

    function arrangement(input) {
        if (!isObject(input)) throw new Error('arrangement needs { count, packing, seed? }');
        const { count, packing } = input;
        const seed = input.seed === undefined ? geom().SEED : input.seed;
        if (!Number.isInteger(count) || count < 1) throw new Error('arrangement: count must be an integer >= 1');
        if (!isNumber(packing) || packing <= 0) throw new Error('arrangement: packing must be a finite number > 0');
        if (packing > RANDOM_PACKING) return latticeAt(count, seed, packing);
        const points = remembered('random:' + count + ':' + seed, () => randomPoints(count, seed));
        return Object.freeze({ kind: 'random', points, packing, capped: false });
    }

    // ------------------------------------------------------------- particles

    const facesOf = (scene) => scene.objects.reduce((n, mesh) => n + mesh.faces.length, 0);

    /** Bounding radius / smallest half size: 1 for a particle that looks the same all round. */
    function aspectOf(particle) {
        const halves = [0, 1, 2].map((k) => (particle.bounds.max[k] - particle.bounds.min[k]) / 2);
        return particle.radius / Math.min(...halves);
    }

    /**
     * Faces of a model's mesh at a detail level, from its default sizes (memoised). The count does not depend on the
     * sizes -- only a zero that drops a shell lowers it -- so the level can be chosen without building finer meshes
     * on every keystroke.
     */
    function facesAt(model, detail) {
        return remembered('faces:' + model + ':' + detail, () => {
            const sizes = globalThis.SasFitMeta.models[model].params.filter((p) => p.type === 'volume').map((p) => [p.name, p.def]);
            const reference = geom().build(model, Object.fromEntries(sizes), { detail });
            return reference === null || reference.kind !== 'mesh' ? Infinity : facesOf(reference);
        });
    }

    /** The finest mesh whose COUNT copies fit the face budget; fewer copies of the coarsest when none does. */
    function particleFor(model, params) {
        const details = geom().DETAILS;
        const fits = details.find((detail) => COUNT * facesAt(model, detail) <= FACE_BUDGET);
        const detail = fits === undefined ? details[details.length - 1] : fits;
        const particle = geom().build(model, params, { detail });
        if (particle === null || particle.kind !== 'mesh') return null;
        const faces = facesOf(particle);
        const count = COUNT * faces <= FACE_BUDGET ? COUNT : Math.max(MIN_COUNT, Math.floor(FACE_BUDGET / faces));
        return { particle, detail, faces, count };
    }

    /** A uniformly random rotation (Shoemake's quaternion from three uniform numbers), row-major. */
    function turnOf(next) {
        const [u1, u2, u3] = [next(), next(), next()];
        const [a, b] = [Math.sqrt(1 - u1), Math.sqrt(u1)];
        const [x, y, z, w] = [a * Math.sin(2 * Math.PI * u2), a * Math.cos(2 * Math.PI * u2), b * Math.sin(2 * Math.PI * u3), b * Math.cos(2 * Math.PI * u3)];
        return Object.freeze([
            1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
            2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
            2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
        ]);
    }

    function rotations(count, isotropic) {
        if (isotropic) return Array.from({ length: count }, () => IDENTITY);
        const next = geom().prng(geom().SEED + STREAMS.turns);
        return Array.from({ length: count }, () => turnOf(next));
    }

    // ------------------------------------------------------------- the scene

    /** The smallest distance between two points of a layout (box units, as drawn: not periodic). */
    function nearestOf(points) {
        let nearest = Infinity;
        for (let i = 0; i < points.length; i += 3) {
            for (let j = i + 3; j < points.length; j += 3) {
                nearest = Math.min(nearest, Math.hypot(points[i] - points[j], points[i + 1] - points[j + 1], points[i + 2] - points[j + 2]));
            }
        }
        return nearest;
    }

    /**
     * Box (in units of R_place) at the packing, shrunk when a particle would be drawn too small: { side, sparse }.
     * Never so small that two drawn particles (bounding radius) would touch.
     */
    function boxFor(count, layout, boundingRadius, placementRadius) {
        const side = boxSide(count, layout.packing);
        let far = 0;
        for (let at = 0; at < layout.points.length; at += 3) far = Math.max(far, Math.hypot(layout.points[at], layout.points[at + 1], layout.points[at + 2]));
        const reach = (1 - 2 * globalThis.SasFitShapeView.MARGIN) * REFERENCE_SIDE_PX / MIN_PARTICLE_PX;     // scene radius / bounding radius
        const touching = 2 * boundingRadius / (placementRadius * nearestOf(layout.points));
        const largest = Math.max(far > 0 ? (reach - 1) * boundingRadius / (far * placementRadius) : Infinity, touching);
        return side > largest ? { side: largest, sparse: true } : { side, sparse: false };
    }

    /** Bounds and circumscribed radius of every vertex of every placed copy. */
    function extentOf(particle, placements) {
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        let far = 0;
        placements.forEach(({ centre: c, rotation: r }) => particle.objects.forEach(({ vertices: v }) => {
            for (let at = 0; at < v.length; at += 3) {
                const p = [0, 1, 2].map((k) => r[3 * k] * v[at] + r[3 * k + 1] * v[at + 1] + r[3 * k + 2] * v[at + 2] + c[k]);
                far = Math.max(far, Math.hypot(p[0], p[1], p[2]));
                p.forEach((x, k) => { min[k] = Math.min(min[k], x); max[k] = Math.max(max[k], x); });
            }
        }));
        return { bounds: Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) }), radius: far };
    }

    function build(model, params, sq) {
        if (!isObject(sq) || !isNumber(sq.radiusEffective) || sq.radiusEffective <= 0 || !isNumber(sq.volfraction) || sq.volfraction < 0) return null;
        const chosen = particleFor(model, params);
        if (chosen === null) return null;
        const { particle, detail, faces, count } = chosen;
        const boundingRadius = particle.radius;
        const placementRadius = Math.max(sq.radiusEffective, boundingRadius);
        const wanted = sq.volfraction * (placementRadius / sq.radiusEffective) ** 3;
        const layout = arrangement({ count, packing: wanted > 0 ? wanted : Number.MIN_VALUE });
        const box = boxFor(count, layout, boundingRadius, placementRadius);
        const turns = rotations(count, aspectOf(particle) <= ISOTROPIC);
        const unit = box.side * placementRadius;
        const placements = Object.freeze(turns.map((rotation, i) => Object.freeze({
            centre: Object.freeze([0, 1, 2].map((k) => layout.points[3 * i + k] * unit)), rotation,
        })));
        const extent = extentOf(particle, placements);
        if (!isNumber(extent.radius) || extent.radius <= 0) return null;
        const spacing = box.sparse ? 'sparse' : (layout.capped ? 'dense' : 'scale');
        const info = Object.freeze({
            structure: sq.structure, count, detail, faces: count * faces, arrangement: layout.kind, packing: layout.packing, spacing,
            radiusEffective: sq.radiusEffective, volfraction: sq.volfraction, boundingRadius, placementRadius, boxSide: unit,
        });
        return Object.freeze({ kind: 'ensemble', particle, placements, bounds: extent.bounds, radius: extent.radius, notToScale: particle.notToScale, info });
    }

    function sceneFor(model, params, sq) {
        const ensemble = isObject(sq) ? build(model, params, sq) : null;
        return ensemble !== null ? ensemble : geom().build(model, params);
    }

    const sceneKey = (model, params, sq) => JSON.stringify([model, params, isObject(sq) ? [sq.radiusEffective, sq.volfraction] : null]);

    // ------------------------------------------------------------- the form and the texts

    function sqInfo(form) {
        if (!isObject(form) || form.structure === null || !globalThis.SasFitForm.validate(form).valid) return null;
        const derived = globalThis.SasFitSqDerived;
        const all = globalThis.SasFitJobs.params(form);
        const mode = all.radius_effective_mode;
        const radiusEffective = derived.radiusEffective(form.model, all);
        const base = { structure: form.structure, volfraction: all.volfraction, radiusEffective, mode, modeName: derived.modeName(form.model, mode) };
        if (form.structure !== 'hayter_msa') return Object.freeze(base);
        const debyeLength = isNumber(radiusEffective) ? derived.debyeLength({
            radiusEffective, volfraction: all.volfraction, charge: all.charge, temperature: all.temperature,
            salt: all.concentration_salt, dielectric: all.dielectconst,
        }) : null;
        return Object.freeze({ ...base, charge: all.charge, debyeLength });
    }

    const number = (value, digits) => globalThis.SasFitFormat.display(globalThis.SasFitFormat.number(value, digits));
    const nm = (angstrom) => globalThis.SasFitShapeView.nm(angstrom);

    function spacingLines(info) {
        const bounding = info.placementRadius > info.radiusEffective * ISOTROPIC;     // placed by the bounding sphere, not by R_eff
        const out = [];
        if (info.spacing === 'sparse') out.push(TEXT.sparse);
        if (info.spacing === 'dense') out.push(bounding ? TEXT.bounding : TEXT.dense);
        if (info.arrangement === 'lattice') out.push(bounding ? TEXT.boundingLattice : TEXT.lattice);
        return out;
    }

    function lines(sq, info) {
        if (!isObject(sq)) return Object.freeze([]);
        const name = globalThis.SasFitLabels.MODEL_NAMES[sq.structure] || sq.structure;
        const drawn = isObject(info) ? '，圖中 ' + info.count + ' 顆相同的顆粒' : '';
        const out = ['S(Q)：' + sq.structure + ' ' + name + drawn + '，φ = ' + number(sq.volfraction, PHI_DIGITS),
            '有效半徑 R_eff = ' + nm(sq.radiusEffective) + ' nm，模式：' + sq.modeName];
        if (sq.structure === 'hayter_msa') {
            const charge = '電荷 ' + number(sq.charge, CHARGE_DIGITS) + ' e，';
            out.push(charge + (isNumber(sq.debyeLength) ? 'Debye 屏蔽長度 κ⁻¹ = ' + nm(sq.debyeLength) + ' nm' + TEXT.screening : TEXT.noScreening));
        }
        return Object.freeze(out.concat(isObject(info) ? spacingLines(info) : [TEXT.single]));
    }

    globalThis.SasFitShapeEnsemble = Object.freeze({
        COUNT, FACE_BUDGET, MIN_PARTICLE_PX, REFERENCE_SIDE_PX, RANDOM_PACKING,
        sqInfo, arrangement, build, sceneFor, sceneKey, lines,
    });
})();
