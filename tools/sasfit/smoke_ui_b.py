"""Checks of the UI smoke test added with fix pass B (UI review of 2026-11-19): zoom gestures, the model
curve's own colour over hollow points, the fit bar on every tab, focus during a fit, undo of a removal and
the detail rows of the parameter table.

No entry point: tools/sasfit/smoke_ui.py imports this module and calls the checks with its Ctx and with
itself as `ui` (its page helpers). Split off to keep both files readable.
"""
import time

JS_SCROLL_Y = '() => Math.round(window.scrollY)'
JS_ZOOMED = '() => __ui.chart("sfMainChart").isZoomedOrPanned()'
JS_ACTIVE = '() => document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null'

JS_STYLE = """() => {
  const c = __ui.curve(), d = __ui.activeData(), chart = __ui.chart('sfMainChart');
  const theme = ChartTheme.palette();
  const legend = chart.legend.legendItems.map((i) => i.text);
  const others = __ui.datasets('sfMainChart').filter((x) => x.sfKind === 'data' && x.sfId !== __ui.activeId());
  return { curve: c.borderColor, curveWidth: c.borderWidth, data: d.borderColor, fill: d.backgroundColor, radius: d.pointRadius,
           otherRadius: others.length ? others[0].pointRadius : null, modelCurve: theme.modelCurve, series0: theme.series[0],
           legend, lines: Object.keys(chart.options.plugins.annotation.annotations).filter((k) => /Line$/.test(k)).length };
}"""

JS_BAR = """() => {
  const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { top: b.top, bottom: b.bottom, w: b.width, h: b.height }; };
  const start = document.getElementById('sfFitStart');
  return { bar: r('sfFitBar'), start: r('sfFitStart'), vh: window.innerHeight, disabled: start.disabled,
           inPanel: !!start.closest('[role=tabpanel]'), summary: document.getElementById('sfFitSummary').textContent,
           measure: document.getElementById('sfFitMeasure').textContent.replace(/\\s+/g, ' ').trim() };
}"""

JS_DETAIL = """(name) => {
  const b = document.getElementById('sfMore_' + name), row = document.getElementById('sfDetail_' + name);
  return { expanded: b.getAttribute('aria-expanded'), controls: b.getAttribute('aria-controls'), rowId: row ? row.id : null,
           hidden: row ? row.hidden : null, lower: !!document.getElementById('sfLower_' + name),
           marker: document.getElementById('sfMark_' + name).textContent };
}"""


def chart_point(page, fx=0.45, fy=0.5):
    canvas = page.locator('#sfMainChart')
    canvas.scroll_into_view_if_needed()
    box = canvas.bounding_box()
    return box['x'] + box['width'] * fx, box['y'] + box['height'] * fy


def check_curve_style(ctx, ui):
    """After a fit of the active file: the model curve must not have the colour of its data."""
    def run():
        page = ctx.page
        notes, ok = [], True
        for theme in ('light', 'dark'):
            ctx.theme(theme)
            s = page.evaluate(JS_STYLE)
            hollow = isinstance(s['fill'], str) and s['fill'].replace(' ', '') in ('rgba(0,0,0,0)', 'transparent')
            good = (s['curve'] == s['modelCurve'] and s['curve'] != s['data'] and s['data'] == s['series0'] and hollow
                    and s['radius'] == 2 and s['otherRadius'] == 1.5 and s['curveWidth'] == 2 and '模型' in s['legend'] and s['lines'] == 2)
            ok = ok and good
            notes.append(f"{theme}: curve={s['curve']} (palette.modelCurve={s['modelCurve']}) data border={s['data']} fill={s['fill']} "
                         f"radius active/other={s['radius']}/{s['otherRadius']} curve width={s['curveWidth']} legend={s['legend']} range lines={s['lines']}")
        ctx.theme('light')
        return ok, ' | '.join(notes)
    ctx.check('21 active model curve: its own colour (not the data colour), 2 px, hollow points r=2/1.5, legend 模型, range lines; both themes', run)


