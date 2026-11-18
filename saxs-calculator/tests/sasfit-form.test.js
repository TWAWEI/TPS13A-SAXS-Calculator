'use strict';
/**
 * sasfit-form.js: model form, UI defaults, field validation and the parameter-table view-model
 * (design spec 4.1, 4.3-4.5, 5.3, 5.7 items 10 and 12; plan M3 Task 4).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    SasFitForm: F, SasFitMeta: M, SasFitWeights: W, SasFitValidate: V, SasFitWorkerCore: Core,
} = require('./load.js');

const SHAPES = ['sphere', 'core_shell_sphere', 'vesicle', 'ellipsoid', 'cylinder', 'core_shell_cylinder',
    'flexible_cylinder', 'lamellar'];
const INDEPENDENT = ['guinier', 'guinier_porod', 'power_law', 'mono_gauss_coil', 'gaussian_peak'];
const WITH_S = ['sphere', 'core_shell_sphere', 'vesicle', 'ellipsoid', 'cylinder', 'core_shell_cylinder'];
const STRUCTURES = ['hardsphere', 'hayter_msa'];

const run = (form, ...actions) => actions.reduce((f, a) => F.reduce(f, a), form);
const rowOf = (form, name) => F.rows(form).find((r) => r.name === name);
const names = (form) => F.rows(form).map((r) => r.name);
const isDeepFrozen = (o) => o === null || typeof o !== 'object'
    || (Object.isFrozen(o) && Object.values(o).every(isDeepFrozen));
const withS = (model, structure) => run(F.create(model), { type: 'setStructure', structure });
const openPd = (form, name) => run(form, { type: 'togglePd', name });
const errorKeys = (form) => Object.keys(F.validate(form).errors);

test('module is frozen and exports the constants of the plan', () => {
    assert.ok(isDeepFrozen(F));
    assert.equal(F.PD_DEFAULT_TYPE, 'gaussian');
    assert.deepEqual([...F.PD_WIDTH_BOUNDS], [0, 0.4]);
    assert.equal(F.PD_FIT_START, 0.05);
    assert.equal(F.CHARGE_LOWER, 0.5);
    assert.deepEqual([...F.LOWQ_POWER_BOUNDS], [0, 6]);
});

test('PD_UI_DEFAULTS: spec 4.3 table; differs from SasFitWeights.DEFAULTS only in two nsigmas', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(F.PD_UI_DEFAULTS)), {
        gaussian: { npts: 35, nsigmas: 3 }, rectangle: { npts: 35, nsigmas: 1.73205 }, uniform: { npts: 35, nsigmas: null },
        lognormal: { npts: 80, nsigmas: 3 }, schulz: { npts: 80, nsigmas: 3 }, boltzmann: { npts: 35, nsigmas: 3 },
    });
    assert.deepEqual(Object.keys(F.PD_UI_DEFAULTS).sort(), Object.keys(W.DEFAULTS).sort());
    assert.deepEqual([...F.PD_TYPES], Object.keys(F.PD_UI_DEFAULTS));
    const differing = [];
    Object.keys(W.DEFAULTS).forEach((type) => {
        assert.equal(F.PD_UI_DEFAULTS[type].npts, W.DEFAULTS[type].npts, type + ' npts');
        if (F.PD_UI_DEFAULTS[type].nsigmas !== W.DEFAULTS[type].nsigmas) differing.push(type);
    });
    assert.deepEqual(differing.sort(), ['lognormal', 'schulz']);
    assert.equal(W.DEFAULTS.schulz.nsigmas, 8);
    assert.equal(W.DEFAULTS.lognormal.nsigmas, 8);
});

test('models(): two groups in meta order, no structure factors; search; keep', () => {
    const all = F.models('');
    assert.deepEqual(all.map((g) => g.group), ['形狀', '與形狀無關']);
    assert.deepEqual(all[0].items.map((i) => i.name), SHAPES);
    assert.deepEqual(all[1].items.map((i) => i.name), INDEPENDENT);
    assert.equal(all[0].items[0].title, M.models.sphere.title);
    assert.deepEqual(F.models(), all);
    assert.ok(isDeepFrozen(all));
    const cyl = F.models('cyl');
    assert.deepEqual(cyl.map((g) => g.group), ['形狀']);
    assert.deepEqual(cyl[0].items.map((i) => i.name), ['cylinder', 'core_shell_cylinder', 'flexible_cylinder']);
    assert.deepEqual(F.models('  CYL '), cyl);
    assert.deepEqual(F.models('polymer')[0].items.map((i) => i.name), ['mono_gauss_coil']);   // title match
    assert.deepEqual(F.models('no such model'), []);
    assert.deepEqual(F.models('cyl', 'sphere')[0].items.map((i) => i.name),
        ['sphere', 'cylinder', 'core_shell_cylinder', 'flexible_cylinder']);
    assert.deepEqual(F.models('cyl', 'guinier').map((g) => g.group), ['形狀', '與形狀無關']);
    assert.deepEqual(F.models('hard'), []);
});

test('canTakeStructure: exactly the six models of spec 4.1', () => {
    const yes = M.order.filter((name) => F.canTakeStructure(name));
    assert.deepEqual(yes, WITH_S);
    assert.equal(F.canTakeStructure('mono_gauss_coil'), false);
    assert.ok(M.models.mono_gauss_coil.reffModes.length > 0 && !M.models.mono_gauss_coil.haveFq);
    assert.equal(F.canTakeStructure('hardsphere'), false);
    assert.throws(() => F.canTakeStructure('nope'), /Unknown model/);
});

test('create(sphere): rows, defaults, units, fit flags; form is deep frozen', () => {
    const form = F.create('sphere');
    assert.ok(isDeepFrozen(form));
    assert.equal(form.model, 'sphere');
    assert.equal(form.structure, null);
    assert.equal(form.lowQ, false);
    const rows = F.rows(form);
    assert.ok(isDeepFrozen(rows));
    assert.deepEqual(rows.map((r) => r.name), ['scale', 'background', 'sld', 'sld_solvent', 'radius']);
    assert.deepEqual(rows.map((r) => r.value), ['1', '0.001', '1', '6', '50']);
    assert.deepEqual(rows.map((r) => r.unit), ['', '', '1e-6/Ang^2', '1e-6/Ang^2', 'Ang']);
    assert.deepEqual(rows.map((r) => r.group), ['common', 'common', 'P', 'P', 'P']);
    assert.deepEqual(rows.map((r) => r.isSld), [false, false, true, true, false]);
    assert.deepEqual(rows.map((r) => r.fit), [true, true, false, false, false]);
    assert.deepEqual(rows.map((r) => r.fittable), [true, true, true, true, true]);
    assert.deepEqual(rows.map((r) => r.label), rows.map((r) => r.name));
    rows.forEach((r) => assert.deepEqual({ ...r.errors }, {}));
    assert.deepEqual(Object.keys(rows[4]).sort(), ['derived', 'errors', 'fit', 'fittable', 'group', 'hardMax', 'hardMin',
        'isSld', 'label', 'lower', 'name', 'note', 'pd', 'unit', 'upper', 'value']);
    assert.throws(() => F.create('hardsphere'), /structure factor/);
    assert.throws(() => F.create('nope'), /Unknown model/);
});

test('default bounds are the hard limits of the meta; infinities are empty strings', () => {
    const sphere = F.create('sphere');
    const radius = rowOf(sphere, 'radius');
    assert.deepEqual([radius.lower, radius.upper, radius.hardMin, radius.hardMax], ['0', '', 0, Infinity]);
    const scale = rowOf(sphere, 'scale');
    assert.deepEqual([scale.lower, scale.upper, scale.hardMin, scale.hardMax], ['0', '', 0, Infinity]);
    const bg = rowOf(sphere, 'background');
    assert.deepEqual([bg.lower, bg.upper, bg.hardMin, bg.hardMax], ['', '', -Infinity, Infinity]);
    const length = rowOf(F.create('cylinder'), 'length');
    assert.deepEqual([length.lower, length.upper], ['0', '']);       // no positive UI floor for lengths
    const vf = rowOf(F.create('vesicle'), 'volfraction');
    assert.deepEqual([vf.lower, vf.upper, vf.unit], ['0', '1', '']);
    const rg = rowOf(F.create('guinier'), 'rg');
    assert.deepEqual([rg.lower, rg.upper, rg.hardMin], ['', '', -Infinity]);
    assert.equal(rowOf(F.create('mono_gauss_coil'), 'i_zero').unit, '1/cm');
});

test('orientation parameters never appear', () => {
    ['cylinder', 'ellipsoid', 'core_shell_cylinder'].forEach((model) => {
        const got = names(F.create(model));
        assert.ok(!got.includes('theta') && !got.includes('phi'), model);
        const expected = ['scale', 'background'].concat(
            M.models[model].params.filter((p) => p.type !== 'orientation').map((p) => p.name));
        assert.deepEqual(got, expected);
    });
});

test('setStructure(hardsphere): S rows, modes, derived radius_effective', () => {
    const form = withS('sphere', 'hardsphere');
    assert.deepEqual(names(form), ['scale', 'background', 'sld', 'sld_solvent', 'radius', 'radius_effective', 'volfraction']);
    assert.equal(form.structure, 'hardsphere');
    assert.equal(form.structureMode, 0);
    assert.equal(form.radiusMode, 1);
    const reff = rowOf(form, 'radius_effective');
    assert.deepEqual([reff.group, reff.fittable, reff.derived, reff.note, reff.fit, reff.pd],
        ['S', false, true, '由模型決定', false, null]);
    const vf = rowOf(form, 'volfraction');
    assert.deepEqual([vf.group, vf.value, vf.lower, vf.upper, vf.fittable], ['S', '0.2', '0', '0.74', true]);
    const free = run(form, { type: 'setRadiusMode', mode: 0 });
    const reff0 = rowOf(free, 'radius_effective');
    assert.deepEqual([reff0.fittable, reff0.derived, reff0.note, reff0.value], [true, false, '', '50']);
    const fitted = run(free, { type: 'setFit', name: 'radius_effective', fit: true });
    assert.equal(rowOf(fitted, 'radius_effective').fit, true);
    // going back to a model-defined radius clears the fit flag; the flag of a derived row cannot be set
    const back = run(fitted, { type: 'setRadiusMode', mode: 1 });
    assert.equal(rowOf(back, 'radius_effective').fit, false);
    assert.throws(() => run(back, { type: 'setFit', name: 'radius_effective', fit: true }), /radius_effective/);
    assert.equal(run(form, { type: 'setStructureMode', mode: 1 }).structureMode, 1);
    assert.throws(() => run(form, { type: 'setStructureMode', mode: 2 }), /structure_factor_mode/);
    assert.throws(() => run(form, { type: 'setRadiusMode', mode: 2 }), /radius_effective_mode/);   // sphere has one mode
    assert.equal(run(withS('cylinder', 'hardsphere'), { type: 'setRadiusMode', mode: 7 }).radiusMode, 7);
    assert.throws(() => run(F.create('sphere'), { type: 'setRadiusMode', mode: 1 }), /structure/);
});

test('vesicle keeps its own volfraction; hayter_msa rows, charge floor, no PD on radius_effective', () => {
    const ves = withS('vesicle', 'hardsphere');
    assert.deepEqual(names(ves), ['scale', 'background', 'sld', 'sld_solvent', 'volfraction', 'radius', 'thickness',
        'radius_effective']);
    assert.deepEqual([rowOf(ves, 'volfraction').group, rowOf(ves, 'volfraction').upper], ['P', '1']);
    const hmsa = run(withS('sphere', 'hayter_msa'), { type: 'setRadiusMode', mode: 0 });
    assert.deepEqual(names(hmsa).slice(5),
        ['radius_effective', 'volfraction', 'charge', 'temperature', 'concentration_salt', 'dielectconst']);
    const charge = rowOf(hmsa, 'charge');
    assert.deepEqual([charge.lower, charge.upper, charge.hardMin, charge.hardMax, charge.value, charge.unit],
        ['0.5', '200', 1e-6, 200, '19', 'e']);
    assert.equal(rowOf(hmsa, 'radius_effective').pd, null);
    assert.equal(M.models.hayter_msa.params[0].pd, true);          // the meta says it could; the page does not offer it
    assert.throws(() => openPd(hmsa, 'radius_effective'), /polydispers/);
    assert.deepEqual([rowOf(hmsa, 'volfraction').unit, rowOf(hmsa, 'dielectconst').unit, rowOf(hmsa, 'temperature').unit],
        ['None', 'None', 'K']);
    assert.equal(errorKeys(hmsa).length, 0);
});

test('setStructure: refused where S(Q) does not apply; null removes it; setModel drops or keeps it', () => {
    ['flexible_cylinder', 'lamellar', 'guinier', 'mono_gauss_coil'].forEach((model) => {
        assert.throws(() => withS(model, 'hardsphere'), /cannot take a structure factor/, model);
    });
    assert.throws(() => withS('sphere', 'sphere'), /not a structure factor/);
    assert.throws(() => withS('sphere', 'nope'), /Unknown model/);
    const form = run(withS('sphere', 'hayter_msa'), { type: 'setValue', name: 'charge', value: '12' },
        { type: 'setStructureMode', mode: 1 });
    const none = run(form, { type: 'setStructure', structure: null });
    assert.equal(none.structure, null);
    assert.deepEqual(names(none), names(F.create('sphere')));
    const kept = run(form, { type: 'setModel', model: 'cylinder' }, { type: 'setRadiusMode', mode: 5 });
    assert.equal(kept.structure, 'hayter_msa');
    assert.equal(kept.structureMode, 1);
    assert.equal(rowOf(kept, 'charge').value, '12');               // S values survive a change of P
    assert.equal(rowOf(kept, 'radius').value, '20');               // P values are the new model's defaults
    const clamped = run(kept, { type: 'setModel', model: 'sphere' });
    assert.equal(clamped.radiusMode, 1);                           // sphere has no mode 5
    // volfraction changes its owner (P for vesicle, S otherwise): it starts from the new owner's defaults
    const fromVesicle = run(withS('vesicle', 'hardsphere'), { type: 'setValue', name: 'volfraction', value: '0.9' },
        { type: 'setModel', model: 'sphere' });
    const vf = rowOf(fromVesicle, 'volfraction');
    assert.deepEqual([vf.group, vf.value, vf.upper], ['S', '0.2', '0.74']);
    const switched = run(form, { type: 'setStructure', structure: 'hardsphere' });
    assert.deepEqual([rowOf(switched, 'volfraction').value, rowOf(switched, 'radius_effective').value], ['0.2', '50']);
    const dropped = run(form, { type: 'setModel', model: 'lamellar' });
    assert.equal(dropped.structure, null);
    assert.deepEqual(names(dropped), ['scale', 'background', 'thickness', 'sld', 'sld_solvent']);
    assert.throws(() => run(form, { type: 'setModel', model: 'hardsphere' }), /structure factor/);
});

test('setLowQ: two rows with their defaults; kept across a model change; removed when off', () => {
    const form = run(F.create('sphere'), { type: 'setLowQ', on: true });
    assert.equal(form.lowQ, true);
    assert.deepEqual(names(form).slice(-2), ['lowq_scale', 'lowq_power']);
    const a = rowOf(form, 'lowq_scale');
    assert.deepEqual([a.group, a.value, a.lower, a.upper, a.fit, a.fittable, a.pd, a.unit], ['lowq', '0', '0', '', false, true, null, '']);
    const n = rowOf(form, 'lowq_power');
    assert.deepEqual([n.value, n.lower, n.upper], ['4', '0', '6']);
    const withSq = run(form, { type: 'setStructure', structure: 'hardsphere' });
    assert.deepEqual(names(withSq).slice(-4), ['radius_effective', 'volfraction', 'lowq_scale', 'lowq_power']);
    const moved = run(form, { type: 'setValue', name: 'lowq_power', value: '3.5' }, { type: 'setModel', model: 'guinier' });
    assert.equal(rowOf(moved, 'lowq_power').value, '3.5');
    assert.deepEqual(names(run(form, { type: 'setLowQ', on: false })), names(F.create('sphere')));
    assert.throws(() => run(form, { type: 'setLowQ', on: 'yes' }), /boolean/);
});

test('PD: only polydisperse size parameters have it', () => {
    const pdNames = (form) => F.rows(form).filter((r) => r.pd !== null).map((r) => r.name);
    assert.deepEqual(pdNames(F.create('sphere')), ['radius']);
    assert.deepEqual(pdNames(F.create('flexible_cylinder')), ['length', 'kuhn_length', 'radius']);
    assert.deepEqual(pdNames(F.create('mono_gauss_coil')), ['rg']);
    assert.deepEqual(pdNames(F.create('cylinder')), ['radius', 'length']);
    assert.deepEqual(pdNames(F.create('core_shell_cylinder')), ['radius', 'thickness', 'length']);
    assert.deepEqual(pdNames(F.create('guinier')), []);
    assert.deepEqual(pdNames(withS('sphere', 'hayter_msa')), ['radius']);
    M.order.filter((n) => !M.models[n].isStructureFactor).forEach((model) => {
        const expected = M.models[model].params.filter((p) => p.pd && p.type !== 'orientation').map((p) => p.name);
        assert.deepEqual(pdNames(F.create(model)), expected, model);
    });
});

test('togglePd: first expansion is gaussian 35/3, width 0, bounds 0-0.4, not fitted; settings survive a collapse', () => {
    const closed = rowOf(F.create('sphere'), 'radius').pd;
    assert.equal(closed.open, false);
    const form = openPd(F.create('sphere'), 'radius');
    assert.deepEqual({ ...rowOf(form, 'radius').pd }, {
        open: true, fit: false, width: '0', lower: '0', upper: '0.4', type: 'gaussian', npts: '35', nsigmas: '3',
        hasNsigmas: true, errors: {},
    });
    const edited = run(form, { type: 'setPdField', name: 'radius', field: 'width', value: '0.12' },
        { type: 'setPdField', name: 'radius', field: 'npts', value: '41' }, { type: 'togglePd', name: 'radius' });
    assert.equal(rowOf(edited, 'radius').pd.open, false);
    const again = openPd(edited, 'radius').pds.radius;
    assert.deepEqual([again.open, again.width, again.npts], [true, '0.12', '41']);
    assert.throws(() => openPd(F.create('sphere'), 'sld'), /polydispers/);
    assert.throws(() => openPd(F.create('sphere'), 'nope'), /nope/);
});

test('setPdField(type): npts / nsigmas reset to the UI defaults of every distribution', () => {
    const base = openPd(F.create('sphere'), 'radius');
    F.PD_TYPES.forEach((type) => {
        const custom = run(base, { type: 'setPdField', name: 'radius', field: 'npts', value: '7' },
            { type: 'setPdField', name: 'radius', field: 'nsigmas', value: '9' });
        const pd = rowOf(run(custom, { type: 'setPdField', name: 'radius', field: 'type', value: type }), 'radius').pd;
        assert.equal(pd.type, type);
        assert.equal(pd.npts, String(F.PD_UI_DEFAULTS[type].npts), type);
        assert.equal(pd.hasNsigmas, type !== 'uniform', type);
        // uniform takes no nsigmas; the field then holds PD_NSIGMAS_UNUSED so that a finite number can still be sent
        const expected = type === 'uniform' ? F.PD_NSIGMAS_UNUSED : F.PD_UI_DEFAULTS[type].nsigmas;
        assert.equal(pd.nsigmas, String(expected), type);
    });
    const schulz = rowOf(run(base, { type: 'setPdField', name: 'radius', field: 'type', value: 'schulz' }), 'radius').pd;
    assert.deepEqual([schulz.npts, schulz.nsigmas], ['80', '3']);
    assert.throws(() => run(base, { type: 'setPdField', name: 'radius', field: 'type', value: 'normal' }), /normal/);
    assert.throws(() => run(base, { type: 'setPdField', name: 'radius', field: 'open', value: true }), /open/);
});

test('spec 5.7 item 12: a width ticked for fitting at 0 (or blank) starts at 0.05', () => {
    const base = openPd(F.create('sphere'), 'radius');
    const fitted = run(base, { type: 'setPdFit', name: 'radius', fit: true });
    assert.deepEqual([fitted.pds.radius.fit, fitted.pds.radius.width], [true, '0.05']);
    const blank = run(base, { type: 'setPdField', name: 'radius', field: 'width', value: '  ' },
        { type: 'setPdFit', name: 'radius', fit: true });
    assert.equal(blank.pds.radius.width, '0.05');
    const positive = run(base, { type: 'setPdField', name: 'radius', field: 'width', value: '0.2' },
        { type: 'setPdFit', name: 'radius', fit: true });
    assert.equal(positive.pds.radius.width, '0.2');
    const off = run(fitted, { type: 'setPdFit', name: 'radius', fit: false });
    assert.deepEqual([off.pds.radius.fit, off.pds.radius.width], [false, '0.05']);
    const junk = run(base, { type: 'setPdField', name: 'radius', field: 'width', value: 'abc' },
        { type: 'setPdFit', name: 'radius', fit: true });
    assert.equal(junk.pds.radius.width, 'abc');                    // left for validate to report
    assert.equal(String(F.PD_FIT_START), '0.05');
});

test('validate: a fresh form of every model and combination is valid', () => {
    M.order.filter((n) => !M.models[n].isStructureFactor).forEach((model) => {
        const forms = [F.create(model), run(F.create(model), { type: 'setLowQ', on: true })];
        if (F.canTakeStructure(model)) STRUCTURES.forEach((s) => forms.push(withS(model, s)));
        forms.forEach((form) => {
            const v = F.validate(form);
            assert.ok(isDeepFrozen(v));
            assert.deepEqual({ ...v }, { valid: true, errors: {}, mesh: 1 }, model);
        });
    });
});

test('validate: one case per kind of field error; keys are <parameter>.<field>, messages Chinese with the name', () => {
    const sphere = F.create('sphere');
    const pd = openPd(sphere, 'radius');
    const setPd = (field, value) => run(pd, { type: 'setPdField', name: 'radius', field, value });
    const cases = [
        [run(sphere, { type: 'setValue', name: 'radius', value: 'abc' }), 'radius.value', /radius.*數值.*數字/],
        [run(sphere, { type: 'setValue', name: 'radius', value: '' }), 'radius.value', /radius.*數值/],
        [run(sphere, { type: 'setValue', name: 'radius', value: '0x10' }), 'radius.value', /數字/],
        [run(sphere, { type: 'setValue', name: 'radius', value: '-5' }), 'radius.value', /radius.*不可小於 0/],
        [run(F.create('vesicle'), { type: 'setValue', name: 'volfraction', value: '1.5' }), 'volfraction.value', /不可大於 1/],
        [run(sphere, { type: 'setLower', name: 'radius', value: '60' }, { type: 'setUpper', name: 'radius', value: '40' }),
            'radius.lower', /radius.*下限.*小於上限/],
        [run(sphere, { type: 'setLower', name: 'radius', value: '40' }, { type: 'setUpper', name: 'radius', value: '40' }),
            'radius.lower', /下限.*小於上限/],
        [run(sphere, { type: 'setLower', name: 'radius', value: '-1' }), 'radius.lower', /radius.*下限.*不可小於.*0/],
        [run(F.create('vesicle'), { type: 'setUpper', name: 'volfraction', value: '2' }), 'volfraction.upper', /上限.*不可大於.*1/],
        [run(sphere, { type: 'setLower', name: 'sld', value: 'x' }), 'sld.lower', /sld.*下限.*數字/],
        [run(sphere, { type: 'setUpper', name: 'sld', value: '1e' }), 'sld.upper', /sld.*上限.*數字/],
        [run(sphere, { type: 'setUpper', name: 'scale', value: '0.5' }), 'scale.value', /scale.*下限與上限之間/],
        [setPd('width', '-0.1'), 'radius_pd.width', /radius.*寬度.*不可小於 0/],
        [setPd('width', 'w'), 'radius_pd.width', /radius.*寬度.*數字/],
        [setPd('lower', '0.5'), 'radius_pd.lower', /寬度.*下限.*小於上限/],
        [setPd('lower', '-0.1'), 'radius_pd.lower', /寬度.*下限.*不可小於.*0/],
        [setPd('npts', '0'), 'radius_pd.npts', /radius.*點數.*整數/],
        [setPd('npts', '3.5'), 'radius_pd.npts', /整數/],
        [setPd('npts', String(V.MAX_PD_POINTS + 1)), 'radius_pd.npts', new RegExp(String(V.MAX_PD_POINTS))],
        [setPd('nsigmas', '0'), 'radius_pd.nsigmas', /radius.*nsigmas.*大於 0/],
        [setPd('nsigmas', ''), 'radius_pd.nsigmas', /nsigmas/],
        [run(setPd('width', '0.5'), { type: 'setPdFit', name: 'radius', fit: true }), 'radius_pd.width', /下限與上限之間/],
    ];
    cases.forEach(([form, key, pattern]) => {
        const v = F.validate(form);
        assert.equal(v.valid, false, key);
        assert.deepEqual(Object.keys(v.errors), [key], key + ': ' + JSON.stringify(v.errors));
        assert.match(v.errors[key], pattern, key);
        assert.match(v.errors[key], /[一-鿿]/);
    });
    // a value outside its own bounds is only an error when the parameter is fitted (open question a10)
    assert.equal(F.validate(run(sphere, { type: 'setUpper', name: 'radius', value: '40' })).valid, true);
    // no fitted parameter is not a form error (SasFitJobs.fitReadiness reports it)
    const none = run(sphere, { type: 'setFit', name: 'scale', fit: false }, { type: 'setFit', name: 'background', fit: false });
    assert.equal(F.validate(none).valid, true);
    // a collapsed PD row is not validated; uniform ignores nsigmas
    assert.equal(F.validate(run(setPd('npts', '0'), { type: 'togglePd', name: 'radius' })).valid, true);
    assert.equal(F.validate(run(setPd('type', 'uniform'), { type: 'setPdField', name: 'radius', field: 'nsigmas', value: '' })).valid, true);
    // a derived radius_effective is not validated either
    const derived = run(withS('sphere', 'hardsphere'), { type: 'setRadiusMode', mode: 0 },
        { type: 'setValue', name: 'radius_effective', value: 'abc' });
    assert.deepEqual(errorKeys(derived), ['radius_effective.value']);
    assert.deepEqual(errorKeys(run(derived, { type: 'setRadiusMode', mode: 1 })), []);
});

test('validate: mesh is the product of the active PD point counts; over the limit names every parameter', () => {
    const set = (form, name, field, value) => run(form, { type: 'setPdField', name, field, value });
    let form = ['radius', 'thickness', 'length'].reduce(openPd, F.create('core_shell_cylinder'));
    assert.equal(F.validate(form).mesh, 1);                         // width 0 and not fitted: monodisperse
    form = set(form, 'radius', 'width', '0.1');
    assert.equal(F.validate(form).mesh, 35);
    form = run(form, { type: 'setPdFit', name: 'length', fit: true });
    assert.equal(F.validate(form).mesh, 35 * 35);
    form = set(set(set(form, 'radius', 'npts', '200'), 'length', 'npts', '200'), 'thickness', 'width', '0.1');
    const v = F.validate(form);
    assert.equal(v.valid, false);
    assert.equal(v.mesh, 200 * 200 * 35);
    assert.deepEqual(Object.keys(v.errors), ['form.mesh']);
    assert.match(v.errors['form.mesh'], /radius 200/);
    assert.match(v.errors['form.mesh'], /thickness 35/);
    assert.match(v.errors['form.mesh'], /length 200/);
    assert.ok(v.errors['form.mesh'].includes(String(V.MAX_EVAL_POINTS)));
    assert.ok(v.mesh > V.MAX_EVAL_POINTS);
    assert.equal(F.validate(run(form, { type: 'togglePd', name: 'thickness' })).mesh, 40000);
});

test('rows carry the errors of validate, split by row and PD row', () => {
    const form = run(openPd(F.create('sphere'), 'radius'), { type: 'setValue', name: 'radius', value: 'x' },
        { type: 'setPdField', name: 'radius', field: 'npts', value: '0' }, { type: 'setLower', name: 'sld', value: 'y' });
    assert.deepEqual(Object.keys(F.validate(form).errors).sort(), ['radius.value', 'radius_pd.npts', 'sld.lower']);
    const radius = rowOf(form, 'radius');
    assert.deepEqual(Object.keys(radius.errors), ['value']);
    assert.deepEqual(Object.keys(radius.pd.errors), ['npts']);
    assert.equal(radius.errors.value, F.validate(form).errors['radius.value']);
    assert.deepEqual(Object.keys(rowOf(form, 'sld').errors), ['lower']);
    assert.deepEqual({ ...rowOf(form, 'scale').errors }, {});
});

test('applyValues: only the named value strings change', () => {
    const base = run(openPd(F.create('sphere'), 'radius'), { type: 'setLower', name: 'radius', value: '10' },
        { type: 'setUpper', name: 'radius', value: '90' }, { type: 'setFit', name: 'radius', fit: true });
    const out = run(base, { type: 'applyValues', values: { radius: 51.2, radius_pd: 0.1, scale: 1.0000000000000002e-3 } });
    assert.equal(out.fields.radius.value, '51.2');
    assert.equal(out.pds.radius.width, '0.1');
    assert.equal(out.fields.scale.value, '0.0010000000000000002');
    assert.equal(Number(out.fields.scale.value), 1.0000000000000002e-3);
    assert.deepEqual([out.fields.radius.lower, out.fields.radius.upper, out.fields.radius.fit], ['10', '90', true]);
    assert.deepEqual({ ...out.fields.sld }, { ...base.fields.sld });
    assert.deepEqual({ ...out.pds.radius, width: '0' }, { ...base.pds.radius });
    assert.equal(run(base, { type: 'applyValues', values: {} }).fields.radius.value, '50');
    assert.throws(() => run(base, { type: 'applyValues', values: { nope: 1 } }), /nope/);
    assert.throws(() => run(base, { type: 'applyValues', values: { sld_pd: 1 } }), /sld_pd/);
    assert.throws(() => run(base, { type: 'applyValues', values: { radius: NaN } }), /radius/);
    assert.throws(() => run(base, { type: 'applyValues', values: { radius: '5' } }), /radius/);
    assert.throws(() => run(base, { type: 'applyValues' }), /values/);
});

test('field actions: strings are kept as typed; unknown names and bad payloads throw', () => {
    const form = run(F.create('sphere'), { type: 'setValue', name: 'radius', value: ' 5e1 ' },
        { type: 'setLower', name: 'radius', value: '1' }, { type: 'setUpper', name: 'radius', value: '' },
        { type: 'setFit', name: 'radius', fit: true }, { type: 'setValue', name: 'sld', value: 9.42 });
    assert.deepEqual({ ...form.fields.radius }, { value: ' 5e1 ', lower: '1', upper: '', fit: true });
    assert.equal(form.fields.sld.value, '9.42');
    assert.equal(F.validate(form).valid, true);
    const sphere = F.create('sphere');
    assert.throws(() => run(sphere, { type: 'setValue', name: 'theta', value: '1' }), /theta/);
    assert.throws(() => run(sphere, { type: 'setValue', name: 'radius', value: null }), /string/);
    assert.throws(() => run(sphere, { type: 'setFit', name: 'radius', fit: 1 }), /boolean/);
    assert.throws(() => run(sphere, { type: 'setPdFit', name: 'sld', fit: true }), /polydispers/);
    assert.throws(() => run(sphere, { type: 'nope' }), /Unknown action/);
    assert.throws(() => run(sphere, null), /action/);
    assert.throws(() => F.reduce(null, { type: 'setLowQ', on: true }), /form/);
});

test('immutability: every action returns a new deep-frozen form and leaves its input unchanged', () => {
    const start = withS('sphere', 'hardsphere');
    const actions = [
        { type: 'setModel', model: 'core_shell_sphere' }, { type: 'setStructure', structure: 'hayter_msa' },
        { type: 'setStructureMode', mode: 1 }, { type: 'setRadiusMode', mode: 0 }, { type: 'setLowQ', on: true },
        { type: 'setValue', name: 'radius', value: '61' }, { type: 'setLower', name: 'radius', value: '5' },
        { type: 'setUpper', name: 'radius', value: '500' }, { type: 'setFit', name: 'radius', fit: true },
        { type: 'togglePd', name: 'radius' }, { type: 'setPdField', name: 'radius', field: 'type', value: 'schulz' },
        { type: 'setPdFit', name: 'radius', fit: true }, { type: 'applyValues', values: { radius: 62.5, radius_pd: 0.11 } },
    ];
    const types = new Set(actions.map((a) => a.type));
    assert.equal(types.size, 13);
    let form = start;
    actions.forEach((action) => {
        const before = JSON.stringify(form);
        const next = F.reduce(form, Object.freeze(action));
        assert.notEqual(next, form, action.type);
        assert.ok(isDeepFrozen(next), action.type);
        assert.equal(JSON.stringify(form), before, action.type + ' changed its input');
        form = next;
    });
    assert.equal(form.fields.radius.value, '62.5');
    assert.equal(form.pds.radius.width, '0.11');
    assert.deepEqual([form.pds.radius.type, form.pds.radius.npts, form.pds.radius.nsigmas], ['schulz', '80', '3']);
    assert.equal(F.validate(form).valid, true);
});

// ---------------------------------------------------------------- cross-check with the Worker

/** Drive one fit message through SasFitWorkerCore far enough to see whether its names are accepted. */
async function fitErrorCode(spec, fitFlags, bounds, params) {
    const out = [];
    const core = Core.create({
        loadWasm: () => Promise.reject(new Error('the cross-check must stop before any wasm is loaded')),
        post: (message) => out.push(message),
        yieldTask: () => Promise.resolve(),
    });
    // one data point: a job whose names and bounds pass ends as TOO_FEW_POINTS, before any kernel is needed
    await core.handle({
        type: 'fit', jobId: 1, modelSpec: spec, params, fitFlags, bounds,
        data: { q: Float64Array.of(0.01), I: Float64Array.of(1), sigma: Float64Array.of(1) },
        range: { qMin: 0, qMax: 1 }, weighting: 'sigma',
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].type, 'error');
    return out[0].code;
}

