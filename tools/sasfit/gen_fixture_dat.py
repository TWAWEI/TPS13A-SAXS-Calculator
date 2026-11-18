"""Generate synthetic TPS 13A "official" 1-D .dat files for the sasfit tests.

AUTO-GENERATION TOOL -- the output files are never edited by hand:

    tools/sasfit/.venv/bin/python tools/sasfit/gen_fixture_dat.py

writes (byte-stable, no timestamps)

    saxs-calculator/tests/fixtures/sasfit/dat/SYNTH_sphere_{10,20,30}.dat
    saxs-calculator/tests/fixtures/sasfit/dat/SYNTH_sphere-truth.json   (sidecar)

Every number in these files is generated here: a sasmodels sphere curve
(radius 50 / 52 / 54 Angstrom; the other parameters stay at the sasmodels
defaults) plus seeded Gaussian noise, with obviously synthetic header values
(`SYNTH_*` names).  No measured data, real file name or real sample name is
used.  The byte layout imitates the official writer (the reduction tool's
fileio/dat.py and fileio/params.py, only READ to get the layout right):

  * 25 header lines  " " + value + spaces + TAB + label  (labels verbatim,
    including the beamline's own spelling "Nosie", "signle", "binnng");
  * line 26 " Single Frame Time:" + 11-wide 7-significant-digit G field + "      sec";
  * line 27 "     Q                   I                     ERROR";
  * data rows: three Fortran-E fields (0.69960E-02, 5 significant digits,
    widths 16 / 21 / 25), latin-1, CRLF after every row including the last.

Rows: 5 beamstop rows (q < q_start, I < 0, sigma = 0), one `000 000 000`
placeholder row (an empty bin), then 300 normal rows, q linear from 0.0050 to
0.3500 A^-1, sigma = 3 % of the true I + 1e-3, seeded noise.  The condition
value of the sequence tests is the number in the file name (10 / 20 / 30).

The sidecar holds the truth parameters and the values a correct reader must
return (counts, header fields, condition, first / last rows as written), so
tests can assert against it.  Self-checks raise RuntimeError (not assert).
"""
import json
import os
import sys

sys.dont_write_bytecode = True  # keep tools/sasfit free of __pycache__ (before the local imports)

import ref_common  # noqa: E402,F401  (first: strict-IEEE build setup before sasmodels is imported)
from ref_common import CUTOFF, OUT_DIR, REPO, direct, np, sas_env  # noqa: E402

DAT_DIR = os.path.join(OUT_DIR, "dat")
Q_BEAMSTOP = [0.0010, 0.0018, 0.0026, 0.0034, 0.0042]
Q_FIRST, Q_LAST, N_NORMAL = 0.0050, 0.3500, 300
SIGMA_REL, SIGMA_ABS = 0.03, 1e-3
Q_WIDTH, I_WIDTH, ERR_WIDTH = 16, 21, 25
COLUMN_HEADER = "     Q                   I                     ERROR"
PLACEHOLDER_ROW = "000".rjust(Q_WIDTH) + "000".rjust(I_WIDTH) + "000".rjust(ERR_WIDTH)
CHI2_Q_MAX, CHI2_BAND = 0.07, (0.7, 1.3)
FRAME_TIME_S = 2.0
# (radius in Angstrom, condition = file-name number, noise seed)
FILES = [(50.0, 10, 4), (52.0, 20, 5), (54.0, 30, 2)]  # seeds picked so chi2r lies in CHI2_BAND
SPHERE_PARS = {"sld": 1.0, "sld_solvent": 6.0, "scale": 1.0, "background": 0.001}

# (value, spaces between the value and the TAB, label) -- layout of the 25 header lines
HEADER_FIXED = {
    "mode": "Multi", "n_frames": "5", "energy": "15.0000", "sf": "1.00",
    "t_sample": "0.50000", "t_cell": "0.80000", "thickness": "1.000",
    "beam_center": "512.000 512.000", "sdd": "3000.000", "q_start": "0.0050",
    "dq_mode": "0.00", "pinhole": "1.00,1.00", "output_resol": "0",
}


