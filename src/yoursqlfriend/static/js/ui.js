// UI utilities: modals, theme, rendering helpers

// --- HTML Escape Helper (XSS Prevention) ---
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Modal Factory ---
/**
 * Create and show a modal overlay with standard close behavior.
 * @param {string} id - Element ID for the modal overlay
 * @param {string} overlayClass - CSS class(es) for the overlay div
 * @param {string} contentHTML - Inner HTML for the modal
 * @param {object} [options] - { closeSelector, onClose, focusSelector }
 * @returns {{ modal: HTMLElement, close: Function }}
 */
export function createModal(id, overlayClass, contentHTML, options = {}) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = id;
    modal.className = `modal-overlay ${overlayClass}`;
    modal.innerHTML = contentHTML;

    document.body.appendChild(modal);

    const close = () => {
        document.removeEventListener('keydown', escHandler);
        modal.remove();
        if (options.onClose) options.onClose();
    };

    // Close on overlay background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });

    // Close button (if selector provided)
    if (options.closeSelector) {
        const closeBtn = modal.querySelector(options.closeSelector);
        if (closeBtn) closeBtn.addEventListener('click', close);
    }

    // Escape key closes modal
    const escHandler = (e) => {
        if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', escHandler);

    // Focus initial element
    if (options.focusSelector) {
        const focusEl = modal.querySelector(options.focusSelector);
        if (focusEl) focusEl.focus();
    }

    return { modal, close };
}

// --- Download Blob Utility ---
export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
}

// --- Fetch JSON Utility ---
export async function fetchJson(url, body) {
    const options = body !== undefined
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {};
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
}

// --- Custom Confirmation Modal ---
export function showConfirmModal(title, message, onConfirm, confirmText = 'Continue', cancelText = 'Cancel') {
    const contentHTML = `
        <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
            <div class="confirm-modal-header">
                <h3 id="confirm-modal-title"></h3>
            </div>
            <div class="confirm-modal-body">
                <p></p>
            </div>
            <div class="confirm-modal-footer">
                <button class="confirm-modal-cancel"></button>
                <button class="confirm-modal-confirm"></button>
            </div>
        </div>`;

    const { modal, close } = createModal('confirm-modal', 'confirm-modal-overlay', contentHTML);

    // Set text content safely (no innerHTML for user-provided strings)
    modal.querySelector('#confirm-modal-title').textContent = title;
    modal.querySelector('.confirm-modal-body p').textContent = message;
    modal.querySelector('.confirm-modal-cancel').textContent = cancelText;
    modal.querySelector('.confirm-modal-confirm').textContent = confirmText;

    const cancelBtn = modal.querySelector('.confirm-modal-cancel');
    const confirmBtn = modal.querySelector('.confirm-modal-confirm');

    cancelBtn.addEventListener('click', close);
    confirmBtn.addEventListener('click', () => {
        close();
        if (onConfirm) onConfirm();
    });

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
