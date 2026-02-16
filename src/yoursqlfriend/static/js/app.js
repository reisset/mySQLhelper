// Copyright 2025 Reisset
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details

// Main entry point — imports all modules and wires up event listeners

import { state } from './state.js';
import { initTheme, toggleTheme, showConfirmModal, showAlertModal, downloadBlob, fetchJson } from './ui.js';
import { updateChartsForTheme } from './charts.js';
import { initProviderSelector, initModelSelector } from './providers.js';
import { sendMessage } from './chat.js';
import { uploadFile, handleFiles, handleDrop } from './upload.js';
import { showSearchModal } from './search.js';
import { showERDiagramModal } from './erdiagram.js';

// --- Initialize Theme ---
initTheme();

// --- Fetch and display version ---
const appVersion = document.getElementById('app-version');
(async function fetchVersion() {
    try {
        const data = await fetchJson('/api/version');
        if (appVersion) {
            appVersion.textContent = `yourSQLfriend v${data.version}`;
        }
    } catch (error) {
        console.warn('Could not fetch version:', error);
    }
})();

// --- Configure marked.js once at init ---
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

// --- DOM Elements ---
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const chatHistory = document.getElementById('chat-history');
const databaseFile = document.getElementById('database-file');
const dropZone = document.getElementById('drop-zone');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const themeToggle = document.getElementById('theme-toggle');
const refreshBtn = document.getElementById('refresh-btn');
const uploadForm = document.getElementById('upload-form');
const schemaDiagramButton = document.getElementById('schema-diagram-button');
const exportChatButton = document.getElementById('export-chat-button');
const searchAllTablesButton = document.getElementById('search-all-tables-button');
const scrollToBottomBtn = document.getElementById('scroll-to-bottom');

// --- Theme Toggle ---
if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        toggleTheme();
        updateChartsForTheme();
    });
}

// --- Refresh Button ---
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

// --- LLM Provider Initialization ---
initProviderSelector();
initModelSelector();

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
        const text = el.textContent.replace(/^["']|["']$/g, '');
        userInput.value = text;
        userInput.focus();
    });
});

// --- Send Button ---
if (sendButton) {
    sendButton.addEventListener('click', () => {
        sendMessage();
    });
}

// --- Chat Input: auto-grow, enter-to-send, input history ---
if (userInput) {
    function autoGrowTextarea() {
        userInput.style.height = 'auto';
        userInput.style.height = Math.min(userInput.scrollHeight, 160) + 'px';
        userInput.style.overflowY = userInput.scrollHeight > 160 ? 'auto' : 'hidden';
    }

    userInput.addEventListener('input', autoGrowTextarea);

    userInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
            return;
        }

        // Up arrow: navigate backward through history (only when at first line)
        if (e.key === 'ArrowUp' && state.inputHistory.length > 0) {
            const beforeCursor = userInput.value.substring(0, userInput.selectionStart);
            if (!beforeCursor.includes('\n')) {
                e.preventDefault();
                if (state.historyIndex === -1) {
                    state.currentDraft = userInput.value;
                    state.historyIndex = state.inputHistory.length - 1;
                } else if (state.historyIndex > 0) {
                    state.historyIndex--;
                }
                userInput.value = state.inputHistory[state.historyIndex];
                autoGrowTextarea();
            }
        }

        // Down arrow: navigate forward through history (only when at last line)
        if (e.key === 'ArrowDown' && state.historyIndex !== -1) {
            const afterCursor = userInput.value.substring(userInput.selectionStart);
            if (!afterCursor.includes('\n')) {
                e.preventDefault();
                if (state.historyIndex < state.inputHistory.length - 1) {
                    state.historyIndex++;
                    userInput.value = state.inputHistory[state.historyIndex];
                } else {
                    state.historyIndex = -1;
                    userInput.value = state.currentDraft;
                }
                autoGrowTextarea();
            }
        }
    });
}

// --- File Input Change ---
if (databaseFile) {
    databaseFile.addEventListener('change', () => {
        handleFiles(databaseFile.files);
    });
}

// --- Drag and Drop ---
if (dropZone) {
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-over'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'), false);
    });

    dropZone.addEventListener('drop', handleDrop, false);
}

// --- Upload Form ---
if (uploadForm) {
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();
        uploadFile();
    });
}

// --- Sidebar Toggle ---
if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        const isExpanded = !sidebar.classList.contains('collapsed');
        sidebarToggle.setAttribute('aria-expanded', isExpanded);
    });
}

// --- Export Chat ---
if (exportChatButton) {
    exportChatButton.addEventListener('click', async () => {
        try {
            const response = await fetch('/export_chat');
            if (!response.ok) throw new Error('Network response was not ok');
            const blob = await response.blob();
            downloadBlob(blob, 'chat_export.html');
        } catch (error) {
            console.error('Error exporting chat:', error);
            showAlertModal('Export Error', 'Error exporting chat. Please try again.');
        }
    });
}

// --- Search All Tables ---
if (searchAllTablesButton) {
    searchAllTablesButton.addEventListener('click', () => {
        showSearchModal();
    });
}

// --- Schema Diagram ---
if (schemaDiagramButton) {
    schemaDiagramButton.addEventListener('click', () => {
        showERDiagramModal();
    });
}

// --- Warn before reload/close if chat session active ---
window.addEventListener('beforeunload', (e) => {
    const chatMessages = document.querySelectorAll('.chat-message').length;
    if (chatMessages > 0) {
        e.preventDefault();
        e.returnValue = '';
        return '';
    }
});

// --- Service Worker Registration ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
        .catch(err => console.warn('SW registration failed:', err));
}
