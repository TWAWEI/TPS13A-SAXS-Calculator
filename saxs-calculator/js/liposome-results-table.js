/**
 * TPS13A SAXS Calculator - 脂質體 DOX 載藥：結果表
 *
 * 一列 = 一個樣品的 D/L 快照（由 section-liposome.js 的「加入結果表」送進來）。
 * 責任：localStorage 持久化（key tps13a.liposome.results，上限 200 列）、渲染、刪列、
 * 清空（原生 <dialog> 確認）、CSV 匯出（RFC 4180 引號，UTF-8 BOM 由 downloadCsv 加）。
 *
 * 頂層不碰 DOM，Node 可 require 測 csvCell / rowsToCsv。
 * 依賴（呼叫時才取用）：FormUtils.safeLocal、FormUtils.escapeHtml、showAlert、clearAlert、downloadCsv。
 *
 * CSV 不做公式注入防護（`=`/`+`/`-`/`@` 開頭不加前綴）——匯出的是使用者自己的樣品名到自己的 Excel，
 * 加前綴反而毀掉像 `-DOX` 的合法名稱。
 */
(function attachLiposomeResultsTable(global) {
    'use strict';

    const RESULTS_KEY = 'tps13a.liposome.results';
    const MAX_ROWS = 200;

    const CSV_HEADER = [
        'Sample', 'Dilution factor', 'Factor source', 'Factor SD', 'A(primary)', 'Primary wavelength (nm)',
        'DOX conc (mM)', 'Lipid actual (mM)', 'D/L', 'D/L error', 'Added at',
        'Epsilon (L/mol/cm)', 'Path (cm)', 'q min', 'q max', 'Wavelengths (nm)', 'Absorbances', 'Absorbance source',
    ];

    const SOURCE_LABEL = Object.freeze({ saxs: 'SAXS 計算', manual: '手動', spectrum: '光譜讀值' });

    let rows = Object.freeze([]);
    let primaryWavelengthNm = 495;
    let initialised = false;
    const els = {};

    // ------------------------------------------------------------ CSV（純函式）
    function csvCell(value) {
        if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
        if (value === null || value === undefined) return '';
        const text = String(value);
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    function rowToCsv(r) {
        const m = r.meta || {};
        return [
            r.sampleName, r.factor, r.factorSource, m.factorSd, r.aPrimary, r.primaryWavelengthNm,
            r.doxConcMM, r.lipidActualMM, r.dl, r.dlSd, r.addedAt,
            m.epsilon, m.pathCm, m.qMin, m.qMax,
            Array.isArray(m.wavelengths) ? m.wavelengths.join('|') : '',
            Array.isArray(m.absorbances) ? m.absorbances.join('|') : '',
            m.absSource,
        ].map(csvCell).join(',');
    }

    function rowsToCsv(list) {
        return [CSV_HEADER.join(','), ...list.map(rowToCsv)].join('\n');
    }

    // ------------------------------------------------------------ 持久化
    function isRow(r) {
        return !!r && typeof r === 'object' && typeof r.id === 'string' && Number.isFinite(r.dl)
            && Number.isFinite(r.primaryWavelengthNm) && typeof r.sampleName === 'string';
    }

    function loadRows() {
        const raw = global.FormUtils.safeLocal.get(RESULTS_KEY);
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.filter(isRow) : [];
        } catch (err) {
            console.warn('[liposome] 結果表 JSON 損壞，已忽略', err);
            return [];
        }
    }

    function setRows(next) {
        rows = Object.freeze(next);
        const saved = global.FormUtils.safeLocal.set(RESULTS_KEY, JSON.stringify(rows));
        render();
        if (!saved) global.showAlert('lipoResultsAlert', 'warning', '結果已顯示但無法寫入瀏覽器儲存空間，重新整理後會消失，請先匯出 CSV');
    }

    // ------------------------------------------------------------ 渲染
    function fmt(v, digits) {
        return Number.isFinite(v) ? v.toPrecision(digits) : '-';
    }

    function absCell(r) {
        const esc = global.FormUtils.escapeHtml;
        const same = r.primaryWavelengthNm === primaryWavelengthNm;
        const title = same ? '' : ` title="讀值波長 ${esc(r.primaryWavelengthNm)} nm"`;
        const tag = same ? '' : ` <small>(${esc(r.primaryWavelengthNm)})</small>`;
        return `<td class="text-right"${title}>${fmt(r.aPrimary, 5)}${tag}</td>`;
    }

    function rowHtml(r) {
        const esc = global.FormUtils.escapeHtml;
        const when = new Date(r.addedAt);
        const whenText = Number.isNaN(when.getTime()) ? '-' : when.toLocaleString('zh-TW', { hour12: false });
        return `<tr>
            <td>${esc(r.sampleName)}</td>
            <td class="text-right">${fmt(r.factor, 4)}</td>
            <td>${esc(Object.hasOwn(SOURCE_LABEL, r.factorSource) ? SOURCE_LABEL[r.factorSource] : r.factorSource)}</td>
            ${absCell(r)}
            <td class="text-right">${fmt(r.doxConcMM, 4)}</td>
            <td class="text-right">${fmt(r.lipidActualMM, 4)}</td>
            <td class="text-right"><strong>${fmt(r.dl, 4)}</strong></td>
            <td class="text-right">${fmt(r.dlSd, 3)}</td>
            <td>${esc(whenText)}</td>
            <td class="text-center"><button type="button" class="btn btn-secondary btn-sm" data-delete-id="${esc(r.id)}" aria-label="刪除 ${esc(r.sampleName)}">刪除</button></td>
        </tr>`;
    }

    function render() {
        if (!els.body) return;
        els.body.innerHTML = rows.map(rowHtml).join('');
        if (els.absHeader) els.absHeader.textContent = `A(${primaryWavelengthNm} nm)`;
        const empty = rows.length === 0;
        if (els.empty) els.empty.hidden = !empty;
        if (els.wrapper) els.wrapper.hidden = empty;
        if (els.exportBtn) els.exportBtn.disabled = empty;
        if (els.clearBtn) els.clearBtn.disabled = empty;
        if (els.count) els.count.textContent = empty ? '' : `${rows.length} 列`;
    }

    // ------------------------------------------------------------ 操作
    function add(row) {
        if (!isRow(row)) throw new Error('結果列格式不正確');
        if (rows.length >= MAX_ROWS) {
            global.showAlert('lipoResultsAlert', 'error', `結果表已達 ${MAX_ROWS} 列上限，請先匯出 CSV 再清空`);
            return false;
        }
        global.clearAlert('lipoResultsAlert');
        setRows([...rows, row]);
        return true;
    }

    function remove(id) {
        setRows(rows.filter(r => r.id !== id));
    }

    function clear() {
        setRows([]);
    }

    function setPrimaryWavelength(nm) {
        if (!Number.isFinite(nm)) return;
        primaryWavelengthNm = nm;
        render();
    }

    function exportCsv() {
        if (rows.length === 0) return;
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        global.downloadCsv(`liposome-DL-${stamp}.csv`, rowsToCsv(rows));
    }

    function bindClearDialog() {
        const dialog = els.dialog;
        if (!dialog || !els.clearBtn) return;
        const supportsDialog = typeof dialog.showModal === 'function';
        els.clearBtn.addEventListener('click', () => {
            if (!supportsDialog) {
                global.showAlert('lipoResultsAlert', 'error', '此瀏覽器不支援確認視窗，請逐列刪除');
                return;
            }
            // returnValue 會跨次保留：確認清空一次後，下次用 Escape 關閉也會帶著 'confirm' 觸發 close。
            // 每次開啟前清掉，否則會無聲清空整張表。
            dialog.returnValue = '';
            dialog.showModal();
        });
        dialog.addEventListener('close', () => {
            if (dialog.returnValue !== 'confirm') return;   // 取消／Escape：原生 dialog 會自己把焦點還給觸發鈕
            clear();
            // clearBtn 已被 render() 停用，焦點落在空狀態文字
            if (els.empty) { els.empty.setAttribute('tabindex', '-1'); els.empty.focus(); }
        });
        els.dialogCancel?.addEventListener('click', () => {
            dialog.close('cancel');
        });
    }

    function init() {
        if (initialised) return;
        const $ = id => document.getElementById(id);
        els.body = $('lipoResultsBody');
        els.wrapper = $('lipoResultsWrapper');
        els.empty = $('lipoResultsEmpty');
        els.absHeader = $('lipoResultsAbsHeader');
        els.count = $('lipoResultsCount');
        els.exportBtn = $('lipoExportCsv');
        els.clearBtn = $('lipoClearResults');
        els.dialog = $('lipoClearDialog');
        els.dialogCancel = $('lipoClearCancel');
        if (!els.body) return;

        rows = Object.freeze(loadRows());
        render();

        els.body.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-delete-id]');
            if (btn) remove(btn.dataset.deleteId);
        });
        els.exportBtn?.addEventListener('click', exportCsv);
        bindClearDialog();
        initialised = true;
    }

    global.LiposomeResultsTable = Object.freeze({
        RESULTS_KEY,
        MAX_ROWS,
        csvCell,
        rowsToCsv,
        isRow,
        init,
        add,
        remove,
        clear,
        setPrimaryWavelength,
        getRows: () => rows,
    });
})(typeof window !== 'undefined' ? window : globalThis);
