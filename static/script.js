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

// --- Event Listeners ---

if (sendButton) sendButton.addEventListener('click', sendMessage);
if (userInput) {
    userInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
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
                alert('Error exporting chat. Please try again.');
            });
    });
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
            body: JSON.stringify({ message: message }),
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
        
        let errorMessage = error.message;
        let errorDetails = "";

        if (error.name === 'AbortError') {
            errorMessage = "<strong>Error: Request Timed Out.</strong>";
            errorDetails = '<div style="font-size: 0.85em; margin-top: 5px; color: #ccc;">The local LLM did not respond within 15 seconds.</div>';
        } else if (errorMessage.includes("503") || errorMessage.includes("Failed to fetch") || errorMessage.includes("LM Studio")) {
            errorMessage = "<strong>Error: Unable to connect to Local LLM.</strong>";
            errorDetails = `
                <div style="font-size: 0.85em; margin-top: 10px; color: #ccc;">
                    Please check <strong>LM Studio</strong>:
                    <ol style="padding-left: 20px; margin-top: 5px;">
                        <li>Is the server running? (Green bar at top)</li>
                        <li>Is the port set to <code>1234</code>?</li>
                        <li>Is a model loaded?</li>
                    </ol>
                </div>
            `;
        }

        pText.innerHTML = `${errorMessage}${errorDetails}`;
        pText.style.color = '#ff5555';
    } finally {
        clearTimeout(timeoutId); // Ensure cleanup
        if (spinner && spinner.isConnected) spinner.remove(); // Force remove spinner if still present
        userInput.disabled = false;
        sendButton.disabled = false;
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
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(code.textContent);
            copyBtn.textContent = 'Copied!';
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

        // Render Result Table
        if (data.query_results && data.query_results.length > 0) {
            appendResultsTable(data.query_results, contentContainer, sqlQuery);
        } else {
            const resultMsg = document.createElement('div');
            resultMsg.className = 'sql-result-message';
            resultMsg.textContent = "Query executed successfully. No results returned.";
            resultMsg.style.padding = "10px";
            resultMsg.style.fontStyle = "italic";
            contentContainer.appendChild(resultMsg);
        }

    } catch (error) {
        console.error('SQL Error:', error);
        const errorDiv = document.createElement('div');
        errorDiv.style.color = '#ff5555';
        errorDiv.textContent = `SQL Execution Error: ${error.message}`;
        contentContainer.appendChild(errorDiv);
    }
}

function appendResultsTable(queryResults, container, sqlQuery = '') {
    if (typeof gridjs === 'undefined') {
        console.error("Grid.js not loaded");
        return;
    }

    // Create export toolbar
    const exportBar = document.createElement('div');
    exportBar.className = 'export-toolbar';
    exportBar.innerHTML = `
        <span class="export-label">${queryResults.length} rows</span>
        <button class="export-btn export-csv" title="Export as CSV">Export CSV</button>
    `;
    container.appendChild(exportBar);

    // Add export button handler
    exportBar.querySelector('.export-csv').addEventListener('click', () => {
        exportResultsCSV(queryResults, sqlQuery);
    });

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'results-table-container';
    container.appendChild(tableWrapper);

    new gridjs.Grid({
        columns: Object.keys(queryResults[0]),
        data: queryResults.map(row => Object.values(row)),
        pagination: {
            limit: 10,
            summary: true
        },
        search: true,
        sort: true,
        resizable: true,
        style: {
            table: {
                'white-space': 'nowrap',
                'font-size': '0.85rem'
            },
            th: {
                'background-color': '#222',
                'color': '#fff',
                'border': '1px solid #333'
            },
            td: {
                'background-color': '#1d1d1d',
                'color': '#ddd',
                'border': '1px solid #333'
            },
            footer: {
                'background-color': '#181818'
            }
        },
        className: {
            table: 'custom-grid-table',
            th: 'custom-grid-th',
            td: 'custom-grid-td'
        }
    }).render(tableWrapper);
}

