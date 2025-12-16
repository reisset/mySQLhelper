document.addEventListener('DOMContentLoaded', function() {
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const chatHistory = document.getElementById('chat-history');
    const uploadForm = document.getElementById('upload-form');
    const databaseFile = document.getElementById('database-file');
    const schemaDisplay = document.getElementById('schema-display');
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const fileNameDisplay = document.getElementById('file-name-display');
    const welcomeScreen = document.getElementById('welcome-screen');

    function checkWelcomeScreen() {
        // If there are any messages besides the welcome screen, hide it.
        if (chatHistory.children.length > 1 || 
            (chatHistory.children.length === 1 && chatHistory.firstElementChild.id !== 'welcome-screen')) {
            if (welcomeScreen) welcomeScreen.style.display = 'none';
        } else {
            if (welcomeScreen) welcomeScreen.style.display = 'block';
        }
    }

    // --- Event Listeners ---
    sendButton.addEventListener('click', sendMessage);
    userInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    databaseFile.addEventListener('change', () => {
        if (databaseFile.files.length > 0) {
            fileNameDisplay.textContent = databaseFile.files[0].name;
        } else {
            fileNameDisplay.textContent = 'No file chosen';
        }
    });

    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();
        uploadFile();
    });
    
    // uploadForm.querySelector('input[type="submit"]').addEventListener('click', uploadFile); // Removed to prevent double firing

    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

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

    // --- Core Functions ---

    async function sendMessage() {
        const message = userInput.value.trim();
        if (!message) return;

        // Robustly check for and remove welcome screen
        const welcomeScreenEl = document.getElementById('welcome-screen');
        if (welcomeScreenEl) {
            welcomeScreenEl.remove();
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
            await fetch('/save_assistant_message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: fullResponse,
                    token_usage: tokenUsage  // Include token data
                }),
            });

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
            let html = marked.parse(text);
            if (typeof DOMPurify !== 'undefined') {
                html = DOMPurify.sanitize(html);
            }
            element.innerHTML = html;
        } else {
            element.textContent = text;
        }
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
                 appendResultsTable(data.query_results, contentContainer);
            } else {
                const resultMsg = document.createElement('div');
                resultMsg.className = 'sql-result-message';
                resultMsg.textContent = "Query executed successfully. No results returned.";
                resultMsg.style.padding = "10px";
                resultMsg.style.fontStyle = "italic";
                contentContainer.appendChild(resultMsg);
            }

            // Optional: Re-append SQL block if you want a clean copy button separate from text
            appendSqlBlock(sqlQuery, contentContainer);

        } catch (error) {
            console.error('SQL Error:', error);
            const errorDiv = document.createElement('div');
            errorDiv.style.color = '#ff5555';
            errorDiv.textContent = `SQL Execution Error: ${error.message}`;
            contentContainer.appendChild(errorDiv);
        }
    }

    function appendSqlBlock(sqlQuery, container) {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = sqlQuery;
        pre.appendChild(code);
        
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-sql-button';
        copyBtn.textContent = 'Copy';
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(sqlQuery);
            copyBtn.textContent = 'Copied!';
            setTimeout(() => copyBtn.textContent = 'Copy', 2000);
        };
        
        pre.appendChild(copyBtn);
        container.appendChild(pre);
    }

    function appendResultsTable(queryResults, container) {
        const BATCH_SIZE = 20;
        let displayedCount = 0;
        
        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'results-table-container';
        
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const tbody = document.createElement('tbody');
        
        // Headers
        const columns = Object.keys(queryResults[0]);
        const headerRow = document.createElement('tr');
        columns.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        table.appendChild(tbody);
        tableWrapper.appendChild(table);
        container.appendChild(tableWrapper);

        // Render Function
        const renderBatch = () => {
            const nextBatch = queryResults.slice(displayedCount, displayedCount + BATCH_SIZE);
            nextBatch.forEach(row => {
                const tr = document.createElement('tr');
                columns.forEach(col => {
                    const td = document.createElement('td');
                    td.textContent = row[col];
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            displayedCount += nextBatch.length;
            
            // Manage "Show More" Button
            if (displayedCount < queryResults.length) {
                if (!showMoreBtn) {
                    createShowMoreBtn();
                }
                showMoreBtn.textContent = `Show More (${queryResults.length - displayedCount} remaining)`;
                showMoreBtn.style.display = 'block';
            } else {
                if (showMoreBtn) showMoreBtn.style.display = 'none';
            }
        };

        let showMoreBtn = null;
        const createShowMoreBtn = () => {
            showMoreBtn = document.createElement('button');
            showMoreBtn.className = 'toggle-results-button'; // Reused class for style
            showMoreBtn.onclick = renderBatch;
            container.appendChild(showMoreBtn); 
        };

        // Initial Render
        renderBatch();
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
            const welcomeScreenEl = document.getElementById('welcome-screen');
            const hasHistory = chatHistory.children.length > 0;
            const isOnlyWelcome = (chatHistory.children.length === 1 && chatHistory.firstElementChild.id === 'welcome-screen');

            if (hasHistory && !isOnlyWelcome) {
                if (!confirm("A database is already loaded. Uploading a new one will clear the chat history. Continue?")) {
                    return; // User cancelled
                }
            }

            const formData = new FormData();
            formData.append('database_file', file);

            // Robustly check for and remove welcome screen
            if (welcomeScreenEl) {
                welcomeScreenEl.remove();
            }
            
            // Clear history on new upload (confirmed by user or empty start)
            chatHistory.innerHTML = ''; 

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

    checkWelcomeScreen();
});
