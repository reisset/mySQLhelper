// Copyright 2025 Reisset
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details

const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const chatHistory = document.getElementById('chat-history');
const uploadForm = document.getElementById('upload-form');
const databaseFile = document.getElementById('database-file');
const dropZone = document.getElementById('drop-zone');
const schemaDisplay = document.getElementById('schema-display');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const fileNameDisplay = document.getElementById('file-name-display');
const welcomeScreen = document.getElementById('welcome-screen');
const themeToggle = document.getElementById('theme-toggle');
const refreshBtn = document.getElementById('refresh-btn');
const schemaDiagramButton = document.getElementById('schema-diagram-button');
// Database state
let databaseLoaded = false;

// LLM Provider Elements
const providerSelect = document.getElementById('llm-provider-select');
const ollamaStatus = document.getElementById('ollama-status');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const modelSelector = document.getElementById('model-selector');
const modelSelect = document.getElementById('ollama-model-select');

// LLM Provider State
let currentProvider = 'lmstudio';
let ollamaAvailable = false;
let ollamaModels = [];
let selectedOllamaModel = null;
let statusCheckInterval = null;

// Version display
const appVersion = document.getElementById('app-version');

// Fetch and display version on load
async function fetchVersion() {
    try {
        const response = await fetch('/api/version');
        if (response.ok) {
            const data = await response.json();
            if (appVersion) {
                appVersion.textContent = `yourSQLfriend v${data.version}`;
            }
        }
    } catch (error) {
        console.warn('Could not fetch version:', error);
    }
}

fetchVersion();

// Configure marked.js once at init (not on every render call)
if (typeof marked !== 'undefined') {
    marked.setOptions({
        highlight: function(code, lang) {
            if (typeof hljs !== 'undefined') {
                const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                return hljs.highlight(code, { language }).value;
            }
            return code;
        },
        langPrefix: 'hljs language-'
    });
}

// Track active stream AbortController for cleanup on rapid sends
let activeStreamController = null;

// --- Custom Confirmation Modal ---
function showConfirmModal(title, message, onConfirm, confirmText = 'Continue', cancelText = 'Cancel') {
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
function showAlertModal(title, message) {
    showConfirmModal(title, message, null, 'OK', '');
    // Hide cancel button for alerts
    const cancelBtn = document.querySelector('.confirm-modal-cancel');
    if (cancelBtn) cancelBtn.style.display = 'none';
}

// --- HTML Escape Helper (XSS Prevention) ---
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Theme Toggle ---
function initTheme() {
    let savedTheme = 'dark';
    try { savedTheme = localStorage.getItem('theme') || 'dark'; } catch (e) { /* private browsing */ }
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function updateThemeIcon(theme) {
    if (themeToggle) {
        // SVG icons for consistent rendering across platforms
        const moonIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
        const sunIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
        themeToggle.innerHTML = theme === 'light' ? sunIcon : moonIcon;
        themeToggle.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    }
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    try { localStorage.setItem('theme', newTheme); } catch (e) { /* private browsing */ }
    updateThemeIcon(newTheme);
    updateChartsForTheme();
}

// Initialize theme on load
initTheme();

if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
}

// Refresh button handler
if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
        const hasChat = document.querySelectorAll('.chat-message').length > 0;
        if (hasChat) {
            showConfirmModal('Reload Page', 'This will clear your current session. Continue?', () => {
                window.location.reload();
            });
        } else {
            window.location.reload();
        }
    });
}

// --- LLM Provider Management ---

async function checkProviderStatus() {
    try {
        const response = await fetch(`/api/provider/status?provider=${currentProvider}`);
        const data = await response.json();

        if (currentProvider === 'ollama') {
            ollamaAvailable = data.available;
            ollamaModels = data.models || [];
            selectedOllamaModel = data.selected_model;
        }

        updateProviderStatusUI(data.available, data.models || []);

    } catch (error) {
        console.error('Failed to check provider status:', error);
        updateProviderStatusUI(false, []);
    }
}

function updateProviderStatusUI(available, models) {
    if (!ollamaStatus || !statusIndicator || !statusText) return;

    ollamaStatus.style.display = 'flex';

    // Remove existing guidance if any
    const existingGuidance = document.querySelector('.llm-guidance');
    if (existingGuidance) existingGuidance.remove();

    if (available) {
        statusIndicator.classList.remove('offline');
        statusIndicator.classList.add('online');
        statusText.textContent = currentProvider === 'ollama' ? 'Ollama Connected' : 'LM Studio Connected';

        // Populate model dropdown for Ollama only
        if (currentProvider === 'ollama' && modelSelector && modelSelect) {
            modelSelector.style.display = 'block';
            modelSelect.disabled = false;
            modelSelect.innerHTML = '<option value="">Select model...</option>';

            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                if (model === selectedOllamaModel) {
                    option.selected = true;
                }
                modelSelect.appendChild(option);
            });

            // Auto-select first model if none selected
            if (!selectedOllamaModel && models.length > 0) {
                modelSelect.value = models[0];
                selectedOllamaModel = models[0];
                setOllamaModel(models[0]);
            }
        } else {
            // LM Studio - hide model selector
            if (modelSelector) modelSelector.style.display = 'none';
        }
    } else {
        statusIndicator.classList.remove('online');
        statusIndicator.classList.add('offline');
        statusText.textContent = currentProvider === 'ollama' ? 'Ollama Offline' : 'LM Studio Offline';
        if (modelSelector) modelSelector.style.display = 'none';
        if (modelSelect) modelSelect.disabled = true;

        // Add friendly guidance
        const guidanceDiv = document.createElement('div');
        guidanceDiv.className = 'llm-guidance';

        if (currentProvider === 'ollama') {
            guidanceDiv.innerHTML = `
                <p>To connect Ollama:</p>
                <ol>
                    <li>Run <code>ollama serve</code></li>
                    <li>Pull a model: <code>ollama pull llama3.2</code></li>
                </ol>
            `;
        } else {
            guidanceDiv.innerHTML = `
                <p>To connect LM Studio:</p>
                <ol>
                    <li>Open LM Studio</li>
                    <li>Load a model</li>
                    <li>Start server on port 1234</li>
                </ol>
            `;
        }

        // Insert after the ollama-status div
        ollamaStatus.parentNode.insertBefore(guidanceDiv, ollamaStatus.nextSibling);
    }
}

async function setOllamaModel(model) {
    try {
        const response = await fetch('/api/ollama/model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: model })
        });

        if (response.ok) {
            selectedOllamaModel = model;
            console.log('Ollama model set to:', model);
        }
    } catch (error) {
        console.error('Failed to set model:', error);
        showAlertModal('Error', 'Failed to set Ollama model.');
    }
}

function initProviderSelector() {
    if (!providerSelect) return;

    // Check status on page load for default provider
    checkProviderStatus();

    // Start polling for status
    if (!statusCheckInterval) {
        statusCheckInterval = setInterval(checkProviderStatus, 30000);
    }

    providerSelect.addEventListener('change', async (e) => {
        currentProvider = e.target.value;
        // Immediately check status for new provider
        await checkProviderStatus();
    });
}

function initModelSelector() {
    if (!modelSelect) return;

    modelSelect.addEventListener('change', async (e) => {
        const model = e.target.value;
        if (!model) return;
        await setOllamaModel(model);
    });
}

// Initialize provider management after DOM is ready
// Ensure DOM is ready before initializing provider UI
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        initProviderSelector();
        initModelSelector();
    });
} else {
    initProviderSelector();
    initModelSelector();
}

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);

    // "/" to focus chat input (when not already typing)
    if (e.key === '/' && !isTyping && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        userInput.focus();
    }

    // Escape to blur chat input
    if (e.key === 'Escape' && active === userInput) {
        userInput.blur();
    }
});

// --- Scroll to Bottom Button ---
const scrollToBottomBtn = document.getElementById('scroll-to-bottom');
if (scrollToBottomBtn && chatHistory) {
    chatHistory.addEventListener('scroll', () => {
        const distanceFromBottom = chatHistory.scrollHeight - chatHistory.scrollTop - chatHistory.clientHeight;
        scrollToBottomBtn.classList.toggle('visible', distanceFromBottom > 100);
    });

    scrollToBottomBtn.addEventListener('click', () => {
        chatHistory.scrollTo({ top: chatHistory.scrollHeight, behavior: 'smooth' });
    });
}