def check_wheel(ctx, ui):
    def run():
        page = ctx.page
        ui.tab(page, 'model')
        ui.pick_model(page, 'core_shell_cylinder')          # a long parameter table: the page can scroll
        page.evaluate('() => window.scrollTo(0, 0)')
        page.click('#sfModeLogLog')
        page.wait_for_timeout(300)
        reset0 = page.is_disabled('#sfResetZoom')
        x, y = chart_point(page)
        page.evaluate('() => window.scrollTo(0, 0)')
        page.mouse.move(x, y)
        before = page.evaluate(ui.JS_RANGES)
        for _ in range(3):
            page.mouse.wheel(0, 200)
            page.wait_for_timeout(120)
        scrolled = page.evaluate(JS_SCROLL_Y)
        zoomed_plain = page.evaluate(JS_ZOOMED)
        same = page.evaluate(ui.JS_RANGES)['main'] == before['main']
        page.evaluate('() => window.scrollTo(0, 0)')
        x, y = chart_point(page)
        page.mouse.move(x, y)
        page.keyboard.down('Control')
        for _ in range(3):
            page.mouse.wheel(0, -300)
            page.wait_for_timeout(120)
        page.keyboard.up('Control')
        page.wait_for_timeout(500)
        zoomed_ctrl = page.evaluate(JS_ZOOMED)
        scrolled_ctrl = page.evaluate(JS_SCROLL_Y)
        status = page.inner_text('#sfPlotStatus')
        reset1 = page.is_disabled('#sfResetZoom')
        page.click('#sfResetZoom')
        page.wait_for_timeout(400)
        reset2 = page.is_disabled('#sfResetZoom')
        focus = page.evaluate(JS_ACTIVE)
        ui.pick_model(page, 'sphere')
        ok = (reset0 and scrolled > 0 and not zoomed_plain and same and zoomed_ctrl and scrolled_ctrl == 0 and '已縮放' in status
              and not reset1 and reset2 and '已縮放' not in page.inner_text('#sfPlotStatus') and focus == 'sfModeLogLog')
        return ok, (f'plain wheel over the plot: page scrollY 0 -> {scrolled}, chart zoomed={zoomed_plain}, x range unchanged={same}; '
                    f'Ctrl+wheel: zoomed={zoomed_ctrl}, page scrollY={scrolled_ctrl}, status={status!r}; '
                    f'reset button disabled before/zoomed/after reset={reset0}/{reset1}/{reset2}; focus after reset={focus}')
    ctx.check('22 plain wheel over the sticky plot scrolls the page; Ctrl+wheel zooms; 重設縮放 enabled only while zoomed', run)


def check_fit_bar(ctx, ui):
    """Needs data and a fittable form; ends on the fit tab with a result."""
    def run():
        page = ctx.page
        notes, ok = [], True
        for key in ('data', 'model', 'fit'):
            ui.tab(page, key)
            page.evaluate('() => window.scrollTo(0, 0)')
            page.wait_for_timeout(150)
            b = page.evaluate(JS_BAR)
            visible = b['bar']['h'] > 0 and b['start']['top'] >= 0 and b['start']['bottom'] <= b['vh'] and b['start']['w'] > 0
            good = visible and not b['disabled'] and not b['inPanel'] and '擬合 scale' in b['summary']
            ok = ok and good
            notes.append(f"{key}: bar visible={visible} start enabled={not b['disabled']} summary={b['summary']!r}")
        ui.tab(page, 'model')                                 # operable where the parameters are
        page.fill('#sfValue_radius', '52')
        page.check('#sfFit_radius')
        page.wait_for_function('() => /radius$/.test(document.getElementById("sfFitSummary").textContent)')
        page.evaluate('() => { document.getElementById("sfFitLive").textContent = ""; }')
        page.click('#sfFitStart')
        page.wait_for_function('() => /擬合結束/.test(document.getElementById("sfFitLive").textContent)', timeout=15_000)
        b = page.evaluate(JS_BAR)
        pm = page.inner_text('#sfPm_radius')
        focus = page.evaluate(JS_ACTIVE)
        ok = ok and '已收斂' in b['measure'] and pm.startswith('±') and focus == 'sfFitStart'
        notes.append(f"fit started from the model tab: bar measure={b['measure']!r}; ± of radius next to its value={pm!r}; focus={focus}")
        page.fill('#sfValue_radius', '57')
        page.wait_for_timeout(300)
        stale = page.evaluate(JS_BAR)['measure']
        ok = ok and '參數已改動' in stale
        notes.append(f'after editing radius the bar says {stale!r}')
        return ok, ' | '.join(notes)
    ctx.check('23 fit bar: visible and enabled on all three tabs, names the free parameters; a fit runs from the model tab; stale result flagged', run)


