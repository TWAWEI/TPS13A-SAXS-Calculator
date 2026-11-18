"""Generate the fit references of the sasfit JS fitter (gate G4) and its SVD.

AUTO-GENERATION TOOL -- the output files are never edited by hand:

    tools/sasfit/.venv/bin/python tools/sasfit/gen_reference_fit.py

writes (byte-stable, no timestamps)

    saxs-calculator/tests/fixtures/sasfit/svd.json   matrices with their exact SVD and covariance
    saxs-calculator/tests/fixtures/sasfit/fit.json   bumps 1.0.4 `lm` fits, polished to the minimum

svd.json.  Every matrix is built as U*diag(s)*V' (or as a column-scaled matrix)
and stored as float64.  The reference singular values and the covariance
C = V*diag(1/max(s, 1e-8)^2)*V' (bumps lsqerror.py:283-285) are those of the
*stored* matrix, computed by a one-sided Jacobi SVD in 60-digit decimal
arithmetic -- not by LAPACK, whose smallest singular value is off by ~1e-5
relative at condition number 1e12.  numpy's values and bumps' `jacobian_cov`
are cross-checks only (the latter on the matrices with condition <= 1e6).

fit.json.  bumps' `lm` (MPFit) iterates with its own forward-difference
Jacobian, step sqrt(1.19209e-7)*|p| (fitters.py:711, mpfit.py:1561,1587), so
it stops a little away from the true minimum, by an amount that depends on the
start and on the noise.  The reference `values` are therefore the bumps result
polished with scipy.optimize.least_squares (3-point Jacobian, tolerances
1e-15); `stderr`, `covariance`, `jacobian` and `residuals` are recomputed at
the polished point with bumps' own lsqerror functions.  The raw bumps result
is kept as `bumpsRaw`.  A parameter that bumps leaves on a bound is held there
exactly while the others are polished (design spec 15, decision 20).

Cases appended after the M2 review (labels 10a-13) come after the first twelve,
whose bytes do not change.  They add what the first twelve do not exercise:
"dirty" data on which the site's mask removes points (sigma = 0, sigma < 0,
I = 0, and noise-dominated I <= 0) under each of the four weightings, a fit
range restricted on both sides, a parameter pegged on a bound while the free
ones are nonlinear, and a P@hayter_msa fit.  bumps keeps points with dy <= 0,
so the script applies the site's mask and range itself before it builds the
data for bumps; the fixture stores the FULL data, the `range` and `nUsed`, the
number of points that take part.

The script raises, and writes nothing, when a case is not converged, when the
raw and the polished solution differ by 0.02 sigma or more, when the polished
point is not stationary, or when a bound case is not exactly on its bound.

Conventions of bumps (also stored in the fixture): residual = (theory - I)/dI
(the site uses the opposite sign; the covariance does not care);
nllf = sum(r^2)/2; chisq = sum(r^2)/dof; dof = points - fitted parameters;
dx = stderr(jacobian_cov(jacobian(problem, x))), NOT multiplied by sqrt(chisq).

Plan: docs/superpowers/plans/2026-11-18-sasfit-m2-worker-fitter.md, Task 2 and
the review section A-C.
"""
import decimal
import sys

sys.dont_write_bytecode = True  # keep tools/sasfit free of __pycache__ (before the local imports)

import ref_common  # noqa: E402,F401  (first: configures the strict-IEEE build before sasmodels is imported)
from ref_common import CUTOFF, EXPECTED_VERSION, INF, get_model, np, sas_env, write_fixture  # noqa: E402

import bumps  # noqa: E402
import sasmodels  # noqa: E402
from bumps import lsqerror  # noqa: E402
from bumps.fitproblem import FitProblem  # noqa: E402
from bumps.fitters import fit as bumps_fit  # noqa: E402
from sasmodels.bumps_model import Experiment, Model  # noqa: E402
from sasmodels.data import Data1D  # noqa: E402
from sasmodels.direct_model import DirectModel  # noqa: E402
from scipy.optimize import least_squares  # noqa: E402

