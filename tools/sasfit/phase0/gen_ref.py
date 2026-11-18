"""Phase 0 probe: record the exact buffers sasmodels sends to its DLL kernels
plus the raw kernel output and the final I(q), so a wasm build can replay them."""
import json, os, sys
os.environ["SAS_OPENCL"] = "none"
import numpy as np
from sasmodels import kerneldll
from sasmodels.core import load_model
from sasmodels.data import empty_data1D
from sasmodels.direct_model import DirectModel

CUTOFF = 1e-5
Q = np.logspace(-3, 0, 200)
calls = []
_orig = kerneldll.DllKernel._call_kernel

def _record(self, call_details, values, cutoff, magnetic, radius_effective_mode):
    _orig(self, call_details, values, cutoff, magnetic, radius_effective_mode)
    calls.append({
        "model": self.info.name, "nq": int(self.q_input.nq),
        "haveFq": bool(self.info.have_Fq), "numEval": int(call_details.num_eval),
        "details": [int(v) for v in call_details.buffer],
        "values": [float(v) for v in values], "q": [float(v) for v in self.q_input.q],
        "cutoff": float(cutoff), "reffMode": int(radius_effective_mode),
        "result": [float(v) for v in self.result],
    })
kerneldll.DllKernel._call_kernel = _record

SCHULZ3 = dict(radius_pd_type="schulz", radius_pd_n=80, radius_pd_nsigma=3)
CASES = [
    ("sphere_default", "sphere", {}),
    ("sphere_schulz_0.2_ns3", "sphere", dict(radius_pd=0.2, **SCHULZ3)),
    ("sphere_schulz_0.4_ns8", "sphere", dict(radius_pd=0.4, radius_pd_type="schulz", radius_pd_n=80, radius_pd_nsigma=8)),
    ("cylinder_default", "cylinder", {}),
    ("cylinder_2pd", "cylinder", dict(radius_pd=0.15, radius_pd_n=35, length_pd=0.2, length_pd_n=35)),
    ("sphere@hayter_msa", "sphere@hayter_msa", {}),
    ("sphere@hayter_msa_beta_pd", "sphere@hayter_msa", dict(structure_factor_mode=1, radius_pd=0.2, **SCHULZ3)),
    ("core_shell_cylinder_2pd", "core_shell_cylinder", dict(radius_pd=0.15, radius_pd_n=35, length_pd=0.2, length_pd_n=35)),
    ("core_shell_cylinder_2pd_n15", "core_shell_cylinder", dict(radius_pd=0.15, radius_pd_n=15, length_pd=0.2, length_pd_n=15)),
    ("core_shell_cylinder_1pd_n35", "core_shell_cylinder", dict(radius_pd=0.15, radius_pd_n=35)),
]
out = []
for label, name, pars in CASES:
    model = load_model(name, dtype="double", platform="dll")
    calc = DirectModel(empty_data1D(Q), model, cutoff=CUTOFF)
    del calls[:]
    Iq = calc(**pars)
    out.append({"label": label, "model": name, "pars": pars, "Iq": [float(v) for v in Iq], "calls": list(calls)})
    print(label, "kernel calls:", [(c["model"], c["numEval"]) for c in calls])
json.dump({"cutoff": CUTOFF, "cases": out}, open(sys.argv[1], "w"))
