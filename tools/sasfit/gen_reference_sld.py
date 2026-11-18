"""Generate the SLD reference fixture of the sasfit JS module (gate G6).

AUTO-GENERATION TOOL -- the output file is never edited by hand:

    tools/sasfit/.venv/bin/python tools/sasfit/gen_reference_sld.py

writes (byte-stable, no timestamps)

    saxs-calculator/tests/fixtures/sasfit/sld.json

Independence from the JS: only the atomic number Z and the standard atomic
mass of each element are taken from periodictable (periodictable.elements);
the X-ray SLD is computed here with the formula of spec 4.7 and the spec's own
constants (r_e = 2.8179403262e-5 Angstrom, N_A = 6.02214076e23, f ~ Z).
periodictable.xsf / xray_sld (energy dependent f', f'') are NOT used.

    rho_e = N_A * rho_mass * sum(n_i Z_i) / M * 1e-24     (e / A^3)
    SLD   = r_e * rho_e * 1e6                              (1e-6 A^-2)

Formula grammar covered by the cases (plan M3 Task 3, owner decision 21): an
ASCII period is ALWAYS a decimal point; hydrates are written with U+00B7 (or
U+2022 / U+2022-like separators) or with parentheses.  periodictable does not
know the middle dot and reads `CuSO4.5H2O` as O 5.5, so every hydrate case
lists the expanded composition (body + n x water) written out here by hand;
the composition of every case without a middle dot is additionally
cross-checked against periodictable's own formula parser.

The element set is the 84 elements that have a CIAAW standard atomic weight:
Z = 1..83 without Tc (43) and Pm (61), plus Th (90), Pa (91), U (92).
Every self-check raises RuntimeError (not assert: the checks guard the
validity of the reference numbers and must survive `python -O`).
"""
import sys

sys.dont_write_bytecode = True  # keep tools/sasfit free of __pycache__ (before the local imports)

import ref_common  # noqa: E402,F401  (house setup; also provides the deterministic JSON writer)
from ref_common import write_fixture  # noqa: E402

import periodictable  # noqa: E402

R_E_A = 2.8179403262e-5   # Angstrom, spec 4.7
N_A = 6.02214076e23
UNIT = 1e6                # SLD is reported in 1e-6 A^-2
EXPECTED_PERIODICTABLE = "2.1.0"
EXCLUDED_Z = {43, 61}     # Tc, Pm: no standard atomic weight
ELEMENT_Z = [z for z in range(1, 84) if z not in EXCLUDED_Z] + [90, 91, 92]
WATER = {"H": 2, "O": 1}

# (formula, mass density g/cm^3, composition in first-appearance order).  The
# compositions are written out by hand from the grammar, not parsed.
CASES = [
    ("H2O", 1.0, {"H": 2, "O": 1}),
    ("Ca3(PO4)2", 3.14, {"Ca": 3, "P": 2, "O": 8}),
    ("Al2(SO4)3", 2.67, {"Al": 2, "S": 3, "O": 12}),
    ("((CH3)2SiO)10", 0.97, {"C": 20, "H": 60, "Si": 10, "O": 10}),
    ("C2.5H4O", 1.0, {"C": 2.5, "H": 4, "O": 1}),
    ("CuSO4·5H2O", 2.286, {"Cu": 1, "S": 1, "O": 9, "H": 10}),
    ("CuSO4(H2O)5", 2.286, {"Cu": 1, "S": 1, "O": 9, "H": 10}),
    ("CuSO4.5H2O", 2.286, {"Cu": 1, "S": 1, "O": 5.5, "H": 2}),   # period = decimal point
    ("CuSO4·2.5H2O", 2.286, {"Cu": 1, "S": 1, "O": 6.5, "H": 5}),
    ("CuSO4• 5H2O", 2.286, {"Cu": 1, "S": 1, "O": 9, "H": 10}),  # bullet, spaces ignored
    ("CuSO4 ⋅ 5H2O", 2.286, {"Cu": 1, "S": 1, "O": 9, "H": 10}),  # dot operator
    ("CuSO4·H2O·4H2O", 2.286, {"Cu": 1, "S": 1, "O": 9, "H": 10}),  # two separators
    ("Al2(SO4)3·18H2O", 1.69, {"Al": 2, "S": 3, "O": 30, "H": 36}),
    ("  H2O  ", 1.0, {"H": 2, "O": 1}),
    ("SiO2", 2.2, {"Si": 1, "O": 2}),
    ("NaCl", 2.165, {"Na": 1, "Cl": 1}),
    ("Fe3O4", 5.17, {"Fe": 3, "O": 4}),
    ("C6H12O6", 1.54, {"C": 6, "H": 12, "O": 6}),
    ("Au", 19.32, {"Au": 1}),
    ("Fe", 7.874, {"Fe": 1}),
    ("U", 19.1, {"U": 1}),
]