EXPECTED_BUMPS = "1.0.4"
Q_FIT = np.logspace(-2.3, -0.5, 120)
STEPS, FTOL, XTOL = 200, 1e-10, 1e-10      # bumps lm defaults (fitters.py MPFit.settings)
SV_FLOOR = 1e-8                            # lsqerror.jacobian_cov tol
DIRTY_FLOOR = 8e-3                         # noise floor of the "dirty" data of cases 10a-10d
# Noise seed of cases 10a-10d.  The first design used seed 110: there bumps' raw |I|-weighted
# result (10c) ended 0.041 sigma from the polished minimum (seed 116: 0.037), outside the 0.02
# sigma "same solution" check, so it could not serve as a reference.  With this seed all four
# weightings pass the unchanged checks on the same data.
DIRTY_SEED = 119
RAW_VS_POLISHED_MAX = 0.02                 # sigma; raw bumps and polished are the same solution
REFIT_MOVE_MAX = 1e-3                      # sigma; a refit from the solution stays put
STATIONARY_MAX = 1e-4                      # sigma; Gauss-Newton step left at the polished point (P@S: ~3e-6, hardsphere.c round-off)
LOWQ = ("lowq_scale", "lowq_power")
MODES = ("sigma", "sqrtI", "absI", "none")


# ----------------------------------------------------------- exact SVD (svd.json)

def _exact_svd(A):
    """One-sided Jacobi SVD of the float64 matrix *A* in 60-digit decimals: (s, V)."""
    D = decimal.Decimal
    m, n = A.shape
    U = [[D(float(A[i, j])) for j in range(n)] for i in range(m)]
    V = [[D(int(i == j)) for j in range(n)] for i in range(n)]
    tiny = D(10) ** -55
    for _sweep in range(60):
        rotated = False
        for p in range(n - 1):
            for q in range(p + 1, n):
                a = sum(U[i][p] * U[i][p] for i in range(m))
                b = sum(U[i][q] * U[i][q] for i in range(m))
                g = sum(U[i][p] * U[i][q] for i in range(m))
                if g == 0 or abs(g) <= tiny * (a * b).sqrt():
                    continue
                rotated = True
                zeta = (b - a) / (2 * g)
                t = (1 if zeta >= 0 else -1) / (abs(zeta) + (1 + zeta * zeta).sqrt())
                c = 1 / (1 + t * t).sqrt()
                s = c * t
                for M in (U, V):
                    for row in M:
                        row[p], row[q] = c * row[p] - s * row[q], s * row[p] + c * row[q]
        if not rotated:
            break
    else:
        raise RuntimeError("decimal Jacobi SVD did not converge")
    return [sum(U[i][j] * U[i][j] for i in range(m)).sqrt() for j in range(n)], V


def _exact_cov(s, V):
    D = decimal.Decimal
    n = len(s)
    inv = [1 / max(sj, D(SV_FLOOR)) ** 2 for sj in s]
    return np.array([[float(sum(V[i][k] * inv[k] * V[j][k] for k in range(n)))
                      for j in range(n)] for i in range(n)])


def _from_usv(rng, m, n, s):
    U = np.linalg.qr(rng.normal(size=(m, n)))[0]
    V = np.linalg.qr(rng.normal(size=(n, n)))[0]
    return (U * np.asarray(s, dtype=float)) @ V.T


def _svd_matrices():
    """(label, A, built singular values or None) -- fixed seeds, eight matrices."""
    rng = np.random.default_rng(20261118)
    out = [
        ("5x3", _from_usv(rng, 5, 3, [3.0, 1.5, 0.4])),
        ("20x6", _from_usv(rng, 20, 6, [50.0, 20.0, 7.0, 2.0, 0.9, 0.3])),
        ("50x12", _from_usv(rng, 50, 12, np.logspace(2, -2, 12))),
        ("rank-deficient 10x4", _from_usv(rng, 10, 4, [3.0, 1.0, 0.5, 0.0])),
        ("condition 1e12 8x4", _from_usv(rng, 8, 4, [1e3, 1e1, 1e-2, 1e-9])),
        ("column scales 1e8 12x3", _from_usv(rng, 12, 3, [2.0, 1.0, 0.5]) * np.array([1.0, 1e4, 1e8])),
        ("1x1", np.array([[2.5]])),
        ("n=1 6x1", rng.normal(size=(6, 1))),
    ]
    return out