// Export query results as CSV with metadata header
function exportResultsCSV(data, sqlQuery) {
    const timestamp = new Date().toISOString();
    const headers = Object.keys(data[0]);

    // Build CSV with metadata header
    const metaHeader = [
        '# Query Export',
        `# Generated: ${timestamp}`,
        `# Rows: ${data.length}`,
        `# SQL: ${sqlQuery}`,
        ''
    ];

    const csvRows = [headers.join(',')];
    data.forEach(row => {
        const values = headers.map(h => {
            const val = row[h];
            if (val === null) return '';
            const str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        });
        csvRows.push(values.join(','));
    });

    const content = metaHeader.join('\n') + csvRows.join('\n');
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `query_export_${timestamp.slice(0, 19).replace(/[:-]/g, '')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

function updateAllTokenCounters() {
    let runningTotal = 0;
    document.querySelectorAll('.bot-message .token-counter').forEach(counter => {
        const messageTokens = parseInt(counter.getAttribute('data-tokens')) || 0;
        runningTotal += messageTokens;
        const span = counter.querySelector('span');
        if (span) {
            const title = span.title; // Preserve tooltip
            span.textContent = `${messageTokens} tokens (${runningTotal} total)`;
            span.title = title;
        }
    });
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
    if (file) {
        // --- File Size Validation ---
        const fileSizeMB = file.size / (1024 * 1024);
        
        if (fileSizeMB > 1024) { // > 1GB
            alert("File is too large (over 1GB). Please use a smaller subset for analysis.");
            return;
        }
        
        if (fileSizeMB > 100) { // > 100MB warning
            if (!confirm(`This file is large (${fileSizeMB.toFixed(1)} MB). Uploading and processing might take a moment. Continue?`)) {
                return;
            }
        }

        // Check for existing chat history (excluding welcome screen)
        const hasHistory = chatHistory.querySelectorAll('.chat-message').length > 0;
        
        if (hasHistory) {
            if (!confirm("A database is already loaded. Uploading a new one will clear the chat history. Continue?")) {
                return; // User cancelled
            }
        }

        const formData = new FormData();
        formData.append('database_file', file);

        // Minimize welcome screen and clear only chat messages
        if (welcomeScreen) {
            welcomeScreen.classList.add('minimized');
        }
        
        // Remove all chat messages but keep the welcome screen if it exists
        const messages = chatHistory.querySelectorAll('.chat-message');
        messages.forEach(msg => msg.remove());

        fetch('/upload', {
            method: 'POST',
            body: formData,
            })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                alert(data.error);
            } else {
                appendMessage('Database loaded successfully. You can now ask questions about it.', 'bot');
                renderSchema(data.schema);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('An error occurred during file upload.');
        });
    } else {
        alert("Please select a database file first.");
    }
}

function renderSchema(schema) {
    schemaDisplay.innerHTML = '<h3>Database Schema</h3>';
    for (const table in schema) {
        const tableElement = document.createElement('div');
        tableElement.innerHTML = `<h4>${table}</h4>`;
        const columnsList = document.createElement('ul');
        schema[table].forEach(column => {
            const columnItem = document.createElement('li');
            columnItem.textContent = column;
            columnsList.appendChild(columnItem);
        });
        tableElement.appendChild(columnsList);
        schemaDisplay.appendChild(tableElement);
    }
}

function enableAnnotation(container, messageId) {
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'message-controls';
    controlsDiv.style.marginTop = '10px';
    controlsDiv.style.borderTop = '1px solid #333';
    controlsDiv.style.paddingTop = '5px';
    controlsDiv.style.display = 'flex';
    controlsDiv.style.justifyContent = 'flex-end';

    const addNoteBtn = document.createElement('button');
    addNoteBtn.className = 'add-note-btn';
    addNoteBtn.textContent = '+ Add Note';
    addNoteBtn.style.background = 'none';
    addNoteBtn.style.border = 'none';
    addNoteBtn.style.color = '#888';
    addNoteBtn.style.fontSize = '0.8rem';
    addNoteBtn.style.cursor = 'pointer';
    
    addNoteBtn.onmouseover = () => addNoteBtn.style.color = '#ccc';
    addNoteBtn.onmouseout = () => addNoteBtn.style.color = '#888';

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
    editorDiv.style.display = 'flex';
    editorDiv.style.flexDirection = 'column';
    editorDiv.style.gap = '5px';
    editorDiv.style.marginTop = '5px';

    const textarea = document.createElement('textarea');
    textarea.placeholder = "Enter forensic note...";
    textarea.value = initialText; // Pre-fill text
    textarea.style.width = '100%';
    textarea.style.minHeight = '60px';
    textarea.style.background = '#222';
    textarea.style.color = '#ddd';
    textarea.style.border = '1px solid #444';
    textarea.style.padding = '5px';
    textarea.style.borderRadius = '4px';
    textarea.style.fontFamily = 'sans-serif';

    const buttonsDiv = document.createElement('div');
    buttonsDiv.style.display = 'flex';
    buttonsDiv.style.gap = '5px';
    buttonsDiv.style.justifyContent = 'flex-end';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Note';
    saveBtn.style.background = '#22c55e'; // Green
    saveBtn.style.color = '#fff';
    saveBtn.style.border = 'none';
    saveBtn.style.padding = '4px 8px';
    saveBtn.style.borderRadius = '4px';
    saveBtn.style.cursor = 'pointer';
    saveBtn.style.fontSize = '0.8rem';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.background = 'transparent';
    cancelBtn.style.color = '#888';
    cancelBtn.style.border = '1px solid #444';
    cancelBtn.style.padding = '4px 8px';
    cancelBtn.style.borderRadius = '4px';
    cancelBtn.style.cursor = 'pointer';
    cancelBtn.style.fontSize = '0.8rem';

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
                // Render the static note, passing messageId back for future edits
                renderNote(container, noteContent, messageId); 
            } else {
                alert('Error saving note: ' + (data.error || 'Unknown error'));
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Note';
            }
        })
        .catch(err => {
            console.error(err);
            alert('Network error saving note');
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
    // Remove existing note if any (though currently we support one)
    const existing = container.parentNode.querySelector('.forensic-note');
    if (existing) existing.remove();

    const noteDiv = document.createElement('div');
    noteDiv.className = 'forensic-note';
    noteDiv.style.marginTop = '10px';
    noteDiv.style.padding = '8px 12px';
    noteDiv.style.background = '#332b00'; // Dark yellow/brown
    noteDiv.style.borderLeft = '3px solid #ffcc00';
    noteDiv.style.color = '#fff';
    noteDiv.style.fontSize = '0.9rem';
    noteDiv.style.fontStyle = 'italic';
    
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
        
        // Update onclick to support editing existing text
        controls.onclick = () => {
            controls.style.display = 'none';
            // Pass existing text and messageId
            showNoteEditor(container, messageId, text); 
        };
    }
    
    container.insertBefore(noteDiv, container.lastChild); 
}