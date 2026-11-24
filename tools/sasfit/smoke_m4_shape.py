"""The 3D-sketch and plot-column checks of smoke_m4.py (v5.8: the sketch is a card under the curves, no switch).

Imported by smoke_m4.py (which sets sys.dont_write_bytecode first); the page-side scripts are in smoke_m4_js.py.
Every check returns through check(ctx, name, fn): fn() -> (ok, detail), a missing value is a FAIL, not a crash.
"""
import statistics
import time

import smoke_m4_js as js
import smoke_ui as su

VIEWPORTS = ((1440, 900), (1280, 800), (1024, 768), (760, 900), (320, 640))
TWO_COLUMN = VIEWPORTS[:3]


def check(ctx, name, fn):
    """ctx.check, with the errors of reading a result that is not there (a check after a failed one) turned into a FAIL."""
    def run():
        try:
            return fn()
        except (IndexError, AttributeError, StopIteration, ZeroDivisionError) as err:
            raise AssertionError(f'{type(err).__name__}: {err}') from err
    return ctx.check(name, run)


def viewport(page, size, wait=400):
    page.set_viewport_size({'width': size[0], 'height': size[1]})
    page.wait_for_timeout(wait)


def to_stage(page, settle=400):
    """Scroll the 3D stage into the middle of the viewport (it is painted only while it is on screen)."""
    page.evaluate("() => document.getElementById('sfShapeStage').scrollIntoView({ block: 'center', behavior: 'instant' })")
    page.wait_for_timeout(settle)


def to_top(page, settle=400):
    page.evaluate("() => window.scrollTo({ top: 0, behavior: 'instant' })")      # the page has scroll-behavior: smooth
    page.wait_for_timeout(settle)


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


def type_value(page, name, value):
    """Type a parameter value without scrolling the page (page.fill scrolls the field into view)."""
    page.locator(f'#sfValue_{name}').evaluate("(e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); "
                                               "e.dispatchEvent(new Event('change', { bubbles: true })); }", value)


def long_column(page):
    """core_shell_cylinder with hayter_msa: the longest parameter table, so the control column is much longer than the plots."""
    su.pick_model(page, 'core_shell_cylinder')
    page.select_option('#sfStructure', 'hayter_msa')
    page.wait_for_timeout(400)


def plain_sphere(page):
    su.pick_model(page, 'sphere')
    page.select_option('#sfStructure', '')
    page.wait_for_timeout(300)


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
            su.tab(page, 'fit')
            page.wait_for_timeout(300)
            col = page.evaluate(js.JS_COLUMN)
            sticky = col['curvePosition'] == ('sticky' if size in TWO_COLUMN else 'static')
            good = (good and col['overflowX'] <= 0 and not col['nested'] and col['shown'] == [True, True, True] and not col['toggle'] and sticky
                    and col['curve'][1] <= col['shape'][0])
            to_stage(page)
            measured['canvas'].append((size, page.evaluate(js.JS_LAYOUT)['main'], page.evaluate(js.JS_LAYOUT)['shape']))
            to_top(page, 150)
            ok = ok and good
            notes.append(f"{size[0]}x{size[1]}: page overflow {col['overflowX']} px, nested scrollers {col['nested'] or 'none'}, "
                         f"curve card {col['curve'][2]} px ({col['curvePosition']}) then 3D card {col['shape'][2]} px, "
                         f"#sfSeqWrapper {seq['wrapper'][0]}/{seq['wrapper'][1]}, tabs on {len(set(seq['tabTops']))} line(s)" + ('' if good else '  <-- FAIL'))
        viewport(page, su.DESKTOP)
        return ok, ' | '.join(notes)
    check(ctx, '12 layout: curve card and 3D card both shown (no switch), nothing in the plot column scrolls by itself, no page-level horizontal '
               'overflow at five widths; the curve card is sticky in two columns only; the sequence table scrolls only inside #sfSeqWrapper', run)