def gen_svd():
    decimal.getcontext().prec = 60
    cases = []
    for label, A in _svd_matrices():
        s_dec, V = _exact_svd(A)
        s = np.sort(np.array([float(v) for v in s_dec]))[::-1]
        C = _exact_cov(s_dec, V)
        s_np = np.linalg.svd(A, compute_uv=False)
        if not np.allclose(s_np, s, rtol=0, atol=1e-10 * s[0]):
            raise RuntimeError("numpy and exact singular values disagree: %s" % label)
        ill = bool(np.any(s <= SV_FLOOR))
        if s[0] / max(s[-1], 1e-300) <= 1e6:
            scale = np.sqrt(np.outer(np.diag(C), np.diag(C)))
            worst = float(np.max(np.abs(lsqerror.jacobian_cov(A) - C) / scale))
            if worst > 1e-8:
                raise RuntimeError("bumps jacobian_cov disagrees with the exact C: %s %g" % (label, worst))
        cases.append({"label": label, "m": A.shape[0], "n": A.shape[1], "A": A,
                      "s": s, "C": C, "illConditioned": ill})
        print("svd %-24s s_max %.3g s_min %.3g illConditioned %s" % (label, s[0], s[-1], ill))
    write_fixture("svd", {"floor": SV_FLOOR, "source": "exact (60-digit Jacobi) SVD of the stored A",
                          "cases": cases})
    return len(cases)


# ------------------------------------------------------------- fit cases (fit.json)

SPHERE = {"scale": 0.02, "background": 0.005, "sld": 1.0, "sld_solvent": 6.0, "radius": 50.0}
SPHERE_BOUNDS = {"scale": (0.0, INF), "radius": (1.0, 1000.0), "background": (-INF, INF)}
SPHERE_START = {"scale": 0.025, "radius": 57.0, "background": 0.004}
COIL = {"scale": 1.0, "background": 0.001, "i_zero": 70.0, "rg": 75.0}
SCHULZ = {"radius_pd_type": "schulz", "radius_pd_n": 80, "radius_pd_nsigma": 3}


def _case(label, model, truth, start, bounds, seed, structure=None, low_q=False,
          weighting="sigma", floor=1e-4, at_bound=None, alt_start=None, q=None,
          dirty=None, q_range=None):
    """One fit case.  q: its own grid (default Q_FIT); dirty: {"sigmaZero", "sigmaNegative",
    "iZero": index lists, "nonPositive": (min, max) points with I <= 0 the script insists on};
    q_range: (qMin, qMax), both inclusive.  Cases with dirty or q_range store `nUsed`."""
    return {"label": label, "model": model, "structure": structure, "lowQ": low_q,
            "truth": truth, "start": start, "bounds": bounds, "seed": seed,
            "weighting": weighting, "floor": floor, "atBound": at_bound or {},
            "altStart": alt_start, "q": Q_FIT if q is None else q, "dirty": dirty,
            "range": q_range}


