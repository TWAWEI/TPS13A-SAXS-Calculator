"""Generate the numerical reference fixtures for the sasfit JS compute core.

AUTO-GENERATION TOOL -- the output files are never edited by hand:

    SAS_OPENCL=none tools/sasfit/.venv/bin/python tools/sasfit/gen_reference.py

writes (byte-stable, no timestamps)

    saxs-calculator/tests/fixtures/sasfit/weights.json   weights.get_weights + gammaln
    saxs-calculator/tests/fixtures/sasfit/fq.json        direct_model.call_Fq outputs
    saxs-calculator/tests/fixtures/sasfit/g1.json        gate G1 (DirectModel, cutoff 1e-5)
    saxs-calculator/tests/fixtures/sasfit/g2.json        gate G2 (python-kernel models)
    saxs-calculator/tests/fixtures/sasfit/g3.json        gate G3 (sasmodels' own model_info.tests)

Every model case also records `sasmodels: {model, pars}`: the exact model string
passed to `load_model` and the exact keyword arguments passed to sasmodels
(sum-model `A_`/`B_` names for the low-Q power-law cases), so the provenance is
auditable.  The `pars` of a case use the flat names of the JS `evaluate` API.

sasmodels 1.0.12 is the source of truth.  Spec: docs/superpowers/specs/
2026-11-17-sasfit-a-design.md section 4 and 11; plan: docs/superpowers/plans/
2026-11-18-sasfit-m1-compute-core.md Task 2.
"""
import json
import math
import os
import re
import sys

os.environ["SAS_OPENCL"] = "none"  # must precede the sasmodels import

import numpy as np  # noqa: E402
import sasmodels  # noqa: E402
from scipy.special import gammaln  # noqa: E402
from sasmodels import weights  # noqa: E402
from sasmodels.core import load_model  # noqa: E402
from sasmodels.data import empty_data1D  # noqa: E402
from sasmodels.direct_model import DirectModel, call_Fq, call_kernel  # noqa: E402
from sasmodels.model_test import is_near  # noqa: E402
from sasmodels.modelinfo import expand_pars  # noqa: E402

EXPECTED_VERSION = "1.0.12"
CUTOFF = 1e-5          # runtime default (spec 4.2); every DirectModel/call_Fq call passes it
Q_GRID = np.logspace(-3, 0, 200)
Q_FQ = np.logspace(-3, 0, 100)
INF = float("inf")

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(REPO, "saxs-calculator", "tests", "fixtures", "sasfit")

MODEL_ORDER = [
    "sphere", "core_shell_sphere", "vesicle", "ellipsoid", "cylinder",
    "core_shell_cylinder", "flexible_cylinder", "lamellar", "guinier",
    "guinier_porod", "power_law", "mono_gauss_coil", "gaussian_peak",
    "hardsphere", "hayter_msa",
]
STRUCTURE_MODELS = ("hardsphere", "hayter_msa")
# The six models that can take S(Q): have_Fq and radius_effective_modes (spec 4.1).
S_CAPABLE = ["sphere", "core_shell_sphere", "vesicle", "ellipsoid", "cylinder",
             "core_shell_cylinder"]
FIRST_SIZE = {"sphere": "radius", "core_shell_sphere": "radius", "vesicle": "radius",
              "ellipsoid": "radius_polar", "cylinder": "radius",
              "core_shell_cylinder": "radius"}
# Polydisperse (1D) parameters per spec 4.1 table (hayter_msa excluded on purpose).
PD_PARAMS = {
    "sphere": ["radius"],
    "core_shell_sphere": ["radius", "thickness"],
    "vesicle": ["radius", "thickness"],
    "ellipsoid": ["radius_polar", "radius_equatorial"],
    "cylinder": ["radius", "length"],
    "core_shell_cylinder": ["radius", "thickness", "length"],
    "flexible_cylinder": ["length", "kuhn_length", "radius"],
    "lamellar": ["thickness"],
    "mono_gauss_coil": ["rg"],
}
# (distribution, n, nsigma, relative width) -- spec 11 G1
PD_DISTS = [("gaussian", 35, 3, 0.15), ("schulz", 80, 3, 0.2),
            ("schulz", 80, 8, 0.3), ("schulz", 80, 8, 0.4)]
