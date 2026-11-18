'use strict';
/**
 * Real official .dat files, only if the user put some in tests/fixtures-local/sasfit/
 * (git-ignored; real data never enters the public repo). Skips when the folder is
 * missing or empty. Invariants only: no number of a real file is written in a test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SasFitDataIo, SasFitWeighting } = require('./load.js');

const DIR = path.join(__dirname, 'fixtures-local', 'sasfit');
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /\.dat$/i.test(f)) : [];

test('[sasfit-local] real official files parse with the invariants of the format', { skip: files.length === 0 && '本地 fixture 不存在' }, () => {
    for (const name of files) {
        const r = SasFitDataIo.parse(fs.readFileSync(path.join(DIR, name), 'utf8'), { fileName: name });
        const ds = r.dataset;
        assert.ok(ds, name + ' did not parse');
        assert.equal(ds.kind, 'official', name);
        for (const key of ['totalFrames', 'energyKeV', 'scalingFactor', 'sampleTransmission', 'cellTransmission',
            'thicknessMm', 'sddMm', 'qStart', 'frameTimeS']) {
            assert.ok(Number.isFinite(ds.header[key]), name + ' header.' + key);
        }
        assert.equal(typeof ds.header.outputName, 'string', name);
        assert.ok(ds.header.qStart > 0, name);
        assert.ok(ds.q.length > 100, name);
        assert.ok(SasFitWeighting.defaultRange(ds, 'sigma').qMin >= ds.header.qStart, name);
        assert.equal(r.issues.length, 0, name);
    }
});
