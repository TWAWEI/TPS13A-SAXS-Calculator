/**
 * sasfit-shape-view.js -- from a scene of SasFitShapeGeom to what the canvas
 * draws: the view (yaw, pitch, zoom), the orthographic projection, the draw
 * order, the Lambert brightness of every face, the scale bar and the texts
 * about the shape (design spec 6; plan M4 Task 4). Original code.
 *
 *   DEFAULT_VIEW = { yaw: 45, pitch: 20, zoom: 1 } (degrees), ZOOM_RANGE = [0.5, 4], KEY_STEP = 5, PITCH_LIMIT = 89
 *   viewDirection(view) -> [x, y, z]   the unit vector from the object to the viewer, in object coordinates:
 *                          (cos p cos y, cos p sin y, sin p). The object's z axis points up on the screen.
 *   basis(view) -> { right, up, toward }   the screen axes in object coordinates (orthonormal, right-handed;
 *                          toward = viewDirection). A point P is drawn at (cx + ppa P.right, cy - ppa P.up).
 *   LIGHT                  the unit vector to the light in VIEW coordinates [right, up, toward]: it stays where
 *                          it is while the object turns, so the shading changes with the rotation
 *   reduce(view, action) -> view
 *       { type: 'rotate', dYaw, dPitch }   yaw is kept in [0, 360), pitch within +-PITCH_LIMIT
 *       { type: 'zoom', factor }           zoom times factor, kept inside ZOOM_RANGE
 *       { type: 'reset' }
 *       { type: 'key', key }               ArrowLeft / ArrowRight: yaw -/+ KEY_STEP; ArrowUp / ArrowDown: pitch
 *                                          +/- KEY_STEP; '+' '=': zoom in by KEY_ZOOM; '-': out; '0' 'Home':
 *                                          reset. Any other key returns THE SAME OBJECT (the caller then leaves
 *                                          the event alone); a key that is handled returns a new one.
 *   pixelsPerAngstrom(scene, view, size) -> number   the bounding sphere of the scene fits into the smaller side
 *                          of size with a margin of MARGIN; it does not depend on the rotation
 *   drawList(scene, view, size) -> { items, pixelsPerAngstrom }     size = { width, height } in pixels
 *       items in draw order (later ones cover earlier ones):
 *         { kind: 'polygon', points: [x0, y0, x1, y1, ...], role, k, part }
 *         { kind: 'stroke', points: [x0, y0, x1, y1], width, role, k, depth, fill: [{ points, width, k }] }
 *       role is the mesh's ('shapeSolid' | 'shapeCore' | 'shapeShell'), k the Lambert brightness in [0, 1]
 *       (no ambient term: ChartTheme.shade3d adds it), part the face's SasFitShapeGeom.PART.
 *   scaleBar(pixelsPerAngstrom, width) -> { nm, pixels, label } | null
 *       the largest length of the 1-2-5 series that is no longer than BAR_SHARE of the width
 *   nm(angstrom) -> '5.0'   Angstrom as nm with one decimal (two significant figures below 0.1 nm, where one
 *                          decimal says nothing); MISSING for a negative or non-finite number. The only
 *                          toFixed of the sketch.
 *   shapeParams(form) -> { name: number } | null    the dimensions SasFitShapeGeom.build needs; null when the
 *                          model has no shape or the form has a field error
 *   describe(form, { pixelsPerAngstrom, scene }?) -> { title, dims: [{ label, text }], extras: [string], alt } | null
 *       plain text (the caller escapes it or writes it with textContent); null as for shapeParams.
 *       pixelsPerAngstrom (at the default zoom): dimensions drawn smaller than MIN_PIXELS get a sentence;
 *       scene: the scene already built for these parameters (else it is built here for its notToScale)
 *   dimsHtml(dims) -> '<dl class="sf-shape-dims">...</dl>'   the only HTML of the sketch; every text in it goes
 *                          through FormUtils.escapeHtml
 *
 * The draw order is NOT a sort of all faces by depth -- that is wrong for a shell that is cut open, where the
 * core hides part of a cut face and the cut face hides the core faces behind its plane. Instead:
 *   1. back faces of every closed mesh are dropped (normal . toward <= 0);
 *   2. CAVITY faces first (the far wall of a hollow: nothing is behind them), OUTER faces last (they lie on
 *      the convex hull: nothing is in front of them);
 *   3. between them the SOLID faces (a whole convex solid: the core, or a single solid) and the cut faces that
 *      face the viewer, in the order the cut planes give. CUT_A lies in y = 0 and faces +y, CUT_B in x = 0 and
 *      faces +x. With both towards the viewer:
 *          solid faces with y < 0, CUT_A, solid faces with y > 0 and x < 0, CUT_B, solid faces with y > 0 and x > 0
 *      with only CUT_A: y < 0, CUT_A, y > 0; with only CUT_B: x < 0, CUT_B, x > 0; with neither: the solid faces.
 *      Inside a group nothing overlaps (one convex solid, or one plane), so there is no sorting at all.
 * tests/sasfit-shape-order.test.js checks this against analytic ray casting from 200 directions.
 *
 * A tube (flexible_cylinder) is drawn as thick lines: one stroke per segment of the centreline, far to near.
 * The projection of a chain of spheres and cylinders is exactly the union of those round-capped strokes, so it
 * is to scale. k = the sine of the angle between the segment and the light (the mean brightness of a
 * cylinder's side), averaged over the neighbours that overlap the segment. `fill` lists the round-capped lines
 * the painter strokes INSIDE the outline of the segment after it has drawn that outline: the bodies of the
 * segment and of its neighbours along the chain within the reach of the outline, far to near, and then a
 * narrower, lighter line along the lit side of each of them (it makes the tube look round). The bodies remove
 * the outline where the chain simply goes on; it stays where one part of the chain passes in front of another.
 *
 * Nothing given is modified; what is returned is frozen. A scene's face normals are computed once and kept in
 * a WeakMap (scenes are frozen and never change). Pure: no DOM, no timers, no colours. SasFitShapeGeom,
 * SasFitForm, SasFitJobs, SasFitFormat and SasFitLabels are read at call time, FormUtils through host().
 */

