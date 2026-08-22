/**
 * TPS13A SAXS Calculator - IUCr Table Section
 * IUCr 投稿用彙整表：從蛋白質與 SAXS 結果自動填表。
 */

// ========================
// IUCr Table Section
// ========================
function initIUCrSection() {
    const copyBtn = document.getElementById('copyIUCrTable');
    if (!copyBtn) return;

    copyBtn.addEventListener('click', async () => {
        const table = document.getElementById('iucrTable');
        if (!table) return;
        try {
            // Modern Clipboard API: copy table as both HTML and plain text
            const html = table.outerHTML;
            const text = table.innerText;
            if (navigator.clipboard && navigator.clipboard.write) {
                const blob = new Blob([html], { type: 'text/html' });
                const textBlob = new Blob([text], { type: 'text/plain' });
                await navigator.clipboard.write([
                    new ClipboardItem({ 'text/html': blob, 'text/plain': textBlob })
                ]);
            } else {
                await navigator.clipboard.writeText(text);
            }
            copyBtn.textContent = '✓ 已複製';
            setTimeout(() => {
                copyBtn.textContent = '複製表格';
            }, 2000);
        } catch (err) {
            // Fallback for older browsers
            const range = document.createRange();
            range.selectNode(table);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            try {
                document.execCommand('copy');
                copyBtn.textContent = '✓ 已複製';
                setTimeout(() => {
                    copyBtn.textContent = '複製表格';
                }, 2000);
            } catch (fallbackErr) {
                copyBtn.textContent = '複製失敗';
                setTimeout(() => {
                    copyBtn.textContent = '複製表格';
                }, 2000);
            }
            window.getSelection().removeAllRanges();
        }
    });
}

/**
 * IUCr 表格用的數值格式化。
 *
 * `value?.toFixed(d) || '-'` 對 NaN 無效：NaN.toFixed(5) 回傳字串 "NaN"（truthy），
 * 未填欄位會被直接抄進投稿用的 SAS 資料表。
 *
 * @param {number} value - 數值
 * @param {number} digits - 小數位數
 * @returns {string} 格式化字串，非有限值一律 '-'
 */
function formatIUCrValue(value, digits) {
    return Number.isFinite(value) ? value.toFixed(digits) : '-';
}

function updateIUCrTable() {
    const protein = AppState.proteinData;
    const saxs = AppState.saxsData;
    const fmt = formatIUCrValue;
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    // Update protein info
    if (protein) {
        setText('iucr-protein', protein.name || '-');
        setText('iucr-dryvol', fmt(protein.dryVolume, 1));
        setText('iucr-vbar', fmt(protein.partialSpecificVolume, 6));
        setText('iucr-mw-seq', fmt(protein.molecularWeight, 2));
    }

    // Update SAXS data
    if (saxs) {
        setText('iucr-wavelength', fmt(saxs.wavelength, 5));
        setText('iucr-concentration', Number.isFinite(saxs.concentration) ? String(saxs.concentration) : '-');
        setText('iucr-i0-pr', fmt(saxs.i0Pr, 5));
        setText('iucr-rg-pr', fmt(saxs.rgPr, 2));
        setText('iucr-i0-guinier', fmt(saxs.i0Guinier, 5));
        setText('iucr-rg-guinier', fmt(saxs.rgGuinier, 2));
        setText('iucr-dmax', Number.isFinite(saxs.dmax) ? String(saxs.dmax) : '-');
        // 固定 en-US：中文語系的 toLocaleString() 會把 NaN 印成「非數值」，
        // 且千分位格式不應隨瀏覽器語系變動
        setText('iucr-porod', Number.isFinite(saxs.porodVolume)
            ? saxs.porodVolume.toLocaleString('en-US') : '-');
        setText('iucr-mw-porod', fmt(saxs.mwFromPorod, 0));
    }

    // Hide warning if data is available
    if (protein || saxs) {
        document.getElementById('iucrWarning').classList.add('hidden');
    }
}
