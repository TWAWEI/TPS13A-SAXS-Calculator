"""Gate G3 and the kernel-args fixture of the sasfit reference generators.

Run through gen_reference.py (which writes every fixture); see its docstring.

    g3.json           sasmodels' own model_info.tests + the 1D smoke tests
    kernel-args.json  details/values buffers of details.make_kernel_args
"""
import re

import ref_common  # noqa: F401  (first: configures the build before sasmodels is imported)
from ref_common import (MODEL_ORDER, Q_FQ, assert_finite, get_model, np, pd_block,
                        write_fixture)

import sasmodels  # noqa: E402
from sasmodels.details import make_kernel_args  # noqa: E402
from sasmodels.direct_model import call_Fq, call_kernel, get_mesh  # noqa: E402
from sasmodels.model_test import is_near  # noqa: E402
from sasmodels.modelinfo import expand_pars  # noqa: E402


# Official-test counts kept after dropping 2D and magnetic cases (plan Task 2 Step 5).
EXPECTED_G3_KEPT = {
    "sphere": 12, "core_shell_sphere": 2, "vesicle": 4, "ellipsoid": 5,
    "cylinder": 16, "core_shell_cylinder": 1, "flexible_cylinder": 4,
    "lamellar": 1, "guinier": 1, "guinier_porod": 1, "power_law": 1,
    "mono_gauss_coil": 1, "gaussian_peak": 0, "hardsphere": 1, "hayter_msa": 2,
}
MAGNETIC_KEY = re.compile(r"(_M0|_mphi|_mtheta)$|^up_")


# ------------------------------------------------------------------ g3.json

# The three 1D smoke tests of model_test.py run_all (the 2D ones are skipped).
SMOKE = [
    ("smoke Iq q=0.1", ({}, 0.1, None)),
    ("smoke Iq q=[0.001,0.01,0.1]", ({}, [0.001, 0.01, 0.1], [None] * 3)),
    ("smoke Fq q=0.1", ({}, 0.1, None, None, None, None, None)),
]


def _as_list(value):
    return value if isinstance(value, list) else [value]


def _expect_fq(test):
    return {"F1": _as_list(test[2]), "F2": _as_list(test[3]), "radiusEffective": test[4],
            "shellVolume": test[5], "volumeRatio": test[6]}


def interpret_test(name, label, source, test, stats):
    """Return a fixture entry, or None when the test is skipped (see run_one)."""
    user_pars = dict(test[0])
    x = _as_list(test[1])
    if isinstance(x[0], tuple):
        stats["2d"] += 1
        return None
    if any(MAGNETIC_KEY.search(k) for k in user_pars):
        stats["magnetic"] += 1
        return None
    structure = user_pars.pop("@S", None)
    if len(test) == 4:
        stats["intermediates"] += 1
    if len(test) in (3, 4):
        kind, expected, mode = "Iq", _as_list(test[2]), None
    elif len(test) == 7:
        kind, expected = "Fq", _expect_fq(test)
        mode = int(user_pars.pop("radius_effective_mode", 1))
        assert structure is None, "%s: Fq test on a product is not supported" % label
    else:
        raise AssertionError("%s: unexpected test tuple length %d" % (label, len(test)))
    model = name + ("@" + structure if structure else "")
    return {"model": name, "structure": structure, "pars": user_pars,
            "q": [float(v) for v in x], "kind": kind, "expected": expected,
            "radiusEffectiveMode": mode, "source": source, "label": label,
            "sasmodels": {"model": model, "pars": dict(user_pars)}}


def _check_vector(target, actual, label):
    if target is None:
        return
    assert len(target) == len(actual), label
    for t, a in zip(target, actual):
        assert is_near(t, a, 5), "%s: expected %r actual %r" % (label, t, a)


def verify_entry(entry):
    """Re-run sasmodels' own run_one checks (cutoff 0) so the fixture is self-proving."""
    model = get_model(entry["sasmodels"]["model"])
    pars = expand_pars(model.info.parameters, entry["sasmodels"]["pars"])
    q = np.array(entry["q"])
    kernel = model.make_kernel([q])
    label = "%s/%s" % (entry["model"], entry["label"])
    if entry["kind"] == "Iq":
        _check_vector(entry["expected"], call_kernel(kernel, pars), label)
        return
    pars = dict(pars)
    pars["radius_effective_mode"] = entry["radiusEffectiveMode"]
    F1, F2, reff, vshell, ratio = call_Fq(kernel, pars)
    exp = entry["expected"]
    if F1 is not None:
        _check_vector(exp["F1"], F1, label + " F")
    _check_vector(exp["F2"], F2, label + " F2")
    for key, got in (("radiusEffective", reff), ("shellVolume", vshell), ("volumeRatio", ratio)):
        assert is_near(exp[key], got, 5), "%s %s: %r vs %r" % (label, key, exp[key], got)


