/**
 * TPS13A SAXS Calculator - Navigation
 * 側欄導覽切換、收合狀態持久化、行動版選單。
 */

// ========================
// Navigation
// ========================
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item[data-section]');
    const sections = document.querySelectorAll('.section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const sectionId = item.dataset.section;

            // Update nav active state
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Show corresponding section
            sections.forEach(section => {
                section.classList.remove('active');
                if (section.id === `section-${sectionId}`) {
                    section.classList.add('active');
                }
            });

            // Update aria-current
            navItems.forEach(nav => nav.removeAttribute('aria-current'));
            item.setAttribute('aria-current', 'page');

            // Close mobile menu if open
            setMobileMenu(false);
        });
    });

    // Mobile menu toggle
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    const setMobileMenu = (isOpen, { returnFocus = false } = {}) => {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.toggle('open', isOpen);
        if (sidebarOverlay) sidebarOverlay.classList.toggle('active', isOpen);
        if (mobileMenuBtn) {
            mobileMenuBtn.setAttribute('aria-expanded', String(isOpen));
            mobileMenuBtn.setAttribute('aria-label', isOpen ? '關閉選單' : '開啟選單');
            if (!isOpen && returnFocus) mobileMenuBtn.focus();
        }
    };

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            setMobileMenu(!(sidebar && sidebar.classList.contains('open')));
        });
    }
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => setMobileMenu(false));
    }

    // Escape 關閉行動選單並把焦點還給漢堡鈕（側欄是 off-canvas，不關就沒有出口）
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.classList.contains('open')) {
            setMobileMenu(false, { returnFocus: true });
        }
    });

    // Sidebar collapse toggle
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    const toggleIcon = document.getElementById('sidebarToggleIcon');
    const appLayout = document.querySelector('.app-layout');

    if (sidebarToggle && sidebar && appLayout) {
        // 圖示是 aria-hidden 的箭頭，狀態必須另外用 aria-expanded/aria-label 表達
        const syncCollapseState = (isCollapsed) => {
            appLayout.classList.toggle('sidebar-collapsed', isCollapsed);
            if (toggleIcon) toggleIcon.textContent = isCollapsed ? '▶' : '◀';
            sidebarToggle.setAttribute('aria-expanded', String(!isCollapsed));
            sidebarToggle.setAttribute('aria-label', isCollapsed ? '展開側邊欄' : '收合側邊欄');

            // 收合時只看得到 data-short 縮寫，補 title 讓 hover 讀得到完整名稱；
            // 展開時標籤已經完整可見，留著 title 只會重複朗讀。
            sidebar.querySelectorAll('.nav-item[data-title]').forEach(item => {
                if (isCollapsed) {
                    item.setAttribute('title', item.dataset.title);
                } else {
                    item.removeAttribute('title');
                }
            });
        };

        // Restore state from sessionStorage
        if (safeSession.get('sidebarCollapsed') === 'true') {
            sidebar.classList.add('collapsed');
            syncCollapseState(true);
        } else {
            syncCollapseState(false);
        }

        sidebarToggle.addEventListener('click', () => {
            const isCollapsed = sidebar.classList.toggle('collapsed');
            syncCollapseState(isCollapsed);
            safeSession.set('sidebarCollapsed', String(isCollapsed));
        });
    }
}
