/**
 * sasfit-form.js -- the model form of the SAS fitting page as plain data
 * (design spec 4.1, 4.3-4.5, 5.3, 5.7 items 10 and 12). Original code.
 *
 * A form is a frozen object; every field holds the STRING the user typed and
 * is turned into a number only by validate():
 *   { model, structure: null | 'hardsphere' | 'hayter_msa', structureMode: 0 | 1,
 *     radiusMode: 0..n, lowQ: boolean,
 *     fields: { name: { value, lower, upper, fit } },
 *     pds:    { name: { open, fit, width, lower, upper, type, npts, nsigmas } } }
 * fields has one entry per row of the parameter table: scale, background, the
 * parameters of P (orientation parameters are 2-D only and never appear), the
 * parameters of S when a structure factor is chosen (without S's volfraction
 * when P has its own, as in SasFitProduct), lowq_scale / lowq_power with the
 * low-Q power law. pds has one entry per polydisperse SIZE parameter of P; a
 * dispersity takes part only while its row is open. An empty lower / upper
 * bound means "unbounded".
 *
 * UI defaults (plan M3, review record): bounds are the hard limits of the meta
 * except charge (lower 0.5: hayter_msa returns NaN at charge 0), lowq_scale
 * (lower 0) and lowq_power (0-6); scale and background are ticked for fitting;
 * a dispersity opens as gaussian, 35 points, 3 sigmas, width 0, bounds 0-0.4.
 * The Worker (SasFitWorkerCore) would also accept the orientation parameters,
 * radius_effective_pd of hayter_msa and a radius_effective that the model
 * defines; the page offers none of them (fittableNames).
 *
 * reduce() never modifies the form it is given. Programming errors (unknown
 * action, unknown name, wrong payload type) throw an Error in English; what
 * the user can get wrong is reported by validate() in Traditional Chinese.
 * The messages contain only parameter names and numbers formatted here.
 *
 * Pure logic: no DOM, no HTML, no other globals than SasFitMeta and
 * SasFitValidate (read at call time).
 */

