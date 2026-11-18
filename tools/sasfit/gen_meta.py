"""Generate saxs-calculator/js/sasfit-meta.js from sasmodels ModelInfo.

Usage (from repo root):
    SAS_OPENCL=none tools/sasfit/.venv/bin/python tools/sasfit/gen_meta.py

The output is a frozen metadata table for the 15 models of the SAS fitting
page: parameter tables plus the kernel layout constants that details.py needs.
"""
import json
import math
import os
import sys

os.environ.setdefault("SAS_OPENCL", "none")

import sasmodels  # noqa: E402
from sasmodels.core import load_model_info  # noqa: E402

ORDER = [
    "sphere", "core_shell_sphere", "vesicle", "ellipsoid", "cylinder",
    "core_shell_cylinder", "flexible_cylinder", "lamellar", "guinier",
    "guinier_porod", "power_law", "mono_gauss_coil", "gaussian_peak",
    "hardsphere", "hayter_msa",
]
JS_MODELS = {"guinier_porod", "power_law"}
STRUCTURE_FACTORS = {"hardsphere", "hayter_msa"}

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "saxs-calculator", "js", "sasfit-meta.js")

HEADER = """\
/**
 * AUTO-GENERATED -- DO NOT EDIT BY HAND.
 * Generator: tools/sasfit/gen_meta.py (sasmodels {version} ModelInfo).
 * Regenerate: SAS_OPENCL=none tools/sasfit/.venv/bin/python tools/sasfit/gen_meta.py
 *
 * Model metadata for the 15 SAS fitting models: parameter tables and the
 * kernel layout constants used by sasfit-kernel.js.
 */
"""


def num(v):
    """Render a float as a JS literal (handles +-inf)."""
    v = float(v)
    if math.isinf(v):
        return "Infinity" if v > 0 else "-Infinity"
    if math.isnan(v):
        return "NaN"
    return repr(v)


def param_entry(p, pd_1d):
    lo, hi = p.limits
    return {
        "name": p.name,
        "units": p.units,
        "def": ("num", p.default),
        "min": ("num", lo),
        "max": ("num", hi),
        "type": p.type,
        "pd": p.name in pd_1d,
        "relativePd": bool(p.relative_pd),
        "description": p.description,
    }


def render(value):
    """Render a value to one-line JS, honouring ('num', x) markers."""
    if isinstance(value, tuple) and value[0] == "num":
        return num(value[1])
    if isinstance(value, dict):
        return "{ " + ", ".join(f"{k}: {render(v)}" for k, v in value.items()) + " }"
    if isinstance(value, list):
        return "[" + ", ".join(render(v) for v in value) + "]"
    return json.dumps(value, ensure_ascii=False)


def model_entry(name):
    info = load_model_info(name)
    table = info.parameters
    pd_1d = table.pd_1d
    common = {c.name: {"def": ("num", c.default),
                       "min": ("num", c.limits[0]),
                       "max": ("num", c.limits[1])}
              for c in table.common_parameters}
    return {
        "name": name,
        "title": info.title,
        "category": info.category,
        "kind": "js" if name in JS_MODELS else "c",
        "isStructureFactor": name in STRUCTURE_FACTORS,
        "haveFq": bool(info.have_Fq),
        "reffModes": list(info.radius_effective_modes or []),
        "params": [param_entry(p, pd_1d) for p in table.kernel_parameters],
        "common": common,
        "layout": {
            "npars": table.npars,
            "nmagnetic": table.nmagnetic,
            "nvalues": table.nvalues,
            "maxPd": table.max_pd,
            "thetaOffset": table.theta_offset,
        },
    }


def render_model(entry):
    lines = [f"            {json.dumps(entry['name'])}: {{"]
    for key in ("name", "title", "category", "kind", "isStructureFactor",
                "haveFq", "reffModes"):
        lines.append(f"                {key}: {render(entry[key])},")
    lines.append("                params: [")
    for p in entry["params"]:
        lines.append(f"                    {render(p)},")
    lines.append("                ],")
    lines.append(f"                common: {render(entry['common'])},")
    lines.append(f"                layout: {render(entry['layout'])},")
    lines.append("            },")
    return "\n".join(lines)


def build():
    out = [HEADER.format(version=sasmodels.__version__)]
    out.append("(function () {")
    out.append("    'use strict';")
    out.append("")
    out.append("    function deepFreeze(o) {")
    out.append("        if (o === null || typeof o !== 'object') return o;")
    out.append("        Object.values(o).forEach(deepFreeze);")
    out.append("        return Object.freeze(o);")
    out.append("    }")
    out.append("")
    out.append("    const meta = {")
    out.append(f"        sasmodelsVersion: {json.dumps(sasmodels.__version__)},")
    out.append(f"        order: {json.dumps(ORDER)},")
    out.append("        models: {")
    for name in ORDER:
        out.append(render_model(model_entry(name)))
    out.append("        },")
    out.append("    };")
    out.append("")
    out.append("    globalThis.SasFitMeta = deepFreeze(meta);")
    out.append("})();")
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    text = build()
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"wrote {OUT} ({text.count(chr(10))} lines)", file=sys.stderr)
