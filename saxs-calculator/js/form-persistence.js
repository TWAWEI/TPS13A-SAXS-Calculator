/**
 * TPS13A SAXS Calculator - Form Persistence
 * localStorage 表單持久化：存檔、還原、還原提示條。
 */

// ========================
// localStorage Persistence
// ========================
const STORAGE_KEY = 'tps13a-form-state';

// 永不持久化：檔案欄位（無意義）與密碼欄位（光束線是共用電腦，明文外洩）
const PERSIST_SKIP_TYPES = Object.freeze(['file', 'password']);
const PERSIST_SKIP_IDS = Object.freeze([
    'dndcPasswordInput', 'detectorRgInput',
    // 脂質體頁的 chip 管理欄位：重新整理後沒有 SD 與來源，還原數值只會做出沒有來源的因子
    'lipoDilutionFactor', 'lipoAbs1', 'lipoAbs2', 'lipoAbs3',
]);

// 還原後需要補派 input 事件的欄位（其衍生顯示不會在 init 時自行重算）
const PERSIST_DERIVED_IDS = Object.freeze([
    'proteinSequence',    // → 序列長度
    'hplcPeakCenter',     // → 10 μL 建議值
    'hplcPeakFWHM',       // → 10 μL 建議值
    'retentionTimeInput'  // → RT → MW
]);

// 還原（與還原後補派的 input 事件）期間暫停自動存檔，否則 savedAt 會被改寫成
// 「這次開啟頁面的時間」，提示條上的時間就永遠是現在。
let suppressAutoSave = false;

/**
 * 在暫停自動存檔的狀態下執行 fn。
 *
 * @param {function(): void} fn - 要執行的動作
 * @returns {void}
 */
function withAutoSaveSuppressed(fn) {
    const previous = suppressAutoSave;
    suppressAutoSave = true;
    try {
        fn();
    } finally {
        suppressAutoSave = previous;
    }
}

/**
 * 這個欄位可以被持久化嗎？
 *
 * @param {HTMLElement} el - 表單元素
 * @returns {boolean} 可持久化為 true
 */
function isPersistableField(el) {
    return !PERSIST_SKIP_TYPES.includes(el.type) && !PERSIST_SKIP_IDS.includes(el.id);
}

/**
 * 取得欄位的預設值。
 *
 * <select> 沒有 defaultValue 屬性（回 undefined），若直接比對會讓每一個下拉都被
 * 當成「已被使用者改過」而存檔，還原提示條就會每次開頁都出現。改為比對 HTML 上
 * 標了 selected 的選項（沒有的話就是第一個選項）。
 *
 * @param {HTMLElement} el - 表單元素
 * @returns {string} 預設值字串
 */
function fieldDefaultValue(el) {
    if (el.tagName !== 'SELECT') return el.defaultValue;
    const preselected = Array.from(el.options).find(opt => opt.defaultSelected) || el.options[0];
    return preselected ? preselected.value : '';
}

function saveFormState() {
    const values = {};
    document.querySelectorAll('input[id], select[id], textarea[id]').forEach(el => {
        if (!isPersistableField(el)) return;
        // 只存「偏離預設值」的欄位：checkbox / select 若無條件存檔，存過一次之後
        // 每次開頁都會被判定成「有還原內容」而彈出提示條
        if (el.type === 'checkbox') {
            if (el.checked !== el.defaultChecked) values[el.id] = el.checked;
        } else if (el.value !== '' && el.value !== fieldDefaultValue(el)) {
            values[el.id] = el.value;
        }
    });
    safeStorage.set(STORAGE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), values }));
}

/**
 * 讀取存檔（相容 v4.6 之前的扁平格式），並一次性清掉曾經落地的敏感欄位。
 *
 * @returns {{savedAt: string|null, values: object}|null} 解析結果
 */
