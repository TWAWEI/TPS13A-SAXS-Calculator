/**
 * TPS13A SAXS Calculator - 圖表主題（v5.0）
 *
 * 所有 Chart.js 圖表的顏色都由這裡決定；圖表檔只在 dataset／scale／annotation 上標「用途」：
 *   dataset：tpsRole: 'primary' | 'reference' | 'model' | 'residual' | 'fit' | 'region'
 *            tpsSeries: 0..n（多通道，依實體編號，不依勾選順序）或 'byIndex'（圓餅圖，每片一色；
 *            tpsOthersIndex 指出「Others」那片，用 reference 灰）
 *   scale：  tpsRole／tpsSeries → 只有軸線（border）上色；刻度與標題一律用 text 色
 *   annotation：tpsRole: 'region' | 'regionAlt' | 'marker' | 'residual'
 *
 * 載入時機：Chart.js 在 <head> 以 defer 載入，比所有本地 script 晚執行。所以本檔頂層只定義
 * 常數與函式，不碰 Chart、document、matchMedia；用到時才取用（Node 測試也會載入本檔）。
 *
 * 色碼字面值只允許出現在本檔與 css/tokens.css（tests/no-color-literals.test.js）。
 * 系列色 8 色以 dataviz 驗證工具選定：淺色對 #FFFFFF 最低 3.56:1、深色對 #1E1E21 最低 4.73:1，
 * 相鄰色在常見色覺差異下 ΔE ≥ 10.5（淺）／10.6（深）。
 */