def check_focus_and_stop(ctx, ui):
    """A slow fit: focus goes to Stop when it starts and back to Start once it has stopped."""
    def run():
        page = ctx.page
        ui.pick_model(page, 'cylinder')
        for name in ('radius', 'length'):
            ui.set_detail(page, name)
            page.click(f'#sfPdToggle_{name}')
            page.fill(f'#sfPdWidth_{name}', '0.2')
        for name in ('scale', 'radius', 'length'):
            page.check(f'#sfFit_{name}')
        page.wait_for_function('() => !document.getElementById("sfFitStart").disabled', timeout=10_000)
        page.focus('#sfFitStart')
        page.keyboard.press('Enter')
        page.wait_for_function('() => !document.getElementById("sfFitStop").disabled', timeout=5_000)
        focus_running = page.evaluate(JS_ACTIVE)
        lock = page.evaluate('() => [document.getElementById("sfModelLock").hidden, getComputedStyle(document.getElementById("sfValue_radius")).opacity]')
        page.wait_for_timeout(1300)
        progress = page.inner_text('#sfFitProgress')
        t0 = time.time()
        page.keyboard.press('Enter')                          # the focus is on Stop
        page.wait_for_function('() => /已停止/.test(document.getElementById("sfFitProgress").textContent)', timeout=1000)
        stop_ms = (time.time() - t0) * 1000
        page.wait_for_function('() => !document.getElementById("sfFitStart").disabled', timeout=5_000)
        focus_after = page.evaluate(JS_ACTIVE)
        text = page.inner_text('#sfFitProgress')
        before = ui.curve_sig(page)
        current = float(page.input_value('#sfValue_radius'))
        page.fill('#sfValue_radius', f'{current + 3:g}')
        t1 = time.time()
        ui.wait_curve_change(page, before, 20_000)
        ok = (focus_running == 'sfFitStop' and focus_after == 'sfFitStart' and lock[0] is False and float(lock[1]) < 1
              and '正在擬合 cylinder' in progress)
        return ok, (f'focus while running={focus_running}, after stop={focus_after}; lock notice shown={lock[0] is False}, disabled input opacity={lock[1]}; '
                    f'progress while running={progress!r}; 已停止 {stop_ms:.0f} ms after Enter on Stop ({text.strip()!r}); '
                    f'preview updated {(time.time() - t1) * 1000:.0f} ms after changing radius')
    ctx.check('5 slow cylinder fit (two PDs): focus on Stop while running, elapsed time shown, stops within 1 s, focus back on Start; preview still works', run)


