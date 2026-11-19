"""Browser smoke test of the M4 additions to the "SAS 模型擬合" page (M4 plan, Task 18): the sequence fit,
the IUCr block and its copy, the exports, the 3D sketch -- with axe-core in both themes.

Run with the Playwright venv (headless Chromium, nothing is installed by this script):

    ~/Projects/text-to-cad/.venv/bin/python tools/sasfit/smoke_m4.py

It reuses the server / report helpers of smoke_browser.py, the page helpers of smoke_ui.py and
check_iucr_copy.run_checks; prints PASS/FAIL per check, exit code 0 only if all pass. Downloads are read
through expect_download and stored in tools/sasfit/build/smoke-m4/ (git-ignored); pixels of a downloaded PNG
are checked in the page from bytes passed as a base64 argument (the page's CSP blocks fetch of blob: / data:).
Item 14 (timings, canvas sizes) is printed without a threshold. Overall timeout: TOTAL_TIMEOUT_S.
"""
import base64
import json
import math
import re
import signal
import statistics
import subprocess
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True                    # before the imports: no tools/sasfit/__pycache__
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import smoke_browser as sb                        # noqa: E402
import smoke_ui as su                             # noqa: E402
import check_iucr_copy as cic                     # noqa: E402
import smoke_m4_js as js                          # noqa: E402  (the page-side scripts)
from playwright.sync_api import sync_playwright   # noqa: E402

TOTAL_TIMEOUT_S = 240
OUT = HERE / 'build' / 'smoke-m4'
FALLBACK_PYTHON = HERE / '.venv' / 'bin' / 'python'          # has numpy; used only when this interpreter has none
CONDITION = '濃度 (mg/mL)'
CONDITION_FILE = '濃度 (mg_mL)'
TRUTH = (50, 52, 54)
STEM = 'SYNTH_sphere_10_sphere'
VIEWPORTS = ((1440, 900), (1280, 800), (1024, 768), (760, 900), (320, 640))
TWO_COLUMN = VIEWPORTS[:3]
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
WHITE = [255, 255, 255, 255]
BOM = b'\xef\xbb\xbf'
IUCR_HEADING = 'Model fitting (analytical form factor)'

# ----------------------------------------------------------------- helpers

def check(ctx, name, fn):
    """ctx.check, with the errors of reading a result that is not there (a check after a failed one) turned into a FAIL."""
    def run():
        try:
            return fn()
        except (IndexError, AttributeError, StopIteration, ZeroDivisionError) as err:
            raise AssertionError(f'{type(err).__name__}: {err}') from err
    return ctx.check(name, run)


def reload_page(ctx, wrap=False):
    """Reload; optionally wrap the Worker client BEFORE the section creates one; open the section; axe again."""
    page = ctx.page
    page.set_viewport_size({'width': su.DESKTOP[0], 'height': su.DESKTOP[1]})
    page.reload(wait_until='load')
    page.wait_for_function('() => typeof SasFitSection !== "undefined" && typeof Chart !== "undefined" && SasFitSection.getState().files.length === 0')
    if wrap:
        page.evaluate(js.JS_WRAP_CLIENT)
    su.open_section(page)
    su.inject_axe(ctx)


def grab(page, selector, save_as=None):
    """Click a download button; returns (suggested file name, path of the saved file, bytes)."""
    with page.expect_download(timeout=10_000) as info:
        page.click(selector)
    download = info.value
    path = OUT / (save_as or download.suggested_filename)
    download.save_as(str(path))
    return download.suggested_filename, path, path.read_bytes()


def axe(ctx, name, scope='section'):
    def run():
        if ctx.axe_error:
            return False, ctx.axe_error
        violations = su.run_axe(ctx, scope)
        nodes = sum(len(v['nodes']) for v in violations)
        return nodes == 0, f'{nodes} violation node(s)' + ''.join('\n' + line for line in su.describe(violations))
    return check(ctx, f'11 axe wcag2a/2aa/21a/21aa, {name}', run)


def shape(page, settle=250):
    page.wait_for_timeout(settle)
    return page.evaluate(js.JS_SHAPE)


def stage_centre(page):
    box = page.locator('#sfShapeStage').bounding_box()
    return box['x'] + box['width'] / 2, box['y'] + box['height'] / 2


def two_hues(hues, minimum=100, apart=4):
    """Two populated hue bins (10 degrees each) at least `apart` bins from each other."""
    strong = [i for i, n in enumerate(hues) if n >= minimum]
    return any(min((a - b) % 36, (b - a) % 36) >= apart for a in strong for b in strong), [i * 10 for i in strong]


def viewport(page, size, wait=400):
    page.set_viewport_size({'width': size[0], 'height': size[1]})
    page.wait_for_timeout(wait)


# ----------------------------------------------------------------- 1-3: sequence

def prepare_sequence(page):
    su.tab(page, 'data')
    su.load_files(page, su.SYNTH)
    page.fill('#sfConditionName', CONDITION)
    page.dispatch_event('#sfConditionName', 'change')
    su.pick_model(page, 'sphere')
    page.fill('#sfValue_radius', '53')
    page.check('#sfFit_radius')
    su.tab(page, 'fit')
    page.fill('#sfQMax', '0.07')                              # q*R < 4: no local minimum (see smoke_ui.fit_sphere)
    su.tab(page, 'sequence')
    page.wait_for_function("() => !document.getElementById('sfSeqRun').disabled")


