#!/usr/bin/env python
"""Compile sasmodels C kernels to standalone WebAssembly.

Reproduces the preprocessing of sasmodels.kerneldll.make_dll (F64 path):
    source = generate.convert_type(generate.make_source(info)['dll'], F64)
and compiles with the unix defaults of kerneldll (-std=c99 -O2), without
OpenMP and without any flag that changes IEEE semantics.

Usage:
    source ~/emsdk/emsdk_env.sh
    tools/sasfit/.venv/bin/python tools/sasfit/build_wasm.py [model ...]

Output: saxs-calculator/wasm/sas-<model>.wasm and manifest.json
"""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

os.environ.setdefault("SAS_OPENCL", "none")

import sasmodels  # noqa: E402
from sasmodels import generate  # noqa: E402
from sasmodels.core import load_model_info  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BUILD_DIR = Path(__file__).resolve().parent / "build"
WASM_DIR = ROOT / "saxs-calculator" / "wasm"
MANIFEST = WASM_DIR / "manifest.json"

# Models compiled from C. guinier_porod and power_law are Python kernels and
# are hand-written in js/sasfit-py-models.js instead.
C_MODELS = (
    "sphere", "core_shell_sphere", "vesicle", "ellipsoid",
    "cylinder", "core_shell_cylinder", "flexible_cylinder", "lamellar",
    "guinier", "mono_gauss_coil", "gaussian_peak",
    "hardsphere", "hayter_msa",
)

CFLAGS = ("-std=c99", "-O2")
LINK_FLAGS = ("--no-entry", "-sSTANDALONE_WASM=1", "-sALLOW_MEMORY_GROWTH=1")
FLOAT_HEADER = "#define FLOAT_SIZE 8"


def emcc_version():
    out = subprocess.run(["emcc", "--version"], check=True,
                         capture_output=True, text=True).stdout
    return out.splitlines()[0].strip()


def c_source(name):
    info = load_model_info(name)
    if callable(info.Iq):
        raise SystemExit("%s is a Python kernel; it cannot be compiled" % name)
    source = generate.convert_type(generate.make_source(info)["dll"], generate.F64)
    if not source.startswith(FLOAT_HEADER):
        raise SystemExit("%s: F64 preprocessing missing" % name)
    return source


def build(name):
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    WASM_DIR.mkdir(parents=True, exist_ok=True)
    c_path = BUILD_DIR / ("%s.c" % name)
    c_path.write_text(c_source(name))
    out = WASM_DIR / ("sas-%s.wasm" % name)
    exports = "-sEXPORTED_FUNCTIONS=_%s_Iq,_malloc,_free" % name
    cmd = ["emcc", *CFLAGS, str(c_path), "-o", str(out), *LINK_FLAGS, exports]
    subprocess.run(cmd, check=True)
    data = out.read_bytes()
    return {"file": out.name, "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "entry": "%s_Iq" % name}


def main(argv):
    names = argv[1:] or list(C_MODELS)
    unknown = [n for n in names if n not in C_MODELS]
    if unknown:
        raise SystemExit("unknown model(s): %s" % ", ".join(unknown))
    previous = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    models = dict(previous.get("models", {}))
    for name in names:
        models[name] = build(name)
        print("built %-22s %7d bytes" % (name, models[name]["bytes"]))
    manifest = {
        "generator": "tools/sasfit/build_wasm.py",
        "sasmodels": sasmodels.__version__,
        "emscripten": emcc_version(),
        "cflags": list(CFLAGS),
        "linkFlags": list(LINK_FLAGS),
        "precision": "double",
        "models": {k: models[k] for k in sorted(models)},
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main(sys.argv)
