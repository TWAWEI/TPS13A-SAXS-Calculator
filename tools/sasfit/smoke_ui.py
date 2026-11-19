"""Browser smoke test of the "SAS 模型擬合" page (M3 plan, Task 14), with axe-core in both themes.

Run with the Playwright venv (headless Chromium, nothing is installed by this script):

    ~/Projects/text-to-cad/.venv/bin/python tools/sasfit/smoke_ui.py

It reuses the server / report helpers of smoke_browser.py (own http.server on a free 127.0.0.1 port,
Cache-Control: no-store, every request logged), drives the page in Chromium and prints PASS/FAIL per
check; exit code 0 only if all pass. axe-core is loaded into the TEST browser from the jsdelivr CDN at a
pinned version (the site is not changed); when the CDN cannot be reached the axe checks FAIL, never skip.
Screenshots go to tools/sasfit/build/smoke-ui/ (git-ignored). Overall timeout: TOTAL_TIMEOUT_S.
"""
import json
import signal
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True                    # before the import: no tools/sasfit/__pycache__
sys.path.insert(0, str(Path(__file__).resolve().parent))
import smoke_browser as sb                        # noqa: E402
import smoke_ui_b as passb                        # noqa: E402  (checks added with fix pass B)
from playwright.sync_api import sync_playwright, Error as PwError   # noqa: E402

TOTAL_TIMEOUT_S = 480
STEP_TIMEOUT_MS = 40_000
FIX = sb.ROOT / 'tests' / 'fixtures' / 'sasfit' / 'dat'
SHOTS = Path(__file__).resolve().parent / 'build' / 'smoke-ui'
AXE_URL = 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js'
AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
SYNTH = ['SYNTH_sphere_10.dat', 'SYNTH_sphere_20.dat', 'SYNTH_sphere_30.dat']
FIVE = SYNTH + ['generic-3col.csv', 'generic-bad.txt']
DESKTOP = (1440, 900)
THEME_LABEL = {'light': 'label[for=themeLight]', 'dark': 'label[for=themeDark]'}

# ----------------------------------------------------------------- page-side helpers

JS_HELPERS = """
window.__ui = {
  chart(id) { return Chart.getChart(document.getElementById(id)); },
  datasets(id) { const c = this.chart(id); return c ? c.data.datasets : []; },
  activeId() { return SasFitSection.getState().activeId; },
  activeData() { const a = this.activeId(); return this.datasets('sfMainChart').find((d) => d.sfKind === 'data' && d.sfId === a) || null; },
  curve() { const a = this.activeId(); return this.datasets('sfMainChart').find((d) => d.sfKind === 'curve' && (d.sfId === null || d.sfId === a)) || null; },
  sig(ds) {
    if (!ds || !ds.data.length) return null;
    const step = Math.max(1, Math.floor(ds.data.length / 25)), out = [];
    for (let i = 0; i < ds.data.length; i += step) out.push(Number(ds.data[i].y).toPrecision(6));
    return out.join(',');
  },
  xr(id) { const s = this.chart(id).scales.x; return [s.min, s.max]; },
};
"""

JS_MODE_INFO = """() => {
  const m = __ui.chart('sfMainChart'), r = __ui.chart('sfResidualChart');
  const x = m.options.scales.x, y = m.options.scales.y, pressed = ['sfModeLogLog', 'sfModeGuinier', 'sfModeKratky']
    .map((id) => document.getElementById(id).getAttribute('aria-pressed'));
  return { type: m.scales.x.type, title: x.title && x.title.text, yTitle: y.title && y.title.text, pressed,
           left: [m.chartArea.left, r.chartArea.left], right: [m.chartArea.right, r.chartArea.right],
           residualN: __ui.datasets('sfResidualChart').reduce((n, d) => n + d.data.length, 0) };
}"""

JS_RANGES = "() => ({ main: __ui.xr('sfMainChart'), residual: __ui.xr('sfResidualChart') })"

JS_TILES = """() => {
  const tile = (label) => [...document.querySelectorAll('#sfFitParams .tile')]
    .find((t) => t.querySelector('.tile-label').textContent.trim() === label);
  const val = (t) => (t ? parseFloat(t.querySelector('.tile-value').textContent.replace('−', '-')) : null);
  const hero = document.querySelector('#sfFitResults .tile--hero');
  const row = document.querySelector('#sfDataBody tr.is-active .sf-file-status');
  return { chi2r: val(hero), heroText: hero ? hero.textContent.replace(/\\s+/g, ' ') : null, radius: val(tile('radius')),
           rowStatus: row ? row.textContent.replace(/\\s+/g, ' ').trim() : null,
           fitted: [...document.querySelectorAll('#sfFitParams .tile .tile-label')].map((e) => e.textContent.trim()),
           heroes: document.querySelectorAll('#section-sasfit .tile--hero').length,
           hintsBeforeTiles: document.getElementById('sfFitHints').compareDocumentPosition(document.getElementById('sfFitParams')) === 4,
           listRoles: document.querySelectorAll('#sfFitParams [role=list] > [role=listitem]').length,
           hints: document.getElementById('sfFitHints').children.length };
}"""

JS_ANNOTATIONS = """() => {
  const a = __ui.chart('sfMainChart').options.plugins.annotation.annotations;
  return Object.values(a).filter((b) => b.tpsRole === 'outOfRange').map((b) => ({ xMin: b.xMin, xMax: b.xMax }));
}"""

JS_LAYOUT = """() => {
  const plots = document.querySelector('.sf-plots'), ctl = document.querySelector('.sf-controls');
  const ws = document.querySelector('.sf-workspace');
  const p = plots.getBoundingClientRect(), c = ctl.getBoundingClientRect();
  const el = document.documentElement;
  const canvas = document.getElementById('sfMainChart').getBoundingClientRect();
  return { position: getComputedStyle(plots).position,
           columns: getComputedStyle(ws).gridTemplateColumns.split(' ').length,
           plotsLeft: p.left, plotsTop: p.top, plotsBottom: p.bottom, controlsRight: c.right, controlsBottom: c.bottom, controlsTop: c.top,
           controlsWidth: c.width, plotsWidth: p.width, canvasWidth: canvas.width, canvasHeight: canvas.height,
           pageOverflow: el.scrollWidth - el.clientWidth, bodyOverflow: document.body.scrollWidth - el.clientWidth };
}"""