def check_sequence(ctx, measured):
    def run():
        page = ctx.page
        prepare_sequence(page)
        t0 = time.time()
        page.click('#sfSeqRun')
        page.wait_for_function(js.JS_SEQ_DONE, timeout=20_000)
        measured['sequence_s'] = time.time() - t0
        page.select_option('#sfSeqY', 'radius')               # the trend chart opens on the first fitted parameter (scale)
        page.wait_for_timeout(400)
        s = page.evaluate(js.JS_SEQ)
        radii, t = [r['radius'] for r in s['rows']], s['trend']
        ok = (len(s['rows']) == 3 and s['chips'] == ['已收斂'] * 3 and all(r['status'] == 'converged' for r in s['rows'])
              and all(abs(r - want) < 0.5 for r, want in zip(radii, TRUTH)) and all(0.5 <= r['chi2r'] <= 1.6 for r in s['rows'])
              and t is not None and t['x'] == [10, 20, 30] and len(t['y']) == 3 and t['y'][0] < t['y'][1] < t['y'][2] and t['y'] == radii
              and t['xTitle'] == s['condition'] == CONDITION)
        return ok, (f"finished in {measured['sequence_s']:.2f} s; chips={s['chips']}; radius={[round(r, 4) for r in radii]} (truth {list(TRUTH)}); "
                    f"measure={[round(r['chi2r'], 3) for r in s['rows']]}; trend x={t and t['x']} y={t and [round(v, 4) for v in t['y']]} "
                    f"x title={t and t['xTitle']!r} (condition name {s['condition']!r})")
    check(ctx, '1 sequence: three SYNTH files converge within 20 s, radius within 0.5 of 50/52/54, trend chart 3 points with y increasing over x 10/20/30', run)


def check_chain(ctx):
    def run():
        s = ctx.page.evaluate(js.JS_SEQ)
        rows, jobs = s['rows'], s['jobs']
        linked = [r['from'] for r in rows] == [None, rows[0]['id'], rows[1]['id']]
        exact = len(jobs) == 3 and all(jobs[i + 1] == rows[i]['radius'] for i in range(2))
        shown = len(jobs) == 3 and jobs[0] == 53 and all(math.isclose(jobs[i + 1], rows[i]['radius'], rel_tol=1e-5) for i in range(2))
        return linked and shown, (f"startedFrom={[r['from'] for r in rows]}; start radius sent to the Worker={jobs}; results={[r['radius'] for r in rows]}; "
                                  f"equal to 6 significant digits={shown}, bit-for-bit={exact} (the start value goes through the parameter form)")
    check(ctx, '2 chaining: rows 2 and 3 started from the row before; the radius sent to the Worker is the previous result', run)


def check_after_and_load(ctx):
    def run():
        page = ctx.page
        a = page.evaluate(js.JS_ACTIVE)
        after = ('參數已改動' not in a['bar'] and '參數已改動' not in a['results'] and a['result'] is not None
                 and math.isclose(a['input'], a['result'], rel_tol=1e-5))
        third = page.evaluate('() => SasFitSection.getState().seq.order[2]')
        page.click(f'#sfSeqLoad_{third}')
        page.wait_for_function('(id) => SasFitSection.getState().activeId === id', arg=third, timeout=5_000)
        page.wait_for_timeout(500)
        b = page.evaluate(js.JS_ACTIVE)
        loaded = (b['activeId'] == third and abs(b['input'] - 54) < 0.5 and b['curve'] == 1 and bool(b['rowMeasure'])
                  and b['rowMeasure'] in b['measure'] and '參數已改動' not in b['bar'])
        return after and loaded, (f"after the sequence: active {a['activeId']}, radius field {a['input']} (result {a['result']}), stale note shown="
                                  f"{'參數已改動' in a['bar'] + a['results']}; after loading row 3: active {b['activeId']}, radius field {b['input']}, "
                                  f"model curve datasets={b['curve']}, fit bar {b['measure']!r} (row measure {b['rowMeasure']!r})")
    check(ctx, '3 after the sequence the fit target shows its own result (no stale note); loading row 3 makes it the target with radius ~54, curve and measure', run)


# ----------------------------------------------------------------- 9: keyboard

def check_keyboard(ctx):
    def run():
        page, notes, ok = ctx.page, [], True
        su.tab(page, 'data')                                  # arrows move from the selected tab
        page.focus('#sfTabData')
        for key, want in (('ArrowRight', 'sfTabModel'), ('ArrowRight', 'sfTabFit'), ('ArrowRight', 'sfTabSeq'), ('ArrowRight', 'sfTabData'),
                          ('ArrowLeft', 'sfTabSeq'), ('ArrowLeft', 'sfTabFit'), ('Home', 'sfTabData'), ('End', 'sfTabSeq')):
            page.keyboard.press(key)
            page.wait_for_timeout(80)
            got = page.evaluate("(w) => [document.activeElement.id, document.getElementById(w).getAttribute('aria-selected'), "
                                "!document.getElementById(w.replace('Tab', 'Panel')).hidden]", want)
            ok = ok and got == [want, 'true', True]
            notes.append(f"{key}->{got[0]}")
        seen = []
        for _ in range(40):
            page.keyboard.press('Tab')
            seen.append(page.evaluate(su.JS_TAB_STOP))
            if 'sfSeqPick_d2' in seen and 'sfSeqLoad_d2' in seen:
                break
        reached = 'sfSeqPick_d2' in seen and 'sfSeqLoad_d2' in seen
        page.focus('#sfSeqPick_d2')
        page.keyboard.press('Space')
        page.wait_for_timeout(200)
        off = page.evaluate("() => [SasFitSection.getState().seq.selected.d2, document.activeElement.id, document.getElementById('sfSeqPick_d2').checked]")
        page.keyboard.press('Space')
        page.wait_for_timeout(200)
        on = page.evaluate("() => [SasFitSection.getState().seq.selected.d2, document.activeElement.id, document.getElementById('sfSeqPick_d2').checked]")
        page.focus('#sfSeqLoad_d2')
        page.keyboard.press('Enter')
        page.wait_for_timeout(400)
        load = page.evaluate("() => [SasFitSection.getState().activeId, document.activeElement.id]")
        ok = ok and reached and off == [False, 'sfSeqPick_d2', False] and on == [True, 'sfSeqPick_d2', True] and load == ['d2', 'sfSeqLoad_d2']
        return ok, (f"tabs: {', '.join(notes)}; Tab from the sequence tab reaches the row checkbox and load button: {reached} ({len(seen)} stops); "
                    f"Space on the checkbox -> [selected, focus, checked] {off} then {on}; Enter on the load button -> [active, focus] {load}")
    check(ctx, '9 keyboard: four tabs with arrows/Home/End; sequence checkbox and load button reachable with Tab, Space/Enter act, focus stays', run)


