/**
 * sasfit-format.js -- the ONE place where the SAS fitting page turns a fitted
 * number and its error into text (design spec 5.4 "number format"; fix pass A
 * after the M3 reviews). Original code. Used by the result tiles and the error
 * column (SasFitHtml), the hints (SasFitHints) and the write-back of fitted
 * values into the parameter table (SasFitJobs).
 *
 *   number(value, digits)   one number with `digits` significant figures, ASCII
 *                           minus, plain from 1e-3 to below 1e6, else 1.23e-7
 *   display(text)           the same text for the screen: U+2212 as minus sign.
 *                           Never use it for text that is parsed back.
 *   valueError(value, error, { illConditioned }?) -> { value, error, kind }
 *       display text (U+2212). kind:
 *       'normal'         0 < error < |value|. The error has 2 significant
 *                        figures and the value ends at the same decimal place,
 *                        but never has fewer than 3 significant figures (then
 *                        both get more decimals: 2.50 +- 1.00). Plain while the
 *                        larger of the two is in [1e-3, 1e6); otherwise the
 *                        value is m.mmme-N and the error shares that exponent
 *                        while its mantissa is >= 0.1 (2.25e-4 +- 0.77e-4),
 *                        else it stands in its own notation (1.000e9 +- 1.0e7).
 *                        A value that would need more than 10 significant
 *                        figures to reach the error's place shows 10, and the
 *                        error stands alone (49.94000000 +- 1.0e-9).
 *       'undetermined'   error >= |value|: the value with 3 significant figures
 *                        and the error with 2, each in its own notation
 *                        (72.7 +- 5700). The data do not determine the parameter.
 *       'undeterminable' as before, and illConditioned with error > 1000 |value|:
 *                        the error text is UNDETERMINABLE, not a number.
 *       'no-error'       the error is not a positive finite number: value with
 *                        5 significant figures, error MISSING.
 *       'no-value'       the value is not finite: MISSING and the error.
 *   isUndetermined(value, error)   error >= |value| for a usable pair
 *   inputValue(value, error, bounds?) -> number   what is written into an input
 *       after a fit: the value rounded at the place two digits beyond the
 *       error's second significant figure (so it moves by < 0.001 sigma), with
 *       at least 6 and at most 15 significant figures; 8 significant figures
 *       when the error is unusable. bounds [lower, upper]: a value that was
 *       inside stays inside. Idempotent: inputValue(inputValue(v, e), e) is
 *       the same number, which is what lets a result match its own form.
 *   inputText(value, error, bounds?)   String(inputValue(...)): ASCII, parses
 *       back to exactly that number.
 *
 * Pure: no DOM, no other globals; nothing given is modified.
 */