JS_WRAPPER = "(id) => { const e = document.getElementById(id); return e ? [e.scrollWidth, e.clientWidth] : null; }"

JS_TIMINGS = """async () => {
  const q = Float64Array.from({ length: 400 }, (_, i) => Math.pow(10, -2.3 + 1.8 * i / 399));
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const out = [], client = SasFitWorkerClient.create();
  try {
    for (const model of ['ellipsoid', 'core_shell_cylinder', 'flexible_cylinder']) {
      let form = SasFitForm.create(model);
      const name = SasFitForm.rows(form).find((r) => r.pd !== null).name;
      form = SasFitForm.reduce(form, { type: 'togglePd', name });
      form = SasFitForm.reduce(form, { type: 'setPdField', name, field: 'width', value: '0.2' });
      const call = () => client.evaluate({ modelSpec: SasFitJobs.modelSpec(form), params: SasFitJobs.params(form), q, opts: { cutoff: SasFitJobs.CUTOFF } });
      await call();
      const times = [];
      for (let i = 0; i < 3; i++) { const t0 = performance.now(); await call(); times.push(performance.now() - t0); }
      out.push({ model, name, npts: form.pds[name].npts, median: median(times), max: Math.max(...times) });
    }
    return out;
  } finally { client.dispose(); }
}"""

JS_AXE = """async ([scope, tags]) => {
  // scope: 'section' (default: the SAS fitting section and its nav button), 'page' (the whole document),
  // or a CSS selector / a list of selectors to run axe inside (smoke_m4.py: '#section-iucr')
  const opts = { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'], preload: false };
  const mine = scope === 'section' || scope === 'page' ? ['#section-sasfit', '.nav-item[data-section="sasfit"]']
    : (Array.isArray(scope) ? scope : [scope]);
  const context = scope === 'page' ? document : { include: mine };
  const r = await axe.run(context, opts);
  const owned = (target) => { const e = document.querySelector(Array.isArray(target) ? target[0] : target);
    return !!e && mine.some((selector) => !!e.closest(selector)); };
  return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => ({
    target: n.target.join(' >> '), mine: owned(n.target), summary: (n.failureSummary || '').replace(/\\s+/g, ' ').slice(0, 320) })) }));
}"""

JS_TAB_STOP = "() => { const a = document.activeElement; return a ? (a.id || a.tagName) : null; }"


# ----------------------------------------------------------------- plumbing

class Ctx:
    """The test browser page plus everything a check needs."""

    def __init__(self, report, page, messages, errors, base_url, label):
        self.report, self.page, self.messages, self.errors = report, page, messages, errors
        self.base_url, self.label = base_url, label
        self.shots, self.axe_error, self.page_outside = [], None, []

    def check(self, name, fn):
        """Run fn() -> (ok, detail); any browser error or timeout is a FAIL with its message (the global alarm is not swallowed)."""
        try:
            ok, detail = fn()
        except TimeoutError:
            raise
        except (PwError, AssertionError, KeyError, TypeError, ValueError) as err:
            ok, detail = False, f'{type(err).__name__}: {str(err).strip().splitlines()[0][:320] if str(err).strip() else ""}'
            self.shot('FAILED-' + name.split()[0])
        self.report.check(name, ok, detail)
        return ok

    def shot(self, name, theme=None):
        path = SHOTS / f'{name}.png'
        self.page.screenshot(path=str(path))
        self.shots.append(str(path))

    def theme(self, theme):
        self.page.click(THEME_LABEL[theme])
        self.page.wait_for_timeout(500)

    def both_themes(self, name, other_first=False):
        """Screenshot the current state in light and dark; ends in light."""
        for theme in ('light', 'dark'):
            self.theme(theme)
            self.shot(f'{name}-{theme}')
        self.theme('light')


TAB_BUTTONS = {'data': '#sfTabData', 'model': '#sfTabModel', 'fit': '#sfTabFit', 'sequence': '#sfTabSeq'}


def tab(page, key):
    page.click(TAB_BUTTONS[key])


def fresh(page, viewport=DESKTOP):
    """Reload (the page keeps nothing of this section), open the section."""
    page.set_viewport_size({'width': viewport[0], 'height': viewport[1]})
    page.reload(wait_until='load')
    page.wait_for_function('typeof SasFitSection !== "undefined" && typeof Chart !== "undefined" && SasFitSection.getState().files.length === 0')
    open_section(page)


def open_section(page):
    page.click('[data-section="sasfit"]')
    page.wait_for_selector('#section-sasfit.active')
    page.wait_for_timeout(300)


def load_files(page, names):
    page.set_input_files('#sfFileInput', [str(FIX / n) for n in names])
    page.wait_for_function("(n) => document.querySelectorAll('#sfDataBody tr.sf-file-row').length === n"
                           " && !document.getElementById('sfFileInput').disabled", arg=len(names), timeout=15_000)
    page.wait_for_function('() => !!__ui.activeData()', timeout=10_000)


def curve_sig(page):
    return page.evaluate('() => __ui.sig(__ui.curve())')


def wait_curve_change(page, before, timeout):
    page.wait_for_function('(b) => { const s = __ui.sig(__ui.curve()); return !!s && s !== b; }', arg=before, timeout=timeout)


def pick_model(page, model):
    tab(page, 'model')
    page.select_option('#sfModel', model)


def set_detail(page, name, want_open=True):
    """Open (or close) the detail row of a parameter: bounds, dispersity and the formula button are in there."""
    button = page.locator(f'#sfMore_{name}')
    if (button.get_attribute('aria-expanded') == 'true') != want_open:
        button.dispatch_event('click')                        # not a pointer click: the narrow layout keeps a sticky plot above the table
        page.wait_for_function('([n, w]) => (document.getElementById("sfMore_" + n).getAttribute("aria-expanded") === "true") === w',
                               arg=[name, want_open], timeout=5_000)