def fit_cases():
    """The G4 cases (design spec 11): one per model class, a PD width, bounds, weights."""
    cases = [
        _case("1 sphere", "sphere", SPHERE, SPHERE_START, SPHERE_BOUNDS, 101),
        _case("2 core_shell_sphere", "core_shell_sphere",
              {"scale": 0.05, "background": 0.001, "radius": 60.0, "thickness": 10.0,
               "sld_core": 1.0, "sld_shell": 2.0, "sld_solvent": 3.0},
              {"radius": 70.0, "thickness": 12.0, "scale": 0.06},
              {"radius": (1.0, 1000.0), "thickness": (1.0, 1000.0), "scale": (0.0, INF)}, 102),
        _case("3 cylinder", "cylinder",
              {"scale": 0.03, "background": 0.001, "sld": 4.0, "sld_solvent": 1.0,
               "radius": 20.0, "length": 400.0},
              {"radius": 23.0, "length": 320.0, "scale": 0.036},
              {"radius": (1.0, 1000.0), "length": (1.0, 100000.0), "scale": (0.0, INF)}, 103),
        _case("4 mono_gauss_coil", "mono_gauss_coil", COIL,
              {"i_zero": 55.0, "rg": 60.0, "background": 0.0012},
              {"i_zero": (0.0, INF), "rg": (1.0, 1000.0), "background": (-INF, INF)}, 104,
              floor=1e-3),
        _case("5 sphere@hardsphere", "sphere",
              {"scale": 0.02, "background": 0.001, "sld": 1.0, "sld_solvent": 6.0, "radius": 50.0,
               "volfraction": 0.2, "radius_effective": 50.0, "radius_effective_mode": 1,
               "structure_factor_mode": 0},
              {"radius": 56.0, "volfraction": 0.15, "scale": 0.024},
              {"radius": (1.0, 1000.0), "volfraction": (0.0, 0.6), "scale": (0.0, INF)}, 105,
              structure="hardsphere"),
        _case("6 sphere radius_pd schulz", "sphere", dict(SPHERE, radius_pd=0.15, **SCHULZ),
              {"radius": 45.0, "radius_pd": 0.2},
              {"radius": (1.0, 1000.0), "radius_pd": (0.0, 0.4)}, 106),
        _case("7 sphere+power_law", "sphere", dict(SPHERE, lowq_scale=1e-8, lowq_power=4.0),
              {"radius": 56.0, "lowq_scale": 1.3e-8, "background": 0.004},
              {"radius": (1.0, 1000.0), "lowq_scale": (0.0, INF), "background": (-INF, INF)}, 107,
              low_q=True),
        _case("8a upper bound: mono_gauss_coil rg", "mono_gauss_coil", COIL,
              {"i_zero": 55.0, "rg": 60.0},
              {"i_zero": (0.0, INF), "rg": (1.0, 70.0)}, 108, floor=1e-3,
              at_bound={"rg": "upper"}, alt_start={"i_zero": 85.0, "rg": 40.0}),
        # Radius held at a lower bound 3 sigma above the truth; scale and background, which stay
        # free, are linear, so bumps' forward-difference gradient is exact for them.  Two earlier
        # designs pegged the *background* of this sphere (bound 0.002, then 0.00115, truth 0.001)
        # and left the radius free: raw bumps then ended 0.055 and 0.031 sigma (radius) from the
        # constrained minimum, and its results from different starts spread over 0.02 sigma --
        # outside the 0.02 sigma "same solution" check, so those could not serve as a reference.
        _case("8b lower bound: sphere radius", "sphere", SPHERE, SPHERE_START,
              {"scale": (0.0, INF), "radius": (50.05, 1000.0), "background": (-INF, INF)}, 109,
              at_bound={"radius": "lower"},
              alt_start={"scale": 0.016, "radius": 54.0, "background": 0.006}),
    ]
    for tag, mode in (("9a", "sqrtI"), ("9b", "absI"), ("9c", "none")):
        cases.append(_case("%s sphere weighting %s" % (tag, mode), "sphere", SPHERE,
                           SPHERE_START, SPHERE_BOUNDS, 101, weighting=mode))
    return cases + review_cases()


Q_DIRTY = np.logspace(-2.3, -0.5, 150)
# Background-subtracted-looking sphere data: no background, a noise floor that dominates the
# last third of the curve, so that noise alone makes about a dozen intensities negative.
DIRTY_TRUTH = {"scale": 0.02, "background": 0.0, "sld": 1.0, "sld_solvent": 6.0, "radius": 50.0}
DIRTY = {"sigmaZero": [0, 1, 40, 77], "sigmaNegative": [55], "iZero": [128, 141],
         "nonPositive": (10, 16)}
HMSA_TRUTH = {"scale": 1.0, "background": 0.001, "sld": 1.0, "sld_solvent": 6.0, "radius": 30.0,
              "volfraction": 0.1, "charge": 12.0, "temperature": 298.0, "concentration_salt": 0.02,
              "dielectconst": 78.0, "radius_effective": 30.0, "radius_effective_mode": 1,
              "structure_factor_mode": 0}