# Official-test counts kept after dropping 2D and magnetic cases (plan Task 2 Step 5).
EXPECTED_G3_KEPT = {
    "sphere": 12, "core_shell_sphere": 2, "vesicle": 4, "ellipsoid": 5,
    "cylinder": 16, "core_shell_cylinder": 1, "flexible_cylinder": 4,
    "lamellar": 1, "guinier": 1, "guinier_porod": 1, "power_law": 1,
    "mono_gauss_coil": 1, "gaussian_peak": 0, "hardsphere": 1, "hayter_msa": 2,
}
MAGNETIC_KEY = re.compile(r"(_M0|_mphi|_mtheta)$|^up_")

_MODEL_CACHE = {}
_DIRECT_CACHE = {}


# ---------------------------------------------------------------- JSON output

def _enc(obj):
    """Make *obj* JSON-safe: numpy -> python, non-finite floats -> strings."""
    if isinstance(obj, dict):
        return {str(k): _enc(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_enc(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return [_enc(v) for v in obj.tolist()]
    if isinstance(obj, (bool, np.bool_)):
        return bool(obj)
    if isinstance(obj, (int, np.integer)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        value = float(obj)
        if math.isnan(value):
            return "nan"
        if math.isinf(value):
            return "inf" if value > 0 else "-inf"
        return value
    return obj


def write_fixture(name, payload):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name + ".json")
    text = json.dumps(_enc(payload), separators=(",", ":"), allow_nan=False)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text + "\n")
    print("wrote %s (%d bytes)" % (os.path.relpath(path, REPO), len(text) + 1))


def assert_finite(values, label, allow_at=None):
    """All entries finite; entries at indices in *allow_at* may be non-finite."""
    arr = np.asarray(values, dtype=float).ravel()
    bad = np.flatnonzero(~np.isfinite(arr))
    if allow_at is not None:
        bad = np.array([i for i in bad if i not in set(allow_at)], dtype=int)
    if bad.size:
        raise AssertionError("non-finite reference value(s) in %s at %s: %s"
                             % (label, bad[:5].tolist(), arr[bad[:5]].tolist()))


# ------------------------------------------------------------ model helpers

def get_model(spec):
    if spec not in _MODEL_CACHE:
        _MODEL_CACHE[spec] = load_model(spec, dtype="double", platform="dll")
    return _MODEL_CACHE[spec]


def direct(spec, q):
    key = (spec, tuple(q.tolist()))
    if key not in _DIRECT_CACHE:
        _DIRECT_CACHE[key] = DirectModel(empty_data1D(q), get_model(spec), cutoff=CUTOFF)
    return _DIRECT_CACHE[key]


def pd_block(name, dist, n, nsigma, width):
    """All four polydispersity keys (omitting _pd_n would silently mean mono)."""
    return {name + "_pd": width, name + "_pd_n": n,
            name + "_pd_nsigma": nsigma, name + "_pd_type": dist}


def sasmodels_call(model_string, flat, low_q):
    """Translate the flat evaluate() parameter names into the exact sasmodels call."""
    if not low_q:
        return model_string, dict(flat)
    kwargs = {"scale": 1.0, "background": flat["background"],
              "B_scale": flat["lowq_scale"], "B_power": flat["lowq_power"],
              "A_scale": flat["scale"]}
    for key, value in flat.items():
        if key not in ("scale", "background", "lowq_scale", "lowq_power"):
            kwargs["A_" + key] = value
    return model_string + "+power_law", kwargs


def model_case(label, model, structure, flat, q, low_q=False):
    """Run one DirectModel case and wrap it as a fixture entry."""
    base = model + ("@" + structure if structure else "")
    spec, kwargs = sasmodels_call(base, flat, low_q)
    Iq = np.asarray(direct(spec, q)(**dict(kwargs)), dtype=float)
    assert_finite(Iq, label)
    if low_q:
        check_mixture_identity(label, base, flat, q, Iq)
    return {
        "label": label,
        "modelSpec": {"model": model, "structure": structure, "lowQPowerLaw": low_q},
        "pars": dict(flat),
        "Iq": Iq,
        "sasmodels": {"model": spec, "pars": kwargs},
    }


def check_mixture_identity(label, base, flat, q, Iq_mix):
    """Spec 4.5: I_total = I_model + A*q^-n with the background counted once."""
    plain = {k: v for k, v in flat.items() if k not in ("lowq_scale", "lowq_power")}
    plain["background"] = 0.0
    I_model = np.asarray(direct(base, q)(**plain), dtype=float)
    expect = I_model + flat["lowq_scale"] * q ** (-flat["lowq_power"]) + flat["background"]
    if not np.allclose(Iq_mix, expect, rtol=1e-11, atol=0.0):
        worst = float(np.max(np.abs(Iq_mix - expect) / np.abs(expect)))
        raise AssertionError("%s: sum-model mapping differs from I_model+A*q^-n, "
                             "worst rel diff %.3g" % (label, worst))


# ------------------------------------------------------------- weights.json

def _weights_inputs():
    """(label, type, center, width, npts, nsigmas, lower, upper, relative)"""
    c = []
    add = lambda *a: c.append(a)  # noqa: E731
    for width in (0.15, 0.3):
        add("gaussian w%s" % width, "gaussian", 50.0, width, 35, 3, 0.0, INF, True)
    add("gaussian truncated by lower 0", "gaussian", 10.0, 0.5, 35, 3, 0.0, INF, True)
    add("gaussian two-sided limits", "gaussian", 50.0, 0.2, 35, 3, 40.0, 60.0, True)
    add("gaussian even npts", "gaussian", 50.0, 0.2, 36, 3, 0.0, INF, True)
    add("gaussian absolute width (orientation-like)", "gaussian", 90.0, 3.0, 35, 3, -90.0, 90.0, False)
    add("rectangle default nsigmas", "rectangle", 50.0, 0.15, 35, 1.73205, 0.0, INF, True)
    add("rectangle w0.4", "rectangle", 50.0, 0.4, 35, 1.73205, 0.0, INF, True)
    add("rectangle truncated", "rectangle", 10.0, 0.5, 35, 1.73205, 0.0, INF, True)
    add("uniform", "uniform", 50.0, 0.2, 35, None, 0.0, INF, True)
    add("uniform truncated", "uniform", 10.0, 0.7, 35, None, 0.0, INF, True)
    add("uniform absolute", "uniform", 0.0, 5.0, 21, None, -90.0, 90.0, False)
    for width, ns in ((0.2, 8), (0.3, 8), (0.4, 8), (0.4, 3), (0.2, 3)):
        add("lognormal w%s ns%s" % (width, ns), "lognormal", 50.0, width, 80, ns, 0.0, INF, True)
    add("lognormal truncated", "lognormal", 10.0, 0.5, 80, 3, 5.0, 12.0, True)
    for width, ns in ((0.3, 3), (0.4, 3), (0.3, 8), (0.4, 8), (0.2, 3), (0.15, 3)):
        add("schulz w%s ns%s" % (width, ns), "schulz", 50.0, width, 80, ns, 0.0, INF, True)
    add("schulz npts 35", "schulz", 120.0, 0.2, 35, 3, 0.0, INF, True)
    add("schulz truncated by upper", "schulz", 50.0, 0.3, 80, 3, 0.0, 55.0, True)
    add("boltzmann", "boltzmann", 50.0, 0.2, 35, 3, 0.0, INF, True)
    add("boltzmann truncated", "boltzmann", 10.0, 0.5, 35, 3, 0.0, INF, True)
    add("gaussian width 0", "gaussian", 50.0, 0.0, 35, 3, 0.0, INF, True)
    add("schulz width 0", "schulz", 50.0, 0.0, 80, 8, 0.0, INF, True)
    add("gaussian width 0 out of limits", "gaussian", 10.0, 0.0, 35, 3, 20.0, INF, True)
    add("gaussian npts 0", "gaussian", 50.0, 0.2, 0, 3, 0.0, INF, True)
    add("schulz npts 1", "schulz", 50.0, 0.2, 1, 3, 0.0, INF, True)
    add("gaussian npts 2", "gaussian", 50.0, 0.2, 2, 3, 0.0, INF, True)
    return c


def gen_weights():
    cases = []
    for label, dist, center, width, npts, nsig, lower, upper, relative in _weights_inputs():
        x, w = weights.get_weights(dist, npts, width, nsig, center, [lower, upper], relative)
        assert_finite(x, "weights %s x" % label)
        assert_finite(w, "weights %s w" % label)
        cases.append({
            "label": label, "type": dist, "center": center, "width": width,
            "npts": npts, "nsigmas": nsig, "lower": lower, "upper": upper,
            "relative": relative, "x": x, "w": w,
            "sasmodels": {"function": "sasmodels.weights.get_weights",
                          "args": [dist, npts, width, nsig, center, [lower, upper], relative]},
        })
    zs = [0.1, 0.5, 1.0, 1.5, 2.5, 6.25, 10.0, 11.11111111111111, 25.0, 44.44444444444444,
          100.0, 1000.0, 10000.0]
    gl = [{"z": z, "gammaln": float(gammaln(z))} for z in zs]
    assert_finite([g["gammaln"] for g in gl], "gammaln")
    write_fixture("weights", {"sasmodelsVersion": sasmodels.__version__,
                              "function": "scipy.special.gammaln for the 'gammaln' list",
                              "cases": cases, "gammaln": gl})
    return len(cases)


# ------------------------------------------------------------------ fq.json

def _modes(name):
    return get_model(name).info.radius_effective_modes


def run_fq(spec, q, pars, mode):
    kernel = get_model(spec).make_kernel([q])
    call_pars = dict(pars)
    call_pars["radius_effective_mode"] = mode   # call_Fq pops it from this copy
    return call_Fq(kernel, call_pars, cutoff=CUTOFF)


def fq_case(label, name, pars, mode, q):
    F1, F2, reff, vshell, ratio = run_fq(name, q, pars, mode)
    assert F1 is not None, "%s: expected a have_Fq model" % label
    out = {"F1": F1, "F2": F2, "radiusEffective": reff, "shellVolume": vshell,
           "volumeRatio": ratio}
    for key, value in out.items():
        assert_finite(value, "fq %s %s" % (label, key))
    return {"label": label, "model": name, "pars": dict(pars), "cutoff": CUTOFF,
            "radiusEffectiveMode": mode, **out,
            "sasmodels": {"model": name,
                          "pars": dict(pars, radius_effective_mode=mode),
                          "call": "direct_model.call_Fq(kernel, pars, cutoff=%r)" % CUTOFF}}


def gen_fq():
    cases = []
    for name in S_CAPABLE:
        n_modes = len(_modes(name))
        for mode in range(0, n_modes + 1):
            cases.append(fq_case("%s default mode %d" % (name, mode), name, {}, mode, Q_FQ))
        pd = pd_block(FIRST_SIZE[name], "schulz", 80, 3, 0.2)
        for mode in sorted({1, n_modes}):
            cases.append(fq_case("%s schulz0.2 mode %d" % (name, mode), name, pd, mode, Q_FQ))
    write_fixture("fq", {"sasmodelsVersion": sasmodels.__version__, "cutoff": CUTOFF,
                         "q": Q_FQ, "cases": cases})
    return len(cases)


# ------------------------------------------------------------------ g1.json

def _g1_defaults(q):
    out = [model_case("%s default" % n, n, None, {}, q) for n in MODEL_ORDER]
    for s in STRUCTURE_MODELS:
        out.append(model_case("sphere@%s default" % s, "sphere", s, {}, q))
    return out


def _g1_single_pd(q):
    out = []
    for name, params in PD_PARAMS.items():
        info = get_model(name).info
        for par in params:
            assert par in info.parameters.pd_1d, (name, par)
            for dist, n, nsig, width in PD_DISTS:
                label = "%s %s %s n%d ns%s w%s" % (name, par, dist, n, nsig, width)
                out.append(model_case(label, name, None,
                                      pd_block(par, dist, n, nsig, width), q))
    return out


def _schulz_first(name):
    return pd_block(FIRST_SIZE[name], "schulz", 80, 3, 0.2)


def _g1_structure_modes(q):
    out = []
    for name in S_CAPABLE:
        for s in STRUCTURE_MODELS:
            for mode in (0, 1):
                pars = dict(_schulz_first(name), structure_factor_mode=mode)
                out.append(model_case("%s@%s sfmode %d schulz0.2" % (name, s, mode),
                                      name, s, pars, q))
    return out


def _g1_reff_modes(q):
    out = []
    for name in S_CAPABLE:
        n_modes = len(_modes(name))
        for mode in range(0, n_modes + 1):
            pars = dict(_schulz_first(name), structure_factor_mode=0,
                        radius_effective_mode=mode)
            if mode == 0:
                pars["radius_effective"] = 60.0
            out.append(model_case("%s@hardsphere reff mode %d" % (name, mode),
                                  name, "hardsphere", pars, q))
    return out


def _g1_vesicle(q):
    p_info = get_model("vesicle").info
    ps_info = get_model("vesicle@hardsphere").info
    p_ids = [p.id for p in ps_info.parameters.call_parameters]
    assert "volfraction" in [p.id for p in p_info.parameters.call_parameters]
    assert p_ids.count("volfraction") == 1, p_ids
    assert not any(i.startswith("volfraction_") for i in p_ids), p_ids
    pars = dict(_schulz_first("vesicle"), volfraction=0.05, structure_factor_mode=1)
    return [model_case("vesicle@hardsphere own volfraction beta", "vesicle", "hardsphere", pars, q)]


def _g1_low_q(q):
    base = {"scale": 0.8, "background": 0.002, "lowq_scale": 1e-6, "lowq_power": 4.0}
    out = [
        model_case("sphere+power_law", "sphere", None, dict(base), q, True),
        model_case("cylinder+power_law", "cylinder", None, dict(base), q, True),
    ]
    ps = dict(base, structure_factor_mode=1, radius_effective_mode=1,
              **_schulz_first("sphere"))
    out.append(model_case("sphere@hardsphere+power_law schulz beta", "sphere",
                          "hardsphere", ps, q, True))
    return out


def _g1_two_pd(q):
    pars = dict(pd_block("radius", "gaussian", 15, 3, 0.15),
                **pd_block("length", "gaussian", 15, 3, 0.2))
    return [model_case("cylinder radius+length gaussian n15", "cylinder", None, pars, q)]


def gen_g1():
    q = Q_GRID
    groups = [_g1_defaults(q), _g1_single_pd(q), _g1_structure_modes(q),
              _g1_reff_modes(q), _g1_vesicle(q), _g1_low_q(q), _g1_two_pd(q)]
    cases = [c for g in groups for c in g]
    write_fixture("g1", {"sasmodelsVersion": sasmodels.__version__, "cutoff": CUTOFF,
                         "q": q, "cases": cases})
    return [len(g) for g in groups], len(cases)


# ------------------------------------------------------------------ g2.json

Q_ZERO = np.array([0.0, 0.001, 0.01, 0.1, 1.0])


def g2_case(label, name, pars, q, q_key):
    with np.errstate(all="ignore"):
        Iq = np.asarray(direct(name, q)(**dict(pars)), dtype=float)
    zero_idx = [i for i, v in enumerate(q) if v == 0.0]
    assert_finite(Iq, "g2 " + label, allow_at=zero_idx)
    return {"label": label, "model": name, "qKey": q_key, "pars": dict(pars), "Iq": Iq,
            "sasmodels": {"model": name, "pars": dict(pars)}}


def gen_g2():
    gp = "guinier_porod"
    specs = [
        ("guinier_porod default", gp, {}),
        # default ql = sqrt((3-1)(3-1)/2)/60 = 0.0236 sits inside the grid
        ("guinier_porod rg30 s0.5 porod4", gp, {"rg": 30.0, "s": 0.5, "porod_exp": 4.0}),
        ("guinier_porod rg100 s0 porod3 scale2 bg0.01", gp,
         {"rg": 100.0, "s": 0.0, "porod_exp": 3.0, "scale": 2.0, "background": 0.01}),
        ("guinier_porod rg15 s1.5 porod2.5", gp, {"rg": 15.0, "s": 1.5, "porod_exp": 2.5}),
        ("guinier_porod rg<=0 -> bg only", gp, {"rg": 0.0, "background": 0.003}),
        ("guinier_porod porod_exp<=s -> bg only", gp,
         {"rg": 60.0, "s": 2.0, "porod_exp": 1.5, "background": 0.003}),
        ("guinier_porod porod_exp==s -> bg only", gp,
         {"rg": 60.0, "s": 1.0, "porod_exp": 1.0, "background": 0.003}),
        ("power_law default", "power_law", {}),
        ("power_law power2 scale0.01", "power_law", {"power": 2.0, "scale": 0.01}),
        ("power_law power3.5 bg0.002", "power_law", {"power": 3.5, "background": 0.002}),
        ("power_law power-1", "power_law", {"power": -1.0, "scale": 5.0}),
    ]
    zero_specs = [
        ("guinier_porod default q includes 0 (s=1 -> inf)", gp, {}),
        ("guinier_porod s0 q includes 0 (finite)", gp, {"rg": 60.0, "s": 0.0, "porod_exp": 3.0}),
        ("power_law default q includes 0 (inf)", "power_law", {}),
    ]
    cases = [g2_case(l, n, p, Q_GRID, "q") for l, n, p in specs]
    cases += [g2_case(l, n, p, Q_ZERO, "qZero") for l, n, p in zero_specs]
    # sasmodels' actual q=0 behaviour (kernelpy may differ from the raw formula)
    by_label = {c["label"]: c for c in cases}
    assert math.isinf(by_label["guinier_porod default q includes 0 (s=1 -> inf)"]["Iq"][0])
    assert math.isfinite(by_label["guinier_porod s0 q includes 0 (finite)"]["Iq"][0])
    assert math.isinf(by_label["power_law default q includes 0 (inf)"]["Iq"][0])
    write_fixture("g2", {"sasmodelsVersion": sasmodels.__version__, "cutoff": CUTOFF,
                         "q": Q_GRID, "qZero": Q_ZERO, "cases": cases})
    return len(cases)


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


# --------------------------------------------------------------------- main

def main():
    assert sasmodels.__version__ == EXPECTED_VERSION, sasmodels.__version__
    n_w = gen_weights()
    n_fq = gen_fq()
    g1_groups, n_g1 = gen_g1()
    n_g2 = gen_g2()
    per_model, n_g3 = gen_g3()
    print("cases: weights=%d fq=%d g1=%d %s g2=%d g3=%d" % (n_w, n_fq, n_g1, g1_groups, n_g2, n_g3))


if __name__ == "__main__":
    sys.exit(main())