def fit_sphere(page, radius='53', qmax='0.07'):
    """Radius starts at `radius`, its fit box ticked, Qmax typed, fit started, wait for the hero tile."""
    pick_model(page, 'sphere')
    page.fill('#sfValue_radius', radius)
    page.check('#sfFit_radius')
    tab(page, 'fit')
    page.fill('#sfQMax', qmax)
    page.wait_for_function('() => !document.getElementById("sfFitStart").disabled')
    page.click('#sfFitStart')
    page.wait_for_selector('#sfFitResults .tile--hero', timeout=10_000)
    page.wait_for_function('() => !document.getElementById("sfFitStart").disabled', timeout=10_000)
    page.wait_for_function('() => /擬合結束/.test(document.getElementById("sfFitLive").textContent)', timeout=10_000)


def palette(page, theme):
    return page.evaluate('(t) => ChartTheme.PALETTES[t].series[0]', theme)


def wheel_zoom(page):
    """Zoom in with Ctrl + wheel (a plain wheel scrolls the page: check 22)."""
    canvas = page.locator('#sfMainChart')
    canvas.scroll_into_view_if_needed()
    box = canvas.bounding_box()
    page.mouse.move(box['x'] + box['width'] * 0.45, box['y'] + box['height'] * 0.5)
    page.keyboard.down('Control')
    for _ in range(3):
        page.mouse.wheel(0, -300)
        page.wait_for_timeout(120)
    page.keyboard.up('Control')
    page.wait_for_timeout(700)


def span(r):
    return r[1] - r[0]


def close(a, b, tol=1e-6):
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


# ----------------------------------------------------------------- checks 1-3: open, data, preview

def check_no_worker_before_open(ctx, mark):
    def run():
        ctx.page.wait_for_timeout(1000)
        seen = [e['raw'] for e in entries_since(mark) if e['path'].endswith(sb.WORKER_SCRIPT) or sb.WORKER_SCRIPT in e['referer']
                or e['path'].endswith('.wasm')]
        return not seen, f'Worker/wasm requests before the section was opened: {seen or "none"}'
    ctx.check('16 no Worker script / wasm requested before the section is opened', run)


def check_open_section(ctx):
    def run():
        open_section(ctx.page)
        active = ctx.page.evaluate('() => document.getElementById("section-sasfit").classList.contains("active")')
        return active, f'#section-sasfit.active={active}'
    ctx.check('1 click [data-section="sasfit"] -> #section-sasfit is .active', run)


def check_data(ctx):
    def run():
        page = ctx.page
        load_files(page, FIVE)
        info = page.evaluate("""() => { const a = __ui.activeData(); const bad = [...document.querySelectorAll('#sfDataBody tr')]
          .find((r) => r.textContent.includes('generic-bad.txt'));
          return { rows: document.querySelectorAll('#sfDataBody tr.sf-file-row').length, chart: !!__ui.chart('sfMainChart'),
                   n: a ? a.data.length : 0, border: a ? a.borderColor : null, status: document.getElementById('sfPlotStatus').textContent,
                   bad: bad ? bad.textContent.replace(/\\s+/g, ' ') : null }; }""")
        light0 = palette(page, 'light')
        ok = (info['rows'] == 5 and info['chart'] and info['n'] > 0 and info['border'] == light0
              and '對數軸無法顯示' in info['status'] and info['bad'] is not None and '行' in info['bad'])
        import re
        has_line = info['bad'] is not None and re.search(r'第 \d+ 行', info['bad']) is not None
        return ok and has_line, (f"rows={info['rows']} chart={info['chart']} activePoints={info['n']} borderColor={info['border']} "
                                 f"(palette.light.series[0]={light0}) status={info['status']!r} bad-row has line number={has_line}")
    ctx.check('2 five files load: 5 rows, chart colours from ChartTheme, hidden-points reason in status, bad file shows line numbers', run)


def check_preview(ctx):
    def run():
        page = ctx.page
        pick_model(page, 'sphere')
        page.wait_for_function('() => !!__ui.curve()', timeout=10_000)
        before = curve_sig(page)
        page.fill('#sfValue_radius', '55')
        t0 = time.time()
        wait_curve_change(page, before, 1000)
        ms = (time.time() - t0) * 1000
        colours = page.evaluate('() => [__ui.curve().borderColor, __ui.activeData().borderColor, ChartTheme.palette().modelCurve]')
        ok = colours[0] == colours[2] and colours[0] != colours[1]
        return ok, (f'curve changed {ms:.0f} ms after typing radius=55; curve borderColor={colours[0]} (palette.modelCurve={colours[2]}) '
                    f'data borderColor={colours[1]}')
    ctx.check('3 model tab: radius 55 changes the preview curve within 1 s; the preview curve has the model-curve colour, not the data colour', run)


# ----------------------------------------------------------------- check 4: fit

def check_fit(ctx):
    def run():
        page = ctx.page
        pick_model(page, 'sphere')
        page.fill('#sfValue_radius', '53')
        page.check('#sfFit_radius')
        tab(page, 'fit')
        page.fill('#sfQMax', '0.07')
        page.wait_for_function('() => !document.getElementById("sfFitStart").disabled')
        info = page.inner_text('#sfFitSummary')
        boxes = page.evaluate(JS_ANNOTATIONS)
        grey = any(b['xMin'] is not None and close(float(b['xMin']), 0.07) for b in boxes)
        page.click('#sfFitStart')
        page.wait_for_selector('#sfFitResults .tile--hero', timeout=10_000)
        page.wait_for_function('() => !document.getElementById("sfFitStart").disabled', timeout=10_000)
        page.wait_for_function('() => __ui.datasets("sfResidualChart").some((d) => d.data.length > 0)', timeout=5_000)
        t = page.evaluate(JS_TILES)
        resid = page.evaluate('() => __ui.datasets("sfResidualChart").reduce((n, d) => n + d.data.length, 0)')
        ok = (t['radius'] is not None and abs(t['radius'] - 50) < 0.5 and t['chi2r'] is not None and 0.6 <= t['chi2r'] <= 1.6
              and resid > 0 and '已收斂' in (t['rowStatus'] or '') and '已收斂' in (t['heroText'] or '') and grey
              and t['heroes'] == 1 and t['hintsBeforeTiles'] and t['listRoles'] == len(t['fitted']) and 'radius' in info)
        return ok, (f"fit bar summary: {info!r}; grey box at xMin=0.07: {grey} {boxes}; radius tile={t['radius']} (truth 50) chi2r={t['chi2r']} "
                    f"residual points={resid}; file row status={t['rowStatus']!r}; fitted tiles={t['fitted']} (list items={t['listRoles']}); "
                    f"hero tiles on the page={t['heroes']}; hints placed before the parameter tiles={t['hintsBeforeTiles']}; fit hints shown={t['hints']}")
    ctx.check('4 fit radius 53 -> 50 (Qmax 0.07): |radius-50|<0.5, chi2r 0.6-1.6, 已收斂, residuals drawn, grey region', run)