// --- Clickable Example Queries ---
document.querySelectorAll('.example-query').forEach(el => {
    el.addEventListener('click', () => {
        // Strip surrounding quotes from the example text
        const text = el.textContent.replace(/^["']|["']$/g, '');
        userInput.value = text;
        userInput.focus();
    });
});

// --- Database Status Management ---
function updateDatabaseStatus(filename = null) {
    if (filename) {
        databaseLoaded = true;
        userInput.disabled = false;
        userInput.placeholder = 'Ask a question about your database...';
        sendButton.disabled = false;
        if (schemaDiagramButton) schemaDiagramButton.disabled = false;
    } else {
        databaseLoaded = false;
        userInput.disabled = true;
        userInput.placeholder = 'Load a database to start chatting...';
        sendButton.disabled = true;
        if (schemaDiagramButton) schemaDiagramButton.disabled = true;
    }
}

// --- Chat Input History ---
const inputHistory = [];
let historyIndex = -1;
let currentDraft = '';

// --- Event Listeners ---


if (sendButton) {
    sendButton.addEventListener('click', function() {
        sendMessage();
    });
}

if (userInput) {
    // Auto-grow textarea as content changes
    function autoGrowTextarea() {
        userInput.style.height = 'auto';
        userInput.style.height = Math.min(userInput.scrollHeight, 160) + 'px';
        userInput.style.overflowY = userInput.scrollHeight > 160 ? 'auto' : 'hidden';
    }

    userInput.addEventListener('input', autoGrowTextarea);

    // Enter sends, Shift+Enter adds newline, Up/Down for history
    userInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
            return;
        }

        // Up arrow: navigate backward through history (only when at first line)
        if (e.key === 'ArrowUp' && inputHistory.length > 0) {
            const beforeCursor = userInput.value.substring(0, userInput.selectionStart);
            if (!beforeCursor.includes('\n')) {
                e.preventDefault();
                if (historyIndex === -1) {
                    currentDraft = userInput.value;
                    historyIndex = inputHistory.length - 1;
                } else if (historyIndex > 0) {
                    historyIndex--;
                }
                userInput.value = inputHistory[historyIndex];
                autoGrowTextarea();
            }
        }

        // Down arrow: navigate forward through history (only when at last line)
        if (e.key === 'ArrowDown' && historyIndex !== -1) {
            const afterCursor = userInput.value.substring(userInput.selectionStart);
            if (!afterCursor.includes('\n')) {
                e.preventDefault();
                if (historyIndex < inputHistory.length - 1) {
                    historyIndex++;
                    userInput.value = inputHistory[historyIndex];
                } else {
                    historyIndex = -1;
                    userInput.value = currentDraft;
                }
                autoGrowTextarea();
            }
        }
    });
}

// File Input Change
if (databaseFile) {
    databaseFile.addEventListener('change', () => {
        handleFiles(databaseFile.files);
    });
}

// Drag and Drop Events
if (dropZone) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });

    function highlight(e) {
        dropZone.classList.add('drag-over');
    }

    function unhighlight(e) {
        dropZone.classList.remove('drag-over');
    }

    dropZone.addEventListener('drop', handleDrop, false);
}

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    
    if (files.length > 0) {
        databaseFile.files = files; // Assign to input for consistency
        handleFiles(files);
    }
}

function handleFiles(files) {
    if (files.length > 0) {
        fileNameDisplay.textContent = files[0].name;
        // Auto-upload on file selection
        uploadFile();
    } else {
        fileNameDisplay.textContent = 'No file chosen';
    }
}

if (uploadForm) {
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();
        uploadFile();
    });
}

if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        const isExpanded = !sidebar.classList.contains('collapsed');
        sidebarToggle.setAttribute('aria-expanded', isExpanded);
    });
}

const exportChatButton = document.getElementById('export-chat-button');
if (exportChatButton) {
    exportChatButton.addEventListener('click', () => {
        fetch('/export_chat')
            .then(response => {
                if (!response.ok) throw new Error('Network response was not ok');
                return response.blob();
            })
            .then(blob => {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = 'chat_export.html';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                a.remove();
            })
            .catch(error => {
                console.error('Error exporting chat:', error);
                showAlertModal('Export Error', 'Error exporting chat. Please try again.');
            });
    });
}

// --- Search All Tables ---
const searchAllTablesButton = document.getElementById('search-all-tables-button');
if (searchAllTablesButton) {
    searchAllTablesButton.addEventListener('click', () => {
        showSearchModal();
    });
}

if (schemaDiagramButton) {
    schemaDiagramButton.addEventListener('click', () => {
        showERDiagramModal();
    });
}

