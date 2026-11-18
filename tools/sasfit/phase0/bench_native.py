"""Native sasmodels timing of the same cases as the wasm benchmark (median of 20, 5 warm-ups)."""
import os, statistics, time
os.environ["SAS_OPENCL"] = "none"
import numpy as np
from sasmodels.core import load_model
from sasmodels.data import empty_data1D
from sasmodels.direct_model import DirectModel

Q = np.logspace(-3, 0, 400)
CASES = [
    ("sphere_default", "sphere", {}),
    ("sphere_schulz_0.2_ns3", "sphere", dict(radius_pd=0.2, radius_pd_type="schulz", radius_pd_n=80, radius_pd_nsigma=3)),
    ("cylinder_2pd", "cylinder", dict(radius_pd=0.15, radius_pd_n=35, length_pd=0.2, length_pd_n=35)),
    ("core_shell_cylinder_2pd", "core_shell_cylinder", dict(radius_pd=0.15, radius_pd_n=35, length_pd=0.2, length_pd_n=35)),
    ("core_shell_cylinder_2pd_100q", "core_shell_cylinder", dict(radius_pd=0.15, radius_pd_n=35, length_pd=0.2, length_pd_n=35), 100),
    ("core_shell_cylinder_2pd_n15", "core_shell_cylinder", dict(radius_pd=0.15, radius_pd_n=15, length_pd=0.2, length_pd_n=15)),
    ("core_shell_cylinder_1pd_n35", "core_shell_cylinder", dict(radius_pd=0.15, radius_pd_n=35)),
]
for label, name, pars, *nq in CASES:
    q = np.logspace(-3, 0, nq[0]) if nq else Q
    model = load_model(name, dtype="double", platform="dll")
    calc = DirectModel(empty_data1D(q), model, cutoff=1e-5)
    times = []
    for i in range(25):
        t0 = time.perf_counter(); calc(**pars); dt = (time.perf_counter() - t0) * 1e3
        if i >= 5: times.append(dt)
    print(f"NATIVE {label:32s} {len(q):4d} q  median {statistics.median(times):.3f} ms")