# ----------------------------------------------------------------- check 6, 7: plot modes, theme

def check_modes(ctx):
    def run():
        page = ctx.page
        details, ok, titles = [], True, []
        for mode, button, want in (('log-log', '#sfModeLogLog', 'logarithmic'), ('Guinier', '#sfModeGuinier', 'linear'),
                                   ('Kratky', '#sfModeKratky', 'linear')):
            page.click(button)
            page.wait_for_timeout(600)
            i = page.evaluate(JS_MODE_INFO)
            dl, dr = abs(i['left'][0] - i['left'][1]), abs(i['right'][0] - i['right'][1])
            pressed_ok = i['pressed'] == ['true' if b == button else 'false' for b in ('#sfModeLogLog', '#sfModeGuinier', '#sfModeKratky')]
            titles.append((i['title'], i['yTitle']))
            wheel_zoom(page)
            r = page.evaluate(JS_RANGES)
            zoomed = r['main'] != [None, None]
            same = close(r['main'][0], r['residual'][0], 1e-6) and close(r['main'][1], r['residual'][1], 1e-6)
            page.click('#sfResetZoom')
            page.wait_for_timeout(500)
            r2 = page.evaluate(JS_RANGES)
            reset_same = close(r2['main'][0], r2['residual'][0], 1e-6) and close(r2['main'][1], r2['residual'][1], 1e-6)
            good = (i['type'] == want and pressed_ok and dl < 1 and dr < 1 and same and reset_same and span(r['main']) < span(r2['main']) and zoomed)
            ok = ok and good
            details.append(f"{mode}: x type={i['type']} (want {want}) title={i['title']!r} y title={i['yTitle']!r} aria-pressed ok={pressed_ok} "
                           f"chartArea.left main/res={i['left'][0]:.2f}/{i['left'][1]:.2f} right={i['right'][0]:.2f}/{i['right'][1]:.2f} "
                           f"zoom: main x={r['main'][0]:.4g}..{r['main'][1]:.4g} residual x={r['residual'][0]:.4g}..{r['residual'][1]:.4g} equal={same}; "
                           f"after reset equal={reset_same}; residual points={i['residualN']}")
        ok = ok and len(set(titles)) == 3
        page.click('#sfModeLogLog')
        return ok, ' | '.join(details) + f' | (x, y) axis-title pairs distinct={len(set(titles)) == 3}'
    ctx.check('6 three plot modes: axis type/title, aria-pressed, plot-area alignment <1 px, zoom shared with residual', run)


def check_theme(ctx):
    def run():
        page = ctx.page
        page.click('#sfModeLogLog')
        page.wait_for_timeout(500)
        wheel_zoom(page)
        before = page.evaluate(JS_RANGES)
        light0, dark0 = palette(page, 'light'), palette(page, 'dark')
        ctx.theme('dark')
        dark = page.evaluate('() => ({ data: __ui.activeData().borderColor, curve: __ui.curve().borderColor })')
        mid = page.evaluate(JS_RANGES)
        ctx.theme('light')
        light = page.evaluate('() => ({ data: __ui.activeData().borderColor, curve: __ui.curve().borderColor })')
        after = page.evaluate(JS_RANGES)
        keep = all(close(a, b) for k in ('main', 'residual') for a, b in zip(before[k], mid[k])) and \
            all(close(a, b) for k in ('main', 'residual') for a, b in zip(before[k], after[k]))
        ok = dark['data'] == dark0 and light['data'] == light0 and dark0 != light0 and keep
        page.click('#sfResetZoom')
        return ok, (f"dark data={dark['data']} (palette.dark.series[0]={dark0}) curve={dark['curve']}; light again data={light['data']} "
                    f"(palette.light.series[0]={light0}); zoomed x range kept={keep} {before['main'][0]:.4g}..{before['main'][1]:.4g}")
    ctx.check('7 theme toggle recolours the active data/curve in place and keeps the zoom', run)


# ----------------------------------------------------------------- checks 5, 8, 9, 10: model flows

def check_hayter(ctx):
    def run():
        page = ctx.page
        pick_model(page, 'sphere')
        page.select_option('#sfStructure', 'hayter_msa')
        page.wait_for_function('() => document.getElementById("sfModelHints").textContent.trim() !== ""', timeout=5_000)
        hint = page.inner_text('#sfModelHints').strip().replace('\n', ' ')
        set_detail(page, 'charge')                            # the bounds are in the detail row
        lower = page.input_value('#sfLower_charge')
        marker = page.inner_text('#sfMark_charge')
        page.select_option('#sfStructure', '')
        return lower == '0.5' and marker == '', f'hint={hint[:120]!r}; charge lower field={lower!r}; marker of the default bound={marker!r}'
    ctx.check('8 sphere + hayter_msa: #sfModelHints has text, charge lower bound is 0.5', run)


