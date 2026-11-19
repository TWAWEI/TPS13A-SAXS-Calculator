"""Page-side scripts of smoke_m4.py (arrow functions for page.evaluate / wait_for_function; no fetch of blob: or data:)."""

JS_WRAP_CLIENT = """() => {
  const real = globalThis.SasFitWorkerClient;
  window.__jobs = [];
  globalThis.SasFitWorkerClient = Object.freeze({ ...real, create: (...args) => {
    const client = real.create(...args);
    return Object.freeze({ ...client, fit: (job, opts) => { window.__jobs.push({ ...job.params }); return client.fit(job, opts); } });
  } });
}"""

JS_SEQ = """() => {
  const s = SasFitSection.getState();
  const rows = (s.seq.order || []).map((id) => { const r = s.seq.rows[id], res = r.result, f = s.files.find((x) => x.id === id);
    return { id, state: r.state, from: r.startedFrom, status: res ? res.status : null, radius: res ? res.params.radius : null,
             chi2r: res ? res.chi2r : null, name: f.fileName }; });
  const chips = [...document.querySelectorAll('#sfSeqBody tr.sf-seq-row .sf-seq-fit .tile-chip')].map((e) => e.textContent.trim());
  const c = Chart.getChart('sfSeqTrend'), d = c ? c.data.datasets[0] : null;
  return { rows, chips, outcome: s.seq.outcome, phase: s.seq.phase, activeId: s.activeId, jobs: window.__jobs.map((j) => j.radius),
           condition: document.getElementById('sfConditionName').value,
           trend: c ? { x: d.data.map((p) => p.x), y: d.data.map((p) => p.y), xTitle: c.options.scales.x.title.text, border: d.borderColor } : null };
}"""

JS_SEQ_DONE = "() => { const q = SasFitSection.getState().seq; return q.outcome === 'finished' && q.phase === 'idle'; }"
JS_IDLE = "() => { const s = SasFitSection.getState(); return s.fit.phase === 'idle' && s.seq.phase === 'idle'; }"

JS_ACTIVE = """() => {
  const s = SasFitSection.getState(), r = s.fitResults[s.activeId], row = document.querySelector('#sfSeqBody tr[data-id="' + s.activeId + '"]');
  return { activeId: s.activeId, result: r ? r.params.radius : null, input: parseFloat(document.getElementById('sfValue_radius').value),
           bar: document.getElementById('sfFitBar').innerText, results: document.getElementById('sfFitResults').innerText,
           measure: document.getElementById('sfFitMeasure').innerText.replace(/\\s+/g, ' '), rowMeasure: row && row.querySelector('td.sf-seq-fit .sf-seq-value') ? row.querySelector('td.sf-seq-fit .sf-seq-value').textContent.trim() : null,
           curve: Chart.getChart('sfMainChart').data.datasets.filter((d) => d.sfKind === 'curve' && d.sfId === s.activeId && d.data.length > 0).length,
           focus: document.activeElement ? document.activeElement.id : null };
}"""

JS_PNG_PIXEL = """async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
  let ink = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 700) ink++;
  return { w: bmp.width, h: bmp.height, px: [d[0], d[1], d[2], d[3]], ink };
}"""

# The 3D canvas as drawn: painted pixels (different from the top-left one), a hash of every pixel, the scale bar
# (its line is 12 CSS px above the bottom, starting 12 px from the left), the extent of everything else, hue bins.
JS_SHAPE = """() => {
  const c = document.getElementById('sfShapeCanvas'), w = c.width, h = c.height;
  if (!w || !h || !c.clientWidth) return { painted: 0, colours: 0, hash: 0, bar: 0, width: 0, height: 0, hues: [], size: [w, h, c.clientWidth, c.clientHeight] };
  const d = c.getContext('2d').getImageData(0, 0, w, h).data, ratio = w / c.clientWidth;
  const isBg = (i) => d[i] === d[0] && d[i + 1] === d[1] && d[i + 2] === d[2] && d[i + 3] === d[3];
  const by = Math.round((c.clientHeight - 12) * ratio);
  let bx0 = -1, bx1 = -1;
  for (let x = 0; x < w / 2; x++) { if (!isBg(4 * (by * w + x))) { if (bx0 < 0) bx0 = x; bx1 = x; } else if (bx0 >= 0) break; }
  const barRight = bx1 + 6 * ratio, barTop = by - 30 * ratio, colours = new Set(), hues = new Array(36).fill(0);
  let painted = 0, hash = 2166136261, x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 4 * (y * w + x), r = d[i], g = d[i + 1], b = d[i + 2];
    hash = Math.imul(hash ^ (r | (g << 8) | (b << 16)) ^ d[i + 3], 16777619) >>> 0;
    if (isBg(i)) continue;
    painted++;
    if (colours.size < 4096) colours.add((r << 16) | (g << 8) | b);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (d[i + 3] > 200 && max > 50 && (max - min) / max > 0.25) {
      const hue = max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
      hues[Math.floor(hue * 6) % 36]++;
    }
    if (x <= barRight && y >= barTop) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { painted, colours: colours.size, hash, bar: bx0 < 0 ? 0 : (bx1 - bx0 + 1) / ratio, width: x1 < 0 ? 0 : (x1 - x0 + 1) / ratio,
           height: y1 < 0 ? 0 : (y1 - y0 + 1) / ratio, hues, size: [w, h, c.clientWidth, c.clientHeight] };
}"""