function showSearchModal() {
    // Remove existing modal if any
    const existing = document.getElementById('search-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'search-modal';
    modal.className = 'search-modal-overlay';
    modal.innerHTML = `
        <div class="search-modal" role="dialog" aria-modal="true" aria-labelledby="search-modal-title">
            <div class="search-modal-header">
                <h3 id="search-modal-title">Search All Tables</h3>
                <button class="search-modal-close">&times;</button>
            </div>
            <div class="search-modal-body">
                <div class="search-input-row">
                    <input type="text" id="search-term-input" placeholder="Enter search term..." autofocus>
                    <button id="execute-search-btn">Search</button>
                </div>
                <div class="search-options-row">
                    <label class="match-case-toggle">
                        <input type="checkbox" id="match-case-checkbox">
                        <span class="toggle-box"></span>
                        Match case
                    </label>
                </div>
                <div id="search-results-container"></div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => {
        document.removeEventListener('keydown', escHandler);
        modal.remove();
    };

    // Event listeners
    modal.querySelector('.search-modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Escape key closes modal
    const escHandler = (e) => {
        if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', escHandler);

    const searchInput = modal.querySelector('#search-term-input');
    const searchBtn = modal.querySelector('#execute-search-btn');
    const caseSensitive = modal.querySelector('#match-case-checkbox');

    searchBtn.addEventListener('click', () => executeTableSearch(searchInput.value, caseSensitive.checked));
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') executeTableSearch(searchInput.value, caseSensitive.checked);
    });

    searchInput.focus();
}

async function executeTableSearch(searchTerm, caseSensitive = false) {
    if (!searchTerm.trim()) {
        showAlertModal('Search', 'Please enter a search term.');
        return;
    }

    const resultsContainer = document.getElementById('search-results-container');
    resultsContainer.innerHTML = '<div class="search-loading">Searching...</div>';

    try {
        const response = await fetch('/search_all_tables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ search_term: searchTerm, case_sensitive: caseSensitive })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Search failed');
        }

        const data = await response.json();
        renderSearchResults(data, searchTerm, resultsContainer, caseSensitive);

    } catch (error) {
        console.error('Search error:', error);
        resultsContainer.innerHTML = `<div class="search-error">Error: ${escapeHtml(error.message)}</div>`;
    }
}

function renderSearchResults(data, searchTerm, container, caseSensitive = false) {
    if (data.total_matches === 0) {
        container.innerHTML = `<div class="search-no-results">No matches found for "${escapeHtml(searchTerm)}"</div>`;
        return;
    }

    let html = `<div class="search-summary">Found ${data.total_matches} matches in ${data.tables_with_matches} table(s)</div>`;

    for (const [tableName, tableData] of Object.entries(data.results)) {
        const moreCount = tableData.total_matches > 3 ? tableData.total_matches - 3 : 0;
        const safeTableName = escapeHtml(tableName);

        html += `<div class="search-table-card">`;
        html += `<div class="search-table-title">${safeTableName}</div>`;

        // Build column entries
        for (const [colName, values] of Object.entries(tableData.columns)) {
            const safeColName = escapeHtml(colName);

            // Escape values first, then highlight search term
            const highlightedValues = values.map(val => {
                const safeVal = escapeHtml(val);
                const safeSearchTerm = escapeHtml(searchTerm);
                const regex = caseSensitive
                    ? new RegExp(safeSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
                    : new RegExp(safeSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                return safeVal.replace(regex, match => `<mark>${match}</mark>`);
            });

            html += `<div class="search-column-entry">`;
            html += `<span class="search-col-name">${safeColName}:</span> `;
            html += `<span class="search-col-values">${highlightedValues.join(', ')}</span>`;
            html += `</div>`;
        }

        // Show "and X more" if there are more matches
        if (moreCount > 0) {
            html += `<div class="search-more-indicator">...and ${moreCount} more matches</div>`;
        }

        html += `</div>`;
    }

    container.innerHTML = html;
}

// Warn user before reloading/closing if chat session is active
window.addEventListener('beforeunload', (e) => {
    // Check if there's an active chat session (chat messages exist)
    const chatMessages = document.querySelectorAll('.chat-message').length;

    if (chatMessages > 0) {
        // Standard way to trigger browser's confirmation dialog
        e.preventDefault();
        e.returnValue = ''; // Chrome requires returnValue to be set
        return ''; // Some browsers use the return value
    }
});

// --- Core Functions ---

async function sendMessage() {
    const message = userInput.value.trim();
    if (!message) return;

    // Minimize welcome screen and move it above the scrollable chat area
    if (welcomeScreen && !welcomeScreen.classList.contains('minimized')) {
        const chatContainer = chatHistory.parentElement;
        chatContainer.insertBefore(welcomeScreen, chatHistory);
        void welcomeScreen.offsetHeight; // force reflow so transition animates
        welcomeScreen.classList.add('minimized');
    }

    // Save to input history
    inputHistory.push(message);
    historyIndex = -1;
    currentDraft = '';

    appendMessage(message, 'user');
    userInput.value = '';
    userInput.style.height = 'auto';
    userInput.disabled = true;
    sendButton.disabled = true;
    sendButton.classList.add('sending');

    // Status Bar Shimmer
    const statusBar = document.getElementById('status-bar');
    const statusMessages = [
        'Reading schema\u2026',
        'Analyzing question\u2026',
        'Generating SQL\u2026',
        'Preparing response\u2026'
    ];
    // Shuffle messages so the starting message varies each time
    for (let i = statusMessages.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [statusMessages[i], statusMessages[j]] = [statusMessages[j], statusMessages[i]];
    }
    let statusIndex = 0;

    const statusEl = document.createElement('p');
    statusEl.className = 'status-shimmer';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'shimmer-icon';
    iconSpan.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

    const textSpan = document.createElement('span');
    textSpan.textContent = statusMessages[0];

    statusEl.appendChild(iconSpan);
    statusEl.appendChild(textSpan);
    statusBar.innerHTML = '';
    statusBar.appendChild(statusEl);
    statusBar.classList.add('active');
    const shimmerStart = Date.now();

    const shimmerInterval = setInterval(() => {
        statusIndex = (statusIndex + 1) % statusMessages.length;
        textSpan.textContent = statusMessages[statusIndex];
        const duration = 1.8 + Math.random() * 0.7;
        statusEl.style.setProperty('--shimmer-duration', duration.toFixed(2) + 's');
    }, 3500);

    // Bot message container (created now but empty until streaming)
    const botMessageElement = appendMessage('', 'bot');
    const contentContainer = botMessageElement.querySelector('.content-container');
    const pText = document.createElement('p');
    contentContainer.appendChild(pText);

    // Abort previous stream if still active (rapid send protection)
    if (activeStreamController) {
        activeStreamController.abort();
    }
    const controller = new AbortController();
    activeStreamController = controller;
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s watchdog

    try {
        const response = await fetch('/chat_stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                provider: currentProvider
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            clearTimeout(timeoutId); // Clear timeout on error response
            const errData = await response.json();
            throw new Error(errData.error || `HTTP Error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedText = '';
        let fullResponse = '';
        let tokenUsage = null;  // Track token usage
        let firstChunk = true;
        let streamComplete = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            if (firstChunk) {
                clearTimeout(timeoutId);
                firstChunk = false;
            }

            const chunk = decoder.decode(value, { stream: true });
            const endToken = '<|END_OF_STREAM|>';
            const tokenToken = '<|TOKEN_USAGE|>';

            if (chunk.includes(endToken)) {
                streamComplete = true;
                const parts = chunk.split(endToken);
                accumulatedText += parts[0];

                // Check if token usage data is present
                const metadata = parts[1];
                if (metadata.includes(tokenToken)) {
                    const metaParts = metadata.split(tokenToken);
                    fullResponse = metaParts[0];
                    try {
                        tokenUsage = JSON.parse(metaParts[1]);
                    } catch (e) {
                        console.warn('Failed to parse token usage:', e);
                        tokenUsage = null;
                    }
                } else {
                    // Backward compatibility: No token data
                    fullResponse = metadata;
                }
                break;
            } else {
                accumulatedText += chunk;
            }

            renderText(pText, accumulatedText);
            chatHistory.scrollTop = chatHistory.scrollHeight;
        }

        if (!streamComplete) {
            throw new Error("Connection to LLM timed out or was interrupted.");
        }

        // Final render
        renderText(pText, accumulatedText);

        // Dismiss status bar (with minimum display time)
        clearInterval(shimmerInterval);
        const elapsed = Date.now() - shimmerStart;
        const remaining = Math.max(0, 2500 - elapsed);
        setTimeout(() => {
            statusBar.classList.remove('active');
        }, remaining);

        // Add token counter to chat bubble if usage data available
        if (tokenUsage) {
            addTokenCounter(contentContainer, tokenUsage);
        }

        // SAVE THE ASSISTANT MESSAGE TO SESSION (with token usage)
        const saveResponse = await fetch('/save_assistant_message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: fullResponse,
                token_usage: tokenUsage  // Include token data
            }),
        });
        const saveData = await saveResponse.json();

        // Enable annotation if message ID is returned
        if (saveData.message_id) {
            enableAnnotation(contentContainer, saveData.message_id);
        }

        // Execute SQL if present
        await executeSqlAndRender(fullResponse, contentContainer);

    } catch (error) {
        console.error('Chat Error:', error);
        // Spinner removal is now handled in finally block for safety

        // Create error container with proper styling
        const errorDiv = document.createElement('div');
        errorDiv.className = 'chat-error-message';
        errorDiv.setAttribute('role', 'alert');

        const errorIcon = document.createElement('span');
        errorIcon.className = 'error-icon';
        errorIcon.textContent = '⚠';

        const errorContent = document.createElement('div');
        errorContent.className = 'error-content';

        const errorTitle = document.createElement('strong');
        const errorDetails = document.createElement('div');
        errorDetails.className = 'error-details';

        if (error.name === 'AbortError') {
            errorTitle.textContent = 'Request Timed Out';
            errorDetails.textContent = `The ${currentProvider === 'ollama' ? 'Ollama' : 'LM Studio'} server did not respond within 15 seconds.`;
        } else if (error.message.includes("503") || error.message.includes("Failed to fetch") || error.message.includes("LM Studio") || error.message.includes("Ollama")) {
            const isOllama = currentProvider === 'ollama';
            errorTitle.textContent = `Unable to connect to ${isOllama ? 'Ollama' : 'LM Studio'}`;

            const helpList = document.createElement('ol');
            const helpItems = isOllama
                ? ['Is Ollama running? (ollama serve)', 'Is a model pulled? (ollama pull llama3.2)', 'Check port 11434 is accessible']
                : ['Is LM Studio running? (Green bar at top)', 'Is the port set to 1234?', 'Is a model loaded?'];

            helpItems.forEach(item => {
                const li = document.createElement('li');
                li.textContent = item;
                helpList.appendChild(li);
            });

            const helpText = document.createElement('span');
            helpText.textContent = `Please check ${isOllama ? 'Ollama' : 'LM Studio'}:`;
            errorDetails.appendChild(helpText);
            errorDetails.appendChild(helpList);
        } else {
            errorTitle.textContent = 'Error';
            errorDetails.textContent = error.message;
        }

        errorContent.appendChild(errorTitle);
        errorContent.appendChild(errorDetails);
        errorDiv.appendChild(errorIcon);
        errorDiv.appendChild(errorContent);

        pText.textContent = '';
        pText.appendChild(errorDiv);
    } finally {
        clearTimeout(timeoutId); // Ensure cleanup
        clearInterval(shimmerInterval);
        if (activeStreamController === controller) {
            activeStreamController = null;
        }
        statusBar.classList.remove('active');
        userInput.disabled = false;
        sendButton.disabled = false;
        sendButton.classList.remove('sending');
        userInput.focus();
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }
}