def check_error_path(ctx):
    def run():
        page, mark = ctx.page, len(ctx.messages)
        errors_before = len(ctx.errors)
        page.route('**/wasm/sas-ellipsoid.wasm*', lambda route: route.abort())
        pick_model(page, 'sphere')
        page.wait_for_function('() => !!__ui.curve()', timeout=10_000)
        sphere_sig = curve_sig(page)
        page.select_option('#sfModel', 'ellipsoid')
        page.wait_for_function('() => document.getElementById("sfAlert").textContent.trim() !== ""', timeout=20_000)
        alert = page.inner_text('#sfAlert').strip().replace('\n', ' ')
        new = ctx.messages[mark:]
        warn = [m[1] for m in new if m[0] == 'warning' and 'ellipsoid' in m[1]]
        errs = [m[1] for m in new if m[0] == 'error'] + ctx.errors[errors_before:]
        page.click('[data-section="protein"]')
        page.wait_for_selector('#section-protein.active')
        other_ok = page.is_visible('#section-protein')
        open_section(page)
        page.unroute('**/wasm/sas-ellipsoid.wasm*')
        page.select_option('#sfModel', 'sphere')
        page.wait_for_function('() => document.getElementById("sfAlert").textContent.trim() === ""', timeout=10_000)
        page.select_option('#sfModel', 'ellipsoid')
        before = curve_sig(page)
        page.wait_for_function('() => document.getElementById("sfAlert").textContent.trim() === ""', timeout=20_000)
        page.wait_for_function('(b) => { const s = __ui.sig(__ui.curve()); return !!s && s !== b; }', arg=sphere_sig, timeout=20_000)
        cleared = page.inner_text('#sfAlert').strip() == ''
        ok = ('載入' in alert and bool(warn) and not errs and other_ok and cleared)
        return ok, (f'alert={alert[:100]!r}; console warnings naming ellipsoid={warn}; console errors={errs}; protein page shown={other_ok}; '
                    f'after unroute #sfAlert empty={cleared}, ellipsoid curve computed={curve_sig(page) != sphere_sig}')
    ctx.check('9 wasm load failure (ellipsoid): alert + warning naming the model, no error, other page fine, retry works', run)


def check_paused(ctx):
    def run():
        page = ctx.page
        pick_model(page, 'core_shell_cylinder')
        pds = ['radius', 'thickness', 'length']
        for name in pds:
            set_detail(page, name)
        names = page.evaluate('() => [...document.querySelectorAll("[data-action=togglePd]")].map((b) => b.dataset.param)')
        if any(n not in names for n in pds):
            return False, f'core_shell_cylinder offers dispersity switches {names}; need radius, thickness, length'
        for name in pds:
            page.click(f'#sfPdToggle_{name}')
            page.fill(f'#sfPdWidth_{name}', '0.1')
        page.wait_for_function('() => !document.getElementById("sfPreviewNow").hidden', timeout=10_000)
        status = page.inner_text('#sfPlotStatus').strip()
        paused = '已暫停' in status and '曲線尚未更新' in status
        ctx.both_themes('paused-preview')
        before = curve_sig(page)
        t0 = time.time()
        page.click('#sfPreviewNow')
        page.wait_for_function('(b) => { const s = __ui.sig(__ui.curve()); return !!s && s !== b; }', arg=before, timeout=30_000)
        compute_s = time.time() - t0
        page.wait_for_function('() => /曲線已更新（手動）/.test(document.getElementById("sfPlotStatus").textContent)', timeout=10_000)
        updated = page.inner_text('#sfPlotStatus').strip()
        still = not page.is_hidden('#sfPreviewNow')
        for name in pds[1:]:
            page.fill(f'#sfPdWidth_{name}', '0')
        page.wait_for_function('() => document.getElementById("sfPreviewNow").hidden', timeout=10_000)
        return paused and still, (f'status={status!r}; #sfPreviewNow visible; on-demand compute finished in {compute_s:.1f} s '
                                  f'(curve changed), then status={updated!r}; button stays while paused={still}; two widths back to 0 -> button hidden')
    ctx.check('10 core_shell_cylinder with 3 PDs: 已暫停 + #sfPreviewNow computes on demand; 2 widths back to 0 hides it', run)


# ----------------------------------------------------------------- 12, 13, 14, 15, 18, 19: UI behaviour

def check_keyboard(ctx):
    def run():
        page = ctx.page
        page.focus('#sfTabData')
        notes, ok = [], True
        for key, want in (('ArrowRight', 'sfTabModel'), ('ArrowRight', 'sfTabFit'), ('ArrowRight', 'sfTabSeq'), ('ArrowRight', 'sfTabData'),
                          ('ArrowLeft', 'sfTabSeq'), ('ArrowLeft', 'sfTabFit'), ('End', 'sfTabSeq'), ('Home', 'sfTabData')):
            page.keyboard.press(key)
            page.wait_for_timeout(80)
            state = page.evaluate("""(w) => ({ focus: document.activeElement.id, sel: document.getElementById(w).getAttribute('aria-selected'),
                tabindex: document.getElementById(w).getAttribute('tabindex'), panel: !document.getElementById(w.replace('Tab', 'Panel')).hidden })""", want)
            good = state['focus'] == want and state['sel'] == 'true' and state['tabindex'] == '0' and state['panel']
            ok = ok and good
            notes.append(f"{key}->{want}:{'ok' if good else state}")
        wanted = {'data': (['sfFileInput'], ['sfShow_', 'sfActive_', 'sfCond_', 'sfRemove_']),
                  'model': (['sfFitStart', 'sfModel', 'sfFit_radius', 'sfValue_radius', 'sfMore_radius'], []),
                  'fit': (['sfFitStart', 'sfQMin', 'sfQMax', 'sfWeighting', 'sfMaxSteps'], []),
                  'sequence': (['sfFitStart', 'sfSeqChain', 'sfSeqSort', 'sfSeqAll', 'sfSeqNone', 'sfSeqWrapper'], ['sfSeqPick_'])}
        for key, (exact, prefixes) in wanted.items():
            tab(page, key)
            page.focus(TAB_BUTTONS[key])
            seen = []
            for _ in range(160):
                page.keyboard.press('Tab')
                seen.append(page.evaluate(JS_TAB_STOP))
                if all(e in seen for e in exact) and all(any(s.startswith(p) for s in seen) for p in prefixes):
                    break
            missing = [e for e in exact if e not in seen] + [p for p in prefixes if not any(s.startswith(p) for s in seen)]
            ok = ok and not missing
            notes.append(f"Tab through {key} panel: {len(seen)} stops, missing={missing or 'none'}")
        return ok, '; '.join(notes)
    ctx.check('12 keyboard: arrows/Home/End move selection and focus; Tab reaches the controls of every panel', run)