def scroll_steps(page, steps):
    seen = []
    for y in steps:
        page.evaluate(f"() => window.scrollTo({{ top: {y}, behavior: 'instant' }})")
        page.wait_for_timeout(120)
        seen.append(page.evaluate(js.JS_COLUMN))
    return seen


def check_scroll(ctx, measured):
    """Scroll-behaviour evidence: with a long control column the curve card stays at the top, then the 3D card pushes it away."""
    def run():
        page, notes, ok = ctx.page, [], True
        long_column(page)
        for size in TWO_COLUMN:
            viewport(page, size)
            height = page.evaluate('() => document.documentElement.scrollHeight - window.innerHeight')
            seen = scroll_steps(page, range(0, height + 100, 100))
            top = seen[0]['stickyTop']
            stuck = [s['scrollY'] for s in seen if abs(s['curve'][0] - top) <= 1]
            apart = all(s['curve'][1] <= s['shape'][0] for s in seen)
            pushed = seen[-1]['curve'][0] < top - 1 and seen[-1]['shape'][1] <= seen[-1]['innerHeight'] + 1
            good = len(stuck) >= 3 and apart and pushed and not any(s['nested'] for s in seen)
            ok = ok and good
            measured['scroll'].append((size, [(s['scrollY'], s['curve'][0], s['shape'][0]) for s in seen]))
            notes.append(f"{size[0]}x{size[1]}: page scrolls {height} px; curve card held at top {top:.1f} px for scrollY "
                         f"{stuck[0] if stuck else '-'}–{stuck[-1] if stuck else '-'}; cards never overlap={apart}; at the bottom the curve card top is "
                         f"{seen[-1]['curve'][0]} px and the 3D card ends at {seen[-1]['shape'][1]} of {seen[-1]['innerHeight']} px" + ('' if good else '  <-- FAIL'))
        viewport(page, su.DESKTOP)
        to_top(page, 150)
        plain_sphere(page)
        return ok, ' | '.join(notes)
    check(ctx, '12b scrolling (core_shell_cylinder + hayter_msa, the longest control column): the curve card sticks at the top while the control column '
               'goes on, the 3D card follows it without ever overlapping it, the page (not the column) scrolls', run)


# ----------------------------------------------------------------- 7, 8: the sketch

def check_shape_view(ctx):
    def run():
        page, notes = ctx.page, []
        su.tab(page, 'model')
        plain_sphere(page)
        to_stage(page)
        first = shape(page, 400)
        col = page.evaluate(js.JS_COLUMN)
        spin_enabled = page.evaluate("() => !document.getElementById('sfShapeSpin').disabled")
        ok = first['painted'] > 500 and col['shown'] == [True, True, True] and not col['toggle']
        notes.append(f"curve card and 3D card shown together {col['shown']}, canvas {first['size'][0]}x{first['size'][1]}, "
                     f"painted pixels {first['painted']} ({first['colours']} colours)")
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
            to_stage(page, 100)
            m, bar = shape(page, 500), page.evaluate(js.JS_BAR_LABEL)
            sized[radius] = (m, bar, m['width'] / m['bar'] * bar['nm'] if m['bar'] and bar else 0)
        (m50, b50, d50), (m100, b100, d100) = sized['50'], sized['100']
        ok = (ok and m50['hash'] != m100['hash'] and (b50['label'] != b100['label'] or abs(m50['bar'] - m100['bar']) > 1)
              and abs(d50 - 10) < 0.5 and abs(d100 - 20) < 1)
        notes.append(f"radius 50: bar {b50['label']} = {m50['bar']:.0f} px, sphere {m50['width']:.0f} px = {d50:.2f} nm; "
                     f"radius 100: bar {b100['label']} = {m100['bar']:.0f} px, sphere {m100['width']:.0f} px = {d100:.2f} nm")
        su.pick_model(page, 'core_shell_sphere')
        to_stage(page)
        both, hues = two_hues(shape(page, 500)['hues'])
        ok = ok and both
        notes.append(f'core_shell_sphere: hue bins with >= 100 pixels at {hues} degrees')
        su.pick_model(page, 'flexible_cylinder')
        to_stage(page)
        chain, status = shape(page, 500), page.inner_text('#sfShapeStatus')
        ok = ok and chain['painted'] > 500 and '代表性構形' in status
        notes.append(f"flexible_cylinder: painted {chain['painted']}, status {status!r}")
        su.pick_model(page, 'guinier')
        page.wait_for_timeout(400)
        none = page.evaluate("() => [document.getElementById('sfShapeStatus').innerText, document.getElementById('sfShapeStage').getClientRects().length, "
                             "Math.round(document.getElementById('sfShapeCard').getBoundingClientRect().height), "
                             "Chart.getChart('sfMainChart').data.datasets.filter((d) => d.sfKind === 'data' && d.data.length > 0).length]")
        ok = ok and none[0] == '此模型沒有固定形狀' and none[1] == 0 and none[2] < 140 and none[3] > 0
        notes.append(f"guinier: the 3D card is one line {none[0]!r} ({none[2]} px tall, stage shown={none[1] > 0}); the curve chart still has {none[3]} data sets")
        plain_sphere(page)
        to_top(page, 150)
        ctx.spin_enabled = spin_enabled
        return ok, '; '.join(notes)
    check(ctx, '7 3D sketch under the curves: both cards at once, canvas painted, drag repaints, radius 50 -> 100 changes the scale bar (to scale), '
               'core and shell in two hues, flexible cylinder noted as one conformation, a shape-less model collapses to one line', run)


