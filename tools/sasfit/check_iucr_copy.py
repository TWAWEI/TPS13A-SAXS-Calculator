"""Browser check of the IUCr table's "copy table" after M4 Task 17 (the copy carries the CURRENT input values).

Run with the Playwright venv (headless Chromium; nothing is installed by this script):

    ~/Projects/text-to-cad/.venv/bin/python tools/sasfit/check_iucr_copy.py

It serves saxs-calculator/ like smoke_browser.py, opens the IUCr page and compares what "copy table" produces
with the baseline captured BEFORE the change (tests/fixtures/sasfit/iucr-copy-v5.2.json, never regenerated):

  1. baseline still reproducible: with the three inputs emptied the copied text equals the baseline text exactly,
     and the copied HTML equals the baseline HTML without its <input> tags (both sides normalised: HTML comments
     and whitespace between tags removed) -- for the default table and for the filled one;
  2. current input values are in both flavours (escaped in the HTML), no <input> is left, the page keeps its
     inputs, no temporary container stays behind, no sasfit marker comment is copied;
  3. the empty model-fitting block is on the page but not in the copy;
  4. a real click on the button puts exactly iucrCopySource's text and HTML on the clipboard.

Everything runs with the IUCr page SHOWING: for a table that is not rendered innerText degrades to textContent.
run_checks(page, report) is reused by smoke_m4.py. Prints PASS/FAIL per check; exit code 0 only if all pass.
"""
import json
import re
import sys

sys.dont_write_bytecode = True

from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_browser import Report, start_server  # noqa: E402
from capture_iucr_copy import FIXTURE, INPUT_IDS, fill_iucr, show_iucr  # noqa: E402

STEP_TIMEOUT_MS = 40_000
PERMISSIONS = ['clipboard-read', 'clipboard-write']
EDITED = ['0.0123-0.456', '3 x 10 s', '288 <K> & "q"']
EDITED_HTML = '288 &lt;K&gt; &amp; "q"'
ROW_LABELS = ['q-range', 'Exposure time', 'Temperature']
PLACEHOLDER = '尚未送入擬合結果'
HEADING = 'Model fitting'

JS_SOURCE = """() => {
  const s = iucrCopySource(document.getElementById('iucrTable'));
  try { return { html: s.html, text: s.text }; } finally { s.release(); }
}"""
JS_SET_INPUTS = """([ids, values]) => ids.forEach((id, i) => { document.getElementById(id).value = values[i]; })"""
JS_PAGE_STATE = """(ids) => ({
  values: ids.map((id) => document.getElementById(id).value),
  inputs: document.querySelectorAll('#iucrTable input').length,
  holders: document.querySelectorAll('#section-iucr .sr-only').length,
  placeholderShown: (() => { const e = document.getElementById('iucr-sf-empty'); return !!e && e.getBoundingClientRect().height > 0; })(),
})"""
JS_CLIPBOARD = """async () => {
  const text = await navigator.clipboard.readText();
  const items = await navigator.clipboard.read();
  let html = null;
  for (const item of items) if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
  return { text, html };
}"""


def normalise(html):
    """HTML without comments and without the whitespace between tags."""
    return re.sub(r'>\s+<', '><', re.sub(r'<!--.*?-->', '', html, flags=re.S)).strip()


def without_inputs(html):
    return re.sub(r'<input\b[^>]*>', '', html)


def source(page):
    return page.evaluate(JS_SOURCE)


def set_inputs(page, values):
    page.evaluate(JS_SET_INPUTS, [INPUT_IDS, values])


def check_baseline(page, report, fixture, state):
    """Step 1 for one state of the table ('default' or 'filled')."""
    set_inputs(page, ['', '', ''])
    got = source(page)
    base = fixture[state]
    report.check(f'copy/{state}: text equals the baseline exactly (inputs emptied)', got['text'] == base['text'],
                 f"{len(got['text'])} chars vs {len(base['text'])}")
    same = normalise(got['html']) == normalise(without_inputs(base['html']))
    report.check(f'copy/{state}: HTML equals the baseline without its <input> tags (normalised)', same,
                 f"{len(normalise(got['html']))} chars vs {len(normalise(without_inputs(base['html'])))}")