def check_detail_rows(ctx, ui):
    def run():
        page = ctx.page
        ui.pick_model(page, 'sphere')
        notes = []
        ui.set_detail(page, 'radius', False)
        a = page.evaluate(JS_DETAIL, 'radius')
        page.click('#sfMore_radius')
        b = page.evaluate(JS_DETAIL, 'radius')
        focus = page.evaluate(JS_ACTIVE)
        page.fill('#sfUpper_radius', '45x')
        page.wait_for_timeout(150)
        err = page.inner_text('#sfErr_radius_upper')
        page.click('#sfMore_radius')                          # must not close: the message is inside
        forced = page.evaluate(JS_DETAIL, 'radius')
        page.fill('#sfUpper_radius', '95')
        page.click('#sfMore_radius')
        c = page.evaluate(JS_DETAIL, 'radius')
        page.fill('#sfValue_radius', 'abc')
        page.wait_for_timeout(150)
        line = page.evaluate("""() => { const r = document.getElementById('sfErrRow_radius'), t = document.querySelector('.sf-param-table');
            return { hidden: r.hidden, w: r.getBoundingClientRect().width, tw: t.getBoundingClientRect().width, text: r.textContent.trim() }; }""")
        status = page.inner_text('#sfPlotStatus')
        page.fill('#sfValue_radius', '50')
        page.click('#sfMore_radius')
        page.fill('#sfUpper_radius', '')
        page.click('#sfMore_radius')
        d = page.evaluate(JS_DETAIL, 'radius')
        ok = (a['expanded'] == 'false' and a['hidden'] and not a['lower'] and a['controls'] == a['rowId']
              and b['expanded'] == 'true' and not b['hidden'] and b['lower'] and focus == 'sfMore_radius'
              and '上限' in err and forced['expanded'] == 'true'
              and c['expanded'] == 'false' and c['marker'] == '0–95'
              and not line['hidden'] and line['w'] > 0.9 * line['tw'] and '曲線尚未更新' in status and d['marker'] == '')
        notes.append(f"closed: aria-expanded={a['expanded']} row hidden={a['hidden']} controls={a['controls']}; opened: {b['expanded']}, focus stays on {focus}")
        notes.append(f"bound error {err!r} keeps the row open (aria-expanded={forced['expanded']}); corrected and closed: marker={c['marker']!r}")
        notes.append(f"value error line: width {line['w']:.0f} of table {line['tw']:.0f} px, text={line['text']!r}; plot status={status!r}")
        return ok, ' | '.join(notes)
    ctx.check('24 parameter detail row: aria-expanded/controls, opens and closes, stays open on a field error, marker when collapsed, full-width value error', run)


def check_undo(ctx, ui):
    """Own page state: reloads, loads the three synthetic files, fits the first."""
    def run():
        page = ctx.page
        ui.fresh(page)
        ui.load_files(page, ui.SYNTH)
        ui.fit_sphere(page)
        ui.tab(page, 'data')
        rows = lambda: page.evaluate("() => [...document.querySelectorAll('#sfDataBody tr.sf-file-row')].map((r) => r.dataset.id)")
        first = rows()
        active = page.evaluate('() => SasFitSection.getState().activeId')
        page.click(f'#sfRemove_{active}')
        page.wait_for_selector('#sfUndo:not([hidden])')
        text = page.inner_text('#sfUndoText')
        gone = rows()
        had = page.evaluate('(id) => id in SasFitSection.getState().fitResults', active)
        page.click('#sfUndoBtn')
        page.wait_for_selector('#sfUndo', state='hidden')
        back = rows()
        s = page.evaluate("""(id) => { const st = SasFitSection.getState(); const row = document.querySelector('#sfDataBody tr.is-active .sf-file-status');
            return { active: st.activeId, result: id in st.fitResults, status: row ? row.textContent.replace(/\\s+/g, ' ').trim() : null,
                     residuals: __ui.datasets('sfResidualChart').reduce((n, d) => n + d.data.length, 0) }; }""", active)
        ok = (active not in gone and not had and back == first and s['active'] == active and s['result'] and '已收斂' in (s['status'] or '')
              and s['residuals'] > 0 and 'SYNTH_sphere_10.dat' in text)
        return ok, (f'removed {active}: rows {first} -> {gone}, strip {text!r}; undo: rows {back}, active={s["active"]}, fit result restored={s["result"]}, '
                    f'row status={s["status"]!r}, residual points drawn again={s["residuals"]}')
    ctx.check('25 undo after remove restores the file at its place, as the fit target, with its fit result', run)