def header_layout(name):
    return [
        (HEADER_FIXED["mode"], 24, 'Data Collection Mode ("Multi" or "Super")'),
        (name, 19, "Output filename (less than 21 characters)"),
        (HEADER_FIXED["n_frames"], 24, "Total Frame Numbers"),
        (HEADER_FIXED["energy"], 24, "Photon Energy (keV)"),
        (HEADER_FIXED["sf"], 24, "Scaling Factor"),
        (HEADER_FIXED["t_sample"], 19, "Sample Transmission coefficient"),
        (HEADER_FIXED["t_cell"], 19, "Empty Cell Transmission coefficient"),
        (HEADER_FIXED["thickness"], 24, "Sample thickness (mm)"),
        (HEADER_FIXED["beam_center"], 16, "Beam Center (circular or line-cut integration center:q=0)"),
        (HEADER_FIXED["sdd"], 23, "Sample-to-Detector Distance (mm)"),
        ("SYNTH_sample.tif", 15, "Sample filename"),
        ("SYNTH_flux_info", 15, "Sample information (beam flux)"),
        ("SYNTH_cell.tif", 15, "Empty Cell filename"),
        ("SYNTH_flux_info", 15, "Empty Cell information (beam flux)"),
        ("SYNTH_sens.dat", 23, "Detector Sensitivity file"),
        ("SYNTH_noise.dat", 15, "Electronic Nosie file for the Detector"),
        ("NON", 23, 'REJECT or Count ROI ("NON", "REJECT", "COUNT", OR "LINECUT")'),
        ("SYNTH_roi.dat", 23, "ROI- data Region Of Interest"),
        ("0.000 0.000", 15, "LineCut Starting Point (x1,y1)"),
        ("0.000 0.000", 15, "LineCut End Point (x2,y2)"),
        ("0", 23, "LineCut Half Width (with 0 for signle pixel)"),
        (HEADER_FIXED["q_start"], 23, "Starting Q-value for data binning"),
        (HEADER_FIXED["dq_mode"], 23,
         'Data binning dQ-interval ("1" for suggested binnng based on data q-resolution)'),
        (HEADER_FIXED["pinhole"], 15, "Pinhole1 Size & Mask opening (mm)"),
        (HEADER_FIXED["output_resol"], 23, "Output data resol. dQ & binding pts N (Yes=1, No=0)"),
    ]


def fortran_e(x):
    """Fortran E edit descriptor: 5 significant digits, 0.dddddE+xx."""
    if not np.isfinite(x):
        raise RuntimeError("non-finite value %r" % x)
    if x == 0.0:
        return "0.00000E+00"
    mantissa, exp_str = ("%.4E" % abs(x)).split("E")
    digit, frac = mantissa.split(".")
    exponent = int(exp_str) + 1
    if not -99 <= exponent <= 99:
        raise RuntimeError("exponent out of range for %r" % x)
    return "%s0.%s%sE%+03d" % ("-" if x < 0 else "", digit, frac, exponent)


def data_row(q, i, sigma):
    return fortran_e(q).rjust(Q_WIDTH) + fortran_e(i).rjust(I_WIDTH) + fortran_e(sigma).rjust(ERR_WIDTH)


def build_rows(radius, seed):
    """Return (q_written, I_written, sigma_written) arrays, beamstop rows first (no placeholder)."""
    rng = np.random.default_rng(seed)
    q_normal = np.linspace(Q_FIRST, Q_LAST, N_NORMAL)
    q_normal = np.array([float(fortran_e(v).replace("E", "e")) for v in q_normal])  # q as written
    model = direct("sphere", q_normal)
    i_true = np.asarray(model(radius=radius, **SPHERE_PARS), dtype=float)
    sigma = SIGMA_REL * i_true + SIGMA_ABS
    i_obs = i_true + rng.normal(0.0, 1.0, N_NORMAL) * sigma
    i_stop = -(0.5 + 2.5 * rng.random(len(Q_BEAMSTOP))) * 1e-3
    q_all = np.concatenate([Q_BEAMSTOP, q_normal])
    i_all = np.concatenate([i_stop, i_obs])
    s_all = np.concatenate([np.zeros(len(Q_BEAMSTOP)), sigma])
    return q_all, i_all, s_all


def written(values):
    """The values exactly as a reader sees them after the E formatting."""
    return np.array([float(fortran_e(v).replace("E", "e")) for v in values])


def check_chi2(radius, q, i_obs, sigma):
    mask = (q >= Q_FIRST) & (q <= CHI2_Q_MAX) & (sigma > 0)
    model = direct("sphere", q[mask])
    i_model = np.asarray(model(radius=radius, **SPHERE_PARS), dtype=float)
    n = int(mask.sum())
    chi2 = float(np.sum(((i_obs[mask] - i_model) / sigma[mask]) ** 2) / (n - 3))
    if not (CHI2_BAND[0] <= chi2 <= CHI2_BAND[1]):
        raise RuntimeError("reduced chi2 %.3f for radius %g outside %s: change the seed"
                           % (chi2, radius, CHI2_BAND))
    return chi2, n


