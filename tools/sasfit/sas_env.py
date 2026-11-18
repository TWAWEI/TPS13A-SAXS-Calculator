"""Build environment for the sasmodels reference generators: strict IEEE, no FMA.

WHY.  The browser runs the sasmodels C kernels as WebAssembly, and WebAssembly
has no fused multiply-add.  A native DLL built by sasmodels with its default
flags (``-std=c99 -O2 -Wall``) on arm64 lets clang contract ``a*b + c`` into a
single FMA, which rounds once instead of twice.  For most models the two
results agree to ~1e-14, but hayter_msa at low q is conditioned to ~3e-9, so an
FMA-built reference cannot be reproduced by the wasm kernels within the 1e-9
gate (measured 2026-11-18, M1 Task 4: 5 of 200 points of the hayter_msa default
curve, worst 3.3e-9 relative).  Building the reference DLLs with
``-ffp-contract=off`` makes them platform-neutral: the same C compiled natively
then matches the wasm build bit for bit on 194 of 200 of those points.

HOW.  sasmodels.kerneldll reads its environment at *import time*
(kerneldll.py:108-112 ``SAS_DLL_PATH``, kerneldll.py:135-142 ``CC`` /
``CFLAGS``), so ``configure()`` must run before anything imports sasmodels.
The DLLs go to a dedicated, git-ignored cache so that (a) FMA-built DLLs
already cached in ~/.sasmodels/compiled_models are never reused (the cache key
is a hash of the C source and does not include the compiler flags) and (b) the
user's own cache is not polluted with no-FMA builds.

Usage (first lines of a generator, before any sasmodels import)::

    import sas_env
    sas_env.configure()
    ...
    sas_env.verify()            # after import: the settings took effect
    sas_env.verify_cache(dlls)  # after generation: the DLLs came from our cache

Both checks raise RuntimeError.
"""
import os
import sys

NO_FMA_FLAG = "-ffp-contract=off"
# sasmodels' default CFLAGS (kerneldll.py:137) plus the no-contraction flag.
CFLAGS = "-std=c99 -O2 -Wall " + NO_FMA_FLAG
DLL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "build", "dll-nofma")
DLL_SUFFIX = ".so"


def configure():
    """Set the environment sasmodels.kerneldll reads when it is imported."""
    if "sasmodels.kerneldll" in sys.modules:
        raise RuntimeError("sas_env.configure() must run before sasmodels is imported")
    os.environ["SAS_OPENCL"] = "none"
    os.environ["SAS_COMPILER"] = "unix"   # the branch that honours CFLAGS (kerneldll.py:131)
    os.environ["CFLAGS"] = CFLAGS
    os.environ["SAS_DLL_PATH"] = DLL_DIR
    os.makedirs(DLL_DIR, exist_ok=True)


def verify():
    """Check that sasmodels picked the settings up; return the compile command.

    Raises RuntimeError (not AssertionError: these checks guard the validity of
    the reference numbers and must survive ``python -O``).
    """
    from sasmodels import kerneldll

    command = kerneldll.compile_command("model.c", "model.so")
    if NO_FMA_FLAG not in command:
        raise RuntimeError("compile command lacks %s: %r" % (NO_FMA_FLAG, command))
    if not os.path.samefile(kerneldll.SAS_DLL_PATH, DLL_DIR):
        raise RuntimeError("sasmodels DLL cache is %s, expected %s"
                           % (kerneldll.SAS_DLL_PATH, DLL_DIR))
    return command


def verify_cache(dll_paths):
    """Check every loaded DLL lives in the dedicated cache, which is non-empty.

    Raises RuntimeError, for the same reason as verify().
    """
    built = [f for f in os.listdir(DLL_DIR) if f.endswith(DLL_SUFFIX)]
    if not built:
        raise RuntimeError("no DLL was built in %s" % DLL_DIR)
    for path in dll_paths:
        if not os.path.exists(path):
            raise RuntimeError("loaded DLL no longer exists: %s" % path)
        if not os.path.samefile(os.path.dirname(path), DLL_DIR):
            raise RuntimeError("DLL loaded from outside the no-FMA cache: %s" % path)
    return len(built)
