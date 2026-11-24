/**
 * sasfit-shape3d.js -- the 3D structure sketch of the SAS fitting page on a
 * 2D canvas, in its own card under the curves (design spec 5.1, 6; plan M4
 * Tasks 5-7; v5.8: no switch, decision 42). Original code.
 *
 *   SasFitShape3d.paint(ctx2d, list, { theme, size, bar, background }) -> void
 *       Draws a draw list of SasFitShapeView.drawList in list order (later items cover earlier ones).
 *       ctx2d       a CanvasRenderingContext2D whose units are CSS pixels (the caller has set the transform
 *                   for the device pixel ratio)
 *       list        { items } -- polygons and strokes with a role and a brightness k, no colours
 *       theme       'light' | 'dark'; undefined = the theme in effect
 *       size        { width, height } of the drawing in CSS pixels
 *       bar         a scale bar of SasFitShapeView.scaleBar, or null / undefined for none
 *       background  true: fill the light surface colour first (PNG export); otherwise the canvas is cleared
 *                   and the card shows through
 *   SasFitShape3d.create(ctx) -> { render(), exportBlob() -> Promise<Blob | null>, view() }
 *       A segment module of section-sasfit.js (key 'shape'; it is not a tab). create binds the listeners
 *       once. render() draws the sketch of the form's model -- with a structure factor an ensemble of identical
 *       particles (SasFitShapeEnsemble; decision 43): the scene is rebuilt only when the model, one of its
 *       dimensions or (with S(Q)) R_eff or the volume fraction changed (scale, SLDs and dispersity do not
 *       rebuild it), the texts under the
 *       canvas follow every render -- also while the stage is off screen, so that a screen reader never
 *       reads stale sizes -- and the canvas is painted in one requestAnimationFrame, only while it is ON
 *       SCREEN (see below) and only when the scene, the view, the size or the theme is not what was
 *       painted last. A model without a fixed shape hides the stage and says so. A form with a field error
 *       or dimensions that give no solid keep the last picture and say so in #sfShapeStatus.
 *       exportBlob() a PNG of the sketch as it is turned now: light theme on white, EXPORT_WIDTH pixels wide,
 *                  with the scale bar, drawn on a canvas of its own (ctx.deps.createCanvas), whether the stage
 *                  is on screen or not; null when there is nothing to draw. The canvas on the page is not touched.
 *       view()     the current view { yaw, pitch, zoom } (frozen), for tests and the browser smoke test
 *       ctx.deps used here: raf(fn) -> id, cancelRaf(id), createCanvas(), observeResize(element, fn),
 *                  observeVisible(element, fn), matchMedia(query).
 *
 * On screen: the stage is in the viewport (ctx.deps.observeVisible, an IntersectionObserver), the page
 * section is the one shown and the document is not hidden. Off screen nothing is painted and no frame is
 * requested; the canvas keeps its last picture, and the first frame after coming back paints what changed.
 *
 * Turning the sketch (#sfShapeStage; only while the sketch of a model with a shape is shown)
 *   pointer     drag turns it: DRAG_DEG degrees per pixel, the object follows the pointer (dragging right
 *               lowers the yaw, dragging down raises the pitch). The pointer is captured, the mouse turns with
 *               its main button only. A touch turns it the same way once the browser has given the gesture to
 *               the page: the stage has touch-action: pan-y, so a swipe that STARTS vertically scrolls the
 *               page, and one that starts sideways turns the sketch (both angles). Two pointers zoom by the
 *               ratio of their distances.
 *   keyboard    the arrows turn the way a drag does -- ArrowRight / ArrowLeft: yaw -/+ 5 degrees; ArrowDown /
 *               ArrowUp: pitch +/- 5 degrees; + or =:
 *               zoom in, -: zoom out (x 1.1); 0 or Home: the default view. Handled keys cancel their default
 *               (the page does not scroll); every other key, and any key with Ctrl / Meta / Alt, is left alone.
 *   wheel       with Ctrl only (a pinch on a trackpad arrives as Ctrl + wheel): zoom, at most WHEEL_LIMIT per
 *               event, default cancelled (the listener is not passive). A plain wheel is not touched: the
 *               page scrolls, as over the charts (decision 28).
 *   #sfShapeReset   the default view
 *   #sfShapeSpin    auto-rotate, off by default: SPIN_DEG_PER_S about the z axis, at most 30 frames a second,
 *               in a requestAnimationFrame loop that exists only while it turns. It pauses -- no frame is
 *               requested -- while the stage is off screen, the model has no shape, a fit runs or a pointer is
 *               down, and goes on when that is over.
 *               With prefers-reduced-motion: reduce it is switched off and disabled, and the help says so.
 *   There is no panning. Zoomed in, only the middle is visible: the status line says so.
 *
 * How it paints
 *   polygon   filled with ChartTheme.shade3d(role, k, theme) and stroked with THE SAME colour (SEAM_WIDTH):
 *             the stroke closes the hairlines that anti-aliasing leaves between neighbouring faces. Faces
 *             are never outlined in another colour (that would turn a sphere into a wire frame).
 *   stroke    (a segment of the flexible cylinder) everything is clipped to the segment's own outline: a
 *             round-capped line OUTLINE_WIDTH wider on each side. First that line in the edge colour, then the
 *             round-capped lines of item.fill -- the segment and its neighbours along the chain, and the
 *             lighter line on their lit side -- each in its own shade. The fills remove the outline wherever
 *             the chain simply continues, so what is left of it is the silhouette of the tube and the edge
 *             where one part of the chain passes in front of another. (The plan drew the outline with butt
 *             caps and no clip; that leaves ticks inside every bend, because the steps of the chain are
 *             shorter than its radius.)
 *   bar       bottom left: a line in the edge colour, bar.pixels long from outer edge to outer edge, with its
 *             label above it in the text colour.
 *
 * Redrawing happens on demand only: there is no animation loop but the auto-rotation. Theme changes (tps:themechange), a new
 * size of the stage (ResizeObserver) and coming on screen ask for one frame; printing repaints at once in the
 * light theme (beforeprint) and back (afterprint), on screen or not (the whole page is printed), because a
 * canvas is a bitmap that @media print cannot recolour. The backing store is the CSS size times
 * min(devicePixelRatio, MAX_PIXEL_RATIO).
 *
 * Colours come from ChartTheme only: shade3d for faces and strokes, palette(theme).shapeEdge / .text /
 * .surface for lines, labels and the export background. This file contains no colour value.
 *
 * SECURITY: the texts are written with textContent / setAttribute; the one piece of HTML (the dimension
 * list) comes from SasFitShapeView.dimsHtml, which escapes, through ctx.setHtml.
 *
 * Nothing at the top level touches document or window; ChartTheme and FormUtils are read through host() at
 * call time. The module's own state (view, scene, what was painted) is replaced as a whole on every change.
 */

