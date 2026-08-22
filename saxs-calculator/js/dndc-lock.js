/**
 * TPS13A SAXS Calculator - dn/dc Password Lock
 * dn/dc 分頁的密碼鎖：SHA-256 驗證、解鎖後開放側欄項目。
 */

// ========================
// dn/dc Password Lock
// ========================
const DNDC_HASH = '53e6b431c5618bbe2d7a231a2ebb5b846a87182568c66da31e1e5f7006ef3e5a';

async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function initDndcLock() {
    const unlockBtn = document.getElementById('dndcNavUnlock');
    if (!unlockBtn) return;

    // 檢查 sessionStorage 是否已解鎖
    if (safeSession.get('dndcUnlocked') === 'true') {
        unlockDndc({ moveFocus: false });
        return;
    }

    const dialog = document.getElementById('dndcPasswordModal');
    const input = document.getElementById('dndcPasswordInput');
    const errorDiv = document.getElementById('dndcPasswordError');
    const form = document.getElementById('dndcPasswordForm');
    const cancelBtn = document.getElementById('dndcPasswordCancel');
    if (!dialog || !input || !errorDiv || !form || !cancelBtn) return;

    // 原生 <dialog> 自帶焦點鎖定、Escape 關閉與背景 inert。
    // 舊瀏覽器沒有 showModal 時退回 open 屬性，至少不讓 dn/dc 完全不可達。
    const supportsDialog = typeof dialog.showModal === 'function';

    const clearError = () => {
        errorDiv.classList.add('hidden');
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
    };

    const showError = () => {
        errorDiv.classList.remove('hidden');
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', 'dndcPasswordError');
        input.value = '';
        input.focus();
    };

    // 只要還鎖著，焦點就回到觸發器；已解鎖時交給 unlockDndc 處理。
    const restoreTrigger = () => {
        if (AppState.dndcUnlocked) return;
        unlockBtn.setAttribute('aria-expanded', 'false');
        unlockBtn.focus();
    };

    const openDialog = () => {
        if (AppState.dndcUnlocked) return;
        input.value = '';
        clearError();
        unlockBtn.setAttribute('aria-expanded', 'true');
        if (supportsDialog) {
            dialog.showModal();
        } else {
            dialog.setAttribute('open', '');
        }
        input.focus();
    };

    const closeDialog = () => {
        if (supportsDialog) {
            if (dialog.open) dialog.close();   // close 事件負責清值與還焦點
        } else {
            dialog.removeAttribute('open');
            input.value = '';
            restoreTrigger();
        }
    };

    const handleSubmit = async (event) => {
        if (event) event.preventDefault();
        const pwd = input.value;
        if (!pwd) {
            input.focus();
            return;
        }
        try {
            const hash = await sha256(pwd);
            if (hash === DNDC_HASH) {
                clearError();
                safeSession.set('dndcUnlocked', 'true');
                unlockDndc({ moveFocus: false });
                closeDialog();
                focusFirstDndcNavItem();
            } else {
                showError();
            }
        } catch (err) {
            // crypto.subtle 在非安全上下文（http:// 且非 localhost）不存在
            console.error('dn/dc 密碼驗證失敗:', err);
            errorDiv.textContent = '無法驗證密碼（瀏覽器不支援或非安全連線）';
            showError();
        }
    };

    // 事件只綁一次；舊版每次開啟都重新指派 onclick
    unlockBtn.addEventListener('click', openDialog);
    form.addEventListener('submit', handleSubmit);
    cancelBtn.addEventListener('click', closeDialog);
    input.addEventListener('input', clearError);

    // close 涵蓋所有關閉路徑：Escape、取消鈕、背景點擊、解鎖成功
    dialog.addEventListener('close', () => {
        input.value = '';
        restoreTrigger();
    });

    // 點擊 backdrop（事件 target 是 dialog 本體）關閉
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) closeDialog();
    });
}

function focusFirstDndcNavItem() {
    const navItems = document.getElementById('dndcNavItems');
    const firstItem = navItems && navItems.querySelector('.nav-item');
    if (firstItem) firstItem.focus();
}

function unlockDndc({ moveFocus = false } = {}) {
    AppState.dndcUnlocked = true;
    const navItems = document.getElementById('dndcNavItems');
    const unlockBtn = document.getElementById('dndcNavUnlock');
    if (navItems) navItems.classList.remove('hidden');
    if (unlockBtn) {
        unlockBtn.textContent = '🔓 dn/dc 工具';
        unlockBtn.setAttribute('aria-expanded', 'true');
        // 解鎖後已無 dialog 可開：移除 popup 語意並退出 tab 順序，
        // 避免留下一個「可聚焦但按了沒反應」的控制項。
        unlockBtn.removeAttribute('aria-haspopup');
        unlockBtn.removeAttribute('aria-controls');
        unlockBtn.disabled = true;
        unlockBtn.style.cursor = 'default';
    }
    if (moveFocus) focusFirstDndcNavItem();
}