# ----------------------------------------------------------------- 6, 10, 11: exports and both themes

def check_fit_csv(ctx):
    def run():
        page = ctx.page
        su.tab(page, 'fit')
        page.wait_for_function("() => !document.getElementById('sfExportCsv').disabled", timeout=5_000)
        info = page.evaluate("() => { const s = SasFitSection.getState(); return { n: s.files.find((f) => f.id === s.activeId).dataset.q.length, "
                             "summary: document.getElementById('sfFitSummary').textContent }; }")
        shown = int(re.search(r'(\d+) 點', info['summary']).group(1))
        name, path, raw = grab(page, '#sfExportCsv')
        lines = raw.decode('utf-8-sig').splitlines()
        head = next(i for i, line in enumerate(lines) if not line.startswith('#'))
        comments, rows = lines[:head], [line.split(',') for line in lines[head + 1:] if line]
        in_fit = sum(1 for r in rows if r[5] == '1')
        finite = all(len(r) == 6 and math.isfinite(float(r[3])) for r in rows)
        shape_np = genfromtxt_shape(path)
        ok = (name == STEM + '_fit.csv' and raw[:3] == BOM and len(comments) > 0 and all(c.startswith('# ') for c in comments)
              and all(not line.startswith('#') for line in lines[head:]) and lines[head] == 'q,I,sigma,I_model,residual,in_fit'
              and len(rows) == info['n'] and in_fit == shown and finite and shape_np == [info['n'] + 1, 6])
        return ok, (f"{name}, {len(raw)} B, BOM={raw[:3] == BOM}, {len(comments)} comment lines, header {lines[head]!r}, {len(rows)} data rows "
                    f"(file has {info['n']} points), in_fit=1 on {in_fit} rows (fit bar: {shown} 點), I_model all finite={finite}, "
                    f"numpy.genfromtxt shape={shape_np} (header row + data, 6 columns)")
    check(ctx, '6a fit-curve CSV: name, BOM, "# " comments, six columns, one row per point, in_fit count = fitted points, readable by numpy.genfromtxt', run)


def genfromtxt_shape(path):
    """Shape of numpy.genfromtxt(path, delimiter=',', encoding='utf-8-sig'); numpy from the other venv if this one has none."""
    try:
        import numpy
        return list(numpy.genfromtxt(str(path), delimiter=',', encoding='utf-8-sig').shape)
    except ImportError:
        code = "import sys, json, numpy; print(json.dumps(list(numpy.genfromtxt(sys.argv[1], delimiter=',', encoding='utf-8-sig').shape)))"
        done = subprocess.run([str(FALLBACK_PYTHON), '-B', '-c', code, str(path)], capture_output=True, text=True, timeout=30, check=True)
        return json.loads(done.stdout)


def check_report(ctx):
    def run():
        page = ctx.page
        info = page.evaluate("() => { const s = SasFitSection.getState(), r = s.fitResults[s.activeId]; return { names: r.names, params: r.params, "
                             "errors: r.errors, tiles: document.getElementById('sfFitParams').innerText.replace(/\\s+/g, ' ') }; }")
        info['version'] = page.evaluate(sb.JS_FOOTER_VERSION)
        name, _, raw = grab(page, '#sfExportTxt')
        text = raw.decode('utf-8-sig')
        cells = {c[0]: c for c in (line.split(' | ') for line in text.splitlines()) if len(c) == 10 and c[6] in ('fitted', 'fixed')}
        params_ok, notes = True, []
        for n in info['names']:
            c = cells.get(n)
            good = (c is not None and c[6] == 'fitted' and float(c[1]) == info['params'][n] and float(c[2]) == info['errors'][n]
                    and ' ± ' in c[4] and c[4].split(' ± ')[0] in info['tiles'])
            params_ok = params_ok and good
            notes.append(f"{n}: {c[1]} / shown {c[4]!r}" if c else f'{n}: MISSING')
        software = f"sasmodels 1.0.12 (WebAssembly), TPS13A SAXS Calculator v{info['version']}"
        needed = ['Model: sphere', 'Columns: name | value | error | error_scaled | shown on the page', '約化 χ²', 'f ≈ Z', 'Software: ' + software]
        missing = [n for n in needed if n not in text]
        ok = name == STEM + '_report.txt' and len(info['names']) == 3 and params_ok and not missing
        return ok, f"{name}, {len(raw)} B; fitted parameters (full precision / as on the page): {'; '.join(notes)}; missing: {missing or 'none'}"
    check(ctx, '6b report TXT: name, model, every fitted parameter in full precision and as shown, both error columns, measure name, f ≈ Z, software', run)