(function () {
    'use strict';

    // design spec 4.3 (decision 14: schulz and lognormal take 3 sigmas, sasmodels has 8)
    const PD_UI_DEFAULTS = Object.freeze({
        gaussian: Object.freeze({ npts: 35, nsigmas: 3 }),
        rectangle: Object.freeze({ npts: 35, nsigmas: 1.73205 }),
        uniform: Object.freeze({ npts: 35, nsigmas: null }),
        lognormal: Object.freeze({ npts: 80, nsigmas: 3 }),
        schulz: Object.freeze({ npts: 80, nsigmas: 3 }),
        boltzmann: Object.freeze({ npts: 35, nsigmas: 3 }),
    });
    const PD_TYPES = Object.freeze(Object.keys(PD_UI_DEFAULTS));
    const PD_DEFAULT_TYPE = 'gaussian';
    const PD_NSIGMAS_UNUSED = 3;            // field value of a distribution without nsigmas (the kernel wants a finite number)
    const PD_WIDTH_BOUNDS = Object.freeze([0, 0.4]);
    const PD_FIT_START = 0.05;              // design spec 5.7 item 12
    const CHARGE_LOWER = 0.5;               // design spec 5.7 item 10
    const LOWQ_POWER_BOUNDS = Object.freeze([0, 6]);
    const LOWQ_DEFAULTS = Object.freeze({ lowq_scale: 0, lowq_power: 4 });      // design spec 4.5
    const STRUCTURES = Object.freeze(['hardsphere', 'hayter_msa']);
    const STRUCTURE_MODES = Object.freeze([0, 1]);
    const DEFAULT_STRUCTURE_MODE = 0;       // P*S (product.py)
    const DEFAULT_RADIUS_MODE = 1;          // the model's first definition
    const DEFAULT_FIT = Object.freeze(['scale', 'background']);
    const GROUPS = Object.freeze([
        Object.freeze({ group: '形狀', test: (meta) => meta.category.indexOf('shape:') === 0 }),
        Object.freeze({ group: '與形狀無關', test: (meta) => meta.category.indexOf('shape:') !== 0 }),
    ]);
    // UI bounds that differ from the hard limits of the model
    const UI_BOUNDS = Object.freeze({
        charge: Object.freeze({ lower: CHARGE_LOWER }),
        lowq_scale: Object.freeze({ lower: 0 }),
        lowq_power: Object.freeze({ lower: LOWQ_POWER_BOUNDS[0], upper: LOWQ_POWER_BOUNDS[1] }),
    });
    const RADIUS_ID = 'radius_effective';
    const VOLFRAC_ID = 'volfraction';
    const PD_SUFFIX = '_pd';
    const DERIVED_NOTE = '由模型決定';
    const PD_FIELD_KEYS = Object.freeze(['width', 'lower', 'upper', 'type', 'npts', 'nsigmas']);
    const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const freezeMap = (obj) => Object.freeze(Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [key, Object.freeze({ ...value })])));
    const boundText = (v) => (Number.isFinite(v) ? String(v) : '');

    function metaOf(name) {
        const models = globalThis.SasFitMeta.models;
        if (typeof name !== 'string' || !has(models, name)) throw new Error('Unknown model: ' + String(name));
        return models[name];
    }

    /** The rule of design spec 4.1: P needs F(q) and effective radius modes. */
    function canTakeStructure(model) {
        const meta = metaOf(model);
        return !meta.isStructureFactor && meta.haveFq && meta.reffModes.length > 0;
    }

    /** models(query, keep?) -> [{ group, items: [{ name, title }] }]; empty groups are left out. */
    function models(query, keep) {
        const meta = globalThis.SasFitMeta;
        const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
        const matches = (m) => m.name === keep || m.name.toLowerCase().indexOf(needle) >= 0
            || m.title.toLowerCase().indexOf(needle) >= 0;
        const list = meta.order.map((name) => meta.models[name]).filter((m) => !m.isStructureFactor && matches(m));
        return Object.freeze(GROUPS.map(({ group, test }) => Object.freeze({
            group,
            items: Object.freeze(list.filter(test).map((m) => Object.freeze({ name: m.name, title: m.title }))),
        })).filter((g) => g.items.length > 0));
    }

    // ------------------------------------------------------------- parameter definitions

    const defOf = (group, p, extra) => Object.freeze({
        name: p.name, group, unit: p.units === undefined ? '' : p.units, def: p.def, hardMin: p.min, hardMax: p.max,
        isSld: p.type === 'sld', pdCapable: false, derived: false, ...extra,
    });

    /** One definition per row of the parameter table, in table order. */
    function defsOf(shape) {
        const pMeta = metaOf(shape.model);
        const defs = Object.keys(pMeta.common).map((name) => defOf('common', { name, ...pMeta.common[name] }));
        pMeta.params.filter((p) => p.type !== 'orientation')
            .forEach((p) => defs.push(defOf('P', p, { pdCapable: p.pd === true })));
        if (shape.structure !== null) {
            const pHasVolfrac = pMeta.params.some((p) => p.name === VOLFRAC_ID);
            metaOf(shape.structure).params.filter((p) => p.name !== VOLFRAC_ID || !pHasVolfrac)
                .forEach((p) => defs.push(defOf('S', p, { derived: p.name === RADIUS_ID && shape.radiusMode >= 1 })));
        }
        if (shape.lowQ) {
            Object.keys(LOWQ_DEFAULTS).forEach((name) => defs.push(
                defOf('lowq', { name, def: LOWQ_DEFAULTS[name], min: -Infinity, max: Infinity })));
        }
        return defs;
    }

    function defaultField(def) {
        const ui = has(UI_BOUNDS, def.name) ? UI_BOUNDS[def.name] : {};
        return {
            value: String(def.def),
            lower: boundText(has(ui, 'lower') ? ui.lower : def.hardMin),
            upper: boundText(has(ui, 'upper') ? ui.upper : def.hardMax),
            fit: DEFAULT_FIT.indexOf(def.name) >= 0,
        };
    }

    function defaultPd() {
        const d = PD_UI_DEFAULTS[PD_DEFAULT_TYPE];
        return {
            open: false, fit: false, width: '0', lower: String(PD_WIDTH_BOUNDS[0]), upper: String(PD_WIDTH_BOUNDS[1]),
            type: PD_DEFAULT_TYPE, npts: String(d.npts), nsigmas: String(d.nsigmas),
        };
    }

    /**
     * A frozen form of the given shape. A row keeps its entry of `previous`
     * (a form or null) when keep(def) says so, else it starts from the defaults;
     * a radius_effective that the model defines is never fitted.
     */
    function build(shape, previous, keep) {
        const fields = {};
        const pds = {};
        // a name can change its owner (volfraction belongs to vesicle, else to S): such a row starts afresh
        const before = new Map(previous === null ? [] : defsOf(previous).map((def) => [def.name, def.group]));
        defsOf(shape).forEach((def) => {
            const kept = keep(def) && before.get(def.name) === def.group;
            const field = kept ? previous.fields[def.name] : defaultField(def);
            fields[def.name] = def.derived ? { ...field, fit: false } : field;
            if (def.pdCapable) pds[def.name] = kept && has(previous.pds, def.name) ? previous.pds[def.name] : defaultPd();
        });
        return Object.freeze({ ...shape, fields: freezeMap(fields), pds: freezeMap(pds) });
    }

    const shapeOf = (form) => ({
        model: form.model, structure: form.structure, structureMode: form.structureMode,
        radiusMode: form.radiusMode, lowQ: form.lowQ,
    });
    const keepAll = () => true;
    const rebuild = (form, changes) => build({ ...shapeOf(form), ...changes }, form, keepAll);

    function assertFormModel(model) {
        if (metaOf(model).isStructureFactor) throw new Error(model + ' is a structure factor, not a model of its own');
    }

    function create(model) {
        assertFormModel(model);
        return build({
            model, structure: null, structureMode: DEFAULT_STRUCTURE_MODE, radiusMode: DEFAULT_RADIUS_MODE, lowQ: false,
        }, null, keepAll);
    }

    // ------------------------------------------------------------- actions

    /** New P: its rows start from the defaults; S(Q) (when it still applies) and the low-Q rows are kept. */
    function setModel(form, { model }) {
        assertFormModel(model);
        const keepS = form.structure !== null && canTakeStructure(model);
        const radiusMode = keepS && form.radiusMode <= metaOf(model).reffModes.length ? form.radiusMode : DEFAULT_RADIUS_MODE;
        const shape = {
            model, structure: keepS ? form.structure : null,
            structureMode: keepS ? form.structureMode : DEFAULT_STRUCTURE_MODE, radiusMode, lowQ: form.lowQ,
        };
        return build(shape, form, (def) => def.group === 'S' || def.group === 'lowq');
    }

    function setStructure(form, { structure }) {
        if (structure === null) {
            return rebuild(form, { structure: null, structureMode: DEFAULT_STRUCTURE_MODE, radiusMode: DEFAULT_RADIUS_MODE });
        }
        if (!metaOf(structure).isStructureFactor) throw new Error(structure + ' is not a structure factor');
        if (!canTakeStructure(form.model)) throw new Error(form.model + ' cannot take a structure factor');
        // the rows of another S are dropped: same names (radius_effective, volfraction), different defaults
        const keep = (def) => def.group !== 'S' || form.structure === structure;
        return build({ ...shapeOf(form), structure }, form, keep);
    }

    function assertStructure(form, what) {
        if (form.structure === null) throw new Error(what + ' needs a structure factor');
    }

    function setStructureMode(form, { mode }) {
        assertStructure(form, 'structure_factor_mode');
        if (STRUCTURE_MODES.indexOf(mode) < 0) throw new Error('structure_factor_mode must be 0 or 1, got ' + String(mode));
        return rebuild(form, { structureMode: mode });
    }

    function setRadiusMode(form, { mode }) {
        assertStructure(form, 'radius_effective_mode');
        const count = metaOf(form.model).reffModes.length;
        if (!Number.isInteger(mode) || mode < 0 || mode > count) {
            throw new Error('radius_effective_mode of ' + form.model + ' must be 0..' + count + ', got ' + String(mode));
        }
        return rebuild(form, { radiusMode: mode });
    }

    function setLowQ(form, { on }) {
        if (typeof on !== 'boolean') throw new Error('setLowQ needs on: boolean');
        return rebuild(form, { lowQ: on });
    }

    function textOf(value, what) {
        if (typeof value === 'string') return value;
        if (typeof value === 'number') return String(value);
        throw new Error(what + ' must be a string (or a number), got ' + typeof value);
    }

    function flagOf(value, what) {
        if (typeof value !== 'boolean') throw new Error(what + ' must be a boolean');
        return value;
    }

    function patchField(form, name, patch) {
        if (!has(form.fields, name)) throw new Error('Not a parameter of this form: ' + String(name));
        return Object.freeze({ ...form, fields: freezeMap({ ...form.fields, [name]: { ...form.fields[name], ...patch } }) });
    }

    function patchPd(form, name, patch) {
        if (!has(form.fields, name) && !has(form.pds, name)) throw new Error('Not a parameter of this form: ' + String(name));
        if (!has(form.pds, name)) throw new Error(name + ' is not a polydisperse parameter of this form');
        return Object.freeze({ ...form, pds: freezeMap({ ...form.pds, [name]: { ...form.pds[name], ...patch } }) });
    }

    const setText = (key) => (form, { name, value }) => patchField(form, name, { [key]: textOf(value, key) });

    function setFit(form, { name, fit }) {
        const def = defsOf(form).find((d) => d.name === name);
        if (def !== undefined && def.derived && fit === true) {
            throw new Error(name + ' is defined by the model (radius_effective_mode ' + form.radiusMode + ') and cannot be fitted');
        }
        return patchField(form, name, { fit: flagOf(fit, 'fit') });
    }

    const togglePd = (form, { name }) => patchPd(form, name, { open: !(has(form.pds, name) && form.pds[name].open) });

    function setPdField(form, { name, field, value }) {
        if (PD_FIELD_KEYS.indexOf(field) < 0) throw new Error('Unknown dispersity field: ' + String(field));
        if (field !== 'type') return patchPd(form, name, { [field]: textOf(value, field) });
        if (!has(PD_UI_DEFAULTS, value)) throw new Error('Unknown distribution: ' + String(value));
        const d = PD_UI_DEFAULTS[value];
        const nsigmas = d.nsigmas === null ? PD_NSIGMAS_UNUSED : d.nsigmas;
        return patchPd(form, name, { type: value, npts: String(d.npts), nsigmas: String(nsigmas) });
    }

    /** Design spec 5.7 item 12: a width fitted from exactly 0 may jump to its upper bound. */
    function setPdFit(form, { name, fit }) {
        const next = patchPd(form, name, { fit: flagOf(fit, 'fit') });
        const width = next.pds[name].width.trim();
        const atZero = width === '' || (NUMBER_RE.test(width) && Number(width) === 0);
        return fit && atZero ? patchPd(next, name, { width: String(PD_FIT_START) }) : next;
    }

    /** values: { name: number }; `<name>_pd` is the width of a dispersity. Only the value strings change. */
    function applyValues(form, { values }) {
        if (values === null || typeof values !== 'object') throw new Error('applyValues needs values: { name: number }');
        return Object.keys(values).reduce((next, key) => {
            const v = values[key];
            if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Value of ' + key + ' must be a finite number');
            if (has(next.fields, key)) return patchField(next, key, { value: String(v) });
            const base = key.slice(0, -PD_SUFFIX.length);
            if (key.endsWith(PD_SUFFIX) && has(next.pds, base)) return patchPd(next, base, { width: String(v) });
            throw new Error('Not a value of this form: ' + key);
        }, form);
    }

    const ACTIONS = Object.freeze({
        setModel, setStructure, setStructureMode, setRadiusMode, setLowQ,
        setValue: setText('value'), setLower: setText('lower'), setUpper: setText('upper'), setFit,
        togglePd, setPdField, setPdFit, applyValues,
    });

    function reduce(form, action) {
        if (form === null || typeof form !== 'object' || !has(form, 'fields')) throw new Error('reduce needs a form');
        if (action === null || typeof action !== 'object') throw new Error('reduce needs an action object');
        if (!has(ACTIONS, action.type)) throw new Error('Unknown action type: ' + String(action.type));
        return ACTIONS[action.type](form, action);
    }

    // ------------------------------------------------------------- validation

    /** The number a field holds, or undefined when the text is not a finite number. */
    function numberOf(text) {
        const t = text.trim();
        if (!NUMBER_RE.test(t)) return undefined;
        const v = Number(t);
        return Number.isFinite(v) ? v : undefined;
    }

    /**
     * Checks value / lower / upper of one row against its hard limits and each
     * other; item = { what, bound, key, value, lower, upper, fit, hardMin,
     * hardMax, valueKey }: `what` names the value and `bound` starts the name
     * of its bounds in the messages. Writes into errors[key + '.' + field].
     */
    function checkTriple(item, errors) {
        const { key, hardMin, hardMax } = item;
        const value = numberOf(item.value);
        const lower = item.lower.trim() === '' ? -Infinity : numberOf(item.lower);
        const upper = item.upper.trim() === '' ? Infinity : numberOf(item.upper);
        const put = (field, message) => { if (!has(errors, key + '.' + field)) errors[key + '.' + field] = message; };
        if (value === undefined) put(item.valueKey, item.what + '必須是數字');
        else if (value < hardMin) put(item.valueKey, item.what + '不可小於 ' + hardMin);
        else if (value > hardMax) put(item.valueKey, item.what + '不可大於 ' + hardMax);
        if (lower === undefined) put('lower', item.bound + '下限必須是數字（留空表示不設限）');
        else if (lower < hardMin) put('lower', item.bound + '下限不可小於允許的最小值 ' + hardMin);
        if (upper === undefined) put('upper', item.bound + '上限必須是數字（留空表示不設限）');
        else if (upper > hardMax) put('upper', item.bound + '上限不可大於允許的最大值 ' + hardMax);
        if (lower === undefined || upper === undefined) return;
        if (lower >= upper) put('lower', item.bound + '下限必須小於上限');
        else if (item.fit && value !== undefined && (value < lower || value > upper)) {
            put(item.valueKey, item.what + '必須在下限與上限之間才能擬合');
        }
    }

    function checkPd(name, pd, errors) {
        const key = name + PD_SUFFIX;
        checkTriple({
            what: name + ' 的 PD 寬度', bound: name + ' 的 PD 寬度', key, value: pd.width, lower: pd.lower, upper: pd.upper, fit: pd.fit,
            hardMin: 0, hardMax: Infinity, valueKey: 'width',
        }, errors);
        const max = globalThis.SasFitValidate.MAX_PD_POINTS;
        const npts = numberOf(pd.npts);
        if (npts === undefined || !Number.isInteger(npts) || npts < 1 || npts > max) {
            errors[key + '.npts'] = name + ' 的 PD 點數必須是 1 到 ' + max + ' 的整數';
        }
        const nsigmas = numberOf(pd.nsigmas);
        if (PD_UI_DEFAULTS[pd.type].nsigmas !== null && !(nsigmas > 0)) {
            errors[key + '.nsigmas'] = name + ' 的 PD nsigmas 必須是大於 0 的數字';
        }
    }

    /** [name, npts] of every dispersity that makes the mesh larger: open, with a width > 0 or a fitted width. */
    function meshFactors(form) {
        return Object.keys(form.pds).filter((name) => {
            const pd = form.pds[name];
            return pd.open && (pd.fit || numberOf(pd.width) > 0) && Number.isInteger(numberOf(pd.npts)) && numberOf(pd.npts) >= 1;
        }).map((name) => [name, numberOf(form.pds[name].npts)]);
    }

    /** validate(form) -> { valid, errors: { '<parameter>.<field>': message }, mesh } (frozen). */
    function validate(form) {
        const errors = {};
        defsOf(form).filter((def) => !def.derived).forEach((def) => {
            checkTriple({
                what: def.name + ' 的數值', bound: def.name + ' 的', key: def.name, ...form.fields[def.name],
                hardMin: def.hardMin, hardMax: def.hardMax, valueKey: 'value',
            }, errors);
        });
        Object.keys(form.pds).filter((name) => form.pds[name].open).forEach((name) => checkPd(name, form.pds[name], errors));
        const factors = meshFactors(form);
        const mesh = factors.reduce((product, [, n]) => product * n, 1);
        const limit = globalThis.SasFitValidate.MAX_EVAL_POINTS;
        if (mesh > limit) {
            errors['form.mesh'] = '多分散網格共 ' + mesh + ' 點（' + factors.map(([name, n]) => name + ' ' + n).join(' × ')
                + '），超過上限 ' + limit + ' 點；請減少點數';
        }
        return Object.freeze({ valid: Object.keys(errors).length === 0, errors: Object.freeze(errors), mesh });
    }

    // ------------------------------------------------------------- view-model

    /** The entries of errors whose key starts with prefix, keyed by the rest of the key. */
    function errorsUnder(errors, prefix) {
        return Object.freeze(Object.fromEntries(Object.keys(errors)
            .filter((key) => key.indexOf(prefix) === 0)
            .map((key) => [key.slice(prefix.length), errors[key]])));
    }

    function pdView(name, pd, errors) {
        return Object.freeze({
            ...pd, hasNsigmas: PD_UI_DEFAULTS[pd.type].nsigmas !== null, errors: errorsUnder(errors, name + PD_SUFFIX + '.'),
        });
    }

    /** rows(form) -> the parameter table, one frozen row per parameter (see the plan's interface block). */
    function rows(form) {
        const { errors } = validate(form);
        return Object.freeze(defsOf(form).map((def) => Object.freeze({
            name: def.name, label: def.name, unit: def.unit, group: def.group,
            ...form.fields[def.name],
            hardMin: def.hardMin, hardMax: def.hardMax,
            fittable: !def.derived, derived: def.derived, note: def.derived ? DERIVED_NOTE : '', isSld: def.isSld,
            pd: def.pdCapable ? pdView(def.name, form.pds[def.name], errors) : null,
            errors: errorsUnder(errors, def.name + '.'),
        })));
    }

    /** Every name the page offers for fitting: the fittable rows and the width of every dispersity. */
    function fittableNames(form) {
        const defs = defsOf(form);
        return Object.freeze(defs.filter((d) => !d.derived).map((d) => d.name)
            .concat(defs.filter((d) => d.pdCapable).map((d) => d.name + PD_SUFFIX)));
    }

    globalThis.SasFitForm = Object.freeze({
        PD_UI_DEFAULTS, PD_TYPES, PD_DEFAULT_TYPE, PD_NSIGMAS_UNUSED, PD_WIDTH_BOUNDS, PD_FIT_START,
        CHARGE_LOWER, LOWQ_POWER_BOUNDS, STRUCTURES,
        models, canTakeStructure, create, reduce, rows, validate, fittableNames,
    });
})();