(function attachChartTheme(global) {
    'use strict';

    const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "PingFang TC", "Noto Sans TC", system-ui, sans-serif';
    const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';

    const LIGHT = Object.freeze({
        text: '#636366',
        grid: 'rgba(0, 0, 0, 0.08)',
        surface: '#FFFFFF',
        primary: '#F04E4E',
        reference: '#636366',
        model: '#047857',
        residual: '#B45309',
        fit: '#B91C1C',
        region: 'rgba(240, 78, 78, 0.08)',
        regionAlt: 'rgba(180, 83, 9, 0.08)',
        marker: '#C27A7A',
        tooltipBg: 'rgba(29, 29, 31, 0.92)',
        tooltipText: '#FFFFFF',
        series: Object.freeze(['#F04E4E', '#2A78D6', '#0F8A6E', '#B45309', '#6250D6', '#C2307A', '#4D7C0F', '#0891B2']),
    });

    const DARK = Object.freeze({
        text: '#A1A1A6',
        grid: 'rgba(255, 255, 255, 0.10)',
        surface: '#1E1E21',
        primary: '#E85858',
        reference: '#A1A1A6',
        model: '#5BD68A',
        residual: '#F5B754',
        fit: '#F58A8A',
        region: 'rgba(232, 88, 88, 0.14)',
        regionAlt: 'rgba(245, 183, 84, 0.12)',
        marker: 'rgba(238, 144, 144, 0.6)',
        tooltipBg: '#2C2C2E',
        tooltipText: '#F5F5F7',
        series: Object.freeze(['#E85858', '#4A8DDF', '#1FA27F', '#C08418', '#9085E9', '#E0629B', '#76A12B', '#1898B4']),
    });

    const PALETTES = Object.freeze({ light: LIGHT, dark: DARK });

    // 系列色用完（第 9 個以後）重用同色，改用虛線區分（composite encoding，不另生新色）
    const REUSE_DASH = Object.freeze([6, 4]);

    /** 生效主題：讀 <html data-theme>，自動時看系統（呼叫時才讀） */
    function resolved() {
        return global.ThemeInit ? global.ThemeInit.effective() : 'light';
    }

    function palette(name = resolved()) {
        return PALETTES[name] || LIGHT;
    }

    function seriesColor(p, index) {
        return p.series[index % p.series.length];
    }

    function seriesDash(p, index) {
        return index >= p.series.length ? [...REUSE_DASH] : [];
    }

    /**
     * 純函式：依用途標記算出「路徑 → 值」清單。structure 是 { data, options }
     * （建立前的 config，或既有實例的 chart.config）。不修改 structure。
     *
     * @returns {ReadonlyArray<{path: ReadonlyArray<string|number>, value: *}>}
     */
    function colorAssignments(structure, p) {
        const out = [];
        const put = (path, value) => out.push(Object.freeze({ path: Object.freeze(path), value }));
        const options = (structure && structure.options) || {};
        const datasets = (structure && structure.data && structure.data.datasets) || [];
        const tagColor = item => {
            if (Number.isInteger(item.tpsSeries)) return seriesColor(p, item.tpsSeries);
            return item.tpsRole && typeof p[item.tpsRole] === 'string' ? p[item.tpsRole] : null;
        };

        put(['options', 'plugins', 'legend', 'labels', 'color'], p.text);
        put(['options', 'plugins', 'tooltip', 'backgroundColor'], p.tooltipBg);
        put(['options', 'plugins', 'tooltip', 'titleColor'], p.tooltipText);
        put(['options', 'plugins', 'tooltip', 'bodyColor'], p.tooltipText);

        Object.entries(options.scales || {}).forEach(([id, scale]) => {
            const base = ['options', 'scales', id];
            put([...base, 'ticks', 'color'], p.text);
            put([...base, 'title', 'color'], p.text);
            put([...base, 'grid', 'color'], p.grid);
            put([...base, 'border', 'color'], (scale && tagColor(scale)) || p.grid);
        });

        datasets.forEach((ds, i) => {
            const base = ['data', 'datasets', i];
            if (ds.tpsSeries === 'byIndex') {
                const count = Array.isArray(ds.data) ? ds.data.length : 0;
                const colors = Array.from({ length: count },
                    (_, k) => (k === ds.tpsOthersIndex ? p.reference : seriesColor(p, k)));
                put([...base, 'backgroundColor'], colors);
                put([...base, 'borderColor'], p.surface);
                return;
            }
            if (Number.isInteger(ds.tpsSeries)) {
                const color = seriesColor(p, ds.tpsSeries);
                put([...base, 'borderColor'], color);
                put([...base, 'backgroundColor'], color);
                put([...base, 'borderDash'], seriesDash(p, ds.tpsSeries));
                return;
            }
            if (ds.tpsRole === 'region') {
                put([...base, 'backgroundColor'], p.region);
                put([...base, 'borderColor'], p.marker);
                return;
            }
            const color = tagColor(ds);
            if (color) {
                put([...base, 'borderColor'], color);
                put([...base, 'backgroundColor'], color);
            }
        });

        const annotations = (options.plugins && options.plugins.annotation && options.plugins.annotation.annotations) || {};
        Object.entries(annotations).forEach(([id, a]) => {
            const color = a && tagColor(a);
            if (!color) return;
            const base = ['options', 'plugins', 'annotation', 'annotations', id];
            put([...base, a.type === 'box' ? 'backgroundColor' : 'borderColor'], color);
            if (a.label) {
                put([...base, 'label', 'color'], p.text);
                // 線段標籤預設是黑底白字；改成卡片底，深淺色都看得清楚。box 的標籤畫在框內，維持透明。
                if (a.type !== 'box') put([...base, 'label', 'backgroundColor'], p.surface);
            }
        });

        return Object.freeze(out);
    }

    /** 沿路徑寫入；缺的中間層補空物件，已存在的物件一律沿用（不替換） */
    function setPath(root, path, value) {
        let node = root;
        for (let k = 0; k < path.length - 1; k++) {
            const key = path[k];
            if (node[key] === null || typeof node[key] !== 'object') node[key] = {};
            node = node[key];
        }
        node[path[path.length - 1]] = value;
    }

    /**
     * 深拷貝 config：dataset 的 data 陣列（可能上萬點）與函式（tooltip callback）沿用參照。
     * 圖表檔常用 {...shared} 淺展開共用設定，Chart.js 又會把 chart.options 的寫入直接寫回 config——
     * 不拷貝的話，換色會改到所有圖表共用的那份物件。
     */
    function cloneConfig(value, key) {
        if (Array.isArray(value)) return key === 'data' ? value : value.map(item => cloneConfig(item));
        if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
            const copy = {};
            Object.keys(value).forEach(k => { copy[k] = cloneConfig(value[k], k); });
            return copy;
        }
        return value;
    }

    // 匯出 PNG 時填白底（平常不畫：畫面上的底色由卡片負責）。不 freeze：交給 Chart.js 的外掛物件。
    const CANVAS_BACKGROUND = {
        id: 'tpsCanvasBackground',
        beforeDraw(chart) {
            if (!chart.$tpsExportBackground) return;
            const { ctx, width, height } = chart;
            ctx.save();
            ctx.fillStyle = LIGHT.surface;
            ctx.fillRect(0, 0, width, height);
            ctx.restore();
        },
    };

    /** 建立圖表前用：回傳上好色、帶白底外掛的新 config（不修改傳入的 config） */
    function colorize(config, name = resolved()) {
        const copy = cloneConfig(config);
        colorAssignments(copy, palette(name)).forEach(({ path, value }) => setPath(copy, path, value));
        return { ...copy, plugins: [...(copy.plugins || []), CANVAS_BACKGROUND] };
    }

    /**
     * 把顏色寫進既有實例的 chart.config（Chart.js 4：chart.config.options／.data 就是建立時的物件）。
     * 只寫葉節點、不替換整個 options，zoom 外掛的範圍才會保留。Chart.js 的更新 API 必須改實例本身，
     * 所以修改只發生在這裡。
     */
    function paint(chart, name) {
        const target = chart.config;
        colorAssignments(target, palette(name)).forEach(({ path, value }) => setPath(target, path, value));
    }

    function applyTo(chart, name = resolved()) {
        paint(chart, name);
        chart.update('none');
    }

    /**
     * 匯出 PNG 一律淺色白底。換色 → 白底 → 取圖 → 還原，全在同一個同步段落，瀏覽器中途不會重繪。
     * stop()：動畫進行中時 update('none') 不會同步重畫，取到的會是舊畫面。
     */
    function exportPng(chart) {
        const original = resolved();
        const swap = original !== 'light';
        try {
            if (typeof chart.stop === 'function') chart.stop();
            if (swap) paint(chart, 'light');
            chart.$tpsExportBackground = true;
            chart.update('none');
            return chart.toBase64Image('image/png', 1);
        } finally {
            chart.$tpsExportBackground = false;
            if (swap) paint(chart, original);
            chart.update('none');
        }
    }

    /** 由 app.js 的 DOMContentLoaded 呼叫（此時 defer 的 Chart.js 已執行） */
    function init() {
        if (!global.document) return;
        global.document.addEventListener('tps:themechange', event => {
            const Chart = global.Chart;
            if (typeof Chart !== 'function' || !Chart.instances) return;
            const name = event.detail && event.detail.theme;
            Object.values(Chart.instances).forEach(chart => applyTo(chart, name));
        });
    }

    global.ChartTheme = Object.freeze({
        FONT,
        MONO,
        PALETTES,
        resolved,
        palette,
        seriesColor,
        seriesDash,
        colorAssignments,
        colorize,
        applyTo,
        exportPng,
        init,
    });
})(typeof window !== 'undefined' ? window : globalThis);