def check_sequence_csv(ctx):
    def run():
        page = ctx.page
        su.tab(page, 'sequence')
        name, _, raw = grab(page, '#sfSeqCsv')
        lines = [line for line in raw.decode('utf-8-sig').splitlines() if line and not line.startswith('#')]
        head = lines[0].split(',')
        radii = [float(line.split(',')[head.index('radius')]) for line in lines[1:]]
        ok = name == CONDITION_FILE + '_sequence.csv' and raw[:3] == BOM and len(radii) == 3 and radii[0] < radii[1] < radii[2]
        return ok, f'{name}, {len(raw)} B, {len(lines) - 1} data rows, columns {head}, radius {radii}'
    check(ctx, '6c sequence CSV: three data rows, radius column increasing', run)


def png(ctx, label, selector, want_name, theme):
    def run():
        name, _, raw = grab(ctx.page, selector, f'{Path(want_name).stem}-{theme}.png')
        info = ctx.page.evaluate(js.JS_PNG_PIXEL, base64.b64encode(raw).decode('ascii'))
        ok = name == want_name and raw[:8] == PNG_SIGNATURE and info['px'] == WHITE and info['ink'] > 20
        return ok, f"{name}, {len(raw)} B, signature={raw[:8] == PNG_SIGNATURE}, {info['w']}x{info['h']}, top-left pixel {info['px']}, non-white pixels {info['ink']}"
    check(ctx, f'6d PNG {label} ({theme} theme): name, PNG signature, white top-left pixel', run)


def themed_pass(ctx):
    """Light then dark: the four PNGs, axe on the three states that have a result, the recolouring of check 10."""
    page, hashes, borders = ctx.page, {}, {}
    for theme in ('light', 'dark'):
        ctx.theme(theme)
        su.tab(page, 'sequence')
        page.wait_for_timeout(200)
        png(ctx, 'trend', '#sfSeqTrendPng', CONDITION_FILE + '_trend.png', theme)
        borders[theme] = page.evaluate("() => [Chart.getChart('sfSeqTrend').data.datasets[0].borderColor, ChartTheme.PALETTES.dark.series[0], ChartTheme.PALETTES.light.series[0]]")
        axe(ctx, f'sequence finished (table + trend chart), {theme}')
        su.tab(page, 'fit')
        page.wait_for_timeout(200)
        png(ctx, 'main', '#sfMainPng', STEM + '_main.png', theme)
        png(ctx, 'residual', '#sfResidualPng', STEM + '_residual.png', theme)
        axe(ctx, f'fit tab, export row enabled, {theme}')
        page.click('#sfViewShape')
        hashes[theme] = shape(page, 400)
        png(ctx, '3D sketch', '#sfShapePng', STEM + '_shape.png', theme)
        axe(ctx, f'structure view (3D sketch), {theme}')
        page.click('#sfViewCurve')
    ctx.theme('light')

    def run():
        light, dark = hashes['light'], hashes['dark']
        ok = light['hash'] != dark['hash'] and dark['painted'] > 500 and borders['dark'][0] == borders['dark'][1] and borders['light'][0] == borders['light'][2]
        return ok, (f"3D canvas hash light {light['hash']} / dark {dark['hash']}; trend borderColor dark {borders['dark'][0]} "
                    f"(PALETTES.dark.series[0] {borders['dark'][1]}), light {borders['light'][0]} (PALETTES.light.series[0] {borders['light'][2]})")
    check(ctx, '10 theme: the 3D sketch is repainted in dark, the trend chart takes PALETTES.dark.series[0]', run)


# ----------------------------------------------------------------- 5: IUCr

def check_iucr_baseline(ctx):
    """The four steps of check_iucr_copy on the page as loaded (nothing sent yet); they print their own lines."""
    before = ctx.report.failures
    try:
        cic.run_checks(ctx.page, ctx.report)
    except Exception as err:                                  # noqa: BLE001 -- a crash here is a failed check, the run goes on
        ctx.report.check('5a check_iucr_copy.run_checks ran to the end', False, f'{type(err).__name__}: {str(err).splitlines()[0][:300]}')
    print(f'      5a check_iucr_copy.run_checks: {ctx.report.failures - before} failed')


def check_iucr_block(ctx):
    def run():
        page = ctx.page
        su.tab(page, 'fit')
        page.wait_for_function("() => !document.getElementById('sfSendIucr').disabled", timeout=5_000)
        page.click('#sfSendIucr')
        note = page.inner_text('#sfSendIucrNote')
        version = page.evaluate(sb.JS_FOOTER_VERSION)
        cic.show_iucr(page)
        page.wait_for_timeout(300)
        got = page.evaluate(js.JS_IUCR_ROWS)
        rows = got['rows']
        by_label = {r[1]: r for r in rows if len(r) > 2}
        params = got['params'] or []
        param_ok = len(params) == 5 and all(n in by_label and (fitted or by_label[n][3] == 'fixed') and (not fitted or by_label[n][3] not in ('', 'fixed'))
                                           for n, fitted in params)
        labels = ['Data file', 'Model', 'q-range for fitting', 'Number of points', 'Weighting', 'Reduced χ²', 'Status', 'Assumptions', 'Software']
        missing = [n for n in labels if n not in by_label]
        ok = (rows[0] == [IUCR_HEADING] and not missing and param_ok and by_label['Data file'][2] == 'SYNTH_sphere_10.dat' and by_label['Model'][2] == 'sphere'
              and 'f ≈ Z' in by_label['Assumptions'][2] and ('v' + version) in by_label['Software'][2] and version == '5.2')
        return ok, (f"note after sending: {note!r}; heading {rows[0]}; parameter rows {[(n, by_label.get(n, ['', '', '', '?'])[3]) for n, _ in params]}; "
                    f"missing rows: {missing or 'none'}; software {by_label.get('Software', ['', '', '?'])[2]!r}")
    check(ctx, '5b send to IUCr: the block has the heading, data file, model, 5 parameter rows (fixed ones marked), q-range, points, weighting, measure, status, assumptions, software', run)