def check_shape_keys(ctx, measured):
    def run():
        page, notes = ctx.page, []
        su.pick_model(page, 'core_shell_cylinder')           # the longest parameter table: the page can scroll
        to_stage(page)
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
        to_stage(page)
        home, before = shape(page), page.evaluate(js.JS_SCROLL)
        x, y = stage_centre(page)
        page.mouse.move(x, y)
        page.mouse.wheel(0, -240)                            # upwards: the stage may sit at the very bottom of the page
        page.wait_for_timeout(600)
        after = page.evaluate(js.JS_SCROLL)
        ok = ok and after[1] < before[1] and shape(page)['hash'] == home['hash']
        notes.append(f"plain wheel (up) over the stage: scrollY {before[1]} -> {after[1]}, canvas unchanged")
        to_stage(page)
        home, before = shape(page), page.evaluate(js.JS_SCROLL)
        x, y = stage_centre(page)
        page.mouse.move(x, y)
        page.keyboard.down('Control')
        page.mouse.wheel(0, -240)
        page.keyboard.up('Control')
        zoomed, after = shape(page, 400), page.evaluate(js.JS_SCROLL)
        ok = ok and zoomed['height'] > home['height'] + 2 and after[1] == before[1]
        notes.append(f"Ctrl + wheel: object height {home['height']:.0f} -> {zoomed['height']:.0f} px, scrollY {before[1]} -> {after[1]}")
        page.click('#sfShapeReset')
        plain_sphere(page)
        to_top(page, 150)
        return ok, '; '.join(notes)
    check(ctx, '8a 3D keyboard and wheel: arrow keys rotate without scrolling the page, + enlarges, a plain wheel over the stage scrolls the page, '
               'Ctrl + wheel zooms and does not scroll', run)