JS_BAR_LABEL = """() => {
  const f = SasFitSection.getForm(), scene = SasFitShapeGeom.build(f.model, SasFitShapeView.shapeParams(f));
  const stage = document.getElementById('sfShapeStage'), size = { width: stage.clientWidth, height: stage.clientHeight };
  const bar = SasFitShapeView.scaleBar(SasFitShapeView.pixelsPerAngstrom(scene, SasFitShapeView.DEFAULT_VIEW, size), size.width);
  return bar ? { label: bar.label, nm: bar.nm, pixels: bar.pixels } : null;
}"""

JS_SCROLL = "() => [window.scrollX, window.scrollY, document.documentElement.scrollHeight - window.innerHeight]"

JS_LAYOUT = """() => {
  const el = document.documentElement, plots = document.querySelector('.sf-plots'), list = document.getElementById('sfTabs');
  const box = list.getBoundingClientRect(), tabs = [...list.querySelectorAll('.tab')].map((t) => t.getBoundingClientRect());
  const w = document.getElementById('sfSeqWrapper'), wide = [];
  for (let e = w.parentElement; e; e = e.parentElement) if (e.scrollWidth > e.clientWidth) wide.push(e.id || e.className || e.tagName);
  const size = (id) => { const c = document.getElementById(id); return [c.width, c.height, c.clientWidth, c.clientHeight]; };
  return { plots: [plots.scrollHeight, plots.clientHeight], page: [el.scrollWidth, el.clientWidth], wrapper: [w.scrollWidth, w.clientWidth], wide,
           tabTops: tabs.map((t) => Math.round(t.top)), tabsInside: tabs.every((t) => t.left >= box.left - 1 && t.right <= box.right + 1),
           tabList: [list.scrollWidth, list.clientWidth], main: size('sfMainChart'), shape: size('sfShapeCanvas') };
}"""

JS_IUCR_ROWS = """() => ({
  rows: [...document.querySelectorAll('#iucr-sf-body tr')].map((tr) => [...tr.children].map((td) => td.innerText.trim())),
  params: AppState.sasfitData ? AppState.sasfitData.params.map((p) => [p.name, !!p.fitted]) : null,
})"""

JS_FRAME_TIME = """() => {
  const f = SasFitSection.getForm(), scene = SasFitShapeGeom.build(f.model, SasFitShapeView.shapeParams(f));
  const c = document.getElementById('sfShapeCanvas'), g = c.getContext('2d'), size = { width: c.clientWidth, height: c.clientHeight }, times = [];
  for (let i = 0; i < 60; i++) {
    const t0 = performance.now(), list = SasFitShapeView.drawList(scene, { yaw: 45 + 3 * i, pitch: 20, zoom: 1 }, size);
    SasFitShape3d.paint(g, list, { size, bar: SasFitShapeView.scaleBar(list.pixelsPerAngstrom, size.width) });
    g.getImageData(0, 0, 1, 1);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { model: f.model, median: times[30], max: times[59], faces: scene.objects.reduce((n, m) => n + m.faces.length, 0), canvas: [c.width, c.height] };
}"""

JS_TABLE_TIME = """() => {
  const base = SasFitSeqView.tableRows(SasFitSection.getState());
  const rows = Array.from({ length: 500 }, (_, i) => ({ ...base[i % base.length], id: 'x' + i }));
  const table = document.createElement('table'), body = table.appendChild(document.createElement('tbody')), html = [], dom = [];
  let chars = 0;
  for (let k = 0; k < 7; k++) {
    const t0 = performance.now(), text = SasFitSeqView.bodyHtml(rows, { locked: false }), t1 = performance.now();
    body.innerHTML = text;
    dom.push(performance.now() - t1); html.push(t1 - t0); chars = text.length;
  }
  const median = (xs) => [...xs].sort((a, b) => a - b)[3];
  return { rows: rows.length, trs: body.children.length, columns: body.children[0].children.length, chars, html: median(html), dom: median(dom) };
}"""