function renderText(element, text) {
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

function addCopyButtons(container) {
    const pres = container.querySelectorAll('pre');
    pres.forEach(pre => {
        // Check if there is a code block inside
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

async function executeSqlAndRender(fullText, contentContainer) {
    const sqlRegex = /```sql\n([\s\S]*?)\n```/;
    const match = fullText.match(sqlRegex);

    if (!match) return; // No SQL to execute

    const sqlQuery = match[1].trim();

    try {
        const response = await fetch('/execute_sql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql_query: sqlQuery }),
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'SQL Execution Failed');
        }

        const data = await response.json();

        // Show auto-corrected badge if retry happened
        if (data.retried) {
            const badge = document.createElement('details');
            badge.className = 'auto-corrected-badge';
            const summary = document.createElement('summary');
            summary.textContent = 'Auto-corrected';
            badge.appendChild(summary);
            const detail = document.createElement('div');
            detail.className = 'auto-corrected-detail';
            detail.innerHTML = `<strong>Original:</strong><pre><code>${escapeHtml(data.original_sql)}</code></pre><strong>Corrected:</strong><pre><code>${escapeHtml(data.corrected_sql)}</code></pre>`;
            badge.appendChild(detail);
            contentContainer.appendChild(badge);
        }

        // Render Result Table
        if (data.query_results && data.query_results.length > 0) {
            appendResultsTable(data.query_results, contentContainer, sqlQuery);
        } else {
            const emptyState = document.createElement('div');
            emptyState.className = 'sql-empty-state';

            const icon = document.createElement('span');
            icon.className = 'empty-icon';
            icon.textContent = '∅';

            const text = document.createElement('span');
            text.textContent = 'Query executed successfully. No results returned.';

            emptyState.appendChild(icon);
            emptyState.appendChild(text);
            contentContainer.appendChild(emptyState);
        }

    } catch (error) {
        console.error('SQL Error:', error);
        const errorDiv = document.createElement('div');
        errorDiv.className = 'sql-error-message';
        errorDiv.setAttribute('role', 'alert');

        const icon = document.createElement('span');
        icon.className = 'error-icon';
        icon.textContent = '⚠';

        const text = document.createElement('span');
        text.textContent = `SQL Execution Error: ${error.message}`;

        errorDiv.appendChild(icon);
        errorDiv.appendChild(text);
        contentContainer.appendChild(errorDiv);
    }
}

function appendResultsTable(queryResults, container, sqlQuery = '') {
    if (typeof gridjs === 'undefined') {
        console.error("Grid.js not loaded");
        return;
    }

    // Row count + chart button row
    const actionsRow = document.createElement('div');
    actionsRow.className = 'results-actions-row';

    const rowCountLabel = document.createElement('span');
    rowCountLabel.className = 'results-row-count';
    rowCountLabel.textContent = `${queryResults.length} rows returned`;
    actionsRow.appendChild(rowCountLabel);

    // CSV export button
    const actionsRight = document.createElement('div');
    actionsRight.className = 'results-actions-right';

    const csvBtn = document.createElement('button');
    csvBtn.className = 'csv-export-btn';
    csvBtn.textContent = 'CSV';
    csvBtn.title = 'Download results as CSV';
    csvBtn.setAttribute('aria-label', 'Download results as CSV');
    csvBtn.addEventListener('click', () => {
        downloadCSV(queryResults);
    });
    actionsRight.appendChild(csvBtn);

    if (typeof Chart !== 'undefined' && queryResults.length > 0) {
        const chartBtn = document.createElement('button');
        chartBtn.className = 'chart-toggle-btn';
        chartBtn.innerHTML = chartIconSVG() + ' Chart';
        chartBtn.title = 'Visualize as chart';
        chartBtn.setAttribute('aria-label', 'Toggle chart visualization');
        actionsRight.appendChild(chartBtn);

        chartBtn.addEventListener('click', () => {
            toggleChart(queryResults, container, chartBtn);
        });
    }

    actionsRow.appendChild(actionsRight);
    container.appendChild(actionsRow);

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'results-table-container';
    container.appendChild(tableWrapper);

    // Render Grid.js with built-in search
    new gridjs.Grid({
        columns: Object.keys(queryResults[0]),
        data: queryResults.map(row => Object.values(row)),
        pagination: { limit: 10, summary: true },
        search: { placeholder: 'Filter results...' },
        sort: { multiColumn: true },
        resizable: true,
        style: {
            table: { 'white-space': 'nowrap', 'font-size': '0.85rem', 'table-layout': 'auto', 'width': '100%' },
            th: { 'background-color': 'var(--background-lighter)', 'color': 'var(--foreground)', 'border': '1px solid var(--border)' },
            td: { 'background-color': 'var(--background-light)', 'color': 'var(--foreground)', 'border': '1px solid var(--border)' },
            footer: { 'background-color': 'var(--card)' }
        },
        className: { table: 'custom-grid-table', th: 'custom-grid-th', td: 'custom-grid-td', container: 'custom-grid-container' }
    }).render(tableWrapper);

    // Reset scroll on pagination to prevent sticky header clipping
    tableWrapper.addEventListener('click', (e) => {
        if (e.target.closest('.gridjs-pagination button')) {
            const wrapper = tableWrapper.querySelector('.gridjs-wrapper');
            if (wrapper) wrapper.scrollTop = 0;
        }
    });
}

// --- CSV Export ---

function downloadCSV(queryResults) {
    if (!queryResults || queryResults.length === 0) return;

    const columns = Object.keys(queryResults[0]);

    // RFC 4180: escape fields containing commas, quotes, or newlines
    const escapeField = (val) => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    };

    const header = columns.map(escapeField).join(',');
    const rows = queryResults.map(row =>
        columns.map(col => escapeField(row[col])).join(',')
    );
    const csv = header + '\n' + rows.join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'query_results.csv';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
}

// --- Chart Visualization ---

function chartIconSVG() {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="12" width="4" height="9"></rect><rect x="10" y="7" width="4" height="14"></rect><rect x="17" y="3" width="4" height="18"></rect></svg>';
}

function detectChartType(queryResults) {
    if (!queryResults || queryResults.length === 0) return null;

    const columns = Object.keys(queryResults[0]);
    if (columns.length < 2) return null;

    // Classify columns as numeric or text
    const colTypes = {};
    for (const col of columns) {
        const sampleValues = queryResults.slice(0, 50).map(row => row[col]).filter(v => v !== null && v !== '');
        const numericCount = sampleValues.filter(v => typeof v === 'number' || (!isNaN(Number(v)) && String(v).trim() !== '')).length;
        colTypes[col] = (numericCount / Math.max(sampleValues.length, 1)) > 0.7 ? 'numeric' : 'text';
    }

    const numericCols = columns.filter(c => colTypes[c] === 'numeric');
    const textCols = columns.filter(c => colTypes[c] === 'text');

    // 1 text/date column + 1+ numeric columns → bar
    if (textCols.length === 1 && numericCols.length >= 1) {
        return { type: 'bar', labelCol: textCols[0], dataCols: numericCols };
    }

    // 2 columns, both numeric → scatter
    if (columns.length === 2 && numericCols.length === 2) {
        return { type: 'scatter', xCol: numericCols[0], yCol: numericCols[1], dataCols: numericCols };
    }

    // 1 text + 1 numeric, ≤20 rows → pie
    if (textCols.length === 1 && numericCols.length === 1 && queryResults.length <= 20) {
        return { type: 'pie', labelCol: textCols[0], dataCols: numericCols };
    }

    // Multiple numeric + at least 1 text → bar with first text as labels
    if (numericCols.length >= 1 && textCols.length >= 1) {
        return { type: 'bar', labelCol: textCols[0], dataCols: numericCols };
    }

    // 2+ numeric, no text → use row index
    if (numericCols.length >= 2) {
        return { type: 'bar', labelCol: null, dataCols: numericCols };
    }

    return null;
}

function toggleChart(queryResults, container, chartBtn) {
    const existingChart = container.querySelector('.chart-container');
    if (existingChart) {
        const canvas = existingChart.querySelector('canvas');
        if (canvas) {
            const inst = Chart.getChart(canvas);
            if (inst) inst.destroy();
        }
        existingChart.remove();
        chartBtn.classList.remove('active');
        return;
    }

    const detection = detectChartType(queryResults);
    if (!detection) {
        const msg = document.createElement('div');
        msg.className = 'chart-not-suitable';
        msg.textContent = 'Data not suitable for charting. Need at least 1 label column and 1 numeric column.';
        container.appendChild(msg);
        setTimeout(() => msg.remove(), 4000);
        return;
    }

    chartBtn.classList.add('active');

    const chartContainer = document.createElement('div');
    chartContainer.className = 'chart-container';

    // Store data for theme updates
    chartContainer._chartData = { queryResults, detection };

    const typeSelector = document.createElement('div');
    typeSelector.className = 'chart-type-selector';
    const types = ['bar', 'line', 'pie', 'scatter'];
    types.forEach(type => {
        const btn = document.createElement('button');
        btn.className = 'chart-type-btn' + (type === detection.type ? ' active' : '');
        btn.textContent = type.charAt(0).toUpperCase() + type.slice(1);
        btn.addEventListener('click', () => {
            typeSelector.querySelectorAll('.chart-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderChart(canvas, queryResults, detection, type);
        });
        typeSelector.appendChild(btn);
    });
    chartContainer.appendChild(typeSelector);

    const canvas = document.createElement('canvas');
    canvas.className = 'chart-canvas';
    chartContainer.appendChild(canvas);

    container.appendChild(chartContainer);
    renderChart(canvas, queryResults, detection, detection.type);
}

function renderChart(canvas, queryResults, detection, chartType) {
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

    const gridColor = isDark ? 'rgba(42, 42, 58, 0.8)' : 'rgba(200, 200, 208, 0.8)';
    const textColor = isDark ? '#8a8a9a' : '#4a4a5a';
    const legendColor = isDark ? '#e8e8ec' : '#1a1a24';

    const palette = isDark
        ? ['#f0a030', '#40d0d0', '#40c060', '#e0a020', '#a070e0', '#4090f0', '#e06060', '#60e0a0']
        : ['#b06800', '#006868', '#30a050', '#b07800', '#7050b0', '#3070c0', '#c04040', '#40b080'];

    let labels;
    if (detection.labelCol) {
        labels = queryResults.map(row => {
            const val = row[detection.labelCol];
            return String(val).length > 25 ? String(val).substring(0, 22) + '...' : String(val);
        });
    } else {
        labels = queryResults.map((_, i) => `Row ${i + 1}`);
    }

    let datasets;
    if (chartType === 'scatter') {
        const xCol = detection.dataCols[0];
        const yCol = detection.dataCols[1];
        datasets = [{
            label: `${xCol} vs ${yCol}`,
            data: queryResults.map(row => ({
                x: Number(row[xCol]) || 0,
                y: Number(row[yCol]) || 0
            })),
            backgroundColor: palette[0] + '80',
            borderColor: palette[0],
            pointRadius: 4
        }];
    } else if (chartType === 'pie') {
        datasets = [{
            data: queryResults.map(row => Number(row[detection.dataCols[0]]) || 0),
            backgroundColor: palette.slice(0, queryResults.length).map(c => c + 'cc'),
            borderColor: palette.slice(0, queryResults.length),
            borderWidth: 1
        }];
    } else {
        datasets = detection.dataCols.map((col, i) => ({
            label: col,
            data: queryResults.map(row => Number(row[col]) || 0),
            backgroundColor: palette[i % palette.length] + '80',
            borderColor: palette[i % palette.length],
            borderWidth: chartType === 'line' ? 2 : 1,
            tension: chartType === 'line' ? 0.3 : 0
        }));
    }

    const config = {
        type: chartType === 'pie' ? 'pie' : chartType,
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            plugins: {
                legend: {
                    display: datasets.length > 1 || chartType === 'pie',
                    labels: { color: legendColor, font: { family: "'JetBrains Mono', monospace", size: 11 } }
                },
                tooltip: {
                    backgroundColor: isDark ? '#1a1a24' : '#ffffff',
                    titleColor: isDark ? '#f0a030' : '#b06800',
                    bodyColor: textColor,
                    borderColor: isDark ? '#2a2a3a' : '#c8c8d0',
                    borderWidth: 1,
                    titleFont: { family: "'JetBrains Mono', monospace" },
                    bodyFont: { family: "'IBM Plex Sans', sans-serif" }
                }
            },
            scales: (chartType === 'pie') ? {} : {
                x: {
                    ticks: { color: textColor, font: { family: "'JetBrains Mono', monospace", size: 10 }, maxRotation: 45 },
                    grid: { color: gridColor }
                },
                y: {
                    ticks: { color: textColor, font: { family: "'JetBrains Mono', monospace", size: 10 } },
                    grid: { color: gridColor },
                    beginAtZero: true
                }
            }
        }
    };

    new Chart(canvas, config);
}

function updateChartsForTheme() {
    document.querySelectorAll('.chart-container').forEach(chartContainer => {
        const data = chartContainer._chartData;
        if (!data) return;
        const canvas = chartContainer.querySelector('canvas');
        if (!canvas) return;
        const activeBtn = chartContainer.querySelector('.chart-type-btn.active');
        const chartType = activeBtn ? activeBtn.textContent.toLowerCase() : data.detection.type;
        renderChart(canvas, data.queryResults, data.detection, chartType);
    });
}


function addTokenCounter(containerElement, tokenUsage) {
    // Remove existing token counter if present (for updates)
    const existingCounter = containerElement.querySelector('.token-counter');
    if (existingCounter) {
        existingCounter.remove();
    }

    const promptTokens = tokenUsage.prompt_tokens || 0;
    const completionTokens = tokenUsage.completion_tokens || 0;
    const totalTokens = tokenUsage.total_tokens || 0;

    // Calculate cumulative total from all bot messages
    let cumulativeTotal = 0;
    document.querySelectorAll('.bot-message .token-counter').forEach(counter => {
        const existingTokens = parseInt(counter.getAttribute('data-tokens')) || 0;
        cumulativeTotal += existingTokens;
    });
    cumulativeTotal += totalTokens;

    // Create token counter element
    const tokenCounter = document.createElement('div');
    tokenCounter.className = 'token-counter';
    tokenCounter.setAttribute('data-tokens', totalTokens);

    const tokenSpan = document.createElement('span');
    tokenSpan.textContent = `${totalTokens} tokens (${cumulativeTotal} total)`;
    tokenSpan.title = `Prompt: ${promptTokens} | Completion: ${completionTokens}`;

    tokenCounter.appendChild(tokenSpan);

    // Insert as first child of content container
    containerElement.insertBefore(tokenCounter, containerElement.firstChild);
}


function appendMessage(message, sender) {
    const div = document.createElement('div');
    div.className = `chat-message ${sender}-message`;
    
    let contentDiv;
    if (sender === 'user') {
        const p = document.createElement('p');
        p.textContent = message;
        div.appendChild(p);
        contentDiv = div;
    } else {
        contentDiv = document.createElement('div');
        contentDiv.className = 'content-container';
        div.appendChild(contentDiv);
        
        // Fix: Actually render the message text if provided (e.g. for upload success message)
        if (message) {
            const p = document.createElement('p');
            p.textContent = message;
            contentDiv.appendChild(p);
        }
    }
    
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    return div;
}

function uploadFile() {
    const file = databaseFile.files[0];
    if (!file) {
        showAlertModal('No File Selected', 'Please select a database file first.');
        return;
    }

    // --- File Size Validation ---
    const fileSizeMB = file.size / (1024 * 1024);

    if (fileSizeMB > 1024) { // > 1GB
        showAlertModal('File Too Large', 'File is over 1GB. Please use a smaller subset for analysis.');
        return;
    }

    // Check for existing chat history (excluding welcome screen)
    const hasHistory = chatHistory.querySelectorAll('.chat-message').length > 0;

    const doUpload = () => {
        const formData = new FormData();
        formData.append('database_file', file);

        // Minimize welcome screen and move it above the scrollable chat area
        if (welcomeScreen && !welcomeScreen.classList.contains('minimized')) {
            const chatContainer = chatHistory.parentElement;
            chatContainer.insertBefore(welcomeScreen, chatHistory);
            void welcomeScreen.offsetHeight; // force reflow so transition animates
            welcomeScreen.classList.add('minimized');
        }

        // Destroy Chart.js instances before clearing chat
        document.querySelectorAll('.chart-container canvas').forEach(canvas => {
            const inst = Chart.getChart(canvas);
            if (inst) inst.destroy();
        });

        // Remove all chat messages but keep the welcome screen if it exists
        const messages = chatHistory.querySelectorAll('.chat-message');
        messages.forEach(msg => msg.remove());

        // Show upload progress indicator
        if (dropZone) {
            dropZone.classList.add('uploading');
            fileNameDisplay.textContent = `Uploading ${file.name}...`;
        }

        fetch('/upload', {
            method: 'POST',
            body: formData,
        })
        .then(response => response.json())
        .then(data => {
            // Hide upload progress
            if (dropZone) dropZone.classList.remove('uploading');

            if (data.error) {
                fileNameDisplay.textContent = file.name;
                showAlertModal('Upload Error', data.error);
            } else {
                appendMessage('Database loaded successfully. You can now ask questions about it.', 'bot');
                renderSchema(data.schema);
                updateDatabaseStatus(file.name);
                fileNameDisplay.textContent = file.name;
            }
        })
        .catch(error => {
            // Hide upload progress
            if (dropZone) dropZone.classList.remove('uploading');
            fileNameDisplay.textContent = file.name;

            console.error('Error:', error);
            showAlertModal('Upload Error', 'An error occurred during file upload.');
        });
    };

    // Chain confirmations as needed
    if (fileSizeMB > 100) {
        showConfirmModal(
            'Large File Warning',
            `This file is ${fileSizeMB.toFixed(1)} MB. Uploading and processing might take a moment.`,
            () => {
                if (hasHistory) {
                    showConfirmModal(
                        'Replace Database',
                        'A database is already loaded. Uploading a new one will clear the chat history.',
                        doUpload
                    );
                } else {
                    doUpload();
                }
            }
        );
    } else if (hasHistory) {
        showConfirmModal(
            'Replace Database',
            'A database is already loaded. Uploading a new one will clear the chat history.',
            doUpload
        );
    } else {
        doUpload();
    }
}

function renderSchema(schema) {
    const tableCount = Object.keys(schema).length;
    schemaDisplay.innerHTML = `<h3>Database Schema <span class="schema-table-count">(${tableCount} tables)</span></h3>`;

    for (const table in schema) {
        const tableElement = document.createElement('div');
        tableElement.className = 'schema-table';

        const tableHeader = document.createElement('h4');
        tableHeader.className = 'schema-table-header';
        tableHeader.innerHTML = `<span class="schema-toggle-icon">▶</span> ${escapeHtml(table)} <span class="schema-column-count">${schema[table].length}</span>`;
        tableHeader.addEventListener('click', () => {
            tableElement.classList.toggle('expanded');
        });

        const columnsList = document.createElement('ul');
        columnsList.className = 'schema-columns';
        schema[table].forEach(column => {
            const columnItem = document.createElement('li');
            columnItem.textContent = column;
            columnsList.appendChild(columnItem);
        });

        tableElement.appendChild(tableHeader);
        tableElement.appendChild(columnsList);
        schemaDisplay.appendChild(tableElement);
    }
}

function enableAnnotation(container, messageId) {
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'message-controls';

    const addNoteBtn = document.createElement('button');
    addNoteBtn.className = 'add-note-btn';
    addNoteBtn.textContent = '+ Add Note';

    addNoteBtn.onclick = () => {
        addNoteBtn.style.display = 'none';
        showNoteEditor(controlsDiv, messageId);
    };

    controlsDiv.appendChild(addNoteBtn);
    container.appendChild(controlsDiv);
}

function showNoteEditor(container, messageId, initialText = '') {
    const editorDiv = document.createElement('div');
    editorDiv.className = 'note-editor';

    const textarea = document.createElement('textarea');
    textarea.className = 'note-editor-textarea';
    textarea.placeholder = "Enter forensic note...";
    textarea.value = initialText;

    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'note-editor-buttons';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'note-editor-save';
    saveBtn.textContent = 'Save Note';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'note-editor-cancel';
    cancelBtn.textContent = 'Cancel';

    cancelBtn.onclick = () => {
        editorDiv.remove();
        container.querySelector('.add-note-btn').style.display = 'inline-block';
    };

    saveBtn.onclick = () => {
        const noteContent = textarea.value.trim();
        if (!noteContent) return;

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        fetch('/add_note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message_id: messageId, note_content: noteContent })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                editorDiv.remove();
                renderNote(container, noteContent, messageId);
            } else {
                showAlertModal('Save Error', 'Error saving note: ' + (data.error || 'Unknown error'));
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Note';
            }
        })
        .catch(err => {
            console.error(err);
            showAlertModal('Network Error', 'Failed to save note. Please try again.');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Note';
        });
    };

    buttonsDiv.appendChild(cancelBtn);
    buttonsDiv.appendChild(saveBtn);
    editorDiv.appendChild(textarea);
    editorDiv.appendChild(buttonsDiv);
    container.appendChild(editorDiv);
}