def check_layout(ctx):
    def run():
        page = ctx.page
        page.set_viewport_size({'width': 1440, 'height': 900})
        page.wait_for_timeout(300)
        wide = page.evaluate(JS_LAYOUT)
        sizes, ok = {}, True
        for size in ((1280, 800), (1024, 768), (760, 900)):
            page.set_viewport_size({'width': size[0], 'height': size[1]})
            page.wait_for_timeout(350)
            sizes[size[0]] = page.evaluate(JS_LAYOUT)
        tab(page, 'model')                                    # the narrow layout keeps the plot in view while the model is edited
        page.wait_for_timeout(200)
        narrow_model = page.evaluate(JS_LAYOUT)
        tab(page, 'data')
        page.set_viewport_size({'width': 1440, 'height': 900})
        two = [wide, sizes[1280], sizes[1024]]
        ok = (all(m['position'] == 'sticky' and m['columns'] == 2 and m['plotsLeft'] >= m['controlsRight'] - 1 for m in two)
              and all(m['plotsWidth'] > m['controlsWidth'] for m in two) and wide['canvasWidth'] >= 540 and sizes[1280]['canvasWidth'] >= 400
              and sizes[760]['columns'] == 1 and sizes[760]['plotsBottom'] <= sizes[760]['controlsTop'] + 1
              and sizes[760]['position'] == 'static' and narrow_model['position'] == 'sticky')
        cols = lambda name, m: (f"{name}: {m['columns']} column(s), controls {m['controlsWidth']:.0f} px, plots {m['plotsWidth']:.0f} px, "
                                f"canvas {m['canvasWidth']:.0f}x{m['canvasHeight']:.0f}, plots {m['position']}")
        return ok, (' | '.join([cols('1440x900', wide), cols('1280x800', sizes[1280]), cols('1024x768', sizes[1024]), cols('760x900', sizes[760])])
                    + f" | 760: plots.bottom={sizes[760]['plotsBottom']:.0f} <= controls.top={sizes[760]['controlsTop']:.0f} (plot first); "
                    f"on the model tab the plot is {narrow_model['position']}")
    ctx.check('13 layout: two columns (plot the wider one) at 1440, 1280 and 1024; one column with the plot first at 760, sticky on the model tab', run)


def check_measurements(ctx):
    def run():
        rows = ctx.page.evaluate(JS_TIMINGS)
        lines = [f"{r['model']}: PD on {r['name']} (npts {r['npts']}), 400 q, median {r['median']:.1f} ms (max {r['max']:.1f} ms)" for r in rows]
        return all(r['median'] > 0 for r in rows), 'informational (no threshold): ' + '; '.join(lines)
    ctx.check('14a single preview time per heavy model (one 35-point PD, 400 q)', run)


def check_overflow(ctx):
    def run():
        page, notes, ok = ctx.page, [], True
        for size in ((1440, 900), (1280, 800), (1024, 768)):
            page.set_viewport_size({'width': size[0], 'height': size[1]})
            page.wait_for_timeout(300)
            pick_model(page, 'core_shell_cylinder')            # the longest names; every detail row open, one with its dispersity
            names = page.evaluate("() => [...document.querySelectorAll('#sfParamBody [data-action=toggleDetail]')].map((b) => b.dataset.param)")
            for name in names:
                set_detail(page, name)
            page.locator('#sfPdToggle_radius').dispatch_event('click')
            page.wait_for_selector('#sfPdWidth_radius')
            param = page.evaluate(JS_WRAPPER, 'sfParamWrapper')
            opened = page.evaluate("() => document.querySelectorAll('#sfParamBody .sf-detail-row:not([hidden])').length")
            ok = ok and opened == len(names) and len(names) >= 8
            pick_model(page, 'sphere')
            tab(page, 'data')
            files = page.evaluate(JS_WRAPPER, 'sfDataWrapper')
            m = page.evaluate(JS_LAYOUT)
            ok = ok and m['pageOverflow'] <= 0 and m['bodyOverflow'] <= 0 and param[0] <= param[1] and files[0] <= files[1]
            notes.append(f"{size[0]}x{size[1]}: #sfParamWrapper scrollWidth/clientWidth={param[0]}/{param[1]} "
                         f"({'scrolls horizontally' if param[0] > param[1] else 'fits'}); #sfDataWrapper (5 files) {files[0]}/{files[1]} "
                         f"({'scrolls horizontally' if files[0] > files[1] else 'fits'}); page-level overflow={m['pageOverflow']} px")
        page.set_viewport_size({'width': 1440, 'height': 900})
        return ok, ' | '.join(notes)
    ctx.check('14b/19 no horizontal overflow of the parameter table (all detail rows open), the file table or the page at 1440, 1280 and 1024', run)


def check_narrow(ctx):
    def run():
        page = ctx.page
        page.set_viewport_size({'width': 760, 'height': 900})
        page.wait_for_timeout(400)
        m = page.evaluate(JS_LAYOUT)
        ctx.shot('narrow-760-light')
        page.set_viewport_size({'width': 320, 'height': 640})
        page.wait_for_timeout(400)
        notes, ok320, param, stacked = [], True, [1, 0], ''
        for key in ('data', 'fit', 'sequence', 'model'):
            tab(page, key)
            page.wait_for_timeout(200)
            if key == 'model':
                set_detail(page, 'radius')
                page.locator('#sfPdToggle_radius').dispatch_event('click')
                page.wait_for_selector('#sfPdWidth_radius')
                param = page.evaluate(JS_WRAPPER, 'sfParamWrapper')
                stacked = page.evaluate("() => getComputedStyle(document.querySelector('#sfParamBody .sf-param-row')).display")
            p = page.evaluate(JS_LAYOUT)
            ok320 = ok320 and p['pageOverflow'] <= 0 and p['bodyOverflow'] <= 0
            notes.append(f"{key} {p['pageOverflow']} px")
        page.focus('#sfUpper_radius')                         # a field below the sticky plot must not be scrolled under it
        seen = page.evaluate("""() => { const f = document.activeElement.getBoundingClientRect(), p = document.querySelector('.sf-plots').getBoundingClientRect();
            return { top: Math.round(f.top), plotBottom: Math.round(p.bottom), sticky: getComputedStyle(document.querySelector('.sf-plots')).position }; }""")
        ok320 = ok320 and seen['sticky'] == 'sticky' and seen['top'] >= seen['plotBottom'] - 1
        notes.append(f"focused field top {seen['top']} px, below the {seen['sticky']} plot (bottom {seen['plotBottom']} px)")
        page.locator('#sfPdToggle_radius').dispatch_event('click')
        set_detail(page, 'radius', False)
        tab(page, 'data')
        page.set_viewport_size({'width': 1440, 'height': 900})
        ok = (m['columns'] == 1 and m['pageOverflow'] <= 0 and m['bodyOverflow'] <= 0 and ok320 and param[0] <= param[1] and stacked == 'grid')
        return ok, (f"760x900: grid columns={m['columns']}, page overflow={m['pageOverflow']} px; 320x640 page overflow per tab: {', '.join(notes)}; "
                    f"parameter table at 320 (detail row + dispersity open): scrollWidth/clientWidth={param[0]}/{param[1]}, rows stacked (display {stacked})")
    ctx.check('18 narrow viewports: single column at 760; no page-level horizontal overflow at 760 and 320 (parameter rows stacked at 320)', run)