/** Every name the Worker accepts in fitFlags for a spec, found by probing one name at a time. */
async function workerFittable(spec) {
    const metas = [spec.model, spec.structure].filter((n) => n !== null).map((n) => M.models[n]);
    const candidates = new Set(['scale', 'background', 'lowq_scale', 'lowq_power', 'structure_factor_mode',
        'radius_effective_mode', 'no_such_parameter']);
    metas.forEach((meta) => meta.params.forEach((p) => {
        [p.name, p.name + '_pd', p.name + '_pd_n', p.name + '_pd_nsigma'].forEach((n) => candidates.add(n));
    }));
    const accepted = [];
    for (const name of candidates) {
        const code = await fitErrorCode(spec, { [name]: true }, {}, { [name]: 1 });
        assert.ok(code === 'TOO_FEW_POINTS' || code === 'BAD_FIT_FLAGS', name + ': ' + code);
        if (code === 'TOO_FEW_POINTS') accepted.push(name);
    }
    return accepted;
}

/** What the page deliberately does not offer although the Worker would take it (spec 4.1, plan decisions). */
function notOffered(form) {
    const out = [];
    M.models[form.model].params.filter((p) => p.type === 'orientation')
        .forEach((p) => out.push(p.name, p.name + '_pd'));
    if (form.structure === 'hayter_msa') out.push('radius_effective_pd');
    if (form.structure !== null && form.radiusMode >= 1) out.push('radius_effective');
    return out;
}

