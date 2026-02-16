// Chat messaging: send, stream, render, token tracking

import { state } from './state.js';
import { renderText, fetchJson } from './ui.js';
import { executeSqlAndRender } from './sql.js';
import { enableAnnotation } from './notes.js';

export async function sendMessage() {
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const chatHistory = document.getElementById('chat-history');
    const welcomeScreen = document.getElementById('welcome-screen');

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
    state.inputHistory.push(message);
    state.historyIndex = -1;
    state.currentDraft = '';

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
    if (state.activeStreamController) {
        state.activeStreamController.abort();
    }
    const controller = new AbortController();
    state.activeStreamController = controller;
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s watchdog

    try {
        const response = await fetch('/chat_stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                provider: state.currentProvider
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
        const saveData = await fetchJson('/save_assistant_message', {
            content: fullResponse,
            token_usage: tokenUsage
        });

        // Enable annotation if message ID is returned
        if (saveData.message_id) {
            enableAnnotation(contentContainer, saveData.message_id);
        }

        // Execute SQL if present
        await executeSqlAndRender(fullResponse, contentContainer);

    } catch (error) {
        console.error('Chat Error:', error);

        // Create error container with proper styling
        const errorDiv = document.createElement('div');
        errorDiv.className = 'chat-error-message';
        errorDiv.setAttribute('role', 'alert');

        const errorIcon = document.createElement('span');
        errorIcon.className = 'error-icon';
        errorIcon.textContent = '\u26A0';

        const errorContent = document.createElement('div');
        errorContent.className = 'error-content';

        const errorTitle = document.createElement('strong');
        const errorDetails = document.createElement('div');
        errorDetails.className = 'error-details';

        if (error.name === 'AbortError') {
            errorTitle.textContent = 'Request Timed Out';
            errorDetails.textContent = `The ${state.currentProvider === 'ollama' ? 'Ollama' : 'LM Studio'} server did not respond within 15 seconds.`;
        } else if (error.message.includes("503") || error.message.includes("Failed to fetch") || error.message.includes("LM Studio") || error.message.includes("Ollama")) {
            const isOllama = state.currentProvider === 'ollama';
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
        if (state.activeStreamController === controller) {
            state.activeStreamController = null;
        }
        statusBar.classList.remove('active');
        userInput.disabled = false;
        sendButton.disabled = false;
        sendButton.classList.remove('sending');
        userInput.focus();
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }
}

export function appendMessage(message, sender) {
    const chatHistory = document.getElementById('chat-history');
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
