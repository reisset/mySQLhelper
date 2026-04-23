// File upload, schema rendering, database status

import { state } from './state.js';
import { escapeHtml, showConfirmModal, showAlertModal } from './ui.js';
import { appendMessage } from './chat.js';
import { destroyAllGrids } from './sql.js';
import { resetInspector } from './inspector.js';

export function updateDatabaseStatus(filename = null) {
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const searchBtn = document.getElementById('search-all-tables-button');
    const dbPath = document.getElementById('db-path');
    const lpFilename = document.getElementById('lp-filename');
    const ftStatus = document.getElementById('ft-status');

    if (filename) {
        state.databaseLoaded = true;
        userInput.disabled = false;
        userInput.placeholder = 'Ask a question about your database…';
        sendButton.disabled = false;
        if (searchBtn) searchBtn.disabled = false;
        if (dbPath) dbPath.innerHTML = `<b>${escapeHtml(filename)}</b>`;
        if (lpFilename) lpFilename.textContent = filename;
        if (ftStatus) ftStatus.textContent = `loaded · ${filename}`;
    } else {
        state.databaseLoaded = false;
        userInput.disabled = true;
        userInput.placeholder = 'Load a database to start chatting…';
        sendButton.disabled = true;
        if (searchBtn) searchBtn.disabled = true;
        if (dbPath) dbPath.innerHTML = '<span class="dimmer">no database loaded</span>';
        if (lpFilename) lpFilename.textContent = 'no database';
        if (ftStatus) ftStatus.textContent = 'ready';
    }
}

export function handleDrop(e) {
    const databaseFile = document.getElementById('database-file');
    const dt = e.dataTransfer;
    const files = dt.files;

    if (files.length > 0) {
        databaseFile.files = files; // Assign to input for consistency
        handleFiles(files);
    }
}

export function handleFiles(files) {
    const fileNameDisplay = document.getElementById('file-name-display');
    if (files.length > 0) {
        fileNameDisplay.textContent = files[0].name;
        // Auto-upload on file selection
        uploadFile();
    } else {
        fileNameDisplay.textContent = 'No file chosen';
    }
}

export function uploadFile() {
    const databaseFile = document.getElementById('database-file');
    const dropZone = document.getElementById('drop-zone');
    const fileNameDisplay = document.getElementById('file-name-display');
    const chatHistory = document.getElementById('chat-history');
    const welcomeScreen = document.getElementById('welcome-screen');

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

    const doUpload = async () => {
        const formData = new FormData();
        formData.append('database_file', file);

        // Minimize welcome screen and move it above the scrollable chat area
        if (welcomeScreen && !welcomeScreen.classList.contains('minimized')) {
            const chatContainer = chatHistory.parentElement;
            chatContainer.insertBefore(welcomeScreen, chatHistory);
            void welcomeScreen.offsetHeight; // force reflow so transition animates
            welcomeScreen.classList.add('minimized');
        }

        destroyAllGrids();
        resetInspector();

        // Remove all chat messages but keep the welcome screen if it exists
        const messages = chatHistory.querySelectorAll('.chat-message');
        messages.forEach(msg => msg.remove());

        // Show upload progress indicator
        if (dropZone) {
            dropZone.classList.add('uploading');
            fileNameDisplay.textContent = `Uploading ${file.name}...`;
        }

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();

            if (dropZone) dropZone.classList.remove('uploading');

            if (data.error) {
                fileNameDisplay.textContent = file.name;
                showAlertModal('Upload Error', data.error);
            } else {
                state.richSchema = data.rich_schema || {};
                appendMessage('Database loaded successfully. You can now ask questions about it.', 'bot');
                renderSchema(data.rich_schema || data.schema);
                updateDatabaseStatus(file.name);
                fileNameDisplay.textContent = file.name;
                if (data.metadata && data.metadata.hash) {
                    const ftHash = document.getElementById('ft-hash');
                    if (ftHash) ftHash.textContent = `sha256 ${data.metadata.hash.substring(0, 12)}…`;
                }
            }
        } catch (error) {
            if (dropZone) dropZone.classList.remove('uploading');
            fileNameDisplay.textContent = file.name;
            console.error('Error:', error);
            showAlertModal('Upload Error', 'An error occurred during file upload.');
        }
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

export function renderSchema(schema) {
    const schemaDisplay = document.getElementById('schema-display');
    const tableCountLabel = document.getElementById('schema-table-count');
    schemaDisplay.innerHTML = '';

    const tables = Object.keys(schema);
    if (tableCountLabel) {
        tableCountLabel.textContent = tables.length
            ? `${tables.length} ${tables.length === 1 ? 'table' : 'tables'}`
            : '';
    }

    if (!tables.length) {
        schemaDisplay.innerHTML = '<div class="schema-empty">no tables found</div>';
        return;
    }

    for (const table of tables) {
        const info = schema[table];
        const columns = Array.isArray(info) ? info.map(n => ({ name: n, type: 'TEXT', pk: false, fk: null })) : (info.columns || []);
        const samples = (info && info.sample_rows) || [];
        const rowCount = info && info.row_count;

        const item = document.createElement('div');
        item.className = 'tbl-item';

        const head = document.createElement('div');
        head.className = 'tbl-item-head';
        head.innerHTML = `
            <span class="tw">▸</span>
            <span class="nm">${escapeHtml(table)}</span>
            <span class="ct">${columns.length} col${columns.length === 1 ? '' : 's'}${rowCount != null ? ` · ${rowCount} row${rowCount === 1 ? '' : 's'}` : ''}</span>
        `;
        head.addEventListener('click', () => item.classList.toggle('open'));
        item.appendChild(head);

        const detail = document.createElement('div');
        detail.className = 'tbl-detail';

        const cols = document.createElement('div');
        cols.className = 'tbl-cols';
        columns.forEach(col => {
            const c = document.createElement('div');
            c.className = 'c' + (col.pk ? ' pk' : '') + (col.fk ? ' fk' : '');
            c.innerHTML = `
                <span class="n">${escapeHtml(col.name)}</span>
                <span class="t">${escapeHtml(col.type || '')}</span>
            `;
            if (col.fk) {
                c.title = `→ ${col.fk.ref_table}.${col.fk.ref_column}`;
            }
            cols.appendChild(c);
        });
        detail.appendChild(cols);

        if (samples && samples.length) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'sample-btn';
            btn.textContent = `▸ ${samples.length} sample row${samples.length === 1 ? '' : 's'}`;
            detail.appendChild(btn);

            const preview = document.createElement('div');
            preview.className = 'sample-preview';
            preview.style.display = 'none';
            const headers = Object.keys(samples[0]);
            const thead = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
            const rows = samples.map(r =>
                '<tr>' + headers.map(h => {
                    const v = r[h];
                    const text = v === null || v === undefined ? '' : String(v);
                    return `<td>${escapeHtml(text)}</td>`;
                }).join('') + '</tr>'
            ).join('');
            preview.innerHTML = `<table><thead><tr>${thead}</tr></thead><tbody>${rows}</tbody></table>`;
            detail.appendChild(preview);

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const showing = preview.style.display !== 'none';
                preview.style.display = showing ? 'none' : 'block';
                btn.textContent = (showing ? '▸ ' : '▾ ') + samples.length + ` sample row${samples.length === 1 ? '' : 's'}`;
            });
        }

        item.appendChild(detail);
        schemaDisplay.appendChild(item);
    }
}
