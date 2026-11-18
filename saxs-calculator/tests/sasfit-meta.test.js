'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SasFitMeta } = require('./load.js');

const ORDER = [
    'sphere', 'core_shell_sphere', 'vesicle', 'ellipsoid', 'cylinder',
    'core_shell_cylinder', 'flexible_cylinder', 'lamellar', 'guinier',
    'guinier_porod', 'power_law', 'mono_gauss_coil', 'gaussian_peak',
    'hardsphere', 'hayter_msa',
];

const PD = {
    sphere: ['radius'],
    core_shell_sphere: ['radius', 'thickness'],
    vesicle: ['radius', 'thickness'],
    ellipsoid: ['radius_polar', 'radius_equatorial'],
    cylinder: ['radius', 'length'],
    core_shell_cylinder: ['radius', 'thickness', 'length'],
    flexible_cylinder: ['length', 'kuhn_length', 'radius'],
    lamellar: ['thickness'],
    guinier: [],
    guinier_porod: [],
    power_law: [],
    mono_gauss_coil: ['rg'],
    gaussian_peak: [],
    hardsphere: [],
    hayter_msa: ['radius_effective'],
};

const HAVE_FQ = ['sphere', 'core_shell_sphere', 'vesicle', 'ellipsoid', 'cylinder', 'core_shell_cylinder'];

const pdNames = (m) => m.params.filter((p) => p.pd).map((p) => p.name).sort();

test('[sasfit-meta] version and model order', () => {
    assert.equal(SasFitMeta.sasmodelsVersion, '1.0.12');
    assert.deepEqual([...SasFitMeta.order], ORDER);
    assert.deepEqual(Object.keys(SasFitMeta.models), ORDER);
});

test('[sasfit-meta] kind, haveFq, isStructureFactor', () => {
    for (const name of ORDER) {
        const m = SasFitMeta.models[name];
        assert.equal(m.name, name);
        assert.equal(m.kind, name === 'guinier_porod' || name === 'power_law' ? 'js' : 'c', name);
        assert.equal(m.haveFq, HAVE_FQ.includes(name), `${name} haveFq`);
        assert.equal(m.isStructureFactor, name === 'hardsphere' || name === 'hayter_msa', name);
        assert.equal(typeof m.title, 'string');
        assert.ok(m.category.length > 0);
    }
});

test('[sasfit-meta] polydisperse parameter sets follow pd_1d', () => {
    for (const name of ORDER) {
        assert.deepEqual(pdNames(SasFitMeta.models[name]), [...PD[name]].sort(), name);
    }
});

test('[sasfit-meta] reffModes present for the six S(Q)-capable shapes', () => {
    for (const name of HAVE_FQ) {
        assert.ok(SasFitMeta.models[name].reffModes.length > 0, name);
    }
    assert.equal(SasFitMeta.models.lamellar.reffModes.length, 0);
    assert.deepEqual([...SasFitMeta.models.sphere.reffModes], ['radius']);
});

test('[sasfit-meta] layout constants', () => {
    const L = (n) => SasFitMeta.models[n].layout;
    assert.equal(L('sphere').maxPd, 1);
    assert.equal(L('sphere').nvalues, 15);
    assert.equal(L('cylinder').maxPd, 4);
    assert.equal(L('cylinder').nvalues, 18);
    assert.equal(L('core_shell_cylinder').maxPd, 5);
    assert.equal(L('core_shell_cylinder').nvalues, 23);
    assert.equal(L('guinier').maxPd, 0);
    assert.equal(L('guinier').nvalues, 3);
    assert.equal(L('sphere').thetaOffset, -1);
    assert.ok(L('cylinder').thetaOffset >= 0);
    assert.equal(L('sphere').npars, SasFitMeta.models.sphere.params.length);
});

test('[sasfit-meta] common scale/background', () => {
    for (const name of ORDER) {
        const c = SasFitMeta.models[name].common;
        assert.equal(c.scale.def, 1, name);
        const bg = name === 'hardsphere' || name === 'hayter_msa' ? 0 : 0.001;
        assert.equal(c.background.def, bg, name);
        assert.equal(c.background.min, -Infinity);
        assert.equal(c.background.max, Infinity);
    }
});

test('[sasfit-meta] spot-check defaults and units', () => {
    const sphere = SasFitMeta.models.sphere.params.find((p) => p.name === 'radius');
    assert.equal(sphere.def, 50);
    assert.equal(sphere.units, 'Ang');
    const cyl = SasFitMeta.models.cylinder.params.find((p) => p.name === 'length');
    assert.equal(cyl.def, 400);
});

test('[sasfit-meta] deep frozen and within line limit', () => {
    const frozen = (o) => {
        if (o === null || typeof o !== 'object') return true;
        return Object.isFrozen(o) && Object.values(o).every(frozen);
    };
    assert.ok(frozen(SasFitMeta));
    const file = path.join(__dirname, '..', 'js', 'sasfit-meta.js');
    assert.ok(fs.readFileSync(file, 'utf8').split('\n').length <= 800);
});