def review_cases():
    """Cases 10-13, appended after the M2 review (see the module docstring)."""
    cases = []
    for tag, mode in (("10a", "sigma"), ("10b", "sqrtI"), ("10c", "absI"), ("10d", "none")):
        cases.append(_case("%s dirty sphere weighting %s" % (tag, mode), "sphere", DIRTY_TRUTH,
                           {"scale": 0.024, "radius": 54.0, "background": 0.0005}, SPHERE_BOUNDS, DIRTY_SEED,
                           weighting=mode, floor=DIRTY_FLOOR, q=Q_DIRTY, dirty=DIRTY))
    cases.append(_case("11 sphere restricted q range", "sphere", SPHERE, SPHERE_START, SPHERE_BOUNDS,
                       111, q_range=(0.012, 0.15)))
    # Thickness held on an upper bound below the truth (10) while radius and scale, both free,
    # are nonlinear and correlated with it: the bound case the first twelve do not have.
    cases.append(_case("12 nonlinear bound: core_shell_sphere thickness", "core_shell_sphere",
                       {"scale": 0.05, "background": 0.001, "radius": 60.0, "thickness": 10.0,
                        "sld_core": 1.0, "sld_shell": 2.0, "sld_solvent": 3.0},
                       {"radius": 66.0, "thickness": 8.0, "scale": 0.06},
                       {"radius": (1.0, 1000.0), "thickness": (1.0, 9.0), "scale": (0.0, INF)}, 112,
                       at_bound={"thickness": "upper"},
                       alt_start={"radius": 55.0, "thickness": 6.0, "scale": 0.04}))
    # A benign regime of hayter_msa (2*q*R >= 0.3 on this grid, design spec 16).
    cases.append(_case("13 sphere@hayter_msa", "sphere", HMSA_TRUTH,
                       {"radius": 33.0, "charge": 8.0, "volfraction": 0.13},
                       {"radius": (5.0, 200.0), "charge": (1.0, 100.0), "volfraction": (0.001, 0.5)},
                       113, structure="hayter_msa"))
    return cases


def _sas_name(flat_name, low_q):
    """Flat evaluate() name -> sasmodels name (sum model A_/B_ names with the low-Q term)."""
    if not low_q or flat_name == "background":
        return flat_name
    if flat_name in LOWQ:
        return "B_" + flat_name[len("lowq_"):]
    return "A_" + flat_name


def _sas_kwargs(case, flat):
    low_q = case["lowQ"]
    kwargs = {_sas_name(k, low_q): v for k, v in flat.items()}
    if low_q:
        kwargs["scale"] = 1.0          # outer scale of the sum model (mixture.py:216-235)
    return kwargs


def _model_string(case):
    base = case["model"] + ("@" + case["structure"] if case["structure"] else "")
    return base + "+power_law" if case["lowQ"] else base


def _weights(mode, I, sigma):
    if mode == "sigma":
        return sigma.copy()
    if mode == "sqrtI":
        return np.sqrt(np.abs(I))
    if mode == "absI":
        return np.abs(I)
    if mode == "none":
        return np.ones_like(I)
    raise ValueError("unknown weighting %r" % mode)


def _site_mask(q, I, w):
    """The site's usable-point rule (design spec 4.8); bumps itself keeps dy <= 0."""
    return np.isfinite(q) & (q > 0) & np.isfinite(I) & np.isfinite(w) & (w > 0)


def _make_data(case):
    q = case["q"]
    kern = get_model(_model_string(case))
    blank = Data1D(x=q, y=np.zeros_like(q), dy=np.ones_like(q))
    theory = np.asarray(DirectModel(blank, kern, cutoff=CUTOFF)(**_sas_kwargs(case, case["truth"])))
    sigma = 0.03 * np.abs(theory) + case["floor"]
    I = theory + np.random.default_rng(case["seed"]).normal(size=theory.size) * sigma
    if case["dirty"]:
        I, sigma = _make_dirty(case, I, sigma)
    return kern, I, sigma


def _make_dirty(case, I, sigma):
    """The points real files have and a fit must leave out: sigma = 0, sigma < 0, I = 0."""
    dirty = case["dirty"]
    I, sigma = I.copy(), sigma.copy()
    sigma[dirty["sigmaZero"]] = 0.0
    sigma[dirty["sigmaNegative"]] *= -1.0
    I[dirty["iZero"]] = 0.0
    low, high = dirty["nonPositive"]
    count = int(np.sum(I <= 0))
    if not low <= count <= high:
        raise RuntimeError("%s: %d points with I <= 0, wanted %d..%d" % (case["label"], count, low, high))
    return I, sigma


