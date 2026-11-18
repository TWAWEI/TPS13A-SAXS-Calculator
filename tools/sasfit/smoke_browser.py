"""Browser smoke test of the SAS fitting Worker (M2 plan, Task 6 and review section E).

Run with the Playwright venv (headless Chromium, nothing is installed by this script):

    ~/Projects/text-to-cad/.venv/bin/python tools/sasfit/smoke_browser.py

It serves saxs-calculator/ with a stdlib http.server on a random 127.0.0.1 port (caching off, every
request logged), drives the page in Chromium and prints PASS/FAIL per check. Exit code 0 only if all
checks pass. Worker sub-requests (importScripts, wasm) are judged from the SERVER log, because
page.on('request') can miss them. Overall timeout: TOTAL_TIMEOUT_S.
"""
import http.server
import json
import re
import signal
import statistics
import sys
import threading
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2] / 'saxs-calculator'
TOTAL_TIMEOUT_S = 120
STEP_TIMEOUT_MS = 40_000
SLOW_MS = 300
EXPECTED_MODULES = ['sasfit-meta.js', 'sasfit-validate.js', 'sasfit-weights.js', 'sasfit-kernel.js',
                    'sasfit-product.js', 'sasfit-py-models.js', 'sasfit-evaluate.js', 'sasfit-weighting.js',
                    'sasfit-linalg.js', 'sasfit-fitter.js', 'sasfit-worker-core.js']
WORKER_SCRIPT = 'sasfit-worker.js'


# ----------------------------------------------------------------- server

class LoggingHandler(http.server.SimpleHTTPRequestHandler):
    """Static files from ROOT, Cache-Control: no-store, one log entry per request."""
    log = []
    log_lock = threading.Lock()
    _ctype = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    _code = '-'

    def send_response(self, code, message=None):
        self._code = code
        super().send_response(code, message)

    def send_header(self, keyword, value):
        if keyword.lower() == 'content-type':
            self._ctype = value
        super().send_header(keyword, value)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
        self.record(self._code)       # headers are complete here, so Content-Type is known

    def record(self, code):
        entry = {'path': urlsplit(self.path).path, 'query': parse_qs(urlsplit(self.path).query), 'raw': self.path,
                 'code': str(code), 'ctype': self._ctype, 'referer': self.headers.get('Referer', ''),
                 'dest': self.headers.get('Sec-Fetch-Dest', '')}
        with self.log_lock:
            self.log.append(entry)

    def log_request(self, code='-', size='-'):
        pass                          # logged by record(), once the headers are known

    def log_message(self, *args):
        pass


def start_server():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), LoggingHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


# ----------------------------------------------------------------- page-side scripts

JS_FOOTER_VERSION = """() => {
  const m = /Version\\s+(\\S+)/.exec(document.querySelector('.sidebar-footer').textContent);
  return m ? m[1] : null;
}"""

JS_COMMON = """
const logspace = (a, b, n) => Float64Array.from({ length: n }, (_, i) => Math.pow(10, a + (b - a) * i / (n - 1)));
const median = (xs) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
function makeRng(seed) {                       // seeded LCG + Box-Muller, no Math.random
  let s = seed >>> 0;
  const uniform = () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return (s + 1) / 4294967297; };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}
"""

JS_EVAL_EQUALS_MAIN = "async () => {" + JS_COMMON + """
  const q = logspace(-2.3, -0.5, 200);
  const spec = { model: 'sphere' };
  const client = SasFitWorkerClient.create();
  try {
    const w = await client.evaluate({ modelSpec: spec, params: {}, q, opts: { cutoff: 1e-5 } });
    const bytes = await (await fetch('wasm/sas-sphere.wasm?v=' + client.version)).arrayBuffer();
    const kernel = await SasFitKernel.instantiate(bytes);
    const m = SasFitEvaluate.evaluate(spec, {}, q, { cutoff: 1e-5 }, { sphere: kernel });
    let diff = 0, maxAbs = 0, finite = 0;
    for (let i = 0; i < q.length; i++) {
      if (w.I[i] !== m.I[i]) { diff++; maxAbs = Math.max(maxAbs, Math.abs(w.I[i] - m.I[i])); }
      if (Number.isFinite(w.I[i])) finite++;
    }
    return { n: w.I.length, mainN: m.I.length, diff, maxAbs, finite, first: w.I[0] };
  } finally { client.dispose(); }
}"""

