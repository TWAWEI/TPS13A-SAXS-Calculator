'use strict';
/**
 * sasfit-sasview.js（v5.7）：擬合結果 → SasView「Copy Params／Paste Params」的參數文字。
 *
 * 格式來自 SasView 自己的原始碼（6.1.0 的 FittingWidget.getFitParameters／updatePageWithParameters／updateFullModel、
 * PolydispersityWidget.gatherPolyParams／updateFullPolyModel、FittingUtilities.formatParameters；5.0.6 同名函式），
 * 並以本機 SasView 6.1.0 的 FittingWidget 實際貼上讀回驗證過（規格 §9、決策 41）。三個黃金字串是完整的期望輸出：
 * 改輸出格式必須同時改這裡，並重新對真的 SasView 驗證。
 *
 * parse() 是照格式說明寫的小解析器（等同 SasView clipboard_paste 的切法：先以「:」切行、再以「,」切欄）。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SasFitSasView: V, SasFitMeta, SasFitForm, SasFitExport } = require('./load.js');
const h = require('./sasfit-export-helpers.js');

const TAIL = ':magnetic_params,False:2D_params,False';
const SPHERE_GOLDEN = 'sasview_parameter_values:model_name,sphere'
    + ':scale,True,0.98,0.012,0,inf,():background,False,0.001,None,-inf,inf,():sld,False,1,None,-inf,inf,()'
    + ':sld_solvent,False,6,None,-inf,inf,():radius,True,50.0123456789,0.125,0,inf,()'
    + ':polydisperse_params,False' + TAIL + ':fitpage_model,sphere:fitpage_structure,None';
const CORE_SHELL_GOLDEN = 'sasview_parameter_values:model_name,core_shell_sphere'
    + ':scale,True,1,0.02,0,inf,():background,False,0.001,None,-inf,inf,():radius,True,60,0.5,0,inf,()'
    + ':thickness,False,10,None,0,inf,():sld_core,False,1,None,-inf,inf,():sld_shell,False,2,None,-inf,inf,()'
    + ':sld_solvent,False,3,None,-inf,inf,()'
    + ':radius.width,True,0.1,0.01,0,0.4,35,3,gaussian:thickness.width,False,0,None,0.0,1.0,35,3,gaussian'
    + ':polydisperse_params,True' + TAIL + ':fitpage_model,core_shell_sphere:fitpage_structure,None';
const HAYTER_GOLDEN = 'sasview_parameter_values:model_name,sphere'
    + ':scale,True,1.25,0.03,0,inf,():background,False,0.002,None,-inf,inf,()'
    + ':structure_factor_mode,None,1,None,,,():radius_effective_mode,None,1,None,,,()'
    + ':sld,False,1,None,-inf,inf,():sld_solvent,False,6,None,-inf,inf,():radius,True,48.5,0.25,0,inf,()'
    + ':volfraction,True,0.0192,0.001,0,0.74,():charge,False,19,None,0.5,200,():temperature,False,318.16,None,0,450,()'
    + ':concentration_salt,False,0,None,0,inf,():dielectconst,False,71.08,None,-inf,inf,()'
    + ':polydisperse_params,False' + TAIL + ':fitpage_model,sphere:fitpage_structure,hayter_msa';

const spec = (model, structure = null, lowQPowerLaw = false) => ({ model, structure, lowQPowerLaw });
const coreShell = (pd = {}, extra = {}) => h.coreShellResult({
    params: { scale: 1, background: 0.001, radius: 60, radius_pd: 0.1, radius_pd_n: 35, radius_pd_nsigma: 3, radius_pd_type: 'gaussian',
        thickness: 10, sld_core: 1, sld_shell: 2, sld_solvent: 3, ...pd },
    modelSpec: spec('core_shell_sphere'), ...extra,
});
const hayter = (extra = {}) => h.sphereResult({
    params: { scale: 1.25, background: 0.002, sld: 1, sld_solvent: 6, radius: 48.5, volfraction: 0.0192, charge: 19, temperature: 318.16,
        concentration_salt: 0, dielectconst: 71.08, structure_factor_mode: 1, radius_effective_mode: 1 },
    names: ['scale', 'radius', 'volfraction'], errors: { scale: 0.03, radius: 0.25, volfraction: 0.001 },
    modelSpec: spec('sphere', 'hayter_msa'), ...extra,
});

/** The text as SasView's clipboard_paste cuts it: { name: [fields] } and the model; only lines with more than one field. */
function parse(text) {
    const lines = text.split(':');
    assert.equal(lines[0], 'sasview_parameter_values');
    const dict = {};
    lines.slice(1).forEach((line) => {
        const fields = line.split(',');
        if (fields.length > 1) dict[fields[0]] = fields.slice(1);
    });
    return dict;
}
/** Python's float() on a field of the text. */
const pyFloat = (field) => ({ inf: Infinity, '-inf': -Infinity }[field] === undefined ? Number(field) : { inf: Infinity, '-inf': -Infinity }[field]);