def check_iucr_copy(ctx):
    def run():
        page = ctx.page
        fixture = json.loads(cic.FIXTURE.read_text(encoding='utf-8'))
        cic.fill_iucr(page)
        cic.set_inputs(page, ['', '', ''])
        page.click('#copyIUCrTable')
        page.wait_for_function("() => document.getElementById('copyIUCrTable').textContent.includes('已複製')", timeout=5_000)
        clip = page.evaluate(cic.JS_CLIPBOARD)
        text, html = clip['text'], clip['html'] or ''
        rest = text.split('\n' + cic.HEADING)[0]
        ok = (cic.HEADING in text and 'SYNTH_sphere_10.dat' in text and cic.HEADING in html and '<input' not in html and 'sasfit:begin' not in html
              and rest == fixture['filled']['text'])
        return ok, (f"clipboard text {len(text)} chars (block present={cic.HEADING in text}, file name present={'SYNTH_sphere_10.dat' in text}); "
                    f"html {len(html)} chars (block={cic.HEADING in html}, <input={'<input' in html}, marker={'sasfit:begin' in html}); "
                    f"text without the block equals the baseline filled.text: {rest == fixture['filled']['text']} ({len(rest)} vs {len(fixture['filled']['text'])} chars)")
    check(ctx, '5c copy table with the block: text and HTML carry it, no <input>, no marker; the rest equals the baseline (inputs emptied)', run)


def axe_control(ctx):
    """Negative control for the selector scope: a deliberately bad element inside #section-iucr must be reported."""
    def run():
        if ctx.axe_error:
            return False, ctx.axe_error
        ctx.page.evaluate("() => { const i = document.createElement('img'); i.id = 'axeControl'; i.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; "
                          "document.getElementById('section-iucr').appendChild(i); }")
        try:
            inside = [v['id'] for v in su.run_axe(ctx, '#section-iucr')]
            outside = [v['id'] for v in su.run_axe(ctx, '#section-sasfit')]
        finally:
            ctx.page.evaluate("() => document.getElementById('axeControl').remove()")
        return 'image-alt' in inside and 'image-alt' not in outside, f'img without alt in #section-iucr: scope #section-iucr reports {inside}, scope #section-sasfit reports {outside}'
    check(ctx, '11 axe negative control for a selector scope (a bad element is reported inside the scope only)', run)


# ----------------------------------------------------------------- 12: layout

def check_layout(ctx, measured):
    def run():
        page, notes, ok = ctx.page, [], True
        for size in VIEWPORTS:
            viewport(page, size)
            su.tab(page, 'sequence')
            page.wait_for_timeout(250)
            seq = page.evaluate(js.JS_LAYOUT)
            one_line = len(set(seq['tabTops'])) == 1
            good = (seq['page'][0] <= seq['page'][1] and not seq['wide'] and seq['tabsInside'] and seq['tabList'][0] <= seq['tabList'][1]
                    and (one_line or size[0] == 320))
            note = (f"{size[0]}x{size[1]}: page {seq['page'][0]}/{seq['page'][1]}, #sfSeqWrapper {seq['wrapper'][0]}/{seq['wrapper'][1]}, "
                    f"wider ancestors {seq['wide'] or 'none'}, tabs on {len(set(seq['tabTops']))} line(s)")
            su.tab(page, 'fit')
            views = {}
            for view, button in (('curve', '#sfViewCurve'), ('shape', '#sfViewShape')):
                page.click(button)
                page.wait_for_timeout(350)
                views[view] = page.evaluate(js.JS_LAYOUT)
                good = good and views[view]['page'][0] <= views[view]['page'][1]
                if size in TWO_COLUMN:
                    good = good and views[view]['plots'][0] == views[view]['plots'][1]
                    note += f", .sf-plots {view} {views[view]['plots'][0]}/{views[view]['plots'][1]}"
            page.click('#sfViewCurve')
            measured['canvas'].append((size, views['curve']['main'], views['shape']['shape']))
            ok = ok and good
            notes.append(note + ('' if good else '  <-- FAIL'))
        viewport(page, su.DESKTOP)
        return ok, ' | '.join(notes)
    check(ctx, '12 layout: no scrolling inside the plot column (curve and structure views) at 1440/1280/1024; no page-level horizontal overflow at five widths; '
              'the sequence table scrolls only inside #sfSeqWrapper; the four tabs stay on one line (320 may wrap)', run)


# ----------------------------------------------------------------- 7, 8: 3D sketch