def check_current_values(page, report):
    """Step 2: what the user typed is copied, in both flavours."""
    set_inputs(page, EDITED)
    got = source(page)
    rows = got['text'].split('\n')
    in_rows = all(any(label in row and row.split('\t')[2:3] == [value] for row in rows) for label, value in zip(ROW_LABELS, EDITED))
    report.check('copy: the text has the current input values, each in its own row', in_rows,
                 '; '.join(row.replace('\t', ' | ') for row in rows if any(label in row for label in ROW_LABELS)))
    report.check('copy: the HTML has the values escaped and no <input>',
                 EDITED_HTML in got['html'] and all(v in got['html'] for v in EDITED[:2]) and '<input' not in got['html'],
                 f"<input in html: {'<input' in got['html']}")
    report.check('copy: no sasfit marker comment in the HTML', 'sasfit:' not in got['html'] and '<!--' not in got['html'])
    state = page.evaluate(JS_PAGE_STATE, INPUT_IDS)
    report.check('copy: the page keeps its three inputs and their values, no temporary container is left',
                 state['values'] == EDITED and state['inputs'] == 3 and state['holders'] == 0, json.dumps(state, ensure_ascii=False))


def check_empty_block(page, report):
    """Step 3: nothing sent -> the placeholder is on the page, not in the copy."""
    page.evaluate('() => setIUCrModelFit(null)')
    got = source(page)
    state = page.evaluate(JS_PAGE_STATE, INPUT_IDS)
    absent = all(word not in got['text'] and word not in got['html'] for word in (HEADING, PLACEHOLDER))
    report.check('copy: the empty model-fitting block is shown on the page but not copied', absent and state['placeholderShown'],
                 f"placeholder shown: {state['placeholderShown']}")


def check_button(page, report):
    """Step 4: the real button writes exactly that text and HTML to the clipboard."""
    expected = source(page)
    page.click('#copyIUCrTable')
    page.wait_for_function("() => document.getElementById('copyIUCrTable').textContent.includes('已複製')", timeout=5_000)
    clip = page.evaluate(JS_CLIPBOARD)
    report.check('copy button: clipboard text/plain equals iucrCopySource', clip['text'] == expected['text'], f"{len(clip['text'])} chars")
    report.check('copy button: clipboard text/html equals iucrCopySource (normalised)',
                 clip['html'] is not None and normalise(expected['html']) in normalise(clip['html']) and '<input' not in clip['html'],
                 f"{0 if clip['html'] is None else len(clip['html'])} chars")
    state = page.evaluate(JS_PAGE_STATE, INPUT_IDS)
    report.check('copy button: no temporary container is left', state['holders'] == 0, str(state['holders']))


def run_checks(page, report):
    """All four steps on a page that is already loaded; ends with the three inputs holding EDITED and the table filled."""
    fixture = json.loads(FIXTURE.read_text(encoding='utf-8'))
    show_iucr(page)
    page.evaluate('() => setIUCrModelFit(null)')
    check_baseline(page, report, fixture, 'default')
    fill_iucr(page)
    check_baseline(page, report, fixture, 'filled')
    check_current_values(page, report)
    check_empty_block(page, report)
    check_button(page, report)


def main():
    server, thread = start_server()
    base = f'http://127.0.0.1:{server.server_address[1]}'
    report = Report()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            context = browser.new_context(color_scheme='light', permissions=PERMISSIONS)
            page = context.new_page()
            page.set_default_timeout(STEP_TIMEOUT_MS)
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.goto(base + '/index.html', wait_until='load')
            page.wait_for_function('() => typeof iucrCopySource === "function" && typeof SasFitIucr !== "undefined"')
            run_checks(page, report)
            report.check('no console errors or page errors', not errors, '; '.join(errors[:3]))
            context.close()
            browser.close()
    except Exception as err:                      # a crash is a failure, not a silent pass
        print(f'FAIL  check aborted: {type(err).__name__}: {err}')
        return 1
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    print('RESULT: ' + ('ALL PASS' if report.failures == 0 else f'{report.failures} FAILED'))
    return 0 if report.failures == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