def check_offscreen(ctx):
    """No painting and no animation frame for the sketch while its stage is off screen; it catches up when it comes back."""
    def run():
        page, notes = ctx.page, []
        viewport(page, su.DESKTOP)
        long_column(page)                                    # the 3D card starts far below the fold
        page.evaluate(js.JS_COUNTERS)
        to_top(page, 600)
        col = page.evaluate(js.JS_COLUMN)
        off = col['stage'][0] > col['innerHeight']
        idle0 = page.evaluate(js.JS_COUNTS)
        page.wait_for_timeout(1000)
        idle1 = page.evaluate(js.JS_COUNTS)
        hash0 = page.evaluate(js.JS_SHAPE)['hash']
        type_value(page, 'radius', '35')
        page.wait_for_timeout(800)
        edit = page.evaluate(js.JS_COUNTS)
        hash1 = page.evaluate(js.JS_SHAPE)['hash']
        to_stage(page, 500)
        back = page.evaluate(js.JS_COUNTS)
        hash2 = page.evaluate(js.JS_SHAPE)['hash']
        ok = (off and idle1['frames'] == idle0['frames'] and idle1['paints'] == idle0['paints'] and edit['paints'] == idle0['paints']
              and hash1 == hash0 and back['paints'] == edit['paints'] + 1 and hash2 != hash1)
        notes.append(f"stage top {col['stage'][0]} px with a {col['innerHeight']} px viewport (off screen={off}); idle 1 s: "
                     f"{idle1['frames'] - idle0['frames']} animation frames, {idle1['paints'] - idle0['paints']} paints; radius edited off screen: "
                     f"{edit['paints'] - idle0['paints']} paints, canvas unchanged={hash1 == hash0}; scrolled into view: {back['paints'] - edit['paints']} paint, "
                     f"canvas changed={hash2 != hash1}")
        page.click('#sfShapeSpin')
        page.wait_for_timeout(500)
        spinning = page.evaluate(js.JS_COUNTS)
        page.wait_for_timeout(300)
        spun = page.evaluate(js.JS_COUNTS)
        to_top(page, 400)
        away0 = page.evaluate(js.JS_COUNTS)
        page.wait_for_timeout(800)
        away1 = page.evaluate(js.JS_COUNTS)
        to_stage(page, 500)
        resumed = page.evaluate(js.JS_COUNTS)
        page.click('#sfShapeSpin')
        page.click('#sfShapeReset')
        ok = ok and spun['paints'] > spinning['paints'] and away1['frames'] == away0['frames'] and away1['paints'] == away0['paints'] and resumed['paints'] > away1['paints']
        notes.append(f"auto-rotate on screen: {spun['paints'] - spinning['paints']} paints in 300 ms; scrolled away: {away1['frames'] - away0['frames']} frames, "
                     f"{away1['paints'] - away0['paints']} paints in 800 ms; back on screen: turning again ({resumed['paints'] - away1['paints']} paints)")
        type_value(page, 'radius', '20')
        plain_sphere(page)
        to_top(page, 150)
        return ok, '; '.join(notes)
    check(ctx, '15 off screen: idle = 0 animation frames, a parameter edit does not paint the hidden sketch, scrolling it into view paints it once; '
               'auto-rotate pauses off screen and goes on when it comes back', run)


# ----------------------------------------------------------------- 16: the ensemble with a structure factor (decision 43)

def structure(page, name, phi=None):
    page.select_option('#sfStructure', name)
    page.wait_for_timeout(250)
    if phi is not None:
        type_value(page, 'volfraction', phi)
        page.wait_for_timeout(250)