def check_shape_view(ctx):
    def run():
        page, notes = ctx.page, []
        su.tab(page, 'model')
        page.click('#sfViewShape')
        first = shape(page, 400)
        hidden = page.evaluate("() => [document.getElementById('sfCurveView').hidden, document.getElementById('sfShapeView').hidden, document.getElementById('sfShapeSpin').disabled]")
        ok = hidden[:2] == [True, False] and first['painted'] > 500
        notes.append(f"#sfCurveView hidden={hidden[0]}, canvas {first['size'][0]}x{first['size'][1]}, painted pixels {first['painted']} ({first['colours']} colours)")
        x, y = stage_centre(page)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 80, y, steps=8)
        page.mouse.up()
        dragged = shape(page)
        ok = ok and dragged['hash'] != first['hash']
        notes.append(f"drag 80 px: hash {first['hash']} -> {dragged['hash']}")
        page.click('#sfShapeReset')
        sized = {}
        for radius in ('50', '100'):
            page.fill('#sfValue_radius', radius)
            m, bar = shape(page, 500), page.evaluate(js.JS_BAR_LABEL)
            sized[radius] = (m, bar, m['width'] / m['bar'] * bar['nm'] if m['bar'] and bar else 0)
        (m50, b50, d50), (m100, b100, d100) = sized['50'], sized['100']
        ok = (ok and m50['hash'] != m100['hash'] and (b50['label'] != b100['label'] or abs(m50['bar'] - m100['bar']) > 1)
              and abs(d50 - 10) < 0.5 and abs(d100 - 20) < 1)
        notes.append(f"radius 50: bar {b50['label']} = {m50['bar']:.0f} px, sphere {m50['width']:.0f} px = {d50:.2f} nm; "
                     f"radius 100: bar {b100['label']} = {m100['bar']:.0f} px, sphere {m100['width']:.0f} px = {d100:.2f} nm")
        su.pick_model(page, 'core_shell_sphere')
        core = shape(page, 500)
        both, hues = two_hues(core['hues'])
        ok = ok and both
        notes.append(f'core_shell_sphere: hue bins with >= 100 pixels at {hues} degrees')
        su.pick_model(page, 'flexible_cylinder')
        chain, status = shape(page, 500), page.inner_text('#sfShapeStatus')
        ok = ok and chain['painted'] > 500 and '代表性構形' in status
        notes.append(f"flexible_cylinder: painted {chain['painted']}, status {status!r}")
        su.pick_model(page, 'guinier')
        page.wait_for_timeout(400)
        status = page.inner_text('#sfShapeStatus')
        ok = ok and '此模型沒有固定形狀' in status
        notes.append(f'guinier: status {status!r}')
        page.click('#sfViewCurve')
        page.wait_for_timeout(400)
        back = page.evaluate("() => { const c = Chart.getChart('sfMainChart'); return [document.getElementById('sfCurveView').hidden, c.canvas.width, c.canvas.height, "
                             "c.data.datasets.filter((d) => d.sfKind === 'data' && d.data.length > 0).length]; }")
        ok = ok and back[0] is False and back[1] > 0 and back[2] > 0 and back[3] > 0
        notes.append(f'back to the curve: #sfCurveView hidden={back[0]}, canvas {back[1]}x{back[2]}, data datasets {back[3]}')
        ctx.spin_enabled = hidden[2] is False
        return ok, '; '.join(notes)
    check(ctx, '7 3D sketch: structure view replaces the curve, canvas painted, drag repaints, radius 50 -> 100 changes the scale bar (to scale), '
              'core and shell in two hues, flexible cylinder noted as one conformation, guinier has no shape, curve view comes back', run)


def check_shape_keys(ctx, measured):
    def run():
        page, notes = ctx.page, []
        su.pick_model(page, 'core_shell_cylinder')           # the longest parameter table: the page can scroll (the window must stay
                                                              # tall enough for the plot column, or the wheel scrolls inside that column)
        page.click('#sfViewShape')
        page.evaluate('() => window.scrollTo(0, 0)')
        page.focus('#sfShapeStage')
        page.keyboard.press('Home')
        start, scroll0 = shape(page, 400), page.evaluate(js.JS_SCROLL)
        measured['frame'] = page.evaluate(js.JS_FRAME_TIME)
        page.keyboard.press('Home')
        page.keyboard.press('ArrowLeft')
        left, scroll1 = shape(page), page.evaluate(js.JS_SCROLL)
        page.keyboard.press('ArrowDown')
        down, scroll2 = shape(page), page.evaluate(js.JS_SCROLL)
        ok = scroll0[2] > 300 and left['hash'] != start['hash'] and down['hash'] != left['hash'] and scroll1[:2] == scroll0[:2] == scroll2[:2]
        notes.append(f"ArrowLeft: hash {start['hash']} -> {left['hash']}, ArrowDown -> {down['hash']}, scroll {scroll0[:2]} -> {scroll1[:2]} -> {scroll2[:2]} "
                     f"(page can scroll {scroll0[2]} px)")
        page.keyboard.press('Home')
        home = shape(page)
        page.keyboard.press('+')
        plus = shape(page)
        ok = ok and plus['height'] > home['height'] + 2
        notes.append(f"+ key: object {home['width']:.0f}x{home['height']:.0f} -> {plus['width']:.0f}x{plus['height']:.0f} px")
        page.keyboard.press('Home')
        x, y = stage_centre(page)
        page.mouse.move(x, y)
        page.mouse.wheel(0, 240)
        page.wait_for_timeout(600)
        wheel, scroll3 = shape(page), page.evaluate(js.JS_SCROLL)
        ok = ok and scroll3[1] > scroll0[1] and wheel['hash'] == home['hash']
        notes.append(f"plain wheel: scrollY {scroll0[1]} -> {scroll3[1]}, canvas unchanged={wheel['hash'] == home['hash']}")
        page.evaluate('() => window.scrollTo(0, 0)')
        page.wait_for_timeout(500)
        x, y = stage_centre(page)
        page.mouse.move(x, y)
        page.keyboard.down('Control')
        page.mouse.wheel(0, -240)
        page.keyboard.up('Control')
        zoomed, scroll4 = shape(page, 400), page.evaluate(js.JS_SCROLL)
        ok = ok and zoomed['height'] > home['height'] + 2 and scroll4[1] == 0
        notes.append(f"Ctrl + wheel: object height {home['height']:.0f} -> {zoomed['height']:.0f} px, scrollY {scroll4[1]}")
        page.click('#sfShapeReset')
        page.click('#sfViewCurve')
        return ok, '; '.join(notes)
    check(ctx, '8a 3D keyboard and wheel: arrow keys rotate without scrolling the page, + enlarges, a plain wheel scrolls the page and does not zoom, Ctrl + wheel zooms', run)


