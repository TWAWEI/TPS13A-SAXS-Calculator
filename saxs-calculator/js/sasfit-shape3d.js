/**
 * sasfit-shape3d.js -- the 3D structure sketch of the SAS fitting page on a
 * 2D canvas (design spec 6; plan M4 Tasks 5-7). Original code.
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
 * Colours come from ChartTheme only: shade3d for faces and strokes, palette(theme).shapeEdge / .text /
 * .surface for lines, labels and the export background. This file contains no colour value.
 *
 * Nothing at the top level touches document or window; ChartTheme is read through host() at call time.
 */

(function () {
    'use strict';

    const SEAM_WIDTH = 0.75;
    const OUTLINE_WIDTH = 1;                  // per side; SasFitShapeView sizes item.fill for this
    const BAR = Object.freeze({ inset: 12, lineWidth: 2, tick: 4, gap: 5, fontSize: 12 });
    const SHADE_LEVELS = 255;                 // brightness steps a colour is looked up for (a face needs no more)

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

    globalThis.SasFitShape3d = Object.freeze({ paint });
})();
