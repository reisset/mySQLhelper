// File upload, schema rendering, database status

import { state } from './state.js';
import { escapeHtml, showConfirmModal, showAlertModal } from './ui.js';
import { appendMessage } from './chat.js';

export function updateDatabaseStatus(filename = null) {
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const schemaDiagramButton = document.getElementById('schema-diagram-button');

    if (filename) {
        state.databaseLoaded = true;
        userInput.disabled = false;
        userInput.placeholder = 'Ask a question about your database...';
        sendButton.disabled = false;
        if (schemaDiagramButton) schemaDiagramButton.disabled = false;
    } else {
        state.databaseLoaded = false;
        userInput.disabled = true;
        userInput.placeholder = 'Load a database to start chatting...';
        sendButton.disabled = true;
        if (schemaDiagramButton) schemaDiagramButton.disabled = true;
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

export function renderSchema(schema) {
    const schemaDisplay = document.getElementById('schema-display');
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