def check_reduced_motion(ctx):
    def run():
        page = ctx.page
        page.emulate_media(reduced_motion='reduce')
        try:
            reload_page(ctx)
            page.click('#sfViewShape')
            page.wait_for_timeout(400)
            got = page.evaluate("() => { const b = document.getElementById('sfShapeSpin'); return [b.disabled, b.getAttribute('title'), b.getAttribute('aria-pressed')]; }")
        finally:
            page.emulate_media(reduced_motion='no-preference')
        normal = getattr(ctx, 'spin_enabled', None)
        return got[0] is True and normal is True, f'reduced motion: #sfShapeSpin disabled={got[0]}, title={got[1]!r}; without it the button was enabled={normal}'
    check(ctx, '8b prefers-reduced-motion: after a reload the auto-rotate button is disabled (it is enabled otherwise)', run)


# ----------------------------------------------------------------- 4: stop

def check_stop(ctx):
    def run():
        page = ctx.page
        su.pick_model(page, 'cylinder')
        for name in ('radius', 'length'):
            su.set_detail(page, name)
            page.locator(f'#sfPdToggle_{name}').dispatch_event('click')
            page.wait_for_selector(f'#sfPdWidth_{name}')
            page.fill(f'#sfPdWidth_{name}', '0.2')
            page.check(f'#sfFit_{name}')
        su.tab(page, 'sequence')
        page.wait_for_function("() => !document.getElementById('sfSeqRun').disabled", timeout=20_000)
        jobs0 = page.evaluate('() => window.__jobs.length')
        page.click('#sfSeqRun')
        page.wait_for_function("() => /第 1／3 筆/.test(document.getElementById('sfFitBar').textContent) && !document.getElementById('sfFitStop').disabled", timeout=20_000)
        page.wait_for_timeout(600)
        during = page.evaluate("() => [document.getElementById('sfFitProgress').textContent, SasFitSection.getState().seq.phase, document.getElementById('sfModel').disabled]")
        t0 = time.time()
        page.click('#sfFitStop')
        page.wait_for_function("() => /已停止/.test(document.getElementById('sfFitBar').textContent)", timeout=1000)
        stop_ms = (time.time() - t0) * 1000
        page.wait_for_function(js.JS_IDLE, timeout=5_000)
        bar = page.inner_text('#sfFitBar').replace('\n', ' ')
        outcome = page.evaluate("() => SasFitSection.getState().seq.outcome")
        resume = page.evaluate("() => [...document.querySelectorAll('button')].filter((b) => /繼續|續跑/.test(b.textContent) && b.getClientRects().length > 0)"
                               ".map((b) => (b.id || '?') + ':' + b.textContent.trim())")
        su.tab(page, 'model')
        unlocked = page.evaluate("() => [document.getElementById('sfModel').disabled, document.getElementById('sfValue_radius').disabled, document.getElementById('sfSeqRun').disabled]")
        before = su.curve_sig(page)
        page.fill('#sfValue_radius', f"{float(page.input_value('#sfValue_radius')) + 3:g}")
        t1 = time.time()
        su.wait_curve_change(page, before, 20_000)
        preview_ms = (time.time() - t1) * 1000
        su.tab(page, 'sequence')
        page.wait_for_function("() => !document.getElementById('sfSeqRun').disabled", timeout=20_000)
        page.click('#sfSeqRun')
        page.wait_for_function("() => /第 1／3 筆/.test(document.getElementById('sfFitBar').textContent) && SasFitSection.getState().seq.phase === 'running'", timeout=20_000)
        jobs1 = page.evaluate('() => window.__jobs.length')
        page.click('#sfFitStop')
        page.wait_for_function(js.JS_IDLE, timeout=5_000)
        ok = (during[1] == 'running' and during[2] is True and outcome == 'stopped' and not resume and unlocked == [False, False, False]
              and jobs1 == jobs0 + 2)                          # one job per run: each was stopped during its first file
        return ok, (f"while running: {during[0]!r}, model select disabled={during[2]}; 已停止 on the fit bar {stop_ms:.0f} ms after Stop ({bar!r}), outcome={outcome}; "
                    f"unlocked [model, radius, run disabled]={unlocked}; preview updated {preview_ms:.0f} ms after editing radius; "
                    f"visible continue/resume buttons: {resume or 'none'}; fit jobs sent: {jobs0} before, {jobs1} after pressing run again")
    check(ctx, '4 stop: a slow sequence (cylinder, two dispersities) stops within 1 s from the fit bar, the page unlocks and previews, there is no continue button, run starts over', run)


# ----------------------------------------------------------------- 13, 14

