/**
 * sasfit-sld.js -- X-ray scattering length density from a chemical formula and
 * a mass density (design spec 4.7, decision 21). Original code.
 *
 *   rho_e = N_A * rho_mass * sum(n_i Z_i) / M * 1e-24      (e / A^3)
 *   SLD   = r_e * rho_e * 1e6                              (1e-6 A^-2)
 *
 * Approximation: f ~ Z. The anomalous terms f', f'' are ignored, so the SLD
 * does not depend on the photon energy. The error grows for elements with an
 * absorption edge near the beamline energy (15 keV): the L edges of Au and Pt,
 * the K edges of Br and Sr, among others (energy-dependent f' is a B-version
 * candidate, design spec 16).
 *
 * Formula grammar (owner decision 21):
 *   formula   := part ( SEP [count] part )*
 *   part      := unit+
 *   unit      := Element [count] | '(' part ')' [count]
 *   count     := digits [ '.' digits ]         greater than 0
 *   SEP       := U+00B7 (middle dot) | U+2022 (bullet) | U+22C5 (dot operator)
 * An ASCII period is ALWAYS a decimal point: "CuSO4.5H2O" is O 5.5, not a
 * hydrate (periodictable reads it the same way). Hydrates are written with a
 * separator ("CuSO4·5H2O") or with parentheses ("CuSO4(H2O)5"). A multiplier
 * is allowed only after a separator ("2H2O" is rejected). White space between
 * tokens is ignored.
 *
 * Errors: parseFormula and compute throw an Error with
 *   code      one of ERROR_CODES, or 'bad_density'
 *   position  1-based character of the problem in the text as given (parse errors)
 *   message   Traditional Chinese, names the position and the reason. It may
 *             quote the user's input: escape it before it goes into innerHTML.
 *
 * Pure computation: no DOM, no global state, nothing passed in is modified,
 * every returned object is frozen.
 */