(function () {
    'use strict';

    const MISSING = '—';
    const MINUS = '−';
    const UNDETERMINABLE = '無法決定';
    const ERROR_DIGITS = 2;
    const MIN_VALUE_DIGITS = 3;
    const LONE_VALUE_DIGITS = 5;
    const MAX_VALUE_DIGITS = 10;
    const PLAIN_FROM = 1e-3;
    const PLAIN_BELOW = 1e6;
    const UNDETERMINABLE_RATIO = 1e3;
    const INPUT_GUARD_DIGITS = 2;
    const INPUT_MIN_DIGITS = 6;
    const INPUT_LONE_DIGITS = 8;
    const INPUT_MAX_DIGITS = 15;

    const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
    const usableError = (e) => isNumber(e) && e > 0;
    /** The decimal exponent of a non-zero finite number, read from its own decimal form (no log10 rounding). */
    const exponentOf = (x) => Number(Math.abs(x).toExponential().split('e')[1]);
    const roundSig = (x, digits) => Number(x.toPrecision(digits));
    const isPlain = (size) => size >= PLAIN_FROM && size < PLAIN_BELOW;
    const result = (value, error, kind) => Object.freeze({ value: display(value), error: display(error), kind });

    /** x rounded at the place 10^p (p < 0: decimals; p > 0: tens, hundreds, ...). */
    function roundAt(x, p) {
        if (p < 0) return Number(x.toFixed(Math.min(-p, 100)));
        const unit = Math.pow(10, p);
        return Math.round(x / unit) * unit;
    }

    /** x as plain text ending at the place 10^p. */
    const plainAt = (x, p) => (p < 0 ? x.toFixed(-p) : String(roundAt(x, p)));

    function display(text) {
        return String(text).replace(/-/g, MINUS);
    }

    function number(value, digits) {
        if (!isNumber(value)) return MISSING;
        if (value === 0) return '0';
        const rounded = roundSig(value, digits);
        if (!isPlain(Math.abs(rounded))) return value.toExponential(digits - 1).replace('e+', 'e');
        const text = value.toPrecision(digits);
        return text.indexOf('e') >= 0 ? String(rounded) : text;
    }

    /** value m.mmme-N at the place 10^p; the error with the same exponent while its mantissa is >= 0.1. */
    function exponentPair(value, error, p) {
        const valueAt = roundAt(value, p);
        const errorAt = roundAt(error, p);
        const exponent = exponentOf(valueAt);
        const decimals = exponent - p;
        const tail = 'e' + exponent;
        const valueText = valueAt.toExponential(decimals).replace(/e.*$/, tail);
        const shared = errorAt > 0 && exponentOf(errorAt) >= exponent - 1;
        return result(valueText, shared ? (errorAt / Math.pow(10, exponent)).toFixed(decimals) + tail : number(error, ERROR_DIGITS), 'normal');
    }

    /** 0 < error < |value|. */
    function normalPair(value, error) {
        let p = exponentOf(roundSig(error, ERROR_DIGITS)) - (ERROR_DIGITS - 1);
        let digits = exponentOf(roundAt(value, p)) - p + 1;
        if (digits < MIN_VALUE_DIGITS) {
            p -= MIN_VALUE_DIGITS - digits;
            digits = exponentOf(roundAt(value, p)) - p + 1;
        }
        if (digits > MAX_VALUE_DIGITS) return result(number(value, MAX_VALUE_DIGITS), number(error, ERROR_DIGITS), 'normal');
        const top = Math.max(Math.abs(roundAt(value, p)), roundAt(error, p));
        return isPlain(top) ? result(plainAt(value, p), plainAt(error, p), 'normal') : exponentPair(value, error, p);
    }

    const isUndetermined = (value, error) => usableError(error) && isNumber(value) && error >= Math.abs(value);

    function valueError(value, error, options) {
        if (!usableError(error)) return result(number(value, LONE_VALUE_DIGITS), MISSING, 'no-error');
        if (!isNumber(value)) return result(MISSING, number(error, ERROR_DIGITS), 'no-value');
        if (!isUndetermined(value, error)) return normalPair(value, error);
        const lost = options !== null && typeof options === 'object' && options.illConditioned === true
            && error > UNDETERMINABLE_RATIO * Math.abs(value);
        return lost ? result(number(value, MIN_VALUE_DIGITS), UNDETERMINABLE, 'undeterminable')
            : result(number(value, MIN_VALUE_DIGITS), number(error, ERROR_DIGITS), 'undetermined');
    }

    function clamp(rounded, value, bounds) {
        if (!Array.isArray(bounds)) return rounded;
        const [lower, upper] = bounds;
        if (isNumber(lower) && value >= lower && rounded < lower) return lower;
        if (isNumber(upper) && value <= upper && rounded > upper) return upper;
        return rounded;
    }

    function inputValue(value, error, bounds) {
        if (!isNumber(value) || value === 0) return value;
        const top = exponentOf(value);
        const byError = usableError(error)
            ? Math.min(exponentOf(roundSig(error, ERROR_DIGITS)) - (ERROR_DIGITS - 1) - INPUT_GUARD_DIGITS, top - (INPUT_MIN_DIGITS - 1))
            : top - (INPUT_LONE_DIGITS - 1);
        return clamp(roundAt(value, Math.max(byError, top - (INPUT_MAX_DIGITS - 1))), value, bounds);
    }

    const inputText = (value, error, bounds) => String(inputValue(value, error, bounds));

    globalThis.SasFitFormat = Object.freeze({
        MISSING, MINUS, UNDETERMINABLE, number, display, valueError, isUndetermined, inputValue, inputText,
    });
})();