def render(name, q_all, i_all, s_all):
    lines = [" %s%s\t%s" % (v, " " * pad, label) for v, pad, label in header_layout(name)]
    if len(lines) != 25:
        raise RuntimeError("header must have 25 lines, got %d" % len(lines))
    lines.append(" Single Frame Time:%s      sec" % format(FRAME_TIME_S, "#11.7g"))
    lines.append(COLUMN_HEADER)
    nb = len(Q_BEAMSTOP)
    for k in range(len(q_all)):
        if k == nb:
            lines.append(PLACEHOLDER_ROW)
        lines.append(data_row(q_all[k], i_all[k], s_all[k]))
    return ("\r\n".join(lines) + "\r\n").encode("latin-1")


def row_dict(q, i, s):
    return {"q": q, "I": i, "sigma": s}


def build_file(radius, condition, seed):
    name = "SYNTH_sphere_%d" % condition
    q, i, s = build_rows(radius, seed)
    qw, iw, sw = written(q), written(i), written(s)
    chi2, n_chi2 = check_chi2(radius, qw, iw, sw)
    data = render(name, q, i, s)
    nb = len(Q_BEAMSTOP)
    if not (np.all(iw[:nb] < 0) and np.all(sw[:nb] == 0) and np.all(sw[nb:] > 0)):
        raise RuntimeError("beamstop / sigma invariants violated for %s" % name)
    lines = data.decode("latin-1").split("\r\n")
    if len(lines) != 27 + len(q) + 1 + 1 or lines[-1] != "":
        raise RuntimeError("unexpected line count for %s: %d" % (name, len(lines)))
    sidecar = {
        "fileName": name + ".dat",
        "kind": "official",
        "condition": condition,
        "truth": dict(SPHERE_PARS, model="sphere", radius=radius, cutoff=CUTOFF),
        "noise": {"seed": seed, "sigmaRel": SIGMA_REL, "sigmaAbs": SIGMA_ABS, "generator": "numpy default_rng"},
        "chi2Reduced": {"value": chi2, "qMax": CHI2_Q_MAX, "nPoints": n_chi2, "dof": n_chi2 - 3},
        "header": {"outputName": name, "totalFrames": 5, "energyKeV": 15.0, "scalingFactor": 1.0,
                   "sampleTransmission": 0.5, "cellTransmission": 0.8, "thicknessMm": 1.0,
                   "sddMm": 3000.0, "qStart": 0.005, "frameTimeS": FRAME_TIME_S},
        "lineCount": len(lines) - 1,            # CRLF-terminated lines
        "headerLines": 27,
        "dataRows": len(q) + 1,                  # including the placeholder row
        "placeholders": 1,
        "points": len(q),                        # what a reader returns (placeholder dropped)
        "beamstopPoints": nb,                    # I < 0 and sigma = 0, q < qStart
        "normalPoints": N_NORMAL,
        "negativeNormalPoints": int(np.sum(iw[nb:] < 0)),   # noise at high q; kept, not removed
        "negativePoints": int(np.sum(iw < 0)),              # beamstop + noisy normal rows (hidden on log axes)
        "firstRow": row_dict(float(qw[0]), float(iw[0]), float(sw[0])),
        "lastRow": row_dict(float(qw[-1]), float(iw[-1]), float(sw[-1])),
        "firstNormalRow": row_dict(float(qw[nb]), float(iw[nb]), float(sw[nb])),
        "beamstopRows": [row_dict(float(a), float(b), float(c)) for a, b, c in zip(qw[:nb], iw[:nb], sw[:nb])],
        "defaultRange": {"sigma": {"qMin": float(qw[nb]), "qMax": float(qw[-1])}},
    }
    return name + ".dat", data, sidecar


def main():
    sas_env.verify()
    os.makedirs(DAT_DIR, exist_ok=True)
    sidecars = []
    for radius, condition, seed in FILES:
        fname, data, sidecar = build_file(radius, condition, seed)
        with open(os.path.join(DAT_DIR, fname), "wb") as handle:
            handle.write(data)
        print("wrote %s (%d bytes, chi2r %.3f)" % (os.path.relpath(os.path.join(DAT_DIR, fname), REPO),
                                                    len(data), sidecar["chi2Reduced"]["value"]))
        sidecars.append(sidecar)
    text = json.dumps({"files": sidecars}, separators=(",", ":"), allow_nan=False) + "\n"
    path = os.path.join(DAT_DIR, "SYNTH_sphere-truth.json")
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    print("wrote %s (%d bytes)" % (os.path.relpath(path, REPO), len(text)))


if __name__ == "__main__":
    sys.exit(main())
