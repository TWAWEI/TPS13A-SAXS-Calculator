/**
 * sasfit-shape3d.js -- the 3D structure sketch of the SAS fitting page on a
 * 2D canvas, and the switch of the plot card between the curves and that
 * sketch (design spec 6; plan M4 Tasks 5-7). Original code.
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
 *   SasFitShape3d.create(ctx) -> { render(), exportBlob() -> Promise<Blob | null> }
 *       A segment module of section-sasfit.js (key 'shape'; it is not a tab). create binds the listeners
 *       once. render() shows the view of state.plotView:
 *         'curve'  the curve view and its tools; nothing else happens here -- no mesh is built and the
 *                  canvas context is never asked for
 *         'shape'  the sketch of the form's model: the mesh is rebuilt only when the model or one of its
 *                  dimensions changed (scale, SLDs, dispersity and S(Q) do not rebuild it), the texts under
 *                  the canvas follow every render, and the canvas is painted in one requestAnimationFrame --
 *                  only when the scene, the view, the size or the theme is not what was painted last.
 *                  A model without a fixed shape hides the stage and says so. A form with a field error or
 *                  dimensions that give no solid keep the last picture and say so in #sfShapeStatus.
 *       exportBlob() a PNG of the sketch as it is turned now: light theme on white, EXPORT_WIDTH pixels wide,
 *                  with the scale bar, drawn on a canvas of its own (ctx.deps.createCanvas); null while the
 *                  curves are shown or there is nothing to draw. The canvas on the page is not touched.
 *       ctx.deps used here: raf(fn) -> id, cancelRaf(id), createCanvas(), observeResize(element, fn),
 *                  matchMedia(query).
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
 *   bar       bottom left: a line in the edge colour with its label above it, in the text colour.
 *
 * Redrawing happens on demand only: there is no animation loop. Theme changes (tps:themechange) and a new
 * size of the stage (ResizeObserver) ask for one frame; printing repaints at once in the light theme
 * (beforeprint) and back (afterprint), because a canvas is a bitmap that @media print cannot recolour. The
 * backing store is the CSS size times min(devicePixelRatio, MAX_PIXEL_RATIO).
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
    const VIEWS = Object.freeze({ curve: 'sfViewCurve', shape: 'sfViewShape' });
    const CHAIN_MODEL = 'flexible_cylinder';
    const TEXT = Object.freeze({
        title: '結構示意',
        noShape: '此模型沒有固定形狀',
        formError: '參數表有錯誤，示意圖未更新',
        noScene: '這組尺寸畫不出形狀，示意圖未更新',
        chain: '圖中是一個代表性構形',
        noAlt: '尚無示意圖',
    });

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

    function paintBar(ctx, bar, size, palette) {
        const x = BAR.inset;
        const y = size.height - BAR.inset;
        ctx.lineCap = 'butt';
        ctx.strokeStyle = palette.shapeEdge;
        ctx.lineWidth = BAR.lineWidth;
        ctx.beginPath();
        ctx.moveTo(x, y - BAR.tick);
        ctx.lineTo(x, y);
        ctx.lineTo(x + bar.pixels, y);
        ctx.lineTo(x + bar.pixels, y - BAR.tick);
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

    const isShown = (ui) => ui.ctx.getState().plotView === 'shape';

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

    /** Paint now when the sketch is shown and is not what the canvas already shows; true when it painted. */
    function draw(ui) {
        const { scene, view, painted } = ui.store.get();
        const size = isShown(ui) && scene !== null ? sizeOf(ui) : null;
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
        const size = isShown(ui) && ui.store.get().scene !== null ? sizeOf(ui) : null;
        return size !== null && signature(ui, size) !== ui.store.get().painted;
    }

    function drawSoon(ui) {
        if (needsDraw(ui)) requestDraw(ui);
    }

    // ------------------------------------------------------------- render

    function renderSwitch(ui, shape) {
        const { ctx } = ui;
        Object.keys(VIEWS).forEach((key) => {
            const button = ctx.el(VIEWS[key]);
            const pressed = (key === 'shape') === shape;
            button.setAttribute('aria-pressed', String(pressed));
            button.classList.toggle(ACTIVE_CLASS, pressed);
        });
        ctx.el('sfCurveView').hidden = shape;
        ctx.el('sfCurveTools').hidden = shape;
        ctx.el('sfShapeView').hidden = !shape;
        ctx.el('sfShapeTools').hidden = !shape;
    }

    /** Stage, help and texts are there only for a model that has a shape. */
    function showStage(ui, shown) {
        const { ctx } = ui;
        ['sfShapeStage', 'sfShapeHelp', 'sfShapeText'].forEach((id) => { ctx.el(id).hidden = !shown; });
        ctx.el('sfShapeReset').disabled = !shown;
    }

    function renderNoShape(ui) {
        const { ctx, store } = ui;
        showStage(ui, false);
        setText(ctx.el('sfShapeStatus'), TEXT.noShape);
        ctx.setHtml(ctx.el('sfShapeDims'), '');
        setText(ctx.el('sfShapeExtras'), '');
        ctx.el('sfShapeCanvas').setAttribute('aria-label', TEXT.noAlt);
        store.set({ scene: null, sceneKey: null, painted: null });
    }

    /** The scene of the form: the one kept when model and dimensions are the same. null: no solid for these sizes. */
    function sceneOf(ui, form, params) {
        const { store } = ui;
        const key = form.model + JSON.stringify(params);
        if (key !== store.get().sceneKey) {
            const scene = globalThis.SasFitShapeGeom.build(form.model, params);
            if (scene === null) return null;
            store.set({ scene, sceneKey: key });
        }
        return store.get().scene;
    }

    function renderTexts(ui, form, scene) {
        const { ctx } = ui;
        const shapeView = globalThis.SasFitShapeView;
        const size = sizeOf(ui);
        const ppa = size === null ? undefined : shapeView.pixelsPerAngstrom(scene, shapeView.DEFAULT_VIEW, size);
        const text = shapeView.describe(form, { pixelsPerAngstrom: ppa, scene });
        ctx.setHtml(ctx.el('sfShapeDims'), shapeView.dimsHtml(text.dims));
        setText(ctx.el('sfShapeExtras'), text.extras.join('\n'));
        ctx.el('sfShapeCanvas').setAttribute('aria-label', text.alt);
    }

    function renderShape(ui) {
        const { ctx } = ui;
        const form = ctx.getForm();
        setText(ctx.el('sfPlotTitle'), TEXT.title);                // the data segment wrote the plot mode there
        if (!globalThis.SasFitShapeGeom.hasShape(form.model)) {
            renderNoShape(ui);
            return;
        }
        showStage(ui, true);
        const params = globalThis.SasFitShapeView.shapeParams(form);
        const scene = params === null ? null : sceneOf(ui, form, params);
        if (scene === null) {                                      // the last picture stays; the status says why
            setText(ctx.el('sfShapeStatus'), params === null ? TEXT.formError : TEXT.noScene);
            return;
        }
        setText(ctx.el('sfShapeStatus'), form.model === CHAIN_MODEL ? TEXT.chain : '');
        renderTexts(ui, form, scene);
        drawSoon(ui);
    }

    function render(ui) {
        const shape = isShown(ui);
        renderSwitch(ui, shape);
        if (shape) renderShape(ui);
    }

    // ------------------------------------------------------------- export

    /** The sketch as it is turned now, light on white, on a canvas of its own. */
    function exportBlob(ui) {
        const { scene, view } = ui.store.get();
        const size = isShown(ui) && scene !== null ? sizeOf(ui) : null;
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

    function chooseView(ui, view) {
        const { ctx } = ui;
        if (ctx.getState().plotView === view) return;
        ctx.dispatch({ type: 'setPlotView', view });
        // the charts were updated while their canvases had no size: draw them again now that they are shown
        if (view === 'curve') ctx.refresh();
    }

    function bindSwitch(ui) {
        Object.keys(VIEWS).forEach((view) => ui.ctx.el(VIEWS[view]).addEventListener('click', () => chooseView(ui, view)));
    }

    function setView(ui, view) {
        if (view === ui.store.get().view) return;
        ui.store.set({ view });
        drawSoon(ui);
    }

    /** Repaint at once in the light theme for the printer, and back afterwards (a frame would come too late). */
    function setPrinting(ui, printing) {
        ui.store.set({ printing });
        draw(ui);
    }

    function bindRedraw(ui) {
        const { ctx, store } = ui;
        ctx.el('sfShapeReset').addEventListener('click', () => setView(ui, globalThis.SasFitShapeView.DEFAULT_VIEW));
        ctx.deps.observeResize(ctx.el('sfShapeStage'), () => drawSoon(ui));
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
        }) });
        bindSwitch(ui);
        bindRedraw(ui);
        return Object.freeze({ render: () => render(ui), exportBlob: () => exportBlob(ui) });
    }

    globalThis.SasFitShape3d = Object.freeze({ paint, create, EXPORT_WIDTH, MAX_PIXEL_RATIO });
})();