JS_HAYTER = "async () => {" + JS_COMMON + """
  const q = logspace(-2.3, -0.5, 200);
  const client = SasFitWorkerClient.create();
  try {
    const r = await client.evaluate({ modelSpec: { model: 'sphere', structure: 'hayter_msa' }, params: {}, q, opts: { cutoff: 1e-5 } });
    let finite = 0;
    for (const v of r.I) if (Number.isFinite(v)) finite++;
    return { n: r.I.length, finite, extras: Object.keys(r.extras), first: r.I[0] };
  } finally { client.dispose(); }
}"""

JS_FIT = "async () => {" + JS_COMMON + """
  const truth = { radius: 60, scale: 1, background: 0.001 };
  const spec = { model: 'sphere' };
  // qmax 0.06 (q*R ~ 3.6, below the first minimum of the sphere form factor): from starts 20 % off,
  // a range reaching q*R >= 6 ends in a local minimum (chi2r ~ 600 reported as 'converged')
  const q = logspace(Math.log10(0.005), Math.log10(0.06), 120);
  const client = SasFitWorkerClient.create();
  try {
    const clean = (await client.evaluate({ modelSpec: spec, params: truth, q, opts: { cutoff: 1e-5 } })).I;
    const gauss = makeRng(20261118);
    const sigma = Float64Array.from(clean, (v) => 0.03 * v + 1e-4);
    const I = Float64Array.from(clean, (v, i) => v + sigma[i] * gauss());
    let progress = 0;
    const t0 = performance.now();
    const r = await client.fit({
      modelSpec: spec, params: { radius: truth.radius * 1.2, scale: truth.scale * 1.2, background: truth.background * 1.2 },
      fitFlags: { scale: true, radius: true, background: true },
      bounds: { radius: [1, 1000], scale: [0, Infinity], background: [-Infinity, Infinity] },
      data: { q, I, sigma, kind: 'generic', header: null }, range: { qMin: q[0], qMax: q[q.length - 1] },
      weighting: 'sigma', options: { maxSteps: 200, cutoff: 1e-5 },
    }, { onProgress: () => { progress++; } });
    const wallMs = performance.now() - t0;
    return { status: r.status, radius: r.params.radius, errRadius: r.errors.radius, truth: truth.radius,
             chi2r: r.chi2r, dof: r.dof, iterations: r.iterations, progress, wallMs, atBound: r.atBound };
  } finally { client.dispose(); }
}"""

JS_STOP = "async () => {" + JS_COMMON + """
  const pd = { radius_pd: 0.2, radius_pd_type: 'gaussian', radius_pd_n: 35, radius_pd_nsigma: 3,
               length_pd: 0.2, length_pd_type: 'gaussian', length_pd_n: 35, length_pd_nsigma: 3 };
  const spec = { model: 'cylinder' };
  const q = logspace(-2.3, -0.5, 400);
  const client = SasFitWorkerClient.create();
  try {
    const I = (await client.evaluate({ modelSpec: spec, params: { ...pd, radius: 22, length: 420 }, q, opts: { cutoff: 1e-5 } })).I;
    const sigma = Float64Array.from(I, (v) => 0.03 * v + 1e-4);
    const pending = client.fit({
      modelSpec: spec, params: { ...pd, radius: 20, length: 400, scale: 1, background: 0.001 },
      fitFlags: { scale: true, radius: true, length: true },
      bounds: { radius: [1, 1000], length: [1, 5000], scale: [0, Infinity] },
      data: { q, I, sigma, kind: 'generic', header: null }, range: { qMin: q[0], qMax: q[q.length - 1] },
      weighting: 'sigma', options: { maxSteps: 200, cutoff: 1e-5 },
    }, { onProgress: () => {} });
    await new Promise((r) => setTimeout(r, 200));
    const t0 = performance.now();
    client.stop();
    const result = await pending;
    const stopMs = performance.now() - t0;
    const after = await client.evaluate({ modelSpec: { model: 'sphere' }, params: {}, q: logspace(-2, -0.5, 50), opts: { cutoff: 1e-5 } });
    return { status: result.status, stopMs, afterN: after.I.length, afterFinite: after.I.every(Number.isFinite) };
  } finally { client.dispose(); }
}"""