def _keep(case, I, w):
    """The points that take part: the site's mask, and inside the case's range (inclusive)."""
    q = case["q"]
    keep = _site_mask(q, I, w)
    if case["range"]:
        keep &= (q >= case["range"][0]) & (q <= case["range"][1])
    if not (case["dirty"] or case["range"]) and not keep.all():
        raise RuntimeError("%s: %d point(s) masked; the fixture expects none"
                           % (case["label"], int((~keep).sum())))
    return keep


def _make_problem(case, kern, I, w, start):
    """FitProblem and the flat names of its parameters, in problem.labels() order."""
    keep = _keep(case, I, w)
    pars = dict(case["truth"])
    pars.update(start)
    model = Model(kern, **_sas_kwargs(case, pars))
    back = {}
    for flat_name, (lo, hi) in case["bounds"].items():
        sas_name = _sas_name(flat_name, case["lowQ"])
        getattr(model, sas_name).range(lo, hi)
        back[sas_name] = flat_name
    data = Data1D(x=case["q"][keep], y=I[keep], dy=w[keep])
    problem = FitProblem(Experiment(data, model, cutoff=CUTOFF))
    return problem, [back[label] for label in problem.labels()]


def _run_lm(problem):
    return bumps_fit(problem, method="lm", steps=STEPS, ftol=FTOL, xtol=XTOL)


def _residuals_at(problem, x):
    problem.setp(x)
    return np.array(problem.residuals(), dtype=float).ravel()


def _pegged(case, names, x, bounds):
    """Indices held on a bound; raises unless they are exactly the expected ones."""
    found = {}
    for j, name in enumerate(names):
        if x[j] == bounds[0][j]:
            found[name] = "lower"
        elif x[j] == bounds[1][j]:
            found[name] = "upper"
    if found != case["atBound"]:
        raise RuntimeError("%s: parameters on a bound %r, expected %r (x = %r)"
                           % (case["label"], found, case["atBound"], x.tolist()))
    return [j for j, name in enumerate(names) if name in found]


def _polish(case, problem, names, x_raw):
    """True minimum next to the bumps result; pegged parameters stay on their bound."""
    bounds = problem.bounds()
    pegged = _pegged(case, names, x_raw, bounds)
    free = [j for j in range(len(names)) if j not in pegged]

    def full(x_free):
        x = x_raw.copy()
        x[free] = x_free
        return x

    sol = least_squares(lambda x_free: _residuals_at(problem, full(x_free)), x_raw[free],
                        jac="3-point", method="lm", xtol=1e-15, ftol=1e-15, gtol=1e-15)
    x = full(sol.x)
    if np.any(x[free] <= bounds[0][free]) or np.any(x[free] >= bounds[1][free]):
        raise RuntimeError("%s: polished point left the bounds: %r" % (case["label"], x.tolist()))
    # Stationarity: the Gauss-Newton step of the free parameters, in sigma, from the
    # 3-point Jacobian scipy ended with.  KKT sign for pegged ones: moving inward costs.
    r = _residuals_at(problem, x)
    step = np.linalg.lstsq(sol.jac, -r, rcond=None)[0]
    for j in pegged:
        h = 1e-6 * abs(x[j]) * (1.0 if case["atBound"][names[j]] == "lower" else -1.0)
        inward = x.copy()
        inward[j] += h
        slope = (np.sum(_residuals_at(problem, inward) ** 2) - np.sum(r ** 2)) / abs(h)
        if not slope > 0:
            raise RuntimeError("%s: %s is on its bound but the minimum is inside (slope %g)"
                               % (case["label"], names[j], slope))
    return x, free, step


def _check_converged(case, problem, res, sigma):
    if not res.nit < STEPS:
        raise RuntimeError("%s: bumps lm used all %d steps" % (case["label"], STEPS))
    problem.setp(res.x)
    again = _run_lm(problem)
    move = float(np.max(np.abs(again.x - res.x) / sigma))
    if not move < REFIT_MOVE_MAX:
        raise RuntimeError("%s: a refit from the bumps solution moves %.3g sigma" % (case["label"], move))
    return move


