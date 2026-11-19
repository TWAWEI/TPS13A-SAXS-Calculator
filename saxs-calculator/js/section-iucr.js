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
            // 內容取自處理過的複本（輸入框換成現值、空的擬合段不進複製）；取值後立刻移除複本，才進入 await
            const source = iucrCopySource(table);
            const { html, text } = source;
            source.release();
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
            // Fallback for older browsers：內容與上面完全相同（copy 事件直接寫入處理過的 HTML 與純文字），
            // 暫時的複本複製完（或失敗）一定移除；execCommand 回報成功才顯示「已複製」
            let source = null;
            let copied = false;
            try {
                source = iucrCopySource(table);
                copied = iucrExecCopy(source.node, source.html, source.text);
            } catch (fallbackErr) {
                console.warn('[iucr] 複製表格失敗', fallbackErr);
            } finally {
                if (source) source.release();
            }
            copyBtn.textContent = copied ? '✓ 已複製' : '複製失敗';
            setTimeout(() => {
                copyBtn.textContent = '複製表格';
            }, 2000);
        }
    });
}

/**
 * 舊瀏覽器（或 Clipboard API 被拒）的複製：選取節點後執行 execCommand('copy')，並以一次性的 copy 監聽器
 * 把剪貼簿內容直接設成給定的 HTML 與純文字——不讓瀏覽器自己序列化選取範圍（那會帶進 .sr-only 容器的樣式，
 * 純文字的 Tab 與換行也與 Clipboard API 那條路不同）。監聽器與選取範圍在任何情況下都會清掉。
 *
 * @param {Node} node - 要選取的節點（已掛在文件裡）
 * @param {string} html - 寫進 text/html 的內容
 * @param {string} text - 寫進 text/plain 的內容
 * @returns {boolean} execCommand 是否回報成功，且內容確實由監聽器寫入
 */
function iucrExecCopy(node, html, text) {
    let written = false;
    const onCopy = (event) => {
        if (!event.clipboardData) return;
        event.clipboardData.setData('text/html', html);
        event.clipboardData.setData('text/plain', text);
        event.preventDefault();
        written = true;
    };
    const selection = window.getSelection();
    document.addEventListener('copy', onCopy);
    try {
        const range = document.createRange();
        range.selectNode(node);
        selection.removeAllRanges();
        selection.addRange(range);
        return document.execCommand('copy') === true && written;
    } finally {
        document.removeEventListener('copy', onCopy);
        selection.removeAllRanges();
    }
}

/**
 * 表單控制項在複製內容裡的文字：輸入框與文字區是現值，選單是所選項目的文字。
 *
 * @param {HTMLElement} control - 原表格裡的控制項（複本不帶現值）
 * @returns {string} 純文字
 */
function iucrControlText(control) {
    if (control.tagName && String(control.tagName).toLowerCase() === 'select') {
        const option = control.options ? control.options[control.selectedIndex] : null;
        return option ? String(option.text) : '';
    }
    return control.value === undefined || control.value === null ? '' : String(control.value);
}

/**
 * 表格的複本，處理成適合貼到別處的樣子（不修改原表格）：
 * 每個表單控制項換成它「目前的值」的文字節點（值從原表格讀——cloneNode 不帶現值；文字節點由瀏覽器跳脫）；
 * 還沒送入擬合結果的擬合段（#iucr-sf-body[data-empty="true"]）拿掉；表格直屬的註解節點拿掉。
 *
 * @param {HTMLTableElement} table - 畫面上的表格
 * @returns {HTMLTableElement} 尚未掛進文件的複本
 */
function iucrCopyClone(table) {
    const clone = table.cloneNode(true);
    const live = table.querySelectorAll('input, select, textarea');
    clone.querySelectorAll('input, select, textarea').forEach((control, i) => {
        control.replaceWith(document.createTextNode(iucrControlText(live[i])));
    });
    const fitBlock = clone.querySelector('#iucr-sf-body');
    if (fitBlock && fitBlock.getAttribute('data-empty') === 'true') fitBlock.remove();
    Array.from(clone.childNodes).filter(node => node.nodeType === 8).forEach(node => node.remove());
    clone.normalize();      // 相鄰的文字節點併成一個、空的文字節點（清空的輸入框）拿掉
    return clone;
}

/**
 * 「複製表格」的內容來源。複本掛進一個 .sr-only 容器（要有版面盒，innerText 才會依表格版面輸出 Tab 與換行），
 * 讀出 HTML 與純文字；呼叫端用完必須 release()。從掛上到 release 要在同一個同步段落內完成
 * （這段時間文件裡有重複的 id，瀏覽器不會在中途重繪）。讀取時丟例外也不留下容器。
 *
 * @param {HTMLTableElement} table - 畫面上的表格
 * @returns {{html: string, text: string, node: HTMLTableElement, release: function(): void}} 複本的內容與移除函式
 */
function iucrCopySource(table) {
    const holder = document.createElement('div');
    holder.className = 'sr-only';
    holder.setAttribute('aria-hidden', 'true');
    const node = iucrCopyClone(table);
    holder.appendChild(node);
    table.parentNode.appendChild(holder);
    const release = () => holder.remove();
    try {
        return { html: node.outerHTML, text: node.innerText, node, release };
    } catch (err) {
        release();
        throw err;
    }
}

/**
 * 把 AppState.sasfitData 畫進 IUCr 表格的「Model fitting」段（tbody#iucr-sf-body）。
 * 找不到該段或 SasFitIucr 不存在時什麼都不做。列的 HTML 由 SasFitIucr.rowsHtml 產生（已跳脫）。
 *
 * @returns {void}
 */
function renderIUCrModelFit() {
    const body = document.getElementById('iucr-sf-body');
    if (!body || typeof SasFitIucr === 'undefined') return;
    const data = typeof AppState !== 'undefined' && AppState.sasfitData ? AppState.sasfitData : null;
    body.innerHTML = SasFitIucr.rowsHtml(data);
    body.setAttribute('data-empty', data === null ? 'true' : 'false');
}

/**
 * SAS 模型擬合頁「送進 IUCr 表格」的入口：以新物件取代 AppState.sasfitData（null 表示清除）並重畫擬合段。
 * updateIUCrTable 只由蛋白質頁與 SAXS 頁呼叫，所以擬合段在送出當下自己寫入。
 *
 * @param {Object|null} data - SasFitIucr.data 的回傳（凍結），或 null
 * @returns {void}
 */
function setIUCrModelFit(data) {
    AppState.sasfitData = data === undefined ? null : data;
    renderIUCrModelFit();
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
        setText('iucr-mw-seq', MassUnits.formatKDa(protein.molecularWeight));
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
        setText('iucr-mw-porod', MassUnits.formatKDa(saxs.mwFromPorod));
    }

    // Hide warning if data is available
    if (protein || saxs) {
        document.getElementById('iucrWarning').classList.add('hidden');
    }
}