JS_TIMINGS = "async () => {" + JS_COMMON + """
  const q = logspace(-2.3, -0.5, 400);
  const pd = (names, type, n) => Object.fromEntries(names.flatMap((p) =>
    [[p + '_pd', 0.2], [p + '_pd_type', type], [p + '_pd_n', n], [p + '_pd_nsigma', 3]]));
  const cases = [
    ['sphere schulz n=80', { model: 'sphere' }, pd(['radius'], 'schulz', 80), 5],
    ['cylinder radius gaussian n=35', { model: 'cylinder' }, pd(['radius'], 'gaussian', 35), 5],
    ['cylinder radius+length gaussian n=35', { model: 'cylinder' }, pd(['radius', 'length'], 'gaussian', 35), 3],
  ];
  const client = SasFitWorkerClient.create();
  const out = [];
  try {
    for (const [label, modelSpec, params, runs] of cases) {
      const call = () => client.evaluate({ modelSpec, params, q, opts: { cutoff: 1e-5 } });
      await call();                                       // warm-up (wasm load)
      const times = [];
      for (let i = 0; i < runs; i++) { const t0 = performance.now(); await call(); times.push(performance.now() - t0); }
      out.push({ label, runs, median: median(times), min: Math.min(...times), max: Math.max(...times) });
    }
    return out;
  } finally { client.dispose(); }
}"""


# ----------------------------------------------------------------- checks

class Report:
    def __init__(self):
        self.failures = 0

    def check(self, name, ok, detail=''):
        print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  -- {detail}" if detail else ''))
        if not ok:
            self.failures += 1
        return ok


def open_page(browser, base_url, color_scheme):
    """New context + page with console collection; returns (context, page, messages, page_errors)."""
    context = browser.new_context(color_scheme=color_scheme)
    page = context.new_page()
    page.set_default_timeout(STEP_TIMEOUT_MS)
    messages, page_errors = [], []
    page.on('console', lambda m: messages.append((m.type, m.text, m.location.get('url', ''))))
    page.on('pageerror', lambda e: page_errors.append(str(e)))
    page.goto(base_url + '/index.html', wait_until='load')
    page.wait_for_function('typeof SasFitWorkerClient !== "undefined" && typeof SasFitKernel !== "undefined"')
    page.wait_for_timeout(500)
    return context, page, messages, page_errors


def check_console(report, label, messages, page_errors):
    errors = [m for m in messages if m[0] == 'error']
    warnings = [m for m in messages if m[0] == 'warning']
    detail = f'{len(errors)} console error(s), {len(page_errors)} pageerror(s), {len(warnings)} warning(s)'
    for kind, text, url in errors:
        detail += f'\n        error: {text} ({url})'
    for text in page_errors:
        detail += f'\n        pageerror: {text}'
    for kind, text, url in warnings:
        detail += f'\n        warning (not failing): {text}'
    report.check(label, not errors and not page_errors, detail)


def check_eval_equals_main(report, page):
    r = page.evaluate(JS_EVAL_EQUALS_MAIN)
    ok = r['n'] == 200 and r['mainN'] == 200 and r['diff'] == 0 and r['finite'] == 200
    report.check('2 worker evaluate(sphere defaults, 200 q) == main thread, point by point', ok,
                 f"n={r['n']} finite={r['finite']} differing={r['diff']} maxAbsDiff={r['maxAbs']}")


def check_hayter(report, page):
    r = page.evaluate(JS_HAYTER)
    ok = r['n'] == 200 and r['finite'] == 200
    report.check('3 worker evaluate(sphere@hayter_msa defaults) is finite', ok,
                 f"n={r['n']} finite={r['finite']} extras={r['extras']}")


def check_fit(report, page):
    r = page.evaluate(JS_FIT)
    off = abs(r['radius'] - r['truth'])
    ok = (r['status'] == 'converged' and off <= 3 * r['errRadius'] and 0.5 <= r['chi2r'] <= 1.6 and r['progress'] >= 2)
    report.check('4 fit(sphere, noisy synthetic data) converges to truth', ok,
                 f"status={r['status']} radius={r['radius']:.4f} (truth {r['truth']}, off {off:.4f} = "
                 f"{off / r['errRadius']:.2f} sigma, err {r['errRadius']:.4f}) chi2r={r['chi2r']:.3f} dof={r['dof']} "
                 f"iterations={r['iterations']} progress callbacks={r['progress']} wall={r['wallMs']:.0f} ms")
    return r['wallMs']