function renderNote(container, text, messageId) {
    // Remove existing note if any
    const existing = container.parentNode.querySelector('.forensic-note');
    if (existing) existing.remove();

    const noteDiv = document.createElement('div');
    noteDiv.className = 'forensic-note';

    const label = document.createElement('strong');
    label.textContent = 'Analyst Note: ';
    noteDiv.appendChild(label);

    const textNode = document.createTextNode(text);
    noteDiv.appendChild(textNode);

    // Update the "Add Note" button to "Edit Note"
    const controls = container.querySelector('.add-note-btn');
    if (controls) {
        controls.textContent = 'Edit Note';
        controls.style.display = 'inline-block';

        controls.onclick = () => {
            controls.style.display = 'none';
            showNoteEditor(container, messageId, text);
        };
    }

    container.insertBefore(noteDiv, container.lastChild);
}

// --- Schema ER Diagram ---

async function showERDiagramModal() {
    const existing = document.getElementById('er-diagram-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'er-diagram-modal';
    modal.className = 'er-modal-overlay';
    modal.innerHTML = `
        <div class="er-modal" role="dialog" aria-modal="true" aria-labelledby="er-modal-title">
            <div class="er-modal-header">
                <h3 id="er-modal-title">Schema Diagram</h3>
                <button class="er-modal-close" aria-label="Close diagram">&times;</button>
            </div>
            <div class="er-modal-body">
                <div class="er-loading">Loading schema...</div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => {
        document.removeEventListener('keydown', escHandler);
        modal.remove();
    };

    modal.querySelector('.er-modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    const escHandler = (e) => {
        if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', escHandler);

    modal.querySelector('.er-modal-close').focus();

    try {
        const response = await fetch('/api/schema/diagram');
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to load schema');
        }
        const schemaData = await response.json();

        if (schemaData.tables.length === 0) {
            modal.querySelector('.er-modal-body').innerHTML =
                '<div class="er-empty">No tables found in the database.</div>';
            return;
        }

        renderERDiagram(schemaData, modal.querySelector('.er-modal-body'));

    } catch (error) {
        console.error('ER diagram error:', error);
        modal.querySelector('.er-modal-body').innerHTML =
            `<div class="er-error">Error: ${escapeHtml(error.message)}</div>`;
    }
}

function layoutTables(tables, relationships, width, height) {
    const tableCount = tables.length;
    const positions = [];

    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.35;

    for (let i = 0; i < tableCount; i++) {
        const angle = (2 * Math.PI * i) / tableCount;
        positions.push({
            x: centerX + radius * Math.cos(angle),
            y: centerY + radius * Math.sin(angle),
            vx: 0,
            vy: 0
        });
    }

    // Build adjacency lookup
    const adjacency = new Set();
    relationships.forEach(rel => {
        const fromIdx = tables.findIndex(t => t.name === rel.from_table);
        const toIdx = tables.findIndex(t => t.name === rel.to_table);
        if (fromIdx >= 0 && toIdx >= 0) {
            adjacency.add(`${fromIdx}-${toIdx}`);
            adjacency.add(`${toIdx}-${fromIdx}`);
        }
    });

    // Estimate table dimensions
    const tableDims = tables.map(t => ({
        w: Math.max(160, Math.max(t.name.length * 9, ...t.columns.map(c => (c.name.length + c.type.length + 2) * 7)) + 40),
        h: 32 + t.columns.length * 20 + 10
    }));

    // Force-directed simulation
    const iterations = 150;
    for (let iter = 0; iter < iterations; iter++) {
        const damping = 0.85;
        const temp = 1 - (iter / iterations);

        for (let i = 0; i < tableCount; i++) {
            let fx = 0, fy = 0;

            for (let j = 0; j < tableCount; j++) {
                if (i === j) continue;

                const dx = positions[i].x - positions[j].x;
                const dy = positions[i].y - positions[j].y;
                const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);

                // Repulsion
                const repulse = 50000 / (dist * dist);
                fx += (dx / dist) * repulse;
                fy += (dy / dist) * repulse;

                // Attraction for connected tables
                if (adjacency.has(`${i}-${j}`)) {
                    const idealDist = 250;
                    const attract = (dist - idealDist) * 0.05;
                    fx -= (dx / dist) * attract;
                    fy -= (dy / dist) * attract;
                }
            }

            // Centering force
            fx -= (positions[i].x - centerX) * 0.001;
            fy -= (positions[i].y - centerY) * 0.001;

            positions[i].vx = (positions[i].vx + fx) * damping * temp;
            positions[i].vy = (positions[i].vy + fy) * damping * temp;
        }

        for (let i = 0; i < tableCount; i++) {
            positions[i].x += positions[i].vx;
            positions[i].y += positions[i].vy;
        }
    }

    return positions.map((pos, i) => ({
        x: pos.x,
        y: pos.y,
        w: tableDims[i].w,
        h: tableDims[i].h
    }));
}

function renderERDiagram(schemaData, container) {
    container.innerHTML = '';

    const { tables, relationships } = schemaData;

    const svgWidth = Math.max(800, tables.length * 250);
    const svgHeight = Math.max(600, tables.length * 200);

    const layout = layoutTables(tables, relationships, svgWidth, svgHeight);

    // Calculate bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    layout.forEach(pos => {
        minX = Math.min(minX, pos.x - 40);
        minY = Math.min(minY, pos.y - 40);
        maxX = Math.max(maxX, pos.x + pos.w + 40);
        maxY = Math.max(maxY, pos.y + pos.h + 40);
    });

    const viewBoxW = maxX - minX;
    const viewBoxH = maxY - minY;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'er-svg');
    svg.setAttribute('viewBox', `${minX} ${minY} ${viewBoxW} ${viewBoxH}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');

    // Defs
    const defs = document.createElementNS(svgNS, 'defs');
    const marker = document.createElementNS(svgNS, 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('refX', '10');
    marker.setAttribute('refY', '3.5');
    marker.setAttribute('orient', 'auto');
    const arrow = document.createElementNS(svgNS, 'polygon');
    arrow.setAttribute('points', '0 0, 10 3.5, 0 7');
    arrow.setAttribute('class', 'er-arrow');
    marker.appendChild(arrow);
    defs.appendChild(marker);
    svg.appendChild(defs);

    // Relationship layer (behind tables)
    const relGroup = document.createElementNS(svgNS, 'g');
    relGroup.setAttribute('class', 'er-relationships');
    svg.appendChild(relGroup);

    // Table layer
    const tableGroup = document.createElementNS(svgNS, 'g');
    tableGroup.setAttribute('class', 'er-tables');
    svg.appendChild(tableGroup);

    const tableElements = [];

    // Render tables
    tables.forEach((table, i) => {
        const pos = layout[i];
        const g = document.createElementNS(svgNS, 'g');
        g.setAttribute('class', 'er-table-group');
        g.setAttribute('data-table', table.name);
        g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);

        const headerHeight = 32;
        const colHeight = 20;
        const bodyHeight = table.columns.length * colHeight + 8;
        const totalHeight = headerHeight + bodyHeight;
        const tableWidth = pos.w;

        g._erData = { x: pos.x, y: pos.y, w: tableWidth, h: totalHeight, table: table.name };

        // Full background rect (rounded)
        const bgRect = document.createElementNS(svgNS, 'rect');
        bgRect.setAttribute('x', 0);
        bgRect.setAttribute('y', 0);
        bgRect.setAttribute('width', tableWidth);
        bgRect.setAttribute('height', totalHeight);
        bgRect.setAttribute('rx', 6);
        bgRect.setAttribute('class', 'er-table-bg');
        g.appendChild(bgRect);

        // Header rect
        const headerRect = document.createElementNS(svgNS, 'rect');
        headerRect.setAttribute('x', 0);
        headerRect.setAttribute('y', 0);
        headerRect.setAttribute('width', tableWidth);
        headerRect.setAttribute('height', headerHeight);
        headerRect.setAttribute('rx', 6);
        headerRect.setAttribute('class', 'er-table-header');
        g.appendChild(headerRect);

        // Square off header bottom corners
        const headerFix = document.createElementNS(svgNS, 'rect');
        headerFix.setAttribute('x', 0);
        headerFix.setAttribute('y', headerHeight - 6);
        headerFix.setAttribute('width', tableWidth);
        headerFix.setAttribute('height', 6);
        headerFix.setAttribute('class', 'er-table-header');
        g.appendChild(headerFix);

        // Header text
        const headerText = document.createElementNS(svgNS, 'text');
        headerText.setAttribute('x', tableWidth / 2);
        headerText.setAttribute('y', 21);
        headerText.setAttribute('text-anchor', 'middle');
        headerText.setAttribute('class', 'er-table-name');
        headerText.textContent = table.name;
        g.appendChild(headerText);

        // Separator line
        const sep = document.createElementNS(svgNS, 'line');
        sep.setAttribute('x1', 0);
        sep.setAttribute('y1', headerHeight);
        sep.setAttribute('x2', tableWidth);
        sep.setAttribute('y2', headerHeight);
        sep.setAttribute('class', 'er-separator');
        g.appendChild(sep);

        // Columns
        table.columns.forEach((col, ci) => {
            const y = headerHeight + 4 + (ci + 1) * colHeight - 4;

            // PK indicator
            if (col.pk) {
                const pkText = document.createElementNS(svgNS, 'text');
                pkText.setAttribute('x', 8);
                pkText.setAttribute('y', y);
                pkText.setAttribute('class', 'er-pk-label');
                pkText.textContent = 'PK';
                g.appendChild(pkText);
            }

            // Check if this column is a FK
            const isFK = relationships.some(r => r.from_table === table.name && r.from_column === col.name);

            // Column name
            const colText = document.createElementNS(svgNS, 'text');
            colText.setAttribute('x', col.pk ? 30 : 12);
            colText.setAttribute('y', y);
            colText.setAttribute('class', 'er-col-name' + (isFK ? ' er-fk' : ''));
            colText.textContent = col.name;
            g.appendChild(colText);

            // Column type (right-aligned)
            const typeText = document.createElementNS(svgNS, 'text');
            typeText.setAttribute('x', tableWidth - 8);
            typeText.setAttribute('y', y);
            typeText.setAttribute('text-anchor', 'end');
            typeText.setAttribute('class', 'er-col-type');
            typeText.textContent = col.type;
            g.appendChild(typeText);
        });

        pos.h = totalHeight;
        tableGroup.appendChild(g);
        tableElements.push(g);
    });

    // Render relationship lines
    relationships.forEach(rel => {
        const fromEl = tableElements.find(el => el._erData.table === rel.from_table);
        const toEl = tableElements.find(el => el._erData.table === rel.to_table);
        if (!fromEl || !toEl) return;

        const from = fromEl._erData;
        const to = toEl._erData;

        const fromCX = from.x + from.w / 2;
        const fromCY = from.y + from.h / 2;
        const toCX = to.x + to.w / 2;
        const toCY = to.y + to.h / 2;

        let x1, y1, x2, y2;
        if (fromCX < toCX) {
            x1 = from.x + from.w; y1 = fromCY;
            x2 = to.x;            y2 = toCY;
        } else {
            x1 = from.x;          y1 = fromCY;
            x2 = to.x + to.w;     y2 = toCY;
        }

        const midX = (x1 + x2) / 2;
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
        path.setAttribute('class', 'er-relationship-line');
        path.setAttribute('marker-end', 'url(#arrowhead)');
        path.setAttribute('data-from', rel.from_table);
        path.setAttribute('data-to', rel.to_table);
        relGroup.appendChild(path);

        // Label at midpoint
        const label = document.createElementNS(svgNS, 'text');
        label.setAttribute('x', midX);
        label.setAttribute('y', (y1 + y2) / 2 - 6);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('class', 'er-rel-label');
        label.textContent = `${rel.from_column} \u2192 ${rel.to_column}`;
        relGroup.appendChild(label);
    });

    // No-FK notice
    if (relationships.length === 0) {
        const notice = document.createElementNS(svgNS, 'text');
        notice.setAttribute('x', minX + viewBoxW / 2);
        notice.setAttribute('y', minY + 20);
        notice.setAttribute('text-anchor', 'middle');
        notice.setAttribute('class', 'er-no-fk-notice');
        notice.textContent = 'No foreign key relationships declared in this database';
        svg.appendChild(notice);
    }

    container.appendChild(svg);
    initERInteractions(svg, tableElements);
}

function initERInteractions(svg, tableElements) {
    let dragTarget = null;
    let dragOffset = { x: 0, y: 0 };
    let isPanning = false;
    let panStart = { x: 0, y: 0 };
    let viewBoxStart = null;
    let highlightedTable = null;

    function getSVGPoint(e) {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        return pt.matrixTransform(svg.getScreenCTM().inverse());
    }

    // Table drag
    tableElements.forEach(g => {
        g.style.cursor = 'grab';

        g.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            dragTarget = g;
            const pt = getSVGPoint(e);
            dragOffset.x = pt.x - g._erData.x;
            dragOffset.y = pt.y - g._erData.y;
            g.style.cursor = 'grabbing';
            svg.style.cursor = 'grabbing';
        });
    });

    svg.addEventListener('mousemove', (e) => {
        if (dragTarget) {
            const pt = getSVGPoint(e);
            const newX = pt.x - dragOffset.x;
            const newY = pt.y - dragOffset.y;
            dragTarget.setAttribute('transform', `translate(${newX}, ${newY})`);
            dragTarget._erData.x = newX;
            dragTarget._erData.y = newY;
            updateRelationshipLines(svg, tableElements);
        } else if (isPanning) {
            const dx = (e.clientX - panStart.x) / svg.getScreenCTM().a;
            const dy = (e.clientY - panStart.y) / svg.getScreenCTM().d;
            const vb = viewBoxStart;
            svg.setAttribute('viewBox', `${vb[0] - dx} ${vb[1] - dy} ${vb[2]} ${vb[3]}`);
        }
    });

    svg.addEventListener('mouseup', () => {
        if (dragTarget) {
            dragTarget.style.cursor = 'grab';
            svg.style.cursor = 'default';
            dragTarget = null;
        }
        isPanning = false;
    });

    svg.addEventListener('mouseleave', () => {
        if (dragTarget) {
            dragTarget.style.cursor = 'grab';
            svg.style.cursor = 'default';
            dragTarget = null;
        }
        isPanning = false;
    });

    // Pan background
    svg.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target === svg || e.target.closest('.er-relationships')) {
            isPanning = true;
            panStart = { x: e.clientX, y: e.clientY };
            viewBoxStart = svg.getAttribute('viewBox').split(' ').map(Number);
        }
    });

    // Zoom
    svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const vb = svg.getAttribute('viewBox').split(' ').map(Number);
        const scale = e.deltaY > 0 ? 1.1 : 0.9;

        const pt = getSVGPoint(e);
        const newW = vb[2] * scale;
        const newH = vb[3] * scale;
        const newX = pt.x - (pt.x - vb[0]) * scale;
        const newY = pt.y - (pt.y - vb[1]) * scale;

        svg.setAttribute('viewBox', `${newX} ${newY} ${newW} ${newH}`);
    }, { passive: false });

    // Click table to highlight
    tableElements.forEach(g => {
        g.addEventListener('click', (e) => {
            if (dragTarget) return;
            e.stopPropagation();
            const tableName = g.getAttribute('data-table');

            if (highlightedTable === tableName) {
                clearERHighlight(svg);
                highlightedTable = null;
                return;
            }

            highlightedTable = tableName;
            highlightERTable(svg, tableName);
        });
    });

    // Click background to clear
    svg.addEventListener('click', (e) => {
        if (e.target === svg || e.target.closest('.er-relationships')) {
            clearERHighlight(svg);
            highlightedTable = null;
        }
    });
}

