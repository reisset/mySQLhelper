// UI utilities: modals, theme, rendering helpers

// --- HTML Escape Helper (XSS Prevention) ---
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Custom Confirmation Modal ---
export function showConfirmModal(title, message, onConfirm, confirmText = 'Continue', cancelText = 'Cancel') {
    const existing = document.getElementById('confirm-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'confirm-modal';
    modal.className = 'confirm-modal-overlay';

    const modalContent = document.createElement('div');
    modalContent.className = 'confirm-modal';
    modalContent.setAttribute('role', 'dialog');
    modalContent.setAttribute('aria-modal', 'true');
    modalContent.setAttribute('aria-labelledby', 'confirm-modal-title');

    const header = document.createElement('div');
    header.className = 'confirm-modal-header';
    const h3 = document.createElement('h3');
    h3.id = 'confirm-modal-title';
    h3.textContent = title;
    header.appendChild(h3);

    const body = document.createElement('div');
    body.className = 'confirm-modal-body';
    const p = document.createElement('p');
    p.textContent = message;
    body.appendChild(p);

    const footer = document.createElement('div');
    footer.className = 'confirm-modal-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'confirm-modal-cancel';
    cancelBtn.textContent = cancelText;

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'confirm-modal-confirm';
    confirmBtn.textContent = confirmText;

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    modalContent.appendChild(header);
    modalContent.appendChild(body);
    modalContent.appendChild(footer);
    modal.appendChild(modalContent);

    document.body.appendChild(modal);

    const closeModal = () => {
        document.removeEventListener('keydown', escHandler);
        modal.remove();
    };

    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    confirmBtn.addEventListener('click', () => {
        closeModal();
        if (onConfirm) onConfirm();
    });

    // Escape key closes modal
    const escHandler = (e) => {
        if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', escHandler);

    // Focus trap and initial focus
    confirmBtn.focus();
}

// --- Custom Alert Modal ---
export function showAlertModal(title, message) {
    showConfirmModal(title, message, null, 'OK', '');
    // Hide cancel button for alerts
    const cancelBtn = document.querySelector('.confirm-modal-cancel');
    if (cancelBtn) cancelBtn.style.display = 'none';
}

// --- Theme Toggle ---
function updateThemeIcon(theme) {
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        const moonIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
        const sunIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
        themeToggle.innerHTML = theme === 'light' ? sunIcon : moonIcon;
        themeToggle.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    }
}

export function initTheme() {
    let savedTheme = 'dark';
    try { savedTheme = localStorage.getItem('theme') || 'dark'; } catch (e) { /* private browsing */ }
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

export function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    try { localStorage.setItem('theme', newTheme); } catch (e) { /* private browsing */ }
    updateThemeIcon(newTheme);
}

// --- Markdown / Text Rendering ---
export function renderText(element, text) {
    if (typeof marked !== 'undefined') {
        let html = marked.parse(text);
        if (typeof DOMPurify !== 'undefined') {
            html = DOMPurify.sanitize(html);
        }
        element.innerHTML = html;
        addCopyButtons(element);
    } else {
        element.textContent = text;
    }
}

export function addCopyButtons(container) {
    const pres = container.querySelectorAll('pre');
    pres.forEach(pre => {
        const code = pre.querySelector('code');
        if (!code) return;

        // Avoid duplicate buttons if re-running on existing DOM
        if (pre.querySelector('.copy-sql-button')) return;

        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-sql-button';
        copyBtn.textContent = 'Copy';
        copyBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(code.textContent);
                copyBtn.textContent = 'Copied!';
            } catch (err) {
                copyBtn.textContent = 'Failed';
            }
            setTimeout(() => copyBtn.textContent = 'Copy', 2000);
        };

        pre.appendChild(copyBtn);
    });
}