def _check_alt_start(case, kern, I, w, names, x_ref, sigma):
    """Bound cases: a second start reaches the same solution, exactly on the bound."""
    problem, names_alt = _make_problem(case, kern, I, w, case["altStart"])
    if names_alt != names:
        raise RuntimeError("%s: parameter order changed with the start" % case["label"])
    res = _run_lm(problem)
    _pegged(case, names, res.x, problem.bounds())
    diff = float(np.max(np.abs(res.x - x_ref) / sigma))
    if not diff < RAW_VS_POLISHED_MAX:
        raise RuntimeError("%s: second start ends %.3g sigma away" % (case["label"], diff))
    return diff


def _solve_case(case):
    kern, I, sigma_data = _make_data(case)
    w = _weights(case["weighting"], I, sigma_data)
    problem, names = _make_problem(case, kern, I, w, case["start"])
    res = _run_lm(problem)
    x_raw = np.array(res.x, dtype=float)
    dx_raw = np.array(res.dx, dtype=float)
    sumsq_raw = float(np.sum(_residuals_at(problem, x_raw) ** 2))
    refit_move = _check_converged(case, problem, res, dx_raw)
    x, free, gn_step = _polish(case, problem, names, x_raw)
    J = lsqerror.jacobian(problem, x)
    C = lsqerror.jacobian_cov(J)
    stderr = lsqerror.stderr(C)
    r = _residuals_at(problem, x)
    dof = problem.dof
    if dof != r.size - len(names):
        raise RuntimeError("%s: dof %r != %d - %d" % (case["label"], dof, r.size, len(names)))
    sv = np.linalg.svd(J, compute_uv=False)
    corr = C / np.sqrt(np.outer(np.diag(C), np.diag(C)))
    diag = {
        "rawVsPolishedSigma": np.abs(x_raw - x) / stderr,
        "stationaritySigma": float(np.max(np.abs(gn_step) / stderr[free])),
        "maxCorrelation": float(np.max(np.abs(corr - np.eye(len(names))))) if len(names) > 1 else 0.0,
        "jacobianCondition": float(sv[0] / sv[-1]),
        "minSingularValue": float(sv[-1]),
        "refitMoveSigma": refit_move,
    }
    if case["altStart"]:
        diag["altStartSigma"] = _check_alt_start(case, kern, I, w, names, x, stderr)
    return {"names": names, "x": x, "x_raw": x_raw, "dx_raw": dx_raw, "sumsq_raw": sumsq_raw,
            "nit": int(res.nit), "J": J, "C": C, "stderr": stderr, "r": r, "dof": int(dof),
            "I": I, "sigma": sigma_data, "diag": diag, "nUsed": int(_keep(case, I, w).sum())}


def _check_case(case, sol):
    d = sol["diag"]
    label = case["label"]
    if not np.all(d["rawVsPolishedSigma"] < RAW_VS_POLISHED_MAX):
        raise RuntimeError("%s: raw bumps vs polished %r sigma (limit %g)"
                           % (label, d["rawVsPolishedSigma"].tolist(), RAW_VS_POLISHED_MAX))
    if not d["stationaritySigma"] < STATIONARY_MAX:
        raise RuntimeError("%s: polished point not stationary: %.3g sigma" % (label, d["stationaritySigma"]))
    if not d["minSingularValue"] > SV_FLOOR:
        raise RuntimeError("%s: singular value floor would apply (%g)" % (label, d["minSingularValue"]))
    if not np.all(np.isfinite(sol["stderr"])) or not np.all(sol["stderr"] > 0):
        raise RuntimeError("%s: stderr %r" % (label, sol["stderr"].tolist()))
    if "radius_pd" in sol["names"]:
        pd = sol["x"][sol["names"].index("radius_pd")]
        if not 0.0 < pd < 0.4:
            raise RuntimeError("%s: radius_pd %r not strictly inside (0, 0.4)" % (label, pd))


