"""Capture the IUCr table copy output (what 'copy table' puts on the clipboard) as a fixture.

M4 plan, Task 0. Run ONCE on the unmodified page (commit ed9db6f):

    ~/Projects/text-to-cad/.venv/bin/python tools/sasfit/capture_iucr_copy.py

Writes saxs-calculator/tests/fixtures/sasfit/iucr-copy-v5.2.json. Do not regenerate afterwards: the
fixture records today's behaviour (input values are NOT copied). show_iucr/fill_iucr are meant to be
reused by later scripts (Task 17/18).

The IUCr tab MUST be showing: for a non-rendered table innerText degrades to textContent.
"""
import json
import sys

sys.dont_write_bytecode = True

from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_browser import start_server, open_page  # noqa: E402

FIXTURE = Path(__file__).resolve().parents[2] / 'saxs-calculator' / 'tests' / 'fixtures' / 'sasfit' / 'iucr-copy-v5.2.json'
INPUT_IDS = ['iucr-qrange', 'iucr-exposure', 'iucr-temperature']
PROTEIN = {'name': 'HEWL', 'molecularWeight': 69293.82, 'dryVolume': 87005.4, 'partialSpecificVolume': 0.7388}
SAXS = {'wavelength': 1.03321, 'concentration': 2, 'i0Guinier': 0.105, 'rgGuinier': 28.1, 'guinierQmax': 0.04,
        'i0Pr': 0.104, 'rgPr': 28.3, 'dmax': 85, 'porodVolume': 110000, 'mwFromPorod': 66666.7}


def show_iucr(page):
    page.click('[data-section="iucr"]')
    page.wait_for_selector('#section-iucr.active')


def fill_iucr(page):
    page.evaluate('(a) => { AppState.proteinData = a[0]; AppState.saxsData = a[1]; updateIUCrTable(); }',
                  [PROTEIN, SAXS])


def read_table(page):
    return page.evaluate("""() => {
        const t = document.getElementById('iucrTable');
        return { text: t.innerText, html: t.outerHTML };
    }""")


def main():
    server, _ = start_server()
    base = f'http://127.0.0.1:{server.server_address[1]}'
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context, page, _, _ = open_page(browser, base, 'light')
        show_iucr(page)
        default = read_table(page)
        fill_iucr(page)
        filled = read_table(page)
        inputs = page.evaluate('(ids) => ids.map(id => ({ id, value: document.getElementById(id).value }))', INPUT_IDS)
        version = browser.version
        context.close()
        browser.close()
    server.shutdown()
    for name, state in (('default', default), ('filled', filled)):
        n = len(state['text'])
        assert state['text'].startswith('Parameter\tValue'), f'{name}: unexpected start {state["text"][:30]!r}'
        assert 500 <= n <= 800, f'{name}: text length {n} (6000+ means the tab was not showing)'
    fixture = {
        'note': 'Captured once from the unmodified page at ed9db6f (M4 Task 0). Do NOT regenerate: records the '
                'behaviour before Task 17 (input values are not copied).',
        'chromium': version,
        'proteinData': PROTEIN, 'saxsData': SAXS,
        'inputs': inputs, 'default': default, 'filled': filled,
    }
    FIXTURE.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'wrote {FIXTURE} (default text {len(default["text"])} chars, filled {len(filled["text"])} chars)')


if __name__ == '__main__':
    main()