def check_ensemble(ctx, measured):
    def run():
        page, notes = ctx.page, []
        su.tab(page, 'model')
        plain_sphere(page)
        to_stage(page)
        single, one = shape(page, 400), page.evaluate(js.JS_BLOBS)
        structure(page, 'hardsphere', '0.05')
        to_stage(page)
        many, blobs, text = shape(page, 500), page.evaluate(js.JS_BLOBS), page.evaluate(js.JS_EXTRAS)
        ok = (one['blobs'] == 1 and many['hash'] != single['hash'] and blobs['blobs'] >= 4 and many['painted'] > 500
              and 'S(Q)：hardsphere 硬球，圖中 12 顆相同的顆粒，φ = 0.050' in text and '有效半徑 R_eff = 5.0 nm，模式：半徑（radius）' in text)
        notes.append(f"sphere: {one['blobs']} blob; sphere@hardsphere φ 0.05: {blobs['blobs']} separate blobs (largest {blobs['sizes'][:6]}), "
                     f"canvas changed={many['hash'] != single['hash']}")
        texts = {}
        for phi in ('0.0001', '0.2'):
            type_value(page, 'volfraction', phi)
            page.wait_for_timeout(300)
            texts[phi] = page.evaluate(js.JS_EXTRAS)
        sparse = '體積分率很低，顆粒間距未按比例（實際更疏）'
        ok = ok and sparse in texts['0.0001'] and sparse not in texts['0.2'] and '未按比例' not in texts['0.2']
        notes.append(f"not-to-scale sentence at φ 1e-4: {sparse in texts['0.0001']}, at φ 0.2: {sparse in texts['0.2']}")
        su.pick_model(page, 'core_shell_sphere')
        structure(page, 'hayter_msa')
        to_stage(page)
        msa, text = shape(page, 500), page.evaluate(js.JS_EXTRAS)
        both, hues = two_hues(msa['hues'], minimum=40)
        ok = ok and both and 'Debye 屏蔽長度 κ⁻¹ = 20.6 nm' in text and '電荷 19.0 e' in text
        notes.append(f"core_shell_sphere@hayter_msa: hue bins {hues} (core seen through each cut), text has κ⁻¹ 20.6 nm={'κ⁻¹ = 20.6 nm' in text}")
        ctx.shot('m4-ensemble-hayter')
        for theme in ('light', 'dark'):
            ctx.theme(theme)
            to_stage(page, 300)
            measured.setdefault('axe', []).append((theme, su.run_axe(ctx, 'section') if not ctx.axe_error else None))
        ctx.theme('light')
        violations = [v for _, found in measured['axe'] for v in (found or [])]
        ok = ok and not ctx.axe_error and not violations
        notes.append(f"axe with the ensemble on screen, light and dark: {sum(len(v['nodes']) for v in violations)} violation node(s)")
        structure(page, '')
        to_stage(page)
        back = page.evaluate(js.JS_BLOBS)
        ok = ok and back['blobs'] == 1
        notes.append(f'S(Q) off again: {back["blobs"]} blob')
        plain_sphere(page)
        to_top(page, 150)
        return ok, '; '.join(notes)
    check(ctx, '16 ensemble: sphere@hardsphere draws several separate particles (sphere alone one), the S(Q) lines name the factor, N, φ and R_eff '
               'with its mode; the not-to-scale sentence at φ 1e-4 and not at 0.2; hayter_msa lists κ⁻¹; axe clean in both themes', run)


JS_EDIT = """(value) => { const e = document.getElementById('sfValue_radius'), t0 = performance.now();
  e.value = value; e.dispatchEvent(new Event('input', { bubbles: true })); return performance.now() - t0; }"""


def edit_times(page, values):
    """Synchronous input handling (the page's refresh, 3D scene and texts included) and the time until the curve follows."""
    sync, curve = [], []
    for value in values:
        before = su.curve_sig(page)
        t0 = time.time()
        sync.append(page.evaluate(JS_EDIT, value))
        su.wait_curve_change(page, before, 20_000)
        curve.append((time.time() - t0) * 1000)
        page.wait_for_timeout(150)
    return statistics.median(sync), statistics.median(curve)


def measure_ensemble(ctx, measured):
    """Item 14: frame time of the heaviest ensemble and what it does to editing (informational, no threshold)."""
    page = ctx.page
    try:
        su.load_files(page, su.SYNTH[:1]) if not page.evaluate("() => SasFitSection.getState().files.length") else None
        su.pick_model(page, 'core_shell_cylinder')
        structure(page, 'hardsphere')
        to_stage(page, 600)
        measured['ensemble_frame'] = page.evaluate(js.JS_FRAME_TIME)
        measured['edit_on'] = edit_times(page, ['21', '22', '23', '24', '25'])
        to_top(page, 400)
        measured['edit_off'] = edit_times(page, ['26', '27', '28', '29', '30'])
        structure(page, '')
        to_stage(page, 400)
        measured['edit_single'] = edit_times(page, ['31', '32', '33', '34', '35'])
        type_value(page, 'radius', '20')
    except Exception as err:                                  # noqa: BLE001 -- informational; printed as missing
        measured['ensemble_error'] = f'{type(err).__name__}: {str(err).splitlines()[0][:200]}'
    finally:
        plain_sphere(page)
        to_top(page, 150)
