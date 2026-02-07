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

// --- Pywebview Support ---
// Detect pywebview environment (check both at load and later when pywebview injects itself)
let isPywebview = typeof pywebview !== 'undefined';

// Pywebview file dialog support
function setupPywebviewFileDialog() {
    const chooseFileLabel = document.querySelector('label[for="database-file"]');
    if (!chooseFileLabel) return;

    chooseFileLabel.addEventListener('click', async (e) => {
        // Only intercept in pywebview
        if (typeof pywebview === 'undefined') return;

        e.preventDefault();
        e.stopPropagation();

        try {
            const filePath = await pywebview.api.open_file_dialog();
            if (filePath) {
                uploadFileFromPath(filePath);
            }
        } catch (err) {
            console.error('File dialog error:', err);
            showAlertModal('Error', 'Could not open file dialog');
        }
    });
}

function uploadFileFromPath(filePath) {
    const fileName = filePath.split(/[\\/]/).pop();
    fileNameDisplay.textContent = `Uploading ${fileName}...`;

    if (dropZone) dropZone.classList.add('uploading');
    if (welcomeScreen) welcomeScreen.classList.add('minimized');

    // Clear existing chat messages
    const messages = chatHistory.querySelectorAll('.chat-message');
    messages.forEach(msg => msg.remove());

    fetch('/upload_path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: filePath })
    })
    .then(response => response.json())
    .then(data => {
        if (dropZone) dropZone.classList.remove('uploading');

        if (data.error) {
            fileNameDisplay.textContent = fileName;
            showAlertModal('Upload Error', data.error);
        } else {
            appendMessage('Database loaded successfully. You can now ask questions about it.', 'bot');
            renderSchema(data.schema);
            updateDatabaseStatus(fileName);
            fileNameDisplay.textContent = fileName;
        }
    })
    .catch(error => {
        if (dropZone) dropZone.classList.remove('uploading');
        fileNameDisplay.textContent = fileName;
        console.error('Upload error:', error);
        showAlertModal('Upload Error', 'Failed to upload file');
    });
}

// Initialize pywebview file dialog when ready
if (isPywebview) {
    setupPywebviewFileDialog();
} else {
    // pywebview might not be ready yet - listen for the ready event
    window.addEventListener('pywebviewready', () => {
        isPywebview = true;
        setupPywebviewFileDialog();
    });
}

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

    const closeModal = () => modal.remove();

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
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
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
    // Re-query elements to handle PyWebView timing issues where initial queries may fail
    const ollamaStatusEl = ollamaStatus || document.getElementById('ollama-status');
    const statusIndicatorEl = statusIndicator || document.getElementById('status-indicator');
    const statusTextEl = statusText || document.getElementById('status-text');

    if (!ollamaStatusEl || !statusIndicatorEl || !statusTextEl) {
        console.warn('LLM status elements not found, retrying in 500ms...');
        setTimeout(() => checkProviderStatus(), 500);
        return;
    }

    // Always show status for both providers
    ollamaStatusEl.style.display = 'flex';

    // Remove existing guidance if any
    const existingGuidance = document.querySelector('.llm-guidance');
    if (existingGuidance) existingGuidance.remove();

    if (available) {
        statusIndicatorEl.classList.remove('offline');
        statusIndicatorEl.classList.add('online');
        statusTextEl.textContent = currentProvider === 'ollama' ? 'Ollama Connected' : 'LM Studio Connected';

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
        statusIndicatorEl.classList.remove('online');
        statusIndicatorEl.classList.add('offline');
        statusTextEl.textContent = currentProvider === 'ollama' ? 'Ollama Offline' : 'LM Studio Offline';
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
        ollamaStatusEl.parentNode.insertBefore(guidanceDiv, ollamaStatusEl.nextSibling);
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
// This handles PyWebView/WebKit2 timing issues where defer may not guarantee DOM readiness
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        initProviderSelector();
        initModelSelector();
    });
} else {
    initProviderSelector();
    initModelSelector();
}