(function () {
    'use strict';

    const SEAM_WIDTH = 0.75;
    const OUTLINE_WIDTH = 1;                  // per side; SasFitShapeView sizes item.fill for this
    const BAR = Object.freeze({ inset: 12, lineWidth: 2, tick: 4, gap: 5, fontSize: 12 });
    const SHADE_LEVELS = 255;                 // brightness steps a colour is looked up for (a face needs no more)
    const MAX_PIXEL_RATIO = 2;
    const EXPORT_WIDTH = 1200;
    const ACTIVE_CLASS = 'active';
    const THEME_EVENT = 'tps:themechange';
    const CHAIN_MODEL = 'flexible_cylinder';
    const SECTION_ID = 'section-sasfit';
    const DRAG_CLASS = 'is-dragging';
    const DRAG_DEG = 0.5;                     // degrees per pixel of a drag
    const WHEEL_RATE = 0.01;                  // zoom = exp(-deltaY * WHEEL_RATE) ...
    const WHEEL_LIMIT = 1.25;                 // ... but never more than this per event (a mouse wheel sends 100 at once)
    const SPIN_DEG_PER_S = 24;
    const SPIN_FRAME_MS = 1000 / 30;
    const SPIN_MAX_STEP_MS = 250;             // after a throttled tab: no jump
    const MEDIA = Object.freeze({ reduced: '(prefers-reduced-motion: reduce)', coarse: '(pointer: coarse)' });
    const NO_POINTERS = Object.freeze({});
    const TEXT = Object.freeze({
        noShape: '此模型沒有固定形狀',
        formError: '參數表有錯誤，示意圖未更新',
        noScene: '這組尺寸畫不出形狀，示意圖未更新',
        chain: '圖中是一個代表性構形',
        zoomed: '已放大：只看得到中央的部分（不能平移）',
        noAlt: '尚無示意圖',
        help: '拖曳旋轉；Ctrl＋滾輪或兩指縮放；鍵盤：方向鍵旋轉、＋／－縮放、0 重設；按比例繪製（正交投影），不能平移',
        touch: '觸控：先左右拖曳即可旋轉，直接上下滑動是捲動頁面',
        reduced: '系統設定為減少動態效果，已停用自動旋轉',
    });
    const SEPARATOR = '；';

    const host = () => (typeof window !== 'undefined' ? window : globalThis);
    const isObject = (v) => v !== null && typeof v === 'object';

    /** shade(role, k) for one theme, remembering the colours already asked for during this paint. */
    function shader(theme) {
        const chartTheme = host().ChartTheme;
        const known = new Map();
        return (role, k) => {
            const level = Math.round(Math.min(1, Math.max(0, Number.isFinite(k) ? k : 0)) * SHADE_LEVELS);
            const key = role + ':' + level;
            if (!known.has(key)) known.set(key, chartTheme.shade3d(role, level / SHADE_LEVELS, theme));
            return known.get(key);
        };
    }

    function paintPolygon(ctx, item, shade) {
        const { points } = item;
        const colour = shade(item.role, item.k);
        ctx.beginPath();
        ctx.moveTo(points[0], points[1]);
        for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
        ctx.closePath();
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.strokeStyle = colour;
        ctx.lineWidth = SEAM_WIDTH;
        ctx.stroke();
    }

    function line(ctx, points, width, colour) {
        ctx.beginPath();
        ctx.moveTo(points[0], points[1]);
        ctx.lineTo(points[2], points[3]);
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        ctx.stroke();
    }

    /** The outline of a round-capped line of the given width as the current path. */
    function capsule(ctx, points, width) {
        const angle = Math.atan2(points[3] - points[1], points[2] - points[0]);
        ctx.beginPath();
        ctx.arc(points[2], points[3], width / 2, angle - Math.PI / 2, angle + Math.PI / 2);
        ctx.arc(points[0], points[1], width / 2, angle + Math.PI / 2, angle + 3 * Math.PI / 2);
        ctx.closePath();
    }

    function paintStroke(ctx, item, shade, edge) {
        const outer = item.width + 2 * OUTLINE_WIDTH;
        ctx.save();
        capsule(ctx, item.points, outer);
        ctx.clip();                            // nothing of this segment may change what lies outside its own outline
        ctx.lineCap = 'round';
        line(ctx, item.points, outer, edge);
        const fills = Array.isArray(item.fill) && item.fill.length > 0 ? item.fill : [item];
        fills.forEach((part) => line(ctx, part.points, part.width, shade(item.role, part.k)));
        ctx.restore();
    }

    /** The end ticks are drawn half a line width inside, so the bar measures bar.pixels from outer edge to outer edge. */
    function paintBar(ctx, bar, size, palette) {
        const x = BAR.inset;
        const y = size.height - BAR.inset;
        const half = Math.min(BAR.lineWidth, bar.pixels) / 2;
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
        ctx.strokeStyle = palette.shapeEdge;
        ctx.lineWidth = 2 * half;
        ctx.beginPath();
        ctx.moveTo(x + half, y - BAR.tick);
        ctx.lineTo(x + half, y);
        ctx.lineTo(x + bar.pixels - half, y);
        ctx.lineTo(x + bar.pixels - half, y - BAR.tick);
        ctx.stroke();
        ctx.fillStyle = palette.text;
        ctx.font = BAR.fontSize + 'px ' + host().ChartTheme.FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(bar.label, x, y - BAR.tick - BAR.gap);
    }

    function paint(ctx, list, options) {
        const chartTheme = host().ChartTheme;
        const { theme, size, bar, background } = isObject(options) ? options : {};
        if (!isObject(size)) throw new Error('paint needs options.size: { width, height }');
        const palette = chartTheme.palette(theme);
        const shade = shader(theme);
        ctx.save();
        try {
            if (background === true) {
                ctx.fillStyle = chartTheme.palette('light').surface;
                ctx.fillRect(0, 0, size.width, size.height);
            } else {
                ctx.clearRect(0, 0, size.width, size.height);
            }
            ctx.lineJoin = 'round';
            const items = isObject(list) && Array.isArray(list.items) ? list.items : [];
            items.forEach((item) => {
                if (item.kind === 'polygon') paintPolygon(ctx, item, shade);
                else if (item.kind === 'stroke') paintStroke(ctx, item, shade, palette.shapeEdge);
            });
            if (isObject(bar)) paintBar(ctx, bar, size, palette);
        } finally {
            ctx.restore();
        }
    }

    // ------------------------------------------------------------- the view on the page

    /** A value that is replaced as a whole (frozen) on every change. */
    function makeStore(initial) {
        let value = Object.freeze({ ...initial });
        return Object.freeze({
            get: () => value,
            set(changes) { value = Object.freeze({ ...value, ...changes }); return value; },
        });
    }

    /** The page section is the one on screen (an element that is not there counts as shown). */
    function sectionShown(ui) {
        const section = ui.ctx.el(SECTION_ID);
        return !section || !isObject(section.classList) || section.classList.contains(ACTIVE_CLASS);
    }

    /** The stage is in the viewport of a shown page section of a visible document: only then is it painted. */
    const onScreen = (ui) => ui.store.get().visible && sectionShown(ui)
        && !(typeof document !== 'undefined' && document.hidden === true);

    /** The CSS size of the stage, or null while it has none (hidden, or not laid out yet). */
    function sizeOf(ui) {
        const stage = ui.ctx.el('sfShapeStage');
        const [width, height] = [stage.clientWidth, stage.clientHeight];
        return width > 0 && height > 0 ? Object.freeze({ width, height }) : null;
    }

    function pixelRatio() {
        const ratio = host().devicePixelRatio;
        return Math.min(Number.isFinite(ratio) && ratio > 0 ? ratio : 1, MAX_PIXEL_RATIO);
    }

    const themeOf = (ui) => (ui.store.get().printing ? 'light' : ui.store.get().theme || host().ChartTheme.resolved());

    /** What a painting depends on; the canvas is painted again only when this changes. */
    function signature(ui, size) {
        const { sceneKey, view } = ui.store.get();
        return [sceneKey, view.yaw, view.pitch, view.zoom, size.width, size.height, pixelRatio(), themeOf(ui)].join('|');
    }

    function setText(element, text) {
        if (element.textContent !== text) element.textContent = text;
    }

    /** Paint now when the sketch is on screen (or `force`: printing) and is not what the canvas already shows; true when it painted. */
    function draw(ui, force) {
        const { scene, view, painted } = ui.store.get();
        const size = (force === true || onScreen(ui)) && scene !== null ? sizeOf(ui) : null;
        if (size === null) return false;
        const wanted = signature(ui, size);
        if (wanted === painted) return false;
        const canvas = ui.ctx.el('sfShapeCanvas');
        const ratio = pixelRatio();
        const [width, height] = [Math.round(size.width * ratio), Math.round(size.height * ratio)];
        if (canvas.width !== width) canvas.width = width;          // assigning a size clears the canvas: only when it changed
        if (canvas.height !== height) canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) return false;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        const shapeView = globalThis.SasFitShapeView;
        const list = shapeView.drawList(scene, view, size);
        paint(context, list, { theme: themeOf(ui), size, bar: shapeView.scaleBar(list.pixelsPerAngstrom, size.width) });
        ui.store.set({ painted: wanted });
        return true;
    }

    /** One frame for however many requests: a drag or a burst of renders paints once. */
    function requestDraw(ui) {
        const { store, ctx } = ui;
        if (store.get().raf !== null) return;
        store.set({ raf: ctx.deps.raf(() => { store.set({ raf: null }); draw(ui); }) });
    }

    function needsDraw(ui) {
        const size = onScreen(ui) && ui.store.get().scene !== null ? sizeOf(ui) : null;
        return size !== null && signature(ui, size) !== ui.store.get().painted;
    }

    function drawSoon(ui) {
        if (needsDraw(ui)) requestDraw(ui);
    }

    // ------------------------------------------------------------- render

    const matches = (ui, query) => ui.ctx.deps.matchMedia(query).matches === true;

    /** The status line: what keeps the picture from being current, else the notes about what is shown. */
    function renderStatus(ui) {
        const { note, stale, view } = ui.store.get();
        const zoomed = !stale && view.zoom > 1 ? TEXT.zoomed : '';
        setText(ui.ctx.el('sfShapeStatus'), [note, zoomed].filter((text) => text !== '').join(SEPARATOR));
    }

    /** note: the line's own text; stale: the picture is not the form's (then nothing else is said). */
    function setNote(ui, note, stale) {
        ui.store.set({ note, stale });
        renderStatus(ui);
    }

    /** The auto-rotate button and the help under the stage; reduced motion switches the rotation off. */
    function renderSpin(ui, available) {
        const { ctx, store } = ui;
        const reduced = matches(ui, MEDIA.reduced);
        if (reduced && store.get().spin) store.set({ spin: false });
        const button = ctx.el('sfShapeSpin');
        button.disabled = !available || reduced;
        button.setAttribute('aria-pressed', String(store.get().spin));
        if (reduced) button.setAttribute('title', TEXT.reduced); else button.removeAttribute('title');
        const notes = [TEXT.help, matches(ui, MEDIA.coarse) ? TEXT.touch : '', reduced ? TEXT.reduced : ''];
        setText(ctx.el('sfShapeHelp'), notes.filter((text) => text !== '').join(SEPARATOR));
    }

    /** Stage, help and texts are there only for a model that has a shape. */
    function showStage(ui, shown) {
        const { ctx } = ui;
        ['sfShapeStage', 'sfShapeHelp', 'sfShapeText'].forEach((id) => { ctx.el(id).hidden = !shown; });
        ctx.el('sfShapeReset').disabled = !shown;
        renderSpin(ui, shown);
    }

    function renderNoShape(ui) {
        const { ctx, store } = ui;
        store.set({ scene: null, sceneKey: null, painted: null });
        showStage(ui, false);
        setNote(ui, TEXT.noShape, true);
        ctx.setHtml(ctx.el('sfShapeDims'), '');
        setText(ctx.el('sfShapeExtras'), '');
        ctx.el('sfShapeCanvas').setAttribute('aria-label', TEXT.noAlt);
    }

    /** The scene of the form: the one kept when model and dimensions are the same. null: no solid for these sizes. */
    /**
     * The scene of the form: one particle, or with a structure factor the ensemble of SasFitShapeEnsemble (decision
     * 43). It is kept while the key -- model, sizes, R_eff and volume fraction -- is the same. null: no solid.
     */
    function sceneOf(ui, form, params, sq) {
        const { store } = ui;
        const ensemble = globalThis.SasFitShapeEnsemble;
        const key = ensemble.sceneKey(form.model, params, sq);
        if (key !== store.get().sceneKey) {
            const scene = ensemble.sceneFor(form.model, params, sq);
            if (scene === null) return null;
            store.set({ scene, sceneKey: key });
        }
        return store.get().scene;
    }

    function renderTexts(ui, form, scene, sq) {
        const { ctx } = ui;
        const shapeView = globalThis.SasFitShapeView;
        const size = sizeOf(ui);
        const ppa = size === null ? undefined : shapeView.pixelsPerAngstrom(scene, shapeView.DEFAULT_VIEW, size);
        const text = shapeView.describe(form, { pixelsPerAngstrom: ppa, scene, sq });
        ctx.setHtml(ctx.el('sfShapeDims'), shapeView.dimsHtml(text.dims));
        setText(ctx.el('sfShapeExtras'), text.extras.join('\n'));
        ctx.el('sfShapeCanvas').setAttribute('aria-label', text.alt);
    }

    function renderShape(ui) {
        const { ctx } = ui;
        const form = ctx.getForm();
        if (!globalThis.SasFitShapeGeom.hasShape(form.model)) {
            renderNoShape(ui);
            return;
        }
        showStage(ui, true);
        const params = globalThis.SasFitShapeView.shapeParams(form);
        const sq = params === null ? null : globalThis.SasFitShapeEnsemble.sqInfo(form);
        const scene = params === null ? null : sceneOf(ui, form, params, sq);
        if (scene === null) {                                      // the last picture stays; the status says why
            setNote(ui, params === null ? TEXT.formError : TEXT.noScene, true);
            return;
        }
        setNote(ui, form.model === CHAIN_MODEL ? TEXT.chain : '', false);
        renderTexts(ui, form, scene, sq);
        drawSoon(ui);
    }

    function render(ui) {
        renderShape(ui);
        syncSpin(ui);
    }

    // ------------------------------------------------------------- export

    /** The sketch as it is turned now, light on white, on a canvas of its own (on screen or not). */
    function exportBlob(ui) {
        const { scene, view } = ui.store.get();
        const size = scene !== null ? sizeOf(ui) : null;
        if (size === null) return Promise.resolve(null);
        const canvas = ui.ctx.deps.createCanvas();
        const scale = EXPORT_WIDTH / size.width;
        canvas.width = EXPORT_WIDTH;
        canvas.height = Math.round(size.height * scale);
        const context = canvas.getContext('2d');
        if (!context) return Promise.resolve(null);
        context.setTransform(scale, 0, 0, scale, 0, 0);
        const shapeView = globalThis.SasFitShapeView;
        const list = shapeView.drawList(scene, view, size);
        paint(context, list, { theme: 'light', size, bar: shapeView.scaleBar(list.pixelsPerAngstrom, size.width), background: true });
        return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    }

    // ------------------------------------------------------------- events

    function setView(ui, view) {
        if (view === ui.store.get().view) return;
        ui.store.set({ view });
        renderStatus(ui);
        drawSoon(ui);
    }

    const turn = (ui, action) => setView(ui, globalThis.SasFitShapeView.reduce(ui.store.get().view, action));

    /** A model with a shape is drawn: only then the stage answers to pointer, keys and wheel. */
    const isInteractive = (ui) => ui.store.get().scene !== null;

    // ------------------------------------------------------------- auto-rotate

    function canSpin(ui) {
        const { pointers } = ui.store.get();
        return isInteractive(ui) && ui.ctx.getState().fit.phase !== 'running' && onScreen(ui)
            && Object.keys(pointers).length === 0 && !matches(ui, MEDIA.reduced);
    }

    /** One frame of the rotation: the yaw moves by the time that passed, at most 30 times a second. */
    function spinFrame(ui, time) {
        const { store } = ui;
        store.set({ spinRaf: null });
        if (!store.get().spin || !canSpin(ui)) {
            store.set({ spinTime: null });
            return;
        }
        const last = store.get().spinTime;
        if (last === null) {
            store.set({ spinTime: time });
        } else if (time - last >= SPIN_FRAME_MS) {
            const seconds = Math.min(time - last, SPIN_MAX_STEP_MS) / 1000;
            const view = globalThis.SasFitShapeView.reduce(store.get().view, { type: 'rotate', dYaw: SPIN_DEG_PER_S * seconds, dPitch: 0 });
            store.set({ spinTime: time, view });
            draw(ui);                                              // in this frame: no second request
        }
        syncSpin(ui);
    }

    /** Exactly one frame is requested while the rotation is on and may run; none otherwise. */
    function syncSpin(ui) {
        const { store, ctx } = ui;
        const { spin, spinRaf } = store.get();
        if (spin && canSpin(ui)) {
            if (spinRaf === null) store.set({ spinRaf: ctx.deps.raf((time) => spinFrame(ui, time)) });
            return;
        }
        if (spinRaf !== null) ctx.deps.cancelRaf(spinRaf);
        store.set({ spinRaf: null, spinTime: null });
    }

    function toggleSpin(ui) {
        const { store } = ui;
        if (!isInteractive(ui) || matches(ui, MEDIA.reduced)) return;
        store.set({ spin: !store.get().spin, spinTime: null });
        renderSpin(ui, true);
        syncSpin(ui);
    }

    // ------------------------------------------------------------- pointer, keyboard, wheel

    const pointOf = (event) => Object.freeze({ x: event.clientX, y: event.clientY });

    /** The distance of two pointers, or null when there are not exactly two. */
    function spread(pointers) {
        const points = Object.values(pointers);
        return points.length === 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : null;
    }

    /**
     * setPointerCapture / releasePointerCapture; both throw for a pointer that is not active (a synthetic event,
     * a pointer that is already gone). The drag then simply works without capture, while it stays over the stage.
     */
    function capture(stage, method, pointerId) {
        if (typeof stage[method] !== 'function') return;
        try {
            stage[method](pointerId);
        } catch (err) {
            // nothing to capture or to release
        }
    }

    function onPointerDown(ui, event) {
        const { store, ctx } = ui;
        if (!isInteractive(ui) || (event.pointerType === 'mouse' && event.button !== 0)) return;
        const stage = ctx.el('sfShapeStage');
        capture(stage, 'setPointerCapture', event.pointerId);
        store.set({ pointers: Object.freeze({ ...store.get().pointers, [event.pointerId]: pointOf(event) }) });
        stage.classList.add(DRAG_CLASS);
        syncSpin(ui);
    }

    function onPointerMove(ui, event) {
        const { store } = ui;
        const before = store.get().pointers;
        const last = before[event.pointerId];
        if (last === undefined) return;                           // not a pointer that went down on the stage
        const now = pointOf(event);
        const pointers = Object.freeze({ ...before, [event.pointerId]: now });
        store.set({ pointers });
        const [was, is] = [spread(before), spread(pointers)];
        if (was !== null && is !== null) {
            if (was > 0 && is > 0) turn(ui, { type: 'zoom', factor: is / was });
        } else if (Object.keys(pointers).length === 1) {
            turn(ui, { type: 'rotate', dYaw: -(now.x - last.x) * DRAG_DEG, dPitch: (now.y - last.y) * DRAG_DEG });
        }
    }

    function onPointerEnd(ui, event) {
        const { store, ctx } = ui;
        const { pointers } = store.get();
        if (pointers[event.pointerId] === undefined) return;
        const left = Object.fromEntries(Object.entries(pointers).filter(([id]) => id !== String(event.pointerId)));
        store.set({ pointers: Object.keys(left).length === 0 ? NO_POINTERS : Object.freeze(left) });
        const stage = ctx.el('sfShapeStage');
        capture(stage, 'releasePointerCapture', event.pointerId);
        if (Object.keys(left).length === 0) stage.classList.remove(DRAG_CLASS);
        syncSpin(ui);
    }

    function onKey(ui, event) {
        if (!isInteractive(ui) || event.ctrlKey || event.metaKey || event.altKey) return;
        const { view } = ui.store.get();
        const next = globalThis.SasFitShapeView.reduce(view, { type: 'key', key: event.key });
        if (next === view) return;                                 // not one of ours: the browser keeps it
        event.preventDefault();                                    // the arrows and Home would scroll the page
        setView(ui, next);
    }

    function onWheel(ui, event) {
        if (event.ctrlKey !== true || !isInteractive(ui)) return;   // a plain wheel scrolls the page
        event.preventDefault();
        const factor = Math.exp(-event.deltaY * WHEEL_RATE);
        turn(ui, { type: 'zoom', factor: Math.min(WHEEL_LIMIT, Math.max(1 / WHEEL_LIMIT, factor)) });
    }

    function bindStage(ui) {
        const { ctx } = ui;
        const stage = ctx.el('sfShapeStage');
        stage.addEventListener('pointerdown', (event) => onPointerDown(ui, event));
        stage.addEventListener('pointermove', (event) => onPointerMove(ui, event));
        stage.addEventListener('pointerup', (event) => onPointerEnd(ui, event));
        stage.addEventListener('pointercancel', (event) => onPointerEnd(ui, event));
        stage.addEventListener('keydown', (event) => onKey(ui, event));
        stage.addEventListener('wheel', (event) => onWheel(ui, event), { passive: false });
        ctx.el('sfShapeSpin').addEventListener('click', () => toggleSpin(ui));
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            const resume = () => { drawSoon(ui); syncSpin(ui); };
            document.addEventListener('visibilitychange', resume);
            document.addEventListener('click', resume);         // the sidebar shows or hides the page section
        }
    }

    /** Repaint at once in the light theme for the printer, and back afterwards (a frame would come too late). */
    function setPrinting(ui, printing) {
        ui.store.set({ printing });
        draw(ui, true);
    }

    /** The stage came into or left the viewport: paint what changed meanwhile, start or pause the rotation. */
    function setVisible(ui, visible) {
        ui.store.set({ visible: visible === true });
        drawSoon(ui);
        syncSpin(ui);
    }

    function bindRedraw(ui) {
        const { ctx, store } = ui;
        ctx.el('sfShapeReset').addEventListener('click', () => setView(ui, globalThis.SasFitShapeView.DEFAULT_VIEW));
        ctx.deps.observeResize(ctx.el('sfShapeStage'), () => drawSoon(ui));
        ctx.deps.observeVisible(ctx.el('sfShapeStage'), (visible) => setVisible(ui, visible));
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener(THEME_EVENT, (event) => {
                const theme = isObject(event.detail) && typeof event.detail.theme === 'string' ? event.detail.theme : null;
                store.set({ theme });
                drawSoon(ui);
            });
        }
        if (typeof host().addEventListener === 'function') {
            host().addEventListener('beforeprint', () => setPrinting(ui, true));
            host().addEventListener('afterprint', () => setPrinting(ui, false));
        }
    }

    function create(ctx) {
        const ui = Object.freeze({ ctx, store: makeStore({
            view: globalThis.SasFitShapeView.DEFAULT_VIEW, scene: null, sceneKey: null, painted: null, raf: null, theme: null, printing: false,
            note: '', stale: false, pointers: NO_POINTERS, spin: false, spinRaf: null, spinTime: null, visible: false,
        }) });
        bindRedraw(ui);
        bindStage(ui);
        return Object.freeze({ render: () => render(ui), exportBlob: () => exportBlob(ui), view: () => ui.store.get().view });
    }

    globalThis.SasFitShape3d = Object.freeze({ paint, create, EXPORT_WIDTH, MAX_PIXEL_RATIO });
})();
