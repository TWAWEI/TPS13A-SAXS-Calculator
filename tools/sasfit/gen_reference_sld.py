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


# Isotopes the page accepts beside the 84 elements (fix pass A): deuterium, written D.
# periodictable knows D as an isotope of hydrogen; Z and mass are read from it.
ISOTOPES = ["D"]

# (formula as the page writes it, the same in periodictable's grammar, density g/cm^3, atoms)
ISOTOPE_CASES = [
    ("D2O", "D2O", 1.1044, {"D": 2, "O": 1}),                 # heavy water at 25 C
    ("C6D6", "C6D6", 0.950, {"C": 6, "D": 6}),
]

# The preset materials of the page (design spec 4.7; owner decisions D2, D3 of 2026-11-18):
# (id, formula as the page writes it, the same in periodictable's grammar, density g/cm^3).
# The values are computed here, independently of the JS, and compared in tests/sasfit-sld.test.js.
PRESETS = [
    ("water", "H2O", "H2O", 0.9982),
    ("protein", "C4.9384H7.7583N1.3577O1.4773S0.0417", "C4.9384H7.7583N1.3577O1.4773S0.0417", 1.35),
    ("lipid_head", "C10H18NO8P", "C10H18NO8P", 1.62),
    ("lipid_head_hydrated", "C10H18NO8P·8H2O", "C10H18NO8P(H2O)8", 1.353),
    ("lipid_tail", "C17H33", "C17H33", 0.801),
    ("peg", "C2H4O", "C2H4O", 1.125),
    ("sio2", "SiO2", "SiO2", 2.2),
    ("au", "Au", "Au", 19.32),
    ("fe3o4", "Fe3O4", "Fe3O4", 5.17),
]


def isotope_table():
    table = {}
    for symbol in ISOTOPES:
        isotope = getattr(periodictable, symbol)
        table[symbol] = [isotope.number, isotope.mass]
    return table


def atoms_of(pt_formula):
    return {str(el): float(n) for el, n in periodictable.formula(pt_formula).atoms.items()}


def build_isotope_cases(table):
    entries = []
    for formula, pt_formula, density, atoms in ISOTOPE_CASES:
        if atoms_of(pt_formula) != {k: float(v) for k, v in atoms.items()}:
            raise RuntimeError("composition of %r differs from periodictable" % formula)
        molar_mass, electrons, rho_e, sld = compute(atoms, density, table)
        entries.append({"formula": formula, "density": density, "atoms": atoms, "molarMass": molar_mass,
                        "electrons": electrons, "electronDensity": rho_e, "sld": sld})
    return entries


def build_presets(table):
    entries = []
    for preset_id, formula, pt_formula, density in PRESETS:
        atoms = atoms_of(pt_formula)
        molar_mass, electrons, rho_e, sld = compute(atoms, density, table)
        entries.append({"id": preset_id, "formula": formula, "density": density, "molarMass": molar_mass,
                        "electrons": electrons, "electronDensity": rho_e, "sld": sld,
                        "volumeA3": molar_mass / (N_A * density) * 1e24})
    by_id = {e["id"]: e for e in entries}
    # Electron bookkeeping of the lipid presets: head + 2 tails = DOPC (C44H84NO8P, 434 e).
    if by_id["lipid_head"]["electrons"] + 2 * by_id["lipid_tail"]["electrons"] != 434:
        raise RuntimeError("PC head + two oleoyl tails must have the 434 electrons of DOPC")
    if by_id["lipid_head_hydrated"]["electrons"] != by_id["lipid_head"]["electrons"] + 8 * 10:
        raise RuntimeError("hydrated head = head + 8 waters")
    return entries


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
    isotopes = isotope_table()
    with_isotopes = dict(table, **isotopes)
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
        # additions of fix pass A (the keys above are unchanged)
        "isotopes": isotopes,
        "isotopeCases": build_isotope_cases(with_isotopes),
        "presets": build_presets(table),
    })


if __name__ == "__main__":
    sys.exit(main())