# Strings that must be rejected -> failure category the JS error should carry.
INVALID = [
    ("Xx2", "unknown_element"),
    ("H2O)", "unbalanced_parenthesis"),
    ("(H2O", "unbalanced_parenthesis"),
    ("2H2O", "leading_count"),            # a multiplier is only allowed after a separator
    ("", "empty"),
    ("   ", "empty"),
    ("h2o", "invalid_character"),         # element symbols start with a capital
    ("H-2", "invalid_character"),
    ("CuSO4·", "missing_part"),      # separator without a following part
    ("·5H2O", "missing_part"),       # separator without a preceding part
    ("Tc", "unsupported_element"),        # no standard atomic weight
    ("Pm", "unsupported_element"),
    ("Og", "unsupported_element"),        # beyond the supported set
    ("()", "empty_group"),
]


def element_table():
    table = {}
    for z in ELEMENT_Z:
        element = periodictable.elements[z]
        mass = element.mass
        if not (isinstance(mass, float) and mass > 0):
            raise RuntimeError("no standard mass for Z=%d (%s)" % (z, element.symbol))
        table[element.symbol] = [z, mass]
    if len(table) != 84:
        raise RuntimeError("expected 84 elements, built %d" % len(table))
    return table


def check_composition(formula, atoms):
    """Cross-check against periodictable when its grammar can read the string."""
    text = formula.strip()
    if "·" in text or "•" in text or "⋅" in text or " " in text:
        return False
    parsed = {str(el): n for el, n in periodictable.formula(text).atoms.items()}
    if {k: float(v) for k, v in atoms.items()} != {k: float(v) for k, v in parsed.items()}:
        raise RuntimeError("composition of %r differs from periodictable: %r vs %r"
                           % (formula, atoms, parsed))
    return True


def compute(atoms, density, table):
    molar_mass = sum(n * table[sym][1] for sym, n in atoms.items())
    electrons = sum(n * table[sym][0] for sym, n in atoms.items())
    rho_e = N_A * density * electrons / molar_mass * 1e-24
    return molar_mass, electrons, rho_e, R_E_A * rho_e * UNIT


def build_cases(table):
    entries, cross_checked = [], 0
    for formula, density, atoms in CASES:
        for sym in atoms:
            if sym not in table:
                raise RuntimeError("case %r uses %s outside the element set" % (formula, sym))
        # Hydrate sanity: the two written forms must expand to the same atoms.
        molar_mass, electrons, rho_e, sld = compute(atoms, density, table)
        cross_checked += 1 if check_composition(formula, atoms) else 0
        entries.append({"formula": formula, "density": density, "atoms": atoms,
                        "molarMass": molar_mass, "electrons": electrons,
                        "electronDensity": rho_e, "sld": sld})
    by_formula = {e["formula"]: e for e in entries}
    if by_formula["CuSO4·5H2O"]["atoms"] != by_formula["CuSO4(H2O)5"]["atoms"]:
        raise RuntimeError("the two hydrate spellings disagree")
    body = {"Cu": 1, "S": 1, "O": 4}
    expanded = dict(body)
    for sym, n in WATER.items():
        expanded[sym] = expanded.get(sym, 0) + 5 * n
    if {k: float(v) for k, v in expanded.items()} != \
            {k: float(v) for k, v in by_formula["CuSO4·5H2O"]["atoms"].items()}:
        raise RuntimeError("hand-expanded hydrate differs from the case table")
    # Spec G6 anchor: water at 1.0 g/cm^3 is 9.42e-6 A^-2.
    if abs(by_formula["H2O"]["sld"] - 9.42) > 0.005:
        raise RuntimeError("water SLD %r outside 9.42 +- 0.005" % by_formula["H2O"]["sld"])
    # periodictable reads the period as a decimal point, like the JS must.
    if by_formula["CuSO4.5H2O"]["atoms"].get("O") != 5.5:
        raise RuntimeError("CuSO4.5H2O must be O 5.5")
    return entries, cross_checked


def main():
    if periodictable.__version__ != EXPECTED_PERIODICTABLE:
        raise RuntimeError("expected periodictable %s, found %s"
                           % (EXPECTED_PERIODICTABLE, periodictable.__version__))
    table = element_table()
    cases, cross_checked = build_cases(table)
    pt_re = periodictable.constants.electron_radius * 1e10   # m -> Angstrom
    rel_diff = (pt_re - R_E_A) / R_E_A
    print("periodictable electron_radius = %.10e A; spec r_e = %.10e A; relative difference %.3e"
          % (pt_re, R_E_A, rel_diff))
    print("elements=%d cases=%d invalid=%d (composition cross-checked against periodictable: %d)"
          % (len(table), len(cases), len(INVALID), cross_checked))
    write_fixture("sld", {
        "periodictable": periodictable.__version__,
        "conventions": {
            "rE_A": R_E_A, "N_A": N_A, "sldUnit": "1e-6 A^-2", "densityUnit": "g/cm^3",
            "formula": "SLD = rE * N_A * rho * sum(n_i Z_i) / M * 1e-24 * 1e6; f ~ Z",
            "periodictableElectronRadiusA": pt_re, "rEPeriodictableRelativeDifference": rel_diff,
            "grammar": "an ASCII period is always a decimal point; hydrates use U+00B7 "
                       "(also U+2022, U+22C5) or parentheses",
        },
        "elements": table,
        "cases": cases,
        "invalid": [{"formula": f, "category": c} for f, c in INVALID],
    })


if __name__ == "__main__":
    sys.exit(main())
