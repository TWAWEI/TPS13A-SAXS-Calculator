"""Shared setup of the sasfit reference generators (gen_reference*.py).

Importing this module configures the strict-IEEE (no FMA) DLL build *before*
sasmodels is imported -- see sas_env.py -- so every generator module imports it
first.  It also holds the model lists, the q grids, the JSON writer and the
model / DirectModel caches the generators share.
"""
import json
import math
import os
import sys

sys.dont_write_bytecode = True  # also set by the entry script, before it imports this module

import sas_env  # noqa: E402  (same directory)

sas_env.configure()  # strict-IEEE DLL build; must precede the sasmodels import

import numpy as np  # noqa: E402
from sasmodels.core import load_model  # noqa: E402
from sasmodels.data import empty_data1D  # noqa: E402
from sasmodels.direct_model import DirectModel  # noqa: E402


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