def check_persistence(ctx):
    def run():
        page = ctx.page
        page.fill('#sfConditionName', 'ZZZ-condition')
        page.select_option('#sfQUnit', 'nm')
        page.fill('#sfStaggerDecades', '3')
        tab(page, 'model')
        page.fill('#sfValue_radius', '77')
        set_detail(page, 'radius')
        page.fill('#sfUpper_radius', '8888')
        page.wait_for_timeout(800)
        stored = page.evaluate('() => JSON.stringify(Object.assign({}, localStorage))')
        leaked = [s for s in ('ZZZ-condition', '8888', '"77"') if s in stored]
        fresh(page)
        v = page.evaluate("""() => ({ cond: document.getElementById('sfConditionName').value, unit: document.getElementById('sfQUnit').value,
            dec: document.getElementById('sfStaggerDecades').value, search: document.getElementById('sfModelSearch') === null,
            radius: document.getElementById('sfValue_radius').value })""")
        ok = not leaked and v['cond'] == '條件' and v['unit'] == 'A' and v['dec'] == '1' and v['search'] and v['radius'] != '77'
        return ok, f'after reload: {v}; typed strings found in localStorage: {leaked or "none"}'
    ctx.check('15 form persistence exclusion: typed values are neither stored nor restored after reload', run)


# ----------------------------------------------------------------- 11: axe

def inject_axe(ctx):
    try:
        ctx.page.add_script_tag(url=AXE_URL)
        ctx.page.wait_for_function('() => typeof axe !== "undefined" && !!axe.version', timeout=15_000)
        ctx.axe_version = ctx.page.evaluate('() => axe.version')
        ctx.axe_error = None
    except PwError as err:
        ctx.axe_error = f'could not load axe from {AXE_URL}: {str(err).splitlines()[0][:200]}'


def run_axe(ctx, scope='section'):
    """scope: 'section', 'page', or a CSS selector (or a list of them) to limit axe to."""
    return ctx.page.evaluate(JS_AXE, [scope, AXE_TAGS])


def describe(violations, only_mine=False):
    lines = []
    for v in violations:
        for n in v['nodes']:
            if only_mine and not n['mine']:
                continue
            lines.append(f"        {v['id']} [{v['impact']}] target={n['target']} :: {n['summary']}")
    return lines


def axe_check(ctx, name, scope):
    def run():
        if ctx.axe_error:
            return False, ctx.axe_error
        violations = run_axe(ctx, scope)
        mine = [(v, n) for v in violations for n in v['nodes'] if scope == 'section' or n['mine']]
        detail = f'{len(mine)} violation node(s) inside #section-sasfit / its nav button ({len({v["id"] for v, _ in mine})} rule(s))'
        if scope == 'page':
            outside = [(v, n) for v in violations for n in v['nodes'] if not n['mine']]
            detail += f'; outside the section (information only, not failing): {len(outside)} node(s), rules {sorted({v["id"] for v, _ in outside})}'
            ctx.page_outside = describe(violations)
        detail += ''.join('\n' + line for line in describe(violations, only_mine=scope == 'page'))
        return not mine, detail
    return ctx.check(name, run)


def prep_empty(ctx):
    ctx.page.wait_for_timeout(600)


def prep_data(ctx):
    load_files(ctx.page, FIVE)
    ctx.page.wait_for_timeout(500)


def prep_model(ctx):
    page = ctx.page
    pick_model(page, 'sphere')
    set_detail(page, 'radius')
    page.click('#sfPdToggle_radius')
    set_detail(page, 'sld')
    page.click('#sfSldBtn_sld')
    page.wait_for_selector('#sfSldSlot_sld:not([hidden]) #sfSldPreset')
    page.select_option('#sfSldPreset', 'water')
    page.wait_for_timeout(500)


def prep_fit(ctx):
    page = ctx.page
    page.keyboard.press('Escape')                             # closes the formula panel of the state before
    fit_sphere(page)
    page.wait_for_timeout(600)


def prep_bad_fit(ctx):
    """A fit that converges far from the data: hints under the hero tile, a doubtful status chip, a stale-free result."""
    page = ctx.page
    pick_model(page, 'sphere')
    page.fill('#sfValue_radius', '80')
    tab(page, 'fit')
    page.click('#sfRangeDefault')
    page.wait_for_function('() => !document.getElementById("sfFitStart").disabled')
    page.click('#sfFitStart')
    page.wait_for_function('() => /偏大/.test(document.getElementById("sfFitMeasure").textContent)', timeout=15_000)
    page.wait_for_function('() => document.getElementById("sfFitHints").children.length > 0', timeout=5_000)
    page.wait_for_timeout(500)


def prep_stale(ctx):
    """The result of the state before with a parameter changed since, on the model tab with a value error."""
    page = ctx.page
    tab(page, 'model')
    page.fill('#sfValue_radius', '70')
    set_detail(page, 'scale')
    page.fill('#sfLower_scale', 'x')
    tab(page, 'fit')
    page.wait_for_timeout(500)