// ---------------------------------------------------------------- 模組
test('[sasfit-sasview] 模組：凍結的單一匯出；純函式（原始碼沒有 document／window／計時器／色碼）；名稱白名單涵蓋 meta 的 15 個模型', () => {
    assert.equal(globalThis.SasFitSasView, V);
    assert.ok(Object.isFrozen(V));
    assert.equal(V.TOKEN, 'sasview_parameter_values');
    assert.deepEqual([...V.MODELS, ...V.STRUCTURES].sort(), Object.keys(SasFitMeta.models).sort());
    assert.deepEqual([...V.PD_TYPES].sort(), Object.keys(SasFitForm.PD_UI_DEFAULTS).sort());
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'sasfit-sasview.js'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/\bdocument\b|\bwindow\b|setTimeout|setInterval|navigator|toFixed|toPrecision/.test(code));
});

// ---------------------------------------------------------------- 三個黃金字串
test('[sasfit-sasview] 黃金字串 1：sphere（擬合 scale、radius；上下限未給 → 模型預設）', () => {
    assert.equal(V.text(h.sphereResult(), null), SPHERE_GOLDEN);
});

test('[sasfit-sasview] 黃金字串 2：core_shell_sphere，radius 開 gaussian 多分散並擬合寬度；沒開的 thickness 寫成寬度 0 的 SasView 預設列', () => {
    assert.equal(V.text(coreShell(), null), CORE_SHELL_GOLDEN);
});

test('[sasfit-sasview] 黃金字串 3：sphere@hayter_msa，β 組合；兩個模式列在 background 之後；radius_effective 由模型定義時不寫', () => {
    assert.equal(V.text(hayter(), null), HAYTER_GOLDEN);
});

// ---------------------------------------------------------------- 來回
test('[sasfit-sasview] 來回：照格式解析後，每個參數的勾選、數值（全精度）、誤差、上下限都讀得回來', () => {
    const result = h.sphereResult({ params: { scale: 0.1 + 0.2, background: -1e-7, sld: 1, sld_solvent: 6, radius: 50.0123456789 } });
    const bounds = { scale: [0, Infinity], background: [-Infinity, Infinity], sld: [-5, 20.5], sld_solvent: [-Infinity, Infinity], radius: [10, 1e3] };
    const dict = parse(V.text(result, bounds));
    assert.deepEqual(dict.model_name, ['sphere']);
    ['scale', 'background', 'sld', 'sld_solvent', 'radius'].forEach((name) => {
        const [checked, value, error, min, max, cons] = dict[name];
        assert.equal(dict[name].length, 6, name + '：6 欄（SasView 以「多於 5 欄」判斷有誤差欄）');
        assert.equal(checked, String(result.names.includes(name)).replace(/^./, (c) => c.toUpperCase()));
        assert.ok(Object.is(pyFloat(value), result.params[name]), name);
        assert.equal(error, result.names.includes(name) ? String(result.errors[name]) : 'None');
        assert.deepEqual([pyFloat(min), pyFloat(max)], bounds[name]);
        assert.equal(cons, '()');
    });
    assert.deepEqual(dict.polydisperse_params, ['False']);
});

test('[sasfit-sasview] 來回：多分散列是 8 欄（勾選、寬度、誤差、下限、上限、Npts、Nsigs、分布），照這次擬合實際用的設定寫', () => {
    const result = h.coreShellResult({ structure: 'hardsphere' });                     // schulz 80 / 3，radius_pd 擬合
    const bounds = { radius_pd: [0, 0.3] };
    const dict = parse(V.text(result, bounds));
    assert.deepEqual(dict['radius.width'], ['True', '0.1', '0.01', '0', '0.3', '80', '3', 'schulz']);
    assert.deepEqual(dict['thickness.width'], ['False', '0', 'None', '0.0', '1.0', '35', '3', 'gaussian']);
    assert.deepEqual(dict.polydisperse_params, ['True']);
    assert.deepEqual(dict.structure_factor_mode, ['None', '0', 'None', '', '', '()']);
    assert.deepEqual(dict.radius_effective_mode, ['None', '1', 'None', '', '', '()']);
    assert.deepEqual(dict.fitpage_structure, ['hardsphere']);
    assert.equal('radius_effective' in dict, false);
    const uniform = parse(V.text(coreShell({ radius_pd_type: 'uniform', radius_pd_nsigma: 3 }), null));
    assert.deepEqual(uniform['radius.width'].slice(5), ['35', '', 'uniform'], '沒有 Nsigs 的分布留空（SasView 自己也是）');
});

test('[sasfit-sasview] 有效半徑模式 0（unconstrained）：radius_effective 是一般參數列', () => {
    const result = hayter({ params: { ...hayter().params, radius_effective: 55.5, radius_effective_mode: 0 }, names: ['radius_effective'], errors: { radius_effective: 2 } });
    const dict = parse(V.text(result, null));
    assert.deepEqual(dict.radius_effective, ['True', '55.5', '2', '0', 'inf', '()']);
    assert.deepEqual(dict.radius_effective_mode, ['None', '0', 'None', '', '', '()']);
});