(function () {
    'use strict';

    const R_E = 2.8179403262e-5;          // classical electron radius, Angstrom (design spec 4.7)
    const N_A = 6.02214076e23;
    const CM3_PER_A3 = 1e-24;
    const SLD_UNIT = 1e6;                 // SLD is reported in 1e-6 A^-2
    const MAX_FORMULA_LENGTH = 200;
    const TEXT_DIGITS = 12;               // compositionText hides binary noise such as 0.30000000000000004

    const SEPARATORS = '·•⋅';
    const COUNT_RE = /\d+(?:\.\d+)?/y;
    const SYMBOL_RE = /[A-Z][a-z]*/y;
    const SPACE_RE = /\s/;

    /**
     * [symbol, Z, standard atomic weight]: the 84 elements with a CIAAW
     * standard atomic weight (Z = 1-83 without Tc and Pm, plus Th, Pa, U).
     * Abridged CIAAW values at full precision; interval elements take the
     * conventional value (H 1.008, C 12.011, N 14.007, O 15.999, S 32.06).
     * Gate G6 requires this table to equal periodictable 2.1.0 exactly.
     */
    const ELEMENT_ROWS = [
        ['H', 1, 1.008], ['He', 2, 4.002602], ['Li', 3, 6.94], ['Be', 4, 9.0121831], ['B', 5, 10.81],
        ['C', 6, 12.011], ['N', 7, 14.007], ['O', 8, 15.999], ['F', 9, 18.998403162], ['Ne', 10, 20.1797],
        ['Na', 11, 22.98976928], ['Mg', 12, 24.305], ['Al', 13, 26.9815384], ['Si', 14, 28.085],
        ['P', 15, 30.973761998], ['S', 16, 32.06], ['Cl', 17, 35.45], ['Ar', 18, 39.95], ['K', 19, 39.0983],
        ['Ca', 20, 40.078], ['Sc', 21, 44.955907], ['Ti', 22, 47.867], ['V', 23, 50.9415], ['Cr', 24, 51.9961],
        ['Mn', 25, 54.938043], ['Fe', 26, 55.845], ['Co', 27, 58.933194], ['Ni', 28, 58.6934], ['Cu', 29, 63.546],
        ['Zn', 30, 65.38], ['Ga', 31, 69.723], ['Ge', 32, 72.63], ['As', 33, 74.921595], ['Se', 34, 78.971],
        ['Br', 35, 79.904], ['Kr', 36, 83.798], ['Rb', 37, 85.4678], ['Sr', 38, 87.62], ['Y', 39, 88.905838],
        ['Zr', 40, 91.224], ['Nb', 41, 92.90637], ['Mo', 42, 95.95], ['Ru', 44, 101.07], ['Rh', 45, 102.90549],
        ['Pd', 46, 106.42], ['Ag', 47, 107.8682], ['Cd', 48, 112.414], ['In', 49, 114.818], ['Sn', 50, 118.71],
        ['Sb', 51, 121.76], ['Te', 52, 127.6], ['I', 53, 126.90447], ['Xe', 54, 131.293], ['Cs', 55, 132.90545196],
        ['Ba', 56, 137.327], ['La', 57, 138.90547], ['Ce', 58, 140.116], ['Pr', 59, 140.90766], ['Nd', 60, 144.242],
        ['Sm', 62, 150.36], ['Eu', 63, 151.964], ['Gd', 64, 157.25], ['Tb', 65, 158.925354], ['Dy', 66, 162.5],
        ['Ho', 67, 164.930329], ['Er', 68, 167.259], ['Tm', 69, 168.934219], ['Yb', 70, 173.045],
        ['Lu', 71, 174.9668], ['Hf', 72, 178.486], ['Ta', 73, 180.94788], ['W', 74, 183.84], ['Re', 75, 186.207],
        ['Os', 76, 190.23], ['Ir', 77, 192.217], ['Pt', 78, 195.084], ['Au', 79, 196.96657], ['Hg', 80, 200.592],
        ['Tl', 81, 204.38], ['Pb', 82, 207.2], ['Bi', 83, 208.9804], ['Th', 90, 232.0377], ['Pa', 91, 231.03588],
        ['U', 92, 238.02891],
    ];
    const ELEMENTS = Object.freeze(Object.fromEntries(
        ELEMENT_ROWS.map(([symbol, z, mass]) => [symbol, Object.freeze({ z, mass })])));

    /** Real elements without a standard atomic weight: named in the message, but not computed. */
    const UNSUPPORTED = Object.freeze(('Tc Pm Po At Rn Fr Ra Ac Np Pu Am Cm Bk Cf Es Fm Md No Lr '
        + 'Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' '));

    // The first eight names are the categories of tests/fixtures/sasfit/sld.json.
    const ERROR_CODES = Object.freeze(['unknown_element', 'unsupported_element', 'unbalanced_parenthesis',
        'leading_count', 'empty', 'invalid_character', 'missing_part', 'empty_group', 'invalid_count', 'too_long']);

    /**
     * Preset materials (design spec 4.7): formula + mass density, computed by
     * compute() like any other input. rho_e and SLD below are what compute()
     * returns (f ~ Z), checked against periodictable in tests/sasfit-sld.test.js.
     *
     * Standard formula and density:
     *   water   H2O, 0.9982 g/cm3 at 20 C (CRC Handbook of Chemistry and Physics,
     *           "Standard density of water")             -> 0.3337 e/A^3,  9.403
     *           (1.0000 g/cm3 would give 0.3343 e/A^3, 9.420)
     *   SiO2    amorphous (fused / colloidal) silica, 2.20 g/cm3 (CRC Handbook,
     *           "Physical constants of inorganic compounds", vitreous SiO2)
     *                                                    -> 0.6615 e/A^3, 18.64
     *           (alpha-quartz is 2.648 g/cm3; Stoeber silica can be as low as ~1.9-2.0)
     *   Au      fcc gold, 19.32 g/cm3 at 20 C (CRC Handbook) -> 4.667 e/A^3, 131.5
     *           (Au L3 edge 11.92 keV, L2 13.73 keV: f ~ Z overestimates near 15 keV)
     *   Fe3O4   magnetite, inverse spinel, 5.17 g/cm3 (CRC Handbook; X-ray
     *           density 5.20 g/cm3)                      -> 1.479 e/A^3, 41.68
     *
     * REPRESENTATIVE VALUES -- the four below are not material constants. They
     * were proposed by the implementer from the literature and are subject to
     * confirmation by the project owner (plan M3, Task 3 / Task 15):
     *
     *   protein (average)   C4.9384 H7.7583 N1.3577 O1.4773 S0.0417, the average
     *           amino-acid residue "averagine" (Senko, Beu & McLafferty 1995,
     *           J. Am. Soc. Mass Spectrom. 6, 229-233; 111.125 g/mol, 59.38 e),
     *           at 1.35 g/cm3 = partial specific volume 0.74 cm3/g (Matthews 1968,
     *           J. Mol. Biol. 33, 491-497; Mylonas & Svergun 2007, J. Appl. Cryst.
     *           40, s245-s249 use 0.7425 cm3/g)          -> 0.4344 e/A^3, 12.24
     *           Commonly quoted: 0.42-0.44 e/A^3. With 0.73 cm3/g: 0.4408 e/A^3.
     *   lipid headgroup     phosphatidylcholine head WITHOUT hydration water:
     *           choline + phosphate + glycerol + two carbonyls = C10H18NO8P
     *           (311.23 g/mol, 164 e) in V_H = 319 A^3 (Nagle & Tristram-Nagle
     *           2000, Biochim. Biophys. Acta 1469, 159-195, from gel-phase DPPC:
     *           Sun et al. 1994, Phys. Rev. E 49, 4665) = 1.62 g/cm3
     *                                                    -> 0.5141 e/A^3, 14.49
     *           The 0.45-0.47 e/A^3 usually quoted for the head REGION of a
     *           bilayer profile includes hydration water (0.334 e/A^3); mix the
     *           two by volume fraction for a hydrated shell (five waters per
     *           head give about 0.457 e/A^3).
     *   lipid tail          fluid-phase hydrocarbon chains: one oleoyl chain
     *           without its carbonyl, C17H33 (135 e), from DOPC at 30 C:
     *           V_L 1303 A^3 - V_H 319 A^3 = 984 A^3 for two chains (Nagle &
     *           Tristram-Nagle 2000, as above) = 0.801 g/cm3
     *                                                    -> 0.2742 e/A^3, 7.728
     *           Commonly quoted: 0.27-0.30 e/A^3 (fluid). DPPC chains at 50 C
     *           (C15H31, 913 A^3 for two) give 0.265 e/A^3; gel-phase chains are
     *           denser (about 0.32 e/A^3).
     *   PEG                 monomer C2H4O at the amorphous density 1.125 g/cm3
     *           (Polymer Handbook, 4th ed., Brandrup, Immergut & Grulke eds.,
     *           Wiley 1999, poly(ethylene oxide), amorphous; the crystal is
     *           about 1.23 g/cm3)                        -> 0.3691 e/A^3, 10.40
     *           Commonly quoted: 0.36-0.37 e/A^3.
     */
    const PRESET_ROWS = [
        ['water', '水（20 °C）', 'H2O', 0.9982, 'CRC Handbook of Chemistry and Physics：水在 20 °C 的密度'],
        ['protein', '蛋白質（平均）', 'C4.9384H7.7583N1.3577O1.4773S0.0417', 1.35,
            '代表值。組成：averagine（Senko 等 1995, J. Am. Soc. Mass Spectrom. 6, 229）；'
            + '密度：偏比容 0.74 cm³/g（Matthews 1968, J. Mol. Biol. 33, 491）'],
        ['lipid_head', '脂質頭基（PC，不含水合水）', 'C10H18NO8P', 1.62,
            '代表值。磷脂醯膽鹼頭基 164 個電子、體積 319 Å³'
            + '（Nagle 與 Tristram-Nagle 2000, Biochim. Biophys. Acta 1469, 159）'],
        ['lipid_tail', '脂質尾鏈（液態相）', 'C17H33', 0.801,
            '代表值。DOPC 30 °C 的兩條油醯鏈體積 984 Å³'
            + '（Nagle 與 Tristram-Nagle 2000, Biochim. Biophys. Acta 1469, 159）'],
        ['peg', 'PEG（非晶態）', 'C2H4O', 1.125,
            '代表值。聚環氧乙烷非晶態密度（Polymer Handbook 第 4 版, Wiley 1999）'],
        ['sio2', 'SiO₂（非晶態）', 'SiO2', 2.2, 'CRC Handbook of Chemistry and Physics：非晶態（熔融）二氧化矽'],
        ['au', 'Au（面心立方）', 'Au', 19.32, 'CRC Handbook of Chemistry and Physics：金在 20 °C 的密度'],
        ['fe3o4', 'Fe₃O₄（磁鐵礦）', 'Fe3O4', 5.17, 'CRC Handbook of Chemistry and Physics：磁鐵礦（反尖晶石）'],
    ];
    const PRESETS = Object.freeze(PRESET_ROWS.map(([id, label, formula, density, source]) =>
        Object.freeze({ id, label, formula, density, source })));

    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isSeparator = (ch) => ch !== '' && SEPARATORS.indexOf(ch) >= 0;

    /** index: 0-based offset into the text; the error carries the 1-based position. */
    function fail(code, index, reason) {
        const position = index + 1;
        return Object.assign(new Error('化學式第 ' + position + ' 個字元：' + reason), { code, position });
    }

    function skipSpace(ctx) {
        while (ctx.i < ctx.text.length && SPACE_RE.test(ctx.text[ctx.i])) ctx.i += 1;
    }

    function matchAt(re, ctx) {
        re.lastIndex = ctx.i;
        const m = re.exec(ctx.text);
        return m === null ? null : m[0];
    }

    /** An optional count at the cursor; 1 when there is none. */
    function readCount(ctx) {
        skipSpace(ctx);
        const token = matchAt(COUNT_RE, ctx);
        if (token === null) return 1;
        const value = Number(token);
        if (!(value > 0) || !Number.isFinite(value)) {
            throw fail('invalid_count', ctx.i, '個數「' + token + '」必須大於 0');
        }
        ctx.i += token.length;
        return value;
    }

    function addAtoms(target, source, factor) {
        source.forEach((n, symbol) => target.set(symbol, (target.get(symbol) || 0) + n * factor));
    }

    function readElement(ctx, atoms) {
        const at = ctx.i;
        const symbol = matchAt(SYMBOL_RE, ctx);
        if (!has(ELEMENTS, symbol)) {
            if (UNSUPPORTED.indexOf(symbol) >= 0) {
                throw fail('unsupported_element', at, '不支援的元素「' + symbol + '」（沒有標準原子量）');
            }
            throw fail('unknown_element', at, '不認得的元素「' + symbol + '」');
        }
        ctx.i += symbol.length;
        addAtoms(atoms, new Map([[symbol, 1]]), readCount(ctx));
    }

    function readGroup(ctx, atoms) {
        const open = ctx.i;
        ctx.i += 1;
        const inner = readUnits(ctx);
        const ch = ctx.text.charAt(ctx.i);
        if (ch === '') throw fail('unbalanced_parenthesis', open, '左括號「(」沒有對應的右括號');
        if (isSeparator(ch)) throw fail('invalid_character', ctx.i, '分隔符「' + ch + '」不能寫在括號內');
        if (ch !== ')') throw unexpected(ctx);
        if (inner.size === 0) throw fail('empty_group', open, '括號內沒有任何元素');
        ctx.i += 1;
        addAtoms(atoms, inner, readCount(ctx));
    }

    /** part := unit+ ; stops (without consuming) at anything that cannot start a unit. */
    function readUnits(ctx) {
        const atoms = new Map();
        for (;;) {
            skipSpace(ctx);
            const ch = ctx.text.charAt(ctx.i);
            if (ch >= 'A' && ch <= 'Z') readElement(ctx, atoms);
            else if (ch === '(') readGroup(ctx, atoms);
            else return atoms;
        }
    }

    /** The error for a character that cannot continue the formula at the cursor. */
    function unexpected(ctx) {
        const ch = ctx.text.charAt(ctx.i);
        if (ch === ')') return fail('unbalanced_parenthesis', ctx.i, '多出右括號「)」');
        if (ch >= '0' && ch <= '9') {
            return fail('leading_count', ctx.i, '數字只能寫在元素或括號之後；倍數只能寫在分隔符「·」之後');
        }
        if (ch >= 'a' && ch <= 'z') {
            return fail('invalid_character', ctx.i, '元素符號的第一個字母必須大寫（「' + ch + '」）');
        }
        return fail('invalid_character', ctx.i, '不能使用的字元「' + ch + '」');
    }

    /** One part and, when it is not the first, its multiplier; the part must not be empty. */
    function readPart(ctx, total, separatorAt) {
        const factor = separatorAt === null ? 1 : readCount(ctx);
        const part = readUnits(ctx);
        if (part.size > 0) {
            addAtoms(total, part, factor);
            return;
        }
        const ch = ctx.text.charAt(ctx.i);
        if (separatorAt !== null && (ch === '' || isSeparator(ch))) {
            throw fail('missing_part', separatorAt, '分隔符「' + ctx.text[separatorAt] + '」之後缺少化學式');
        }
        if (isSeparator(ch)) throw fail('missing_part', ctx.i, '分隔符「' + ch + '」之前缺少化學式');
        throw unexpected(ctx);
    }

    function assertText(text) {
        if (typeof text !== 'string' || text.trim() === '') throw fail('empty', 0, '沒有內容，請輸入化學式');
        if (text.length > MAX_FORMULA_LENGTH) {
            throw fail('too_long', MAX_FORMULA_LENGTH, '化學式太長，最多 ' + MAX_FORMULA_LENGTH + ' 個字元');
        }
    }

    /**
     * parseFormula(text) -> { atoms: { symbol: count }, symbols: [symbol, ...] }, both in order of
     * first appearance. Throws the Error described in the file header.
     */
    function parseFormula(text) {
        assertText(text);
        const ctx = { text, i: 0 };
        const total = new Map();
        let separatorAt = null;
        for (;;) {
            readPart(ctx, total, separatorAt);
            skipSpace(ctx);
            const ch = ctx.text.charAt(ctx.i);
            if (ch === '') break;
            if (!isSeparator(ch)) throw unexpected(ctx);
            separatorAt = ctx.i;
            ctx.i += 1;
        }
        return Object.freeze({
            atoms: Object.freeze(Object.fromEntries(total)),
            symbols: Object.freeze(Array.from(total.keys())),
        });
    }

    /** 'Cu 1、S 1、O 9、H 10' in the key order of atoms; counts without padded decimals. */
    function compositionText(atoms) {
        return Object.keys(atoms)
            .map((symbol) => symbol + ' ' + String(Number(atoms[symbol].toPrecision(TEXT_DIGITS))))
            .join('、');
    }

    /**
     * compute(formula, densityGcm3) -> { sld (1e-6 A^-2), electronDensity (e/A^3), molarMass (g/mol),
     * electrons (per formula unit), atoms }. Throws for a bad formula (parseFormula) or density.
     */
    function compute(formula, densityGcm3) {
        if (typeof densityGcm3 !== 'number' || !Number.isFinite(densityGcm3) || !(densityGcm3 > 0)) {
            throw Object.assign(new Error('密度必須是大於 0 的數字（g/cm³）'), { code: 'bad_density' });
        }
        const { atoms, symbols } = parseFormula(formula);
        const molarMass = symbols.reduce((sum, s) => sum + atoms[s] * ELEMENTS[s].mass, 0);
        const electrons = symbols.reduce((sum, s) => sum + atoms[s] * ELEMENTS[s].z, 0);
        const electronDensity = N_A * densityGcm3 * electrons / molarMass * CM3_PER_A3;
        return Object.freeze({ sld: R_E * electronDensity * SLD_UNIT, electronDensity, molarMass, electrons, atoms });
    }

    globalThis.SasFitSld = Object.freeze({
        R_E, N_A, MAX_FORMULA_LENGTH, ELEMENTS, PRESETS, ERROR_CODES,
        parseFormula, compositionText, compute,
    });
})();