function updateRelationshipLines(svg, tableElements) {
    const lines = svg.querySelectorAll('.er-relationship-line');
    const labels = svg.querySelectorAll('.er-rel-label');

    lines.forEach((path, idx) => {
        const fromName = path.getAttribute('data-from');
        const toName = path.getAttribute('data-to');

        const fromEl = tableElements.find(el => el._erData.table === fromName);
        const toEl = tableElements.find(el => el._erData.table === toName);
        if (!fromEl || !toEl) return;

        const from = fromEl._erData;
        const to = toEl._erData;

        const fromCX = from.x + from.w / 2;
        const fromCY = from.y + from.h / 2;
        const toCX = to.x + to.w / 2;
        const toCY = to.y + to.h / 2;

        let x1, y1, x2, y2;
        if (fromCX < toCX) {
            x1 = from.x + from.w; y1 = fromCY;
            x2 = to.x;            y2 = toCY;
        } else {
            x1 = from.x;          y1 = fromCY;
            x2 = to.x + to.w;     y2 = toCY;
        }

        const midX = (x1 + x2) / 2;
        path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);

        if (labels[idx]) {
            labels[idx].setAttribute('x', midX);
            labels[idx].setAttribute('y', (y1 + y2) / 2 - 6);
        }
    });
}

function highlightERTable(svg, tableName) {
    svg.querySelectorAll('.er-table-group').forEach(g => {
        g.classList.add('er-dimmed');
        g.classList.remove('er-highlighted');
    });
    svg.querySelectorAll('.er-relationship-line').forEach(line => {
        line.classList.add('er-dimmed');
        line.classList.remove('er-highlighted');
    });
    svg.querySelectorAll('.er-rel-label').forEach(label => {
        label.classList.add('er-dimmed');
    });

    const targetGroup = svg.querySelector(`.er-table-group[data-table="${CSS.escape(tableName)}"]`);
    if (targetGroup) {
        targetGroup.classList.remove('er-dimmed');
        targetGroup.classList.add('er-highlighted');
    }

    svg.querySelectorAll('.er-relationship-line').forEach((line, idx) => {
        const from = line.getAttribute('data-from');
        const to = line.getAttribute('data-to');
        if (from === tableName || to === tableName) {
            line.classList.remove('er-dimmed');
            line.classList.add('er-highlighted');

            const connectedName = from === tableName ? to : from;
            const connGroup = svg.querySelector(`.er-table-group[data-table="${CSS.escape(connectedName)}"]`);
            if (connGroup) {
                connGroup.classList.remove('er-dimmed');
                connGroup.classList.add('er-highlighted');
            }

            const labels = svg.querySelectorAll('.er-rel-label');
            if (labels[idx]) {
                labels[idx].classList.remove('er-dimmed');
            }
        }
    });
}

function clearERHighlight(svg) {
    svg.querySelectorAll('.er-dimmed').forEach(el => el.classList.remove('er-dimmed'));
    svg.querySelectorAll('.er-highlighted').forEach(el => el.classList.remove('er-highlighted'));
}

// --- Service Worker Registration ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
        .catch(err => console.warn('SW registration failed:', err));
}