test('[sasfit-sasview] 誤差：一律未乘的 1 σ（errors，不是 errorsScaled）；貼邊界或不是有限值時寫 None', () => {
    const none = h.sphereResult({ weighting: 'none', chi2r: 9 });
    assert.equal(none.errorsScaled.radius, 0.375);
    assert.deepEqual(parse(V.text(none, null)).radius.slice(0, 3), ['True', '50.0123456789', '0.125']);
    assert.equal(parse(V.text(h.sphereResult({ atUpper: true }), null)).radius[2], 'None');
    assert.equal(parse(V.text(h.sphereResult({ errors: { scale: NaN, radius: 0.125 } }), null)).scale[2], 'None');
});

// ---------------------------------------------------------------- 不能表示的情況
test('[sasfit-sasview] check：低 q 冪律附加項、不認得的模型／分布、非有限的數值 → 不產生文字，理由是中文', () => {
    assert.deepEqual(V.check(h.sphereResult()), { ok: true, reason: '' });
    const lowQ = V.check(h.coreShellResult({ lowQ: true }));
    assert.equal(lowQ.ok, false);
    assert.match(lowQ.reason, /低 q 冪律/);
    assert.throws(() => V.text(h.coreShellResult({ lowQ: true }), null), /低 q 冪律/);
    assert.match(V.check(h.sphereResult({ modelSpec: spec('fractal') })).reason, /SasView 參數文字不支援模型/);
    assert.match(V.check(hayter({ modelSpec: spec('sphere', 'squarewell') })).reason, /不支援結構因子/);
    assert.match(V.check(coreShell({ radius_pd_type: 'array' })).reason, /分布/);
    assert.match(V.check(h.sphereResult({ params: { ...h.sphereResult().params, radius: NaN } })).reason, /radius.*不是有限的數值/);
    assert.match(V.check(coreShell({ radius_pd_n: NaN })).reason, /radius.*多分散/);
    assert.equal(V.check(null).ok, false);
});

test('[sasfit-sasview] 15 個模型（與可用的結構因子組合）都產生文字，內容只有識別字、數字與格式字元', () => {
    const F = SasFitForm;
    let combined = 0;
    V.MODELS.forEach((model) => {
        [null, ...V.STRUCTURES].forEach((structure) => {
            let form = F.create(model);
            if (structure !== null) {
                try {
                    form = F.reduce(form, { type: 'setStructure', structure });
                } catch (err) {
                    assert.match(err.message, /cannot take a structure factor/);       // 這個模型不能配結構因子
                    return;
                }
                combined += 1;
            }
            const params = globalThis.SasFitJobs.params(form);
            const result = h.sphereResult({ params, names: ['scale'], errors: { scale: 0.01 }, modelSpec: spec(model, structure) });
            const text = V.text(result, null);
            assert.match(text, /^sasview_parameter_values:model_name,[a-z_]+:/, model);
            assert.match(text, /^[A-Za-z0-9_.,:()+\-]+$/, model + '@' + structure);
            const dict = parse(text);
            SasFitExport.paramRows(result, null).filter((row) => row.pd === null).forEach((row) => assert.equal(dict[row.name].length, 6, row.name));
        });
    });
    assert.equal(combined, 12, '6 個形狀模型 × 2 個結構因子');
});

// ---------------------------------------------------------------- 說明
test('[sasfit-sasview] notes：每次擬合需要的手動步驟與 SasView 的已知限制', () => {
    const plain = V.notes(h.sphereResult(), { boundsKnown: true });
    assert.equal(plain.length, 2);
    assert.match(plain[0], /先選模型 sphere.*Edit → Paste Params/);
    assert.match(plain[1], /5 位有效數字.*誤差/);
    const s = V.notes(hayter(), { boundsKnown: true });
    assert.match(s[0], /sphere.*Structure factor.*hayter_msa/);
    assert.ok(s.some((n) => /background.*0\.002/.test(n)), 'SasView 6 有結構因子時不貼 background：寫出要手動輸入的值');
    const pd = V.notes(h.coreShellResult(), { boundsKnown: false });
    assert.ok(pd.some((n) => /Function.*radius.*schulz/.test(n)), '分布不是 gaussian：先手動選');
    assert.ok(pd.some((n) => /Npts.*Nsigs.*radius 0\.1/.test(n)), 'SasView 6 貼上 Npts／Nsigs 會蓋掉寬度：寫出要重新輸入的值');
    assert.ok(pd.some((n) => /上下限.*預設/.test(n)));
    const gaussian = V.notes(coreShell(), { boundsKnown: true });
    assert.equal(gaussian.some((n) => /Function/.test(n)), false);
    assert.ok(gaussian.some((n) => /Npts.*Nsigs/.test(n)));
    assert.ok(V.notes(h.sphereResult({ weighting: 'none' }), { boundsKnown: true }).some((n) => /未乘/.test(n)));
});

test('[sasfit-sasview] 不修改傳入的物件', () => {
    const result = h.coreShellResult();
    const bounds = Object.freeze({ radius: Object.freeze([0, 100]) });
    const before = JSON.stringify(result);
    V.text(result, bounds);
    V.notes(result, { boundsKnown: true });
    assert.equal(JSON.stringify(result), before);
});