(function () {
    'use strict';

    const DEFAULT_VIEW = Object.freeze({ yaw: 45, pitch: 20, zoom: 1 });
    const ZOOM_RANGE = Object.freeze([0.5, 4]);
    const KEY_STEP = 5;
    const KEY_ZOOM = 1.1;
    const PITCH_LIMIT = 89;
    const MARGIN = 0.08;                      // of the smaller side, on each side of the bounding sphere
    const BAR_SHARE = 0.3;
    const BAR_STEPS = Object.freeze([5, 2, 1]);
    const ANGSTROM_PER_NM = 10;
    const MIN_PIXELS = 2;                     // a dimension drawn smaller than this gets a sentence of its own
    const OUTLINE = 1;                        // pixels the painter's outline is wider than the stroke, per side
    const MAX_REACH = 8;                      // neighbours per side whose fill mends the outline of a segment
    const SHINE = Object.freeze({ shift: 0.17, width: 0.4, lift: 0.3 });     // the lighter line of a tube, in stroke widths
    const SMALL_NM = 0.1;                     // below it one decimal says nothing (0.0 or 0.1): two significant figures
    const MISSING = '—';
    const DEG = Math.PI / 180;
    const LIGHT = Object.freeze(unit([-0.45, 0.6, 0.66]));
    const LIGHT_ON_SCREEN = Object.freeze([LIGHT[0] / Math.hypot(LIGHT[0], LIGHT[1]), -LIGHT[1] / Math.hypot(LIGHT[0], LIGHT[1])]);
    const KEYS = Object.freeze({
        ArrowLeft: { type: 'rotate', dYaw: -KEY_STEP, dPitch: 0 }, ArrowRight: { type: 'rotate', dYaw: KEY_STEP, dPitch: 0 },
        ArrowUp: { type: 'rotate', dYaw: 0, dPitch: KEY_STEP }, ArrowDown: { type: 'rotate', dYaw: 0, dPitch: -KEY_STEP },
        '+': { type: 'zoom', factor: KEY_ZOOM }, '=': { type: 'zoom', factor: KEY_ZOOM }, '-': { type: 'zoom', factor: 1 / KEY_ZOOM },
        0: { type: 'reset' }, Home: { type: 'reset' },
    });

    const host = () => (typeof window !== 'undefined' ? window : globalThis);
    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isObject = (v) => v !== null && typeof v === 'object';
    const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
    const clamp = (x, lower, upper) => Math.min(upper, Math.max(lower, x));
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

    function unit(v) {
        const length = Math.hypot(v[0], v[1], v[2]);
        return [v[0] / length, v[1] / length, v[2] / length];
    }

    // ------------------------------------------------------------- view

    function assertView(view) {
        if (!isObject(view) || !isNumber(view.yaw) || !isNumber(view.pitch) || !isNumber(view.zoom) || view.zoom <= 0) {
            throw new Error('A view is { yaw, pitch, zoom } with finite numbers and zoom > 0');
        }
    }

    function basis(view) {
        assertView(view);
        const [cy, sy] = [Math.cos(view.yaw * DEG), Math.sin(view.yaw * DEG)];
        const [cp, sp] = [Math.cos(view.pitch * DEG), Math.sin(view.pitch * DEG)];
        return Object.freeze({
            right: Object.freeze([-sy, cy, 0]),
            up: Object.freeze([-sp * cy, -sp * sy, cp]),
            toward: Object.freeze([cp * cy, cp * sy, sp]),
        });
    }

    const viewDirection = (view) => basis(view).toward;

    const wrapYaw = (yaw) => ((yaw % 360) + 360) % 360;

    function rotate(view, { dYaw, dPitch }) {
        if (!isNumber(dYaw) || !isNumber(dPitch)) throw new Error('rotate needs finite dYaw and dPitch');
        return Object.freeze({ yaw: wrapYaw(view.yaw + dYaw), pitch: clamp(view.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT), zoom: view.zoom });
    }

    function zoomBy(view, { factor }) {
        if (!isNumber(factor) || factor <= 0) throw new Error('zoom needs factor: a finite number > 0');
        return Object.freeze({ yaw: view.yaw, pitch: view.pitch, zoom: clamp(view.zoom * factor, ZOOM_RANGE[0], ZOOM_RANGE[1]) });
    }

    function reduce(view, action) {
        assertView(view);
        if (!isObject(action)) throw new Error('reduce needs an action object');
        if (action.type === 'rotate') return rotate(view, action);
        if (action.type === 'zoom') return zoomBy(view, action);
        if (action.type === 'reset') return DEFAULT_VIEW === view ? Object.freeze({ ...DEFAULT_VIEW }) : DEFAULT_VIEW;
        if (action.type === 'key') return has(KEYS, String(action.key)) ? reduce(view, KEYS[String(action.key)]) : view;
        throw new Error('Unknown view action: ' + String(action.type));
    }

    // ------------------------------------------------------------- projection

    function assertSize(size) {
        if (!isObject(size) || !isNumber(size.width) || !isNumber(size.height) || size.width <= 0 || size.height <= 0) {
            throw new Error('size is { width, height } with positive numbers');
        }
    }

    function assertScene(scene) {
        if (!isObject(scene) || (scene.kind !== 'mesh' && scene.kind !== 'tube') || !isNumber(scene.radius) || scene.radius <= 0) {
            throw new Error('drawList needs a scene of SasFitShapeGeom.build');
        }
    }

    function pixelsPerAngstrom(scene, view, size) {
        assertScene(scene);
        assertView(view);
        assertSize(size);
        return view.zoom * (1 - 2 * MARGIN) * Math.min(size.width, size.height) / (2 * scene.radius);
    }

    /** The projection of one view: screen position and depth (larger = nearer) of the point at `at` of `coords`. */
    function projector(view, size, ppa) {
        const { right, up, toward } = basis(view);
        const cx = size.width / 2;
        const cy = size.height / 2;
        return Object.freeze({
            toward,
            x: (c, at) => cx + ppa * (c[at] * right[0] + c[at + 1] * right[1] + c[at + 2] * right[2]),
            y: (c, at) => cy - ppa * (c[at] * up[0] + c[at + 1] * up[1] + c[at + 2] * up[2]),
            depth: (c, at) => c[at] * toward[0] + c[at + 1] * toward[1] + c[at + 2] * toward[2],
            /** A direction of the object in view coordinates [right, up, toward]. */
            turn: (n) => [dot(n, right), dot(n, up), dot(n, toward)],
        });
    }

    const brightness = (viewNormal) => clamp(dot(viewNormal, LIGHT), 0, 1);

    // ------------------------------------------------------------- meshes

    /** Unit normals (Newell: outwards for anticlockwise faces) and centroids of a mesh, three numbers per face. */
    function measureMesh(mesh) {
        const count = mesh.faces.length;
        const normals = new Float64Array(3 * count);
        const centres = new Float64Array(3 * count);
        const v = mesh.vertices;
        mesh.faces.forEach((face, f) => {
            const n = [0, 0, 0];
            const c = [0, 0, 0];
            for (let i = 0; i < face.length; i++) {
                const p = 3 * face[i];
                const q = 3 * face[(i + 1) % face.length];
                n[0] += v[p + 1] * v[q + 2] - v[p + 2] * v[q + 1];
                n[1] += v[p + 2] * v[q] - v[p] * v[q + 2];
                n[2] += v[p] * v[q + 1] - v[p + 1] * v[q];
                for (let k = 0; k < 3; k++) c[k] += v[p + k] / face.length;
            }
            const length = Math.hypot(n[0], n[1], n[2]) || 1;
            for (let k = 0; k < 3; k++) {
                normals[3 * f + k] = n[k] / length;
                centres[3 * f + k] = c[k];
            }
        });
        return Object.freeze({ normals, centres });
    }

    const measured = new WeakMap();           // mesh -> { normals, centres }: a mesh is frozen and never changes

    function measuresOf(mesh) {
        if (!measured.has(mesh)) measured.set(mesh, measureMesh(mesh));
        return measured.get(mesh);
    }

    /**
     * The place of a face in the draw order, 0 (first) to 6 (last), from its part and its centroid; see the
     * file header. frontA / frontB: the cut face faces the viewer.
     */
    function orderOf(part, cx, cy, frontA, frontB) {
        const PART = globalThis.SasFitShapeGeom.PART;
        if (part === PART.CAVITY) return 0;
        if (part === PART.OUTER) return 6;
        if (part === PART.CUT_A) return 2;
        if (part === PART.CUT_B) return 4;
        if (frontA && frontB) return cy < 0 ? 1 : (cx < 0 ? 3 : 5);
        if (frontA) return cy < 0 ? 1 : 3;
        if (frontB) return cx < 0 ? 3 : 5;
        return 1;
    }

    const ORDERS = 7;

    function polygonItem(mesh, face, part, k, project) {
        const points = new Array(2 * face.length);
        for (let i = 0; i < face.length; i++) {
            points[2 * i] = project.x(mesh.vertices, 3 * face[i]);
            points[2 * i + 1] = project.y(mesh.vertices, 3 * face[i]);
        }
        return Object.freeze({ kind: 'polygon', points: Object.freeze(points), role: mesh.role, k, part });
    }

    /** The faces of one mesh that face the viewer, put into `groups` by their place in the draw order. */
    function collectMesh(mesh, project, groups) {
        const { normals, centres } = measuresOf(mesh);
        const { toward } = project;
        const frontA = toward[1] > 0;
        const frontB = toward[0] > 0;
        mesh.faces.forEach((face, f) => {
            const n = [normals[3 * f], normals[3 * f + 1], normals[3 * f + 2]];
            if (dot(n, toward) <= 0) return;                       // a back face of a closed mesh
            const part = mesh.part[f];
            const order = orderOf(part, centres[3 * f], centres[3 * f + 1], frontA, frontB);
            groups[order].push(polygonItem(mesh, face, part, brightness(project.turn(n)), project));
        });
    }

    function meshItems(scene, project) {
        const groups = Array.from({ length: ORDERS }, () => []);
        scene.objects.forEach((mesh) => collectMesh(mesh, project, groups));
        return groups.flat();
    }

    // ------------------------------------------------------------- tube

    /** One segment of the centreline: its two projected ends, its depth and its brightness. */
    function segmentOf(line, i, project) {
        const a = 3 * i;
        const b = a + 3;
        const tangent = unit([line[b] - line[a], line[b + 1] - line[a + 1], line[b + 2] - line[a + 2]]);
        const along = dot(project.turn(tangent), LIGHT);
        return Object.freeze({
            points: Object.freeze([project.x(line, a), project.y(line, a), project.x(line, b), project.y(line, b)]),
            depth: (project.depth(line, a) + project.depth(line, b)) / 2,
            k: Math.sqrt(Math.max(0, 1 - along * along)),
        });
    }

    /** How many neighbours along the chain can lie under the outline of a segment. */
    function reachOf(scene, ppa) {
        const line = scene.centreline;
        const step = Math.hypot(line[3] - line[0], line[4] - line[1], line[5] - line[2]) * ppa;
        const needed = step > 0 ? Math.ceil((scene.tubeRadius * ppa + OUTLINE) / step) : MAX_REACH;
        return clamp(needed, 1, MAX_REACH);
    }

    /** The indices within `reach` of i along the chain. */
    function nearby(i, reach, count) {
        const near = [];
        for (let j = Math.max(0, i - reach); j <= Math.min(count - 1, i + reach); j++) near.push(j);
        return near;
    }

    /** The mean brightness over each segment's window: neighbouring segments overlap, so their shades must not jump. */
    const smoothed = (segments, reach) => segments.map((_, i) => {
        const near = nearby(i, reach, segments.length);
        return near.reduce((sum, j) => sum + segments[j].k, 0) / near.length;
    });

    /** The body of a segment and the lighter line along its lit side, as what the painter strokes. */
    function tubeParts(segment, k, width) {
        const dx = SHINE.shift * width * LIGHT_ON_SCREEN[0];
        const dy = SHINE.shift * width * LIGHT_ON_SCREEN[1];
        const p = segment.points;
        return Object.freeze({
            body: Object.freeze({ points: p, width, k }),
            shine: Object.freeze({
                points: Object.freeze([p[0] + dx, p[1] + dy, p[2] + dx, p[3] + dy]), width: SHINE.width * width,
                k: Math.min(1, k + SHINE.lift),
            }),
        });
    }

    function tubeItems(scene, project, ppa) {
        const segments = Array.from({ length: scene.segments }, (_, i) => segmentOf(scene.centreline, i, project));
        const width = 2 * scene.tubeRadius * ppa;
        const reach = reachOf(scene, ppa);
        const ks = smoothed(segments, reach);
        const parts = segments.map((segment, i) => tubeParts(segment, ks[i], width));
        const byDepth = (i, j) => segments[i].depth - segments[j].depth || i - j;
        return segments.map((_, i) => i).sort(byDepth).map((i) => {
            const near = nearby(i, reach, segments.length).sort(byDepth);
            return Object.freeze({
                kind: 'stroke', points: segments[i].points, width, role: 'shapeSolid', k: ks[i], depth: segments[i].depth,
                fill: Object.freeze(near.map((j) => parts[j].body).concat(near.map((j) => parts[j].shine))),
            });
        });
    }

    function drawList(scene, view, size) {
        const ppa = pixelsPerAngstrom(scene, view, size);
        const project = projector(view, size, ppa);
        const items = scene.kind === 'tube' ? tubeItems(scene, project, ppa) : meshItems(scene, project);
        return Object.freeze({ items: Object.freeze(items), pixelsPerAngstrom: ppa });
    }

    // ------------------------------------------------------------- scale bar and numbers

    function scaleBar(ppa, width) {
        if (!isNumber(ppa) || ppa <= 0 || !isNumber(width) || width <= 0) return null;
        const longest = BAR_SHARE * width / (ANGSTROM_PER_NM * ppa);          // in nm
        if (!Number.isFinite(longest) || longest <= 0) return null;
        let exponent = Math.floor(Math.log10(longest)) + 1;
        for (let tries = 0; tries < 3; tries++, exponent--) {
            for (const step of BAR_STEPS) {
                const nmValue = Number(step + 'e' + exponent);               // exact decimal: 0.5, not 0.5000000001
                if (nmValue <= longest) {
                    return Object.freeze({ nm: nmValue, pixels: nmValue * ANGSTROM_PER_NM * ppa, label: String(nmValue) + ' nm' });
                }
            }
        }
        return null;
    }

    function nm(angstrom) {
        if (!isNumber(angstrom) || angstrom < 0) return MISSING;
        const value = angstrom / ANGSTROM_PER_NM;
        return value > 0 && value < SMALL_NM ? String(Number(value.toPrecision(2))) : value.toFixed(1);
    }

    // ------------------------------------------------------------- texts

    const CUT_NOTE = '切開四分之一以顯示內部';
    const CHAIN_NOTE = '圖中是一個代表性構形（固定亂數種子，未考慮排除體積）';
    const CHAIN_ALT = '一個代表性構形';
    const LOGNORMAL = 'lognormal';
    const WIDTH_DIGITS = 2;
    const FRACTION_DIGITS = 2;
    const CHARGE_DIGITS = 3;
    /** model -> the lines of the dimension list: [label, the value in Angstrom from the parameters]. */
    const DIMS = Object.freeze({
        sphere: [['半徑 R', (p) => p.radius, 'radius']],
        ellipsoid: [['極半徑 R_polar', (p) => p.radius_polar, 'radius_polar'], ['赤道半徑 R_equatorial', (p) => p.radius_equatorial, 'radius_equatorial']],
        cylinder: [['半徑 R', (p) => p.radius, 'radius'], ['長度 L', (p) => p.length, 'length']],
        core_shell_sphere: [['核半徑', (p) => p.radius, 'radius'], ['殼厚', (p) => p.thickness, 'thickness'],
            ['外徑', (p) => 2 * (p.radius + p.thickness), null]],
        vesicle: [['內半徑', (p) => p.radius, 'radius'], ['膜厚', (p) => p.thickness, 'thickness']],
        core_shell_cylinder: [['核半徑', (p) => p.radius, 'radius'], ['殼厚', (p) => p.thickness, 'thickness'],
            ['核長度 L', (p) => p.length, 'length'], ['總長', (p) => p.length + 2 * p.thickness, null]],
        flexible_cylinder: [['輪廓長度 L', (p) => p.length, 'length'], ['Kuhn 長度 b', (p) => p.kuhn_length, 'kuhn_length'],
            ['半徑 R', (p) => p.radius, 'radius']],
        lamellar: [['厚度 δ', (p) => p.thickness, 'thickness']],
    });
    const CUT_MODELS = Object.freeze(['core_shell_sphere', 'vesicle', 'core_shell_cylinder']);

    function shapeParams(form) {
        if (!isObject(form) || !globalThis.SasFitShapeGeom.hasShape(form.model)) return null;
        if (!globalThis.SasFitForm.validate(form).valid) return null;
        const all = globalThis.SasFitJobs.params(form);
        const names = DIMS[form.model].map((dim) => dim[2]).filter((name) => name !== null);
        return Object.freeze(Object.fromEntries(names.map((name) => [name, all[name]])));
    }

    const number = (value, digits) => globalThis.SasFitFormat.display(globalThis.SasFitFormat.number(value, digits));

    /** One sentence per dispersity that takes part: 'R = 5.0 +- 0.5 nm (schulz)'. */
    function dispersityLines(form, all) {
        return DIMS[form.model].filter((dim) => dim[2] !== null && has(form.pds, dim[2])).map(([label, , name]) => {
            const pd = form.pds[name];
            const width = all[name + '_pd'];
            if (!pd.open || !isNumber(width) || width <= 0) return null;
            if (pd.type === LOGNORMAL) return label + '：寬度 ' + number(width, WIDTH_DIGITS) + '（' + pd.type + '）';
            return label + ' = ' + nm(all[name]) + ' ± ' + nm(width * all[name]) + ' nm（' + pd.type + '）';
        }).filter((line) => line !== null);
    }

    function structureLine(form, all) {
        if (form.structure === null) return [];
        const parts = ['φ = ' + number(all.volfraction, FRACTION_DIGITS)];
        parts.push(isNumber(all.radius_effective) ? 'R_eff = ' + nm(all.radius_effective) + ' nm' : 'R_eff 由模型決定');
        if (isNumber(all.charge)) parts.push('電荷 ' + number(all.charge, CHARGE_DIGITS) + ' e');
        return ['S(Q)：' + form.structure + '，' + parts.join('，')];
    }

    function smallLines(form, params, ppa) {
        if (!isNumber(ppa) || ppa <= 0) return [];
        return DIMS[form.model].map(([label, value]) => [label, value(params)])
            .filter(([, value]) => value > 0 && value * ppa < MIN_PIXELS)
            .map(([label, value]) => label + ' ' + nm(value) + ' nm 在這個比例下小於 ' + MIN_PIXELS + ' 像素');
    }

    function altText(form, title, dims) {
        const notes = [];
        if (CUT_MODELS.indexOf(form.model) >= 0) notes.push(CUT_NOTE);
        if (form.model === 'flexible_cylinder') notes.push(CHAIN_ALT);
        const sizes = dims.map((dim) => dim.label + ' ' + dim.text).join('、');
        return title + '的 3D 示意圖：' + sizes + notes.map((note) => '；' + note).join('');
    }

    function describe(form, options) {
        const params = shapeParams(form);
        if (params === null) return null;
        const given = isObject(options) ? options : {};
        const scene = isObject(given.scene) ? given.scene : globalThis.SasFitShapeGeom.build(form.model, params);
        const all = globalThis.SasFitJobs.params(form);
        const title = globalThis.SasFitLabels.MODEL_NAMES[form.model] || form.model;
        const dims = DIMS[form.model].map(([label, value]) => Object.freeze({ label, text: nm(value(params)) + ' nm' }));
        const extras = (form.model === 'flexible_cylinder' ? [CHAIN_NOTE] : []).concat(
            scene === null ? [] : scene.notToScale, dispersityLines(form, all), structureLine(form, all),
            smallLines(form, params, given.pixelsPerAngstrom));
        return Object.freeze({ title, dims: Object.freeze(dims), extras: Object.freeze(extras), alt: altText(form, title, dims) });
    }

    /** The dimension list of describe() as a definition list; labels and values are escaped. */
    function dimsHtml(dims) {
        const esc = (text) => host().FormUtils.escapeHtml(text);
        const items = dims.map((dim) => '<div class="sf-shape-dim"><dt>' + esc(dim.label) + '</dt><dd>' + esc(dim.text) + '</dd></div>');
        return '<dl class="sf-shape-dims">' + items.join('') + '</dl>';
    }

    globalThis.SasFitShapeView = Object.freeze({
        DEFAULT_VIEW, ZOOM_RANGE, KEY_STEP, KEY_ZOOM, PITCH_LIMIT, MARGIN, LIGHT, CHAIN_NOTE,
        viewDirection, basis, reduce, pixelsPerAngstrom, drawList, scaleBar, nm, shapeParams, describe, dimsHtml,
    });
})();
