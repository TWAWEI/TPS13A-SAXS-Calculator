'use strict';
/**
 * Load the browser-global calculation modules into Node for testing.
 * The modules attach themselves to `window.*` and have no DOM dependency.
 *
 * Usage: node --test saxs-calculator/tests/
 */
const path = require('path');

global.window = global.window || {};

const JS = path.join(__dirname, '..', 'js');
require(path.join(JS, 'form-utils.js'));
require(path.join(JS, 'calculations.js'));
require(path.join(JS, 'detector-limits-ui.js'));
require(path.join(JS, 'protein.js'));
require(path.join(JS, 'dndc-calculations.js'));
require(path.join(JS, 'dndc-file-parser.js'));
require(path.join(JS, 'dndc-astra-parser.js'));

module.exports = {
    SAXS: window.SAXSCalculations,
    DetectorLimits: window.DetectorLimits,
    Protein: window.ProteinAnalysis,
    Dndc: window.DndcCalculations,
    FileParser: window.DndcFileParser,
    AstraParser: window.DndcAstraParser,
    FormUtils: window.FormUtils,
};