def check_axe(ctx):
    """The page is reloaded first; states in order, each in light then dark; one whole-page pass at the end."""
    page = ctx.page
    fresh(page)
    inject_axe(ctx)
    if ctx.axe_error:
        print('      ' + ctx.axe_error)
    states = (('empty', 'empty page', prep_empty), ('data', 'data loaded (data tab)', prep_data),
              ('model', 'model tab, detail rows open with dispersity + SLD panel', prep_model), ('fit', 'fit tab with a good result', prep_fit),
              ('badfit', 'fit tab, bad fit with hints under the hero tile', prep_bad_fit),
              ('stale', 'fit tab, stale result + field error (fit bar says why it cannot start)', prep_stale))
    for key, text, prep in states:
        prep(ctx)
        if key in ('fit', 'badfit'):
            print('      fit hints shown: ' + str(page.evaluate('() => document.getElementById("sfFitHints").children.length')))
        for theme in ('light', 'dark'):
            ctx.theme(theme)
            ctx.shot(f'axe-{key}-{theme}')
            axe_check(ctx, f'11 axe wcag2a/2aa/21a/21aa, {text}, {theme}', 'section')
    for theme in ('light', 'dark'):
        ctx.theme(theme)
        axe_check(ctx, f'11 axe whole-page pass (information; section nodes still fail), fit state, {theme}', 'page')
        print('      whole-page violations (all nodes, for information):')
        for line in ctx.page_outside[:40]:
            print(line)
    ctx.theme('light')
    axe_control(ctx)


def axe_control(ctx):
    """Negative control: axe must flag a deliberately bad element, otherwise "0 violations" above means nothing."""
    def run():
        if ctx.axe_error:
            return False, ctx.axe_error
        ctx.page.evaluate("() => { const i = document.createElement('img'); i.id = 'axeControl'; i.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; "
                          "document.getElementById('section-sasfit').appendChild(i); }")
        ids = [v['id'] for v in run_axe(ctx, 'section')]
        ctx.page.evaluate("() => document.getElementById('axeControl').remove()")
        return 'image-alt' in ids, f'axe {getattr(ctx, "axe_version", "?")}: img without alt inside the section reported as {ids}'
    ctx.check('11 axe negative control (a deliberately bad element is detected)', run)


# ----------------------------------------------------------------- Worker request versions, dark-scheme flow

def entries_since(mark):
    with sb.LoggingHandler.log_lock:
        return list(sb.LoggingHandler.log[mark:])


def check_versions(ctx, mark):
    def run():
        footer = ctx.page.evaluate(sb.JS_FOOTER_VERSION)
        entries = [e for e in entries_since(mark) if e['path'].endswith(sb.WORKER_SCRIPT) or sb.WORKER_SCRIPT in e['referer']]
        script = [e for e in entries if e['path'].endswith(sb.WORKER_SCRIPT)]
        wasm = [e for e in entries if e['path'].endswith('.wasm')]
        modules = [e for e in entries if e['path'].endswith('.js') and not e['path'].endswith(sb.WORKER_SCRIPT)]
        bad = [e['raw'] for e in entries if e['query'].get('v') != [footer]]
        ok = bool(footer) and bool(script) and bool(wasm) and bool(modules) and not bad
        return ok, (f'footer version={footer!r}; worker starts={len(script)}, importScripts modules={len(modules)}, wasm requests={len(wasm)} '
                    f'({sorted({Path(e["path"]).name for e in wasm})}); without matching ?v=: {bad or "none"}')
    ctx.check('17 every Worker / importScripts / wasm request carries ?v=<footer version> (server log)', run)


def dark_scheme_flow(ctx):
    def run():
        page = ctx.page
        open_section(page)
        load_files(page, SYNTH)
        dark0 = palette(page, 'dark')
        border = page.evaluate('() => __ui.activeData().borderColor')
        ctx.shot('dark-scheme-data')
        fit_sphere(page)
        t = page.evaluate(JS_TILES)
        ctx.shot('dark-scheme-fit')
        ok = border == dark0 and t['radius'] is not None and abs(t['radius'] - 50) < 0.5 and '已收斂' in (t['heroText'] or '')
        return ok, f"colour-scheme dark: data borderColor={border} (palette.dark.series[0]={dark0}); fit radius={t['radius']} chi2r={t['chi2r']} {t['rowStatus']!r}"
    ctx.check('20 prefers-color-scheme dark: page loads, data/charts use the dark palette, fit converges', run)


# ----------------------------------------------------------------- driver

def console_check(ctx, label):
    sb.check_console(ctx.report, label, ctx.messages, ctx.errors)


def make_ctx(browser, base_url, report, scheme):
    context, page, messages, errors = sb.open_page(browser, base_url, scheme)
    page.set_viewport_size({'width': DESKTOP[0], 'height': DESKTOP[1]})
    page.add_init_script(JS_HELPERS)
    page.evaluate(JS_HELPERS)
    return context, Ctx(report, page, messages, errors, base_url, scheme)


def run_light(browser, base_url, report, shots):
    mark = len(sb.LoggingHandler.log)
    context, ctx = make_ctx(browser, base_url, report, 'light')
    try:
        check_no_worker_before_open(ctx, mark)
        check_open_section(ctx)
        ctx.shot('empty-light')
        check_data(ctx)
        check_preview(ctx)
        check_fit(ctx)
        me = sys.modules[__name__]
        passb.check_curve_style(ctx, me)
        check_modes(ctx)
        check_theme(ctx)
        passb.check_wheel(ctx, me)
        passb.check_fit_bar(ctx, me)
        passb.check_focus_and_stop(ctx, me)
        check_paused(ctx)
        check_hayter(ctx)
        passb.check_detail_rows(ctx, me)
        check_error_path(ctx)
        check_measurements(ctx)
        passb.check_undo(ctx, me)
        fresh(ctx.page)
        load_files(ctx.page, FIVE)
        check_keyboard(ctx)
        check_layout(ctx)
        check_overflow(ctx)
        check_narrow(ctx)
        check_persistence(ctx)
        check_axe(ctx)
        check_versions(ctx, mark)
        console_check(ctx, '1b no console error / pageerror in the whole light run')
    finally:
        shots.extend(ctx.shots)
        context.close()


def run_dark(browser, base_url, report, shots):
    context, ctx = make_ctx(browser, base_url, report, 'dark')
    try:
        dark_scheme_flow(ctx)
        console_check(ctx, '1c no console error / pageerror in the dark colour-scheme run')
    finally:
        shots.extend(ctx.shots)
        context.close()


def run_all(base_url):
    report, shots = sb.Report(), []
    SHOTS.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            run_light(browser, base_url, report, shots)
            run_dark(browser, base_url, report, shots)
        finally:
            browser.close()
    print('screenshots:')
    for path in sorted(set(shots)):
        print('  ' + path)
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
        print(f'FAIL  UI smoke test aborted: {type(err).__name__}: {err}')
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