def _entry(case, sol):
    names = sol["names"]
    start = dict(case["truth"])
    start.update(case["start"])
    sumsq = float(np.sum(sol["r"] ** 2))
    entry = _base_entry(case, sol, names, start, sumsq)
    if case["dirty"] or case["range"]:
        # Only the appended cases: the site must select exactly these points from the full data.
        if sol["nUsed"] != sol["r"].size:
            raise RuntimeError("%s: nUsed %d != %d residuals" % (case["label"], sol["nUsed"], sol["r"].size))
        entry["nUsed"] = sol["nUsed"]
        if case["range"]:
            entry["range"] = {"qMin": case["range"][0], "qMax": case["range"][1]}
    return entry


def _base_entry(case, sol, names, start, sumsq):
    return {
        "label": case["label"],
        "modelSpec": {"model": case["model"], "structure": case["structure"], "lowQPowerLaw": case["lowQ"]},
        "params": start,
        "truth": dict(case["truth"]),
        "fitFlags": {name: True for name in names},
        "bounds": {name: list(case["bounds"][name]) for name in names},
        "weighting": case["weighting"],
        "seed": case["seed"],
        "data": {"q": case["q"], "I": sol["I"], "sigma": sol["sigma"]},
        "names": names,
        "ref": {"values": dict(zip(names, sol["x"].tolist())),
                "stderr": dict(zip(names, sol["stderr"].tolist())),
                "sumsq": sumsq, "dof": sol["dof"], "chi2r": sumsq / sol["dof"],
                "covariance": sol["C"], "jacobian": sol["J"], "residuals": sol["r"],
                "atBound": dict(case["atBound"])},
        "bumpsRaw": {"values": dict(zip(names, sol["x_raw"].tolist())),
                     "stderr": dict(zip(names, sol["dx_raw"].tolist())),
                     "sumsq": sol["sumsq_raw"], "nit": sol["nit"]},
        "diagnostics": sol["diag"],
        "sasmodels": {"model": _model_string(case)},
    }


def _report(case, sol):
    d = sol["diag"]
    per = ", ".join("%s %.2e" % (n, v) for n, v in zip(sol["names"], d["rawVsPolishedSigma"]))
    print("fit %-36s nit %2d | raw-polished/sigma: %s | max corr %.3f | cond(J) %.3g | "
          "stationary %.1e | refit %.1e%s"
          % (case["label"], sol["nit"], per, d["maxCorrelation"], d["jacobianCondition"],
             d["stationaritySigma"], d["refitMoveSigma"],
             " | alt start %.1e" % d["altStartSigma"] if "altStartSigma" in d else ""))


CONVENTIONS = {
    "residual": "(theory - I)/w  (bumps; the site uses (I - theory)/w)",
    "sumsq": "sum(residual^2) = 2*nllf",
    "chi2r": "sumsq/dof, dof = points - fitted parameters",
    "stderr": "sqrt(diag(covariance)), not multiplied by sqrt(chi2r)",
    "covariance": "bumps lsqerror.jacobian_cov(lsqerror.jacobian(problem, values)), rows in `names` order",
    "jacobian": "bumps lsqerror.jacobian at ref.values: m rows of n, columns in `names` order",
    "values": "bumps lm result polished to the true minimum (scipy least_squares, 3-point Jacobian)",
    "bumpsRaw": "bumps lm result as returned (steps 200, ftol 1e-10, xtol 1e-10)",
}


def gen_fit():
    entries = []
    for case in fit_cases():
        sol = _solve_case(case)
        _report(case, sol)
        _check_case(case, sol)
        entries.append(_entry(case, sol))
    write_fixture("fit", {"sasmodels": sasmodels.__version__, "bumps": bumps.__version__,
                          "cutoff": CUTOFF, "weightingModes": list(MODES),
                          "fitOptions": {"steps": STEPS, "ftol": FTOL, "xtol": XTOL},
                          "conventions": CONVENTIONS, "cases": entries})
    return len(entries)


def main():
    if sasmodels.__version__ != EXPECTED_VERSION or bumps.__version__ != EXPECTED_BUMPS:
        raise RuntimeError("expected sasmodels %s and bumps %s, found %s and %s"
                           % (EXPECTED_VERSION, EXPECTED_BUMPS, sasmodels.__version__, bumps.__version__))
    sas_env.verify()
    n_svd = gen_svd()
    n_fit = gen_fit()
    print("cases: svd=%d fit=%d" % (n_svd, n_fit))


if __name__ == "__main__":
    sys.exit(main())
