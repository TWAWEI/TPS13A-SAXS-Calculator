/**
 * TPS13A SAXS Calculator - Main Application
 * 全域狀態與 DOMContentLoaded 啟動點（各區段的實作在 js/section-*.js）。
 * 必須是 index.html 最後一個載入的腳本。
 */

// ========================
// Global State
// ========================
const AppState = {
    proteinData: null,
    saxsData: null,
    charts: {},
    dndcUnlocked: false
};

// Storage 在部分瀏覽器設定下（Safari「阻擋所有 Cookie」、企業政策、無痕模式）
// 連存取器本身都會 throw SecurityError。全部走 FormUtils 的安全包裝，
// 避免一個 getItem 就讓 DOMContentLoaded 後面所有 init 停擺。
const safeStorage = FormUtils.safeLocal;
const safeSession = FormUtils.safeSession;

// ========================
// Initialize Application
// ========================
document.addEventListener('DOMContentLoaded', () => {
    initFormPersistence();
    initNavigation();
    initProteinSection();
    window.DetectorRgPanel?.init();
    initSAXSSection();
    initHPLCSection();
    initSampleSection();
    initMWSection();
    initCentrifugeSection();
    initDetectorSection();
    initIUCrSection();
    window.LiposomeSection?.init();
    initDndcLock();
});