def check_versions(ctx):
    def run():
        footer = ctx.page.evaluate(sb.JS_FOOTER_VERSION)
        entries = sb.worker_entries()
        script = [e for e in entries if e['path'].endswith(sb.WORKER_SCRIPT)]
        names = [Path(e['path']).name for e in entries if e['path'].endswith('.js') and not e['path'].endswith(sb.WORKER_SCRIPT)]
        wasm = [e for e in entries if e['path'].endswith('.wasm')]
        bad = [e['raw'] for e in entries if e['query'].get('v') != [footer]]
        n = len(sb.EXPECTED_MODULES)
        chunks = bool(names) and len(names) % n == 0 and all(names[i:i + n] == sb.EXPECTED_MODULES for i in range(0, len(names), n))
        ok = bool(footer) and bool(script) and bool(wasm) and chunks and not bad
        return ok, (f'footer version={footer!r}; worker starts={len(script)}, importScripts modules={len(names)} (in order: {chunks}), '
                    f'wasm requests={len(wasm)} ({sorted({Path(e["path"]).name for e in wasm})}); without matching ?v=: {bad or "none"}')
    check(ctx, '13b every Worker / importScripts / wasm request carries ?v=<footer version> (server log)', run)


def measure_table(ctx, measured):
    try:
        measured['table'] = ctx.page.evaluate(js.JS_TABLE_TIME)
    except Exception as err:                                  # noqa: BLE001 -- informational; reported as missing below
        measured['table_error'] = f'{type(err).__name__}: {str(err).splitlines()[0][:200]}'


def print_measurements(measured):
    print('14 measurements (informational, no threshold)')
    f, t = measured.get('frame'), measured.get('table')
    if f:
        print(f"      3D redraw of one frame ({f['model']}, {f['faces']} faces, canvas {f['canvas'][0]}x{f['canvas'][1]}, 60 frames 3 degrees apart): "
              f"median {f['median']:.2f} ms, max {f['max']:.2f} ms")
    else:
        print('      3D redraw time: NOT MEASURED (check 8a did not get that far)')
    if t:
        print(f"      sequence table of {t['rows']} synthetic rows x {t['columns']} columns: SasFitSeqView.bodyHtml median {t['html']:.2f} ms "
              f"({t['chars']} chars), innerHTML into a detached tbody median {t['dom']:.2f} ms (7 runs)")
    else:
        print(f"      500-row table: NOT MEASURED ({measured.get('table_error', 'not run')})")
    if 'sequence_s' in measured:
        print(f"      sequence of three files (sphere, 3 free parameters), click to finished: {measured['sequence_s']:.2f} s")
    else:
        print('      sequence total time: NOT MEASURED')
    for size, main, sketch in measured['canvas']:
        print(f"      {size[0]}x{size[1]}: main chart canvas {main[2]}x{main[3]} CSS px ({main[0]}x{main[1]} backing), "
              f"3D canvas {sketch[2]}x{sketch[3]} CSS px ({sketch[0]}x{sketch[1]} backing)")


# ----------------------------------------------------------------- driver

def run_all(base_url):
    report, measured = sb.Report(), {'canvas': []}
    OUT.mkdir(parents=True, exist_ok=True)
    su.SHOTS.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context, ctx = su.make_ctx(browser, base_url, report, 'light')        # downloads are accepted by default
            context.grant_permissions(cic.PERMISSIONS)
            try:
                page = ctx.page
                check_iucr_baseline(ctx)
                reload_page(ctx, wrap=True)
                if ctx.axe_error:
                    print('      ' + ctx.axe_error)
                su.tab(page, 'sequence')
                for theme in ('light', 'dark'):
                    ctx.theme(theme)
                    axe(ctx, f'sequence tab, empty, {theme}')
                ctx.theme('light')
                check_sequence(ctx, measured)
                check_chain(ctx)
                check_after_and_load(ctx)
                measure_table(ctx, measured)
                check_keyboard(ctx)
                page.click('#sfSeqLoad_d1')                    # back to the first file: the exports and the IUCr block are about it
                page.wait_for_function("() => SasFitSection.getState().activeId === 'd1'", timeout=5_000)
                check_fit_csv(ctx)
                check_report(ctx)
                check_sequence_csv(ctx)
                themed_pass(ctx)
                check_iucr_block(ctx)
                check_iucr_copy(ctx)
                for theme in ('light', 'dark'):
                    ctx.theme(theme)
                    axe(ctx, f'IUCr page with the model-fitting block, {theme}', '#section-iucr')
                ctx.theme('light')
                axe_control(ctx)
                su.open_section(page)
                check_layout(ctx, measured)
                check_shape_view(ctx)
                check_shape_keys(ctx, measured)
                check_stop(ctx)
                check_reduced_motion(ctx)
                check_versions(ctx)
                sb.check_console(report, '13a no console error / pageerror in the whole run', ctx.messages, ctx.errors)
                print_measurements(measured)
            finally:
                context.close()
        finally:
            browser.close()
    return report


def on_alarm(signum, frame):
    raise TimeoutError(f'smoke test exceeded {TOTAL_TIMEOUT_S} s')


def main():
    signal.signal(signal.SIGALRM, on_alarm)
    signal.alarm(TOTAL_TIMEOUT_S)
    server, thread = sb.start_server()
    base_url = f'http://127.0.0.1:{server.server_address[1]}'
    print(f'serving {sb.ROOT} at {base_url}')
    try:
        report = run_all(base_url)
    except Exception as err:                      # a crash is a failure, not a hang or a silent pass
        print(f'FAIL  M4 smoke test aborted: {type(err).__name__}: {err}')
        return 1
    finally:
        signal.alarm(0)
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    print('RESULT: ' + ('ALL PASS' if report.failures == 0 else f'{report.failures} FAILED'))
    return 0 if report.failures == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