function everyCombination() {
    const forms = [];
    M.order.filter((n) => !M.models[n].isStructureFactor).forEach((model) => {
        const bases = [F.create(model)];
        if (F.canTakeStructure(model)) {
            STRUCTURES.forEach((s) => {
                bases.push(withS(model, s), run(withS(model, s), { type: 'setRadiusMode', mode: 0 }));
            });
        }
        bases.forEach((form) => forms.push(form, run(form, { type: 'setLowQ', on: true })));
    });
    return forms;
}

test('fittable names offered by the form = what SasFitWorkerCore accepts, minus the documented exclusions', async () => {
    const forms = everyCombination();
    assert.equal(forms.length, (13 + 6 * 2 * 2) * 2);
    const seen = new Set();
    for (const form of forms) {
        const spec = { model: form.model, structure: form.structure, lowQPowerLaw: form.lowQ };
        const tag = JSON.stringify(spec) + ' radiusMode ' + form.radiusMode;
        seen.add(JSON.stringify(spec));
        const offered = F.fittableNames(form);
        assert.equal(new Set(offered).size, offered.length, tag);
        const accepted = await workerFittable(spec);
        const excluded = notOffered(form);
        excluded.forEach((name) => assert.ok(accepted.includes(name), tag + ': exclusion ' + name + ' is not a Worker name'));
        assert.deepEqual([...offered].sort(), accepted.filter((n) => !excluded.includes(n)).sort(), tag);
        // the whole offered set at once, with the bounds the form shows, passes BAD_FIT_FLAGS and BAD_BOUNDS
        const rows = F.rows(run(form, ...F.rows(form).filter((r) => r.pd !== null).map((r) => ({ type: 'togglePd', name: r.name }))));
        const bound = (text, fallback) => (text === '' ? fallback : Number(text));
        const bounds = {};
        rows.filter((r) => r.fittable).forEach((r) => { bounds[r.name] = [bound(r.lower, -Infinity), bound(r.upper, Infinity)]; });
        rows.filter((r) => r.pd !== null).forEach((r) => { bounds[r.name + '_pd'] = [Number(r.pd.lower), Number(r.pd.upper)]; });
        assert.deepEqual(Object.keys(bounds).sort(), [...offered].sort(), tag + ': rows and fittableNames disagree');
        const flags = Object.fromEntries(offered.map((n) => [n, true]));
        const params = Object.fromEntries(offered.map((n) => [n, 1]));
        assert.equal(await fitErrorCode(spec, flags, bounds, params), 'TOO_FEW_POINTS', tag);
    }
    assert.equal(seen.size, (13 + 6 * 2) * 2);                      // 50 distinct model / S(Q) / low-Q specs
});