def check_stop(report, page):
    r = page.evaluate(JS_STOP)
    ok = r['status'] == 'stopped' and r['stopMs'] < 1000 and r['afterN'] == 50 and r['afterFinite']
    report.check('5 stop() resolves the slow cylinder fit as stopped within 1 s; evaluate afterwards works', ok,
                 f"status={r['status']} stop->resolved={r['stopMs']:.1f} ms evaluate-after: n={r['afterN']} finite={r['afterFinite']}")


def worker_entries():
    """Server-log entries made by the Worker: its script and everything it loads."""
    with LoggingHandler.log_lock:
        log = list(LoggingHandler.log)
    return [e for e in log if e['path'].endswith('/' + WORKER_SCRIPT) or e['path'].endswith(WORKER_SCRIPT)
            or WORKER_SCRIPT in e['referer']]


def check_versions(report, page):
    footer = page.evaluate(JS_FOOTER_VERSION)
    entries = worker_entries()
    script = [e for e in entries if e['path'].endswith(WORKER_SCRIPT)]
    modules = [e for e in entries if e['path'].endswith('.js') and not e['path'].endswith(WORKER_SCRIPT)]
    wasm = [e for e in entries if e['path'].endswith('.wasm')]
    unversioned = [e['raw'] for e in entries if e['query'].get('v') != [footer]]
    names = [Path(e['path']).name for e in modules]
    chunks_ok = bool(names) and len(names) % len(EXPECTED_MODULES) == 0 and all(
        names[i:i + len(EXPECTED_MODULES)] == EXPECTED_MODULES for i in range(0, len(names), len(EXPECTED_MODULES)))
    ok = bool(footer) and bool(script) and bool(wasm) and chunks_ok and not unversioned
    report.check('6 worker script, 11 importScripts modules and every .wasm carry ?v=<footer version>', ok,
                 f"footer version={footer!r}; worker starts={len(script)}; module requests={len(names)} "
                 f"(expected multiple of {len(EXPECTED_MODULES)}, in order: {chunks_ok}); wasm requests={len(wasm)}; "
                 f"requests without matching ?v=: {unversioned or 'none'}")
    types = sorted({str(e['ctype']) for e in wasm})
    print(f"      .wasm Content-Type served: {', '.join(types) or '(none seen)'}")
    print('      worker sub-requests in server log (in arrival order):')
    for e in entries:
        print(f"        {e['code']} {e['raw']}  [dest={e['dest'] or '-'}]")


def print_timings(rows, fit_wall):
    print('7 timings (in page, ms; informational)')
    print(f"      {'case':<40}{'runs':>5}{'median':>9}{'min':>9}{'max':>9}")
    for r in rows:
        flag = '  <-- over %d ms' % SLOW_MS if r['median'] > SLOW_MS else ''
        print(f"      {r['label']:<40}{r['runs']:>5}{r['median']:>9.1f}{r['min']:>9.1f}{r['max']:>9.1f}{flag}")
    flag = '  <-- over %d ms' % SLOW_MS if fit_wall > SLOW_MS else ''
    print(f"      {'fit total wall time (check 4)':<40}{1:>5}{fit_wall:>9.1f}{'':>9}{'':>9}{flag}")


def run_all(base_url):
    report = Report()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context, page, messages, page_errors = open_page(browser, base_url, 'light')
            check_console(report, '1 page loads without console errors / pageerrors', messages, page_errors)
            check_eval_equals_main(report, page)
            check_hayter(report, page)
            fit_wall = check_fit(report, page)
            check_stop(report, page)
            check_versions(report, page)
            print_timings(page.evaluate(JS_TIMINGS), fit_wall)
            check_console(report, '1b no console errors after all worker activity', messages, page_errors)
            context.close()

            context, page, messages, page_errors = open_page(browser, base_url, 'dark')
            check_console(report, '1c page loads without console errors (dark colour scheme)', messages, page_errors)
            context.close()
        finally:
            browser.close()
    return report


def on_alarm(signum, frame):
    raise TimeoutError(f'smoke test exceeded {TOTAL_TIMEOUT_S} s')


def main():
    signal.signal(signal.SIGALRM, on_alarm)
    signal.alarm(TOTAL_TIMEOUT_S)
    server, thread = start_server()
    base_url = f'http://127.0.0.1:{server.server_address[1]}'
    print(f'serving {ROOT} at {base_url}')
    try:
        report = run_all(base_url)
    except Exception as err:                      # a crash is a failure, not a hang or a silent pass
        print(f'FAIL  smoke test aborted: {type(err).__name__}: {err}')
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