def _expected_values(entry):
    exp = entry["expected"]
    if entry["kind"] == "Iq":
        return exp
    return exp["F1"] + exp["F2"] + [exp[k] for k in ("radiusEffective", "shellVolume", "volumeRatio")]


def gen_g3():
    entries, table = [], []
    for name in MODEL_ORDER:
        info = get_model(name).info
        official = list(info.tests or [])
        stats = {"2d": 0, "magnetic": 0, "intermediates": 0}
        kept = 0
        for idx, test in enumerate(official):
            e = interpret_test(name, "official #%d" % idx, "official", test, stats)
            if e is not None:
                entries.append(e)
                kept += 1
        for label, test in SMOKE:
            entries.append(interpret_test(name, label, "smoke", test, dict(stats)))
        table.append((name, len(official), kept, len(official) - kept, stats))
    return finish_g3(entries, table)


def finish_g3(entries, table):
    for name, _total, kept, _skipped, _stats in table:
        assert kept == EXPECTED_G3_KEPT[name], (
            "G3 kept-count mismatch for %s: got %d, plan expects %d"
            % (name, kept, EXPECTED_G3_KEPT[name]))
    for e in entries:
        verify_entry(e)
        vals = [v for v in _expected_values(e) if v is not None]
        assert_finite(vals, "g3 %s %s expected" % (e["model"], e["label"]))
    print("G3 model              total kept skipped  (2D, magnetic; 4-tuple intermediates dropped)")
    for name, total, kept, skipped, st in table:
        print("   %-20s %5d %4d %7d  2D=%d mag=%d intermediates=%d"
              % (name, total, kept, skipped, st["2d"], st["magnetic"], st["intermediates"]))
    tol = {"source": "sasmodels.model_test.is_near (digits=5)", "digits": 5,
           "rules": {"targetNone": "actual must not be NaN",
                     "targetZero": "actual must equal 0 exactly",
                     "targetFinite": "|t-a| < 1.5*10^(ceil(log10|t|)-digits)",
                     "targetInf": "actual must equal target",
                     "targetNaN": "actual must be NaN"}}
    write_fixture("g3", {"sasmodelsVersion": sasmodels.__version__, "cutoff": 0.0,
                         "tolerance": tol, "cases": entries})
    return {t[0]: sum(1 for e in entries if e["model"] == t[0]) for t in table}, len(entries)


# --------------------------------------------------------- kernel-args.json

def _pd_n(name, n, width):
    return pd_block(name, "gaussian", n, 3, width)


def _kernel_args_inputs():
    """(label, model, pars): the ordering cases of np.argsort(length)[::-1] (details.py:207)."""
    return [
        ("sphere default", "sphere", {}),
        ("cylinder default", "cylinder", {}),
        ("cylinder scale and background", "cylinder", {"scale": 2.5, "background": 0.125}),
        ("cylinder radius n35 length n35 (tie)", "cylinder",
         dict(_pd_n("radius", 35, 0.15), **_pd_n("length", 35, 0.2))),
        ("cylinder radius n35 length n15", "cylinder",
         dict(_pd_n("radius", 35, 0.15), **_pd_n("length", 15, 0.2))),
        ("cylinder radius n15 length n35", "cylinder",
         dict(_pd_n("radius", 15, 0.15), **_pd_n("length", 35, 0.2))),
        ("core_shell_cylinder radius n20 thickness n35 length n20", "core_shell_cylinder",
         dict(_pd_n("radius", 20, 0.15), **_pd_n("thickness", 35, 0.1),
              **_pd_n("length", 20, 0.2))),
        ("hayter_msa default", "hayter_msa", {}),
        ("guinier default", "guinier", {}),
    ]


def kernel_args_case(label, name, pars):
    """call_kernel's path (direct_model.py:53-56): get_mesh, then make_kernel_args."""
    kernel = get_model(name).make_kernel([Q_FQ])
    mesh = get_mesh(kernel.info, dict(pars), dim=kernel.dim)
    details, values, is_magnetic = make_kernel_args(kernel, mesh)
    assert not is_magnetic, label
    assert values.dtype == np.float64 and details.buffer.dtype == np.int32, label
    return {"label": label, "model": name, "pars": dict(pars),
            "details": [int(v) for v in details.buffer],
            "values": [float(v) for v in values],
            "numEval": int(details.num_eval), "numWeights": int(details.num_weights),
            "sasmodels": {"model": name, "pars": dict(pars),
                          "call": "details.make_kernel_args(kernel, direct_model.get_mesh(...))"}}


def gen_kernel_args():
    cases = [kernel_args_case(*c) for c in _kernel_args_inputs()]
    write_fixture("kernel-args", {"sasmodelsVersion": sasmodels.__version__, "cases": cases})
    return len(cases)
