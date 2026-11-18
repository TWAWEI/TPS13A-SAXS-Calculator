"""Generate the numerical reference fixtures for the sasfit JS compute core.

AUTO-GENERATION TOOL -- the output files are never edited by hand:

    SAS_OPENCL=none tools/sasfit/.venv/bin/python tools/sasfit/gen_reference.py

writes (byte-stable, no timestamps)

    saxs-calculator/tests/fixtures/sasfit/weights.json   weights.get_weights + gammaln
    saxs-calculator/tests/fixtures/sasfit/fq.json        direct_model.call_Fq outputs
    saxs-calculator/tests/fixtures/sasfit/g1.json        gate G1 (DirectModel, cutoff 1e-5)
    saxs-calculator/tests/fixtures/sasfit/g2.json        gate G2 (python-kernel models)
    saxs-calculator/tests/fixtures/sasfit/g3.json        gate G3 (sasmodels' own model_info.tests)
    saxs-calculator/tests/fixtures/sasfit/kernel-args.json   details/values buffers (make_kernel_args)

The reference DLLs are built with -ffp-contract=off into a dedicated cache
(tools/sasfit/build/dll-nofma): WebAssembly has no FMA, so an FMA-built native
reference is not reproducible in the browser.  See tools/sasfit/sas_env.py.

Every model case also records `sasmodels: {model, pars}`: the exact model string
passed to `load_model` and the exact keyword arguments passed to sasmodels
(sum-model `A_`/`B_` names for the low-Q power-law cases), so the provenance is
auditable.  The `pars` of a case use the flat names of the JS `evaluate` API.

Every g1 case with a structure factor also records `intermediates`, read from
sasmodels' own product kernel (`kernel.results()`, product.py:288-311):
`radiusEffectiveP` (what P returned: 0 in radius_effective_mode 0),
`radiusEffectiveUsed` (the value S was evaluated with: P's when the mode is
> 0, the radius_effective parameter otherwise), `volumeRatio`, `shellVolume`
and `S`.  They let the JS tests gate P@S at component level: hardsphere.c
cancels catastrophically for 2qR ~ 0.05-0.13, where a 1-ulp change of R_eff
moves S(q) by 2.3e-9, so the end-to-end I(q) cannot be held to 1e-9.

Cases added after the M1 review are appended to g1 (label prefixes `hmsa:`,
`dist:`, `pd3:`), so every earlier case keeps its bytes.  Two optional fields:
`gate: "component"` (P@hayter_msa with non-default S parameters: upstream
hayter_msa.c is erratic at low q, so only the component layers are gated and
the end-to-end curve is not compared -- spec 16) and a per-case `q` where the
grid differs from the top-level one.

The generator is three modules: ref_common.py (build setup, model lists, JSON
writer), this file (weights, fq, g1, g2, main) and gen_reference_g3.py (g3,
kernel-args).

sasmodels 1.0.12 is the source of truth.  Spec: docs/superpowers/specs/
2026-11-17-sasfit-a-design.md section 4 and 11; plan: docs/superpowers/plans/
2026-11-18-sasfit-m1-compute-core.md Task 2.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep tools/sasfit free of __pycache__ (before the local imports)

import ref_common  # noqa: E402,F401  (first: configures the strict-IEEE build before sasmodels is imported)
from ref_common import (CUTOFF, EXPECTED_VERSION, FIRST_SIZE, INF, MODEL_ORDER, PD_DISTS,
                        PD_PARAMS, Q_FQ, Q_GRID, REPO, S_CAPABLE, STRUCTURE_MODELS,
                        _MODEL_CACHE, assert_finite, direct, get_model, np, pd_block, sas_env,
                        write_fixture)

import sasmodels  # noqa: E402
from scipy.special import gammaln  # noqa: E402
from sasmodels import weights  # noqa: E402
from sasmodels.direct_model import call_Fq  # noqa: E402

from gen_reference_g3 import gen_g3, gen_kernel_args  # noqa: E402


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


def model_case(label, model, structure, flat, q, low_q=False, gate=None, own_q=False):
    """Run one DirectModel case and wrap it as a fixture entry.

    *gate* and *own_q* add the optional `gate` / `q` fields (after the others).
    """
    base = model + ("@" + structure if structure else "")
    spec, kwargs = sasmodels_call(base, flat, low_q)
    calc = direct(spec, q)
    Iq = np.asarray(calc(**dict(kwargs)), dtype=float)
    assert_finite(Iq, label)
    if low_q:
        check_mixture_identity(label, base, flat, q, Iq)
    entry = {
        "label": label,
        "modelSpec": {"model": model, "structure": structure, "lowQPowerLaw": low_q},
        "pars": dict(flat),
        "Iq": Iq,
        "sasmodels": {"model": spec, "pars": kwargs},
    }
    if structure:
        entry["intermediates"] = product_intermediates(label, calc.results(), structure, flat)
    if gate:
        entry["gate"] = gate
    if own_q:
        entry["q"] = q
    return entry


def _product_parts(results):
    """The _Intermediates dict of the P@S kernel; nested one level in a sum model."""
    if "S(Q)" in results:
        return results
    nested = [v for v in results.values() if isinstance(v, dict) and "S(Q)" in v]
    assert len(nested) == 1, list(results)
    return nested[0]


def product_intermediates(label, results, structure, flat):
    """P@S intermediates as sasmodels exposes them (product.py:288-311)."""
    parts = _product_parts(results)
    mode = int(flat.get("radius_effective_mode", 1))        # product.py:165, 437
    reff_p = float(parts["radius_effective"])
    s_info = get_model(structure).info
    user = float(flat.get("radius_effective", s_info.parameters.defaults["radius_effective"]))
    assert (reff_p == 0.0) == (mode == 0), (label, mode, reff_p)
    out = {
        "radiusEffectiveP": reff_p,
        # product.py:488, 506-508: S keeps the parameter value unless the mode is > 0
        "radiusEffectiveUsed": reff_p if mode > 0 else user,
        "volumeRatio": float(parts["volume_ratio"]),
        "shellVolume": float(parts["volume"]),
        "S": np.asarray(parts["S(Q)"][1], dtype=float),
    }
    for key, value in out.items():
        assert_finite(value, "g1 %s intermediates %s" % (label, key))
    return out


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


def _g1_s_polydisperse(q):
    """S.radius_effective polydisperse (hayter_msa only): averaged in mode 0, ignored otherwise."""
    name = "sphere@hayter_msa"
    spd = pd_block("radius_effective", "gaussian", 35, 3, 0.1)
    out = [
        model_case("spd: %s mode 0 radius_effective gaussian0.1" % name, "sphere", "hayter_msa",
                   dict(spd, radius_effective_mode=0), q),
        model_case("spd: %s mode 0 radius_effective gaussian0.1 beta schulz0.2" % name,
                   "sphere", "hayter_msa",
                   dict(spd, radius_effective_mode=0, structure_factor_mode=1,
                        **_schulz_first("sphere")), q),
        model_case("spd: %s mode 1 radius_effective gaussian0.1 (ignored)" % name,
                   "sphere", "hayter_msa", dict(spd, radius_effective_mode=1), q),
    ]
    mono0 = np.asarray(direct(name, q)(radius_effective_mode=0), dtype=float)
    mono1 = np.asarray(direct(name, q)(radius_effective_mode=1), dtype=float)
    assert not np.allclose(out[0]["Iq"], mono0, rtol=1e-6, atol=0.0), "S pd had no effect in mode 0"
    # product.py:480-483, 506-509: with R_eff from P the S distribution is forced to length 1
    assert np.array_equal(out[2]["Iq"], mono1), "S pd changed the mode-1 result"
    return out


def _g1_two_pd(q):
    pars = dict(pd_block("radius", "gaussian", 15, 3, 0.15),
                **pd_block("length", "gaussian", 15, 3, 0.2))
    return [model_case("cylinder radius+length gaussian n15", "cylinder", None, pars, q)]


def _hmsa(charge, salt, volfraction, temperature=298.15, dielectconst=78.5):
    return {"charge": charge, "concentration_salt": salt, "volfraction": volfraction,
            "temperature": temperature, "dielectconst": dielectconst}


# A protein-sized ellipsoid.  The default (20 x 400 A) has R_eff = 270.7 A, and with
# charge 12, salt 0.1 M, volfraction 0.15 hayter_msa.c then returns garbage near
# 2qR = 70 (S = 0.856 native / 0.816 wasm at q = 0.1290 and 1.818 at q = 0.1335,
# between neighbours at 1.0000): not a case any tolerance can gate (spec 16).
ELLIPSOID = {"radius_polar": 40.0, "radius_equatorial": 25.0}
# (P, P parameters, P polydisperse, structure_factor_mode, S parameters): protein-like regimes.
# The mono ellipsoid case has volfraction 0.05 because with 0.15 (R_eff = 29.8 A) the wasm
# and the native S(q) differ by 1.3e-9 at 2qR = 0.09 for identical inputs (libm, 1 ulp):
# the 1e-9 component gate cannot hold there, and it is not loosened.
HMSA_PRODUCTS = [
    ("sphere", {}, False, 0, _hmsa(10.0, 0.05, 0.05)),
    ("sphere", {}, True, 1, _hmsa(16.3, 0.056, 0.056, 318.16, 71.08)),
    ("core_shell_sphere", {}, True, 0, _hmsa(8.0, 0.15, 0.1)),
    ("core_shell_sphere", {}, False, 1, _hmsa(20.0, 0.02, 0.02, 310.15, 74.2)),
    ("ellipsoid", ELLIPSOID, False, 0, _hmsa(12.0, 0.1, 0.05)),
    ("ellipsoid", ELLIPSOID, True, 1, _hmsa(9.0, 0.03, 0.08, 283.15, 83.8)),
    ("cylinder", {}, False, 1, _hmsa(15.0, 0.03, 0.08)),
    ("cylinder", {}, True, 0, _hmsa(18.0, 0.12, 0.2, 310.15, 74.2)),
]
# radius_effective and S parameters of the plain S(q) cases
HMSA_PLAIN = [
    (20.75, _hmsa(10.0, 0.05, 0.05)),
    (30.0, _hmsa(8.0, 0.15, 0.1, 310.15, 74.2)),
    (45.0, _hmsa(20.0, 0.02, 0.02)),
    (93.0, _hmsa(16.3, 0.056, 0.056, 318.16, 71.08)),
]
HMSA_MIN_2QR = 0.15   # below ~0.1 a 1-ulp change of R moves S by up to 4.5e-4 (spec 16)


def _g1_hayter(q):
    """hayter_msa with non-default parameters (the defaults leave salt at 0).

    P@hayter_msa is gated at component level only (`gate`); the plain S(q)
    cases are strict on a grid of their own that starts at 2qR = 0.15.
    """
    out = []
    for name, p_pars, poly, mode, s_pars in HMSA_PRODUCTS:
        pars = dict(p_pars, **s_pars, structure_factor_mode=mode,
                    **(_schulz_first(name) if poly else {}))
        label = ("hmsa: %s@hayter_msa sfmode %d %s charge %g salt %g volfraction %g"
                 % (name, mode, "schulz0.2" if poly else "mono", s_pars["charge"],
                    s_pars["concentration_salt"], s_pars["volfraction"]))
        out.append(model_case(label, name, "hayter_msa", pars, q, gate="component"))
    for radius, s_pars in HMSA_PLAIN:
        own_q = np.logspace(np.log10(HMSA_MIN_2QR / (2.0 * radius)), 0.0, len(q))
        assert 2.0 * own_q[0] * radius >= HMSA_MIN_2QR * (1 - 1e-12), (radius, own_q[0])
        label = ("hmsa: hayter_msa S(q) R %g charge %g salt %g volfraction %g"
                 % (radius, s_pars["charge"], s_pars["concentration_salt"], s_pars["volfraction"]))
        out.append(model_case(label, "hayter_msa", None, dict(s_pars, radius_effective=radius),
                              own_q, own_q=True))
    return out


# (distribution, n, nsigma, relative width) evaluated inside the kernel loop
KERNEL_DISTS = [("lognormal", 80, 3, 0.2), ("rectangle", 35, 1.73205, 0.15),
                ("uniform", 35, 3, 0.2), ("boltzmann", 35, 3, 0.1)]


def _g1_distributions(q):
    """The four distributions G1 did not yet run through a kernel."""
    return [model_case("dist: %s %s %s n%d ns%s w%s" % (name, par, dist, n, nsig, width),
                       name, None, pd_block(par, dist, n, nsig, width), q)
            for name, par in (("sphere", "radius"), ("cylinder", "length"))
            for dist, n, nsig, width in KERNEL_DISTS]


def _g1_three_pd(q):
    """Three polydisperse parameters at once: 8^3 = 512 mesh points, 6 chunks of 100."""
    out = []
    for name, blocks in (
            ("core_shell_cylinder", [("radius", "gaussian", 8, 3, 0.15),
                                     ("thickness", "schulz", 8, 3, 0.2),
                                     ("length", "lognormal", 8, 3, 0.1)]),
            ("flexible_cylinder", [("length", "lognormal", 8, 3, 0.15),
                                   ("kuhn_length", "gaussian", 8, 3, 0.1),
                                   ("radius", "schulz", 8, 3, 0.2)])):
        pars = {}
        for block in blocks:
            pars.update(pd_block(*block))
        label = "pd3: %s %s n8" % (name, " ".join("%s-%s" % b[:2] for b in blocks))
        out.append(model_case(label, name, None, pars, q))
    return out


def gen_g1():
    q = Q_GRID
    groups = [_g1_defaults(q), _g1_single_pd(q), _g1_structure_modes(q),
              _g1_reff_modes(q), _g1_vesicle(q), _g1_low_q(q), _g1_two_pd(q),
              _g1_s_polydisperse(q),
              # appended after the M1 review; keep them last
              _g1_hayter(q), _g1_distributions(q), _g1_three_pd(q)]
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


# --------------------------------------------------------------------- main

def _dll_paths(model):
    """DLL paths behind a loaded model (product: P and S; mixture: parts)."""
    if hasattr(model, "dllpath"):
        return [model.dllpath]
    parts = getattr(model, "parts", None) or [getattr(model, k) for k in ("P", "S")
                                              if hasattr(model, k)]
    return [path for part in parts for path in _dll_paths(part)]


def verify_build():
    """The references came from no-FMA DLLs in the dedicated cache (sas_env)."""
    paths = sorted({p for m in _MODEL_CACHE.values() for p in _dll_paths(m)})
    assert len(paths) == len(MODEL_ORDER) - 2, paths   # 13 C models; 2 are python kernels
    return sas_env.verify_cache(paths)


def main():
    assert sasmodels.__version__ == EXPECTED_VERSION, sasmodels.__version__
    command = sas_env.verify()
    print("compile command: %s" % " ".join(command))
    n_w = gen_weights()
    n_fq = gen_fq()
    g1_groups, n_g1 = gen_g1()
    n_g2 = gen_g2()
    per_model, n_g3 = gen_g3()
    n_ka = gen_kernel_args()
    n_dll = verify_build()
    print("cases: weights=%d fq=%d g1=%d %s g2=%d g3=%d kernel-args=%d"
          % (n_w, n_fq, n_g1, g1_groups, n_g2, n_g3, n_ka))
    print("no-FMA DLLs in %s: %d" % (os.path.relpath(sas_env.DLL_DIR, REPO), n_dll))


if __name__ == "__main__":
    sys.exit(main())