// --- Database Status Management ---
function updateDatabaseStatus(filename = null) {
    if (filename) {
        databaseLoaded = true;
        userInput.disabled = false;
        userInput.placeholder = 'Ask a question about your database...';
        sendButton.disabled = false;
    } else {
        databaseLoaded = false;
        userInput.disabled = true;
        userInput.placeholder = 'Load a database to start chatting...';
        sendButton.disabled = true;
    }
}

// --- Event Listeners ---


if (sendButton) {
    sendButton.addEventListener('click', function() {
        sendMessage();
    });
}

if (userInput) {
    // Use keydown instead of keypress for better WebKit2 compatibility
    userInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendMessage();
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
        if (window.pywebview && window.pywebview.api) {
            // Desktop app: use native save dialog
            fetch('/export_chat')
                .then(response => {
                    if (!response.ok) throw new Error('Network response was not ok');
                    return response.text();
                })
                .then(html => {
                    const filename = 'chat_export.html';
                    return window.pywebview.api.save_file_dialog(html, filename);
                })
                .catch(error => {
                    console.error('Error exporting chat:', error);
                    showAlertModal('Export Error', 'Error exporting chat. Please try again.');
                });
        } else {
            // Browser: use blob download
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
        }
    });
}

// --- Search All Tables ---
const searchAllTablesButton = document.getElementById('search-all-tables-button');
if (searchAllTablesButton) {
    searchAllTablesButton.addEventListener('click', () => {
        showSearchModal();
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

    const closeModal = () => modal.remove();

    // Event listeners
    modal.querySelector('.search-modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Escape key closes modal
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
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

    // Minimize welcome screen instead of removing it
    if (welcomeScreen) {
        welcomeScreen.classList.add('minimized');
    }

    appendMessage(message, 'user');
    userInput.value = '';
    userInput.disabled = true;
    sendButton.disabled = true;
    sendButton.classList.add('sending');

    // Create Bot Message Container
    const botMessageElement = appendMessage('', 'bot');
    const contentContainer = botMessageElement.querySelector('.content-container');
    
    // Thinking Indicator
    const spinner = document.createElement('div');
    spinner.className = 'thinking-spinner';
    contentContainer.appendChild(spinner);
    
    const pText = document.createElement('p');
    pText.textContent = 'Thinking...';
    contentContainer.appendChild(pText);

    const controller = new AbortController();
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
                clearTimeout(timeoutId); // Success! Data received.
                spinner.remove();
                pText.textContent = '';
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
        if (spinner && spinner.isConnected) spinner.remove(); // Force remove spinner if still present
        userInput.disabled = false;
        sendButton.disabled = false;
        sendButton.classList.remove('sending');
        userInput.focus();
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }
}

function renderText(element, text) {
    if (typeof marked !== 'undefined') {
        // Configure marked with highlight.js
        marked.setOptions({
            highlight: function(code, lang) {
                if (typeof hljs !== 'undefined') {
                    // Attempt to detect language, default to plaintext if not found
                    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                    return hljs.highlight(code, { language }).value;
                }
                return code;
            },
            langPrefix: 'hljs language-'
        });

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

    // Row count label
    const rowCountLabel = document.createElement('div');
    rowCountLabel.className = 'results-row-count';
    rowCountLabel.textContent = `${queryResults.length} rows returned`;
    container.appendChild(rowCountLabel);

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
        resizable: false,
        fixedHeader: true,
        style: {
            table: { 'white-space': 'nowrap', 'font-size': '0.85rem', 'table-layout': 'auto', 'width': '100%' },
            th: { 'background-color': 'var(--background-lighter)', 'color': 'var(--foreground)', 'border': '1px solid var(--border)', 'position': 'sticky', 'top': '0' },
            td: { 'background-color': 'var(--background-light)', 'color': 'var(--foreground)', 'border': '1px solid var(--border)' },
            footer: { 'background-color': 'var(--card)' }
        },
        className: { table: 'custom-grid-table', th: 'custom-grid-th', td: 'custom-grid-td', container: 'custom-grid-container' }
    }).render(tableWrapper);
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

        // Minimize welcome screen and clear only chat messages
        if (welcomeScreen) {
            welcomeScreen.classList.add('minimized');
        }

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
