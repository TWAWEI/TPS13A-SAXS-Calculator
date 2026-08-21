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
require(path.join(JS, 'calculations.js'));
require(path.join(JS, 'protein.js'));
require(path.join(JS, 'dndc-calculations.js'));

module.exports = {
    SAXS: window.SAXSCalculations,
    Protein: window.ProteinAnalysis,
    Dndc: window.DndcCalculations,
};