function readFormState() {
    const raw = safeStorage.get(STORAGE_KEY);
    if (!raw) return null;

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.warn('[form-state] 存檔格式損壞，已清除:', err.message);
        safeStorage.remove(STORAGE_KEY);
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;

    const hasEnvelope = parsed.values && typeof parsed.values === 'object';
    const rawValues = hasEnvelope ? parsed.values : parsed;
    const savedAt = typeof parsed.savedAt === 'string' ? parsed.savedAt : null;

    // 一次性清理：舊版本可能已把明文密碼寫進 localStorage
    const leaked = PERSIST_SKIP_IDS.filter(id => id in rawValues);
    const values = { ...rawValues };
    if (leaked.length > 0) {
        leaked.forEach(id => { delete values[id]; });
        safeStorage.set(STORAGE_KEY, JSON.stringify({ savedAt, values }));
    }

    return { savedAt, values };
}

/**
 * 把 ISO 時間字串格式化成 YYYY-MM-DD HH:mm。
 *
 * @param {string|null} iso - ISO 時間字串
 * @returns {string} 顯示字串（無法解析時回 '先前'）
 */
function formatSavedAt(iso) {
    if (!iso) return '先前';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '先前';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 顯示「已還原上次輸入值」提示條，附清除與關閉按鈕。
 *
 * 光束線工作站多人共用同一個瀏覽器 profile，靜默把上一位使用者的參數填回
 * 欄位是實際會造成錯誤科學結論的資料完整性風險。
 *
 * @param {string|null} savedAt - 存檔時間（ISO）
 * @returns {void}
 */
function showRestoreNotice(savedAt) {
    const main = document.getElementById('main-content');
    if (!main) return;

    const existing = document.getElementById('restoreNotice');
    if (existing) existing.remove();

    const notice = document.createElement('div');
    notice.id = 'restoreNotice';
    notice.className = 'alert alert-info';
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin-bottom: 1rem;';

    const text = document.createElement('span');
    text.style.flex = '1 1 20rem';
    text.textContent = `已還原 ${formatSavedAt(savedAt)} 儲存的輸入值，請確認是否為本次樣品的參數。`;

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-sm btn-secondary';
    clearBtn.textContent = '清除已儲存的輸入';
    clearBtn.addEventListener('click', () => {
        safeStorage.remove(STORAGE_KEY);
        window.location.reload();
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-sm btn-secondary';
    closeBtn.setAttribute('aria-label', '關閉還原提示');
    closeBtn.textContent = '關閉';
    closeBtn.addEventListener('click', () => notice.remove());

    notice.append(text, clearBtn, closeBtn);
    main.prepend(notice);
}

/**
 * 還原後補派 input 事件，讓衍生顯示（序列長度、建議值、RT→MW）與欄位一致。
 *
 * 延到目前這個 task 之後執行：initFormPersistence 是 DOMContentLoaded 的第一個
 * 呼叫，此時其他區段的事件監聽器都還沒綁定。
 *
 * @param {string[]} restoredIds - 實際被還原的欄位 id
 * @returns {void}
 */
function dispatchDerivedUpdates(restoredIds) {
    const targets = PERSIST_DERIVED_IDS.filter(id => restoredIds.includes(id));
    if (targets.length === 0) return;

    setTimeout(() => {
        withAutoSaveSuppressed(() => {
            targets.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.dispatchEvent(new Event('input', { bubbles: true }));
            });
        });
    }, 0);
}

function restoreFormState() {
    const state = readFormState();
    if (!state) return;

    const restoredIds = [];
    withAutoSaveSuppressed(() => {
        Object.entries(state.values).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (!el || !isPersistableField(el)) return;
            if (el.type === 'checkbox') {
                el.checked = Boolean(value);
            } else {
                el.value = value;
            }
            restoredIds.push(id);
        });
    });

    if (restoredIds.length === 0) return;
    showRestoreNotice(state.savedAt);
    dispatchDerivedUpdates(restoredIds);
}

function initFormPersistence() {
    restoreFormState();

    // Debounced auto-save on any input change（還原期間不計入）
    let saveTimer = null;
    const scheduleSave = () => {
        if (suppressAutoSave) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveFormState, 500);
    };
    document.addEventListener('input', scheduleSave);
    document.addEventListener('change', scheduleSave);
}
