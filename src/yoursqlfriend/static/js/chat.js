// Chat messaging: send, stream, render, token tracking

import { state } from './state.js';
import { renderText, fetchJson, renderQueryHistory, setFooterMetrics, minimizeWelcomeScreen } from './ui.js';
import { executeSqlAndRender } from './sql.js';
import { providerLabel, PROVIDER_HELP } from './providers.js';

const WATCHDOG_MS = 90000;      // local models need time to prefill large schemas
const SHIMMER_MIN_MS = 2500;    // minimum shimmer display so it doesn't flash
const SHIMMER_ROTATE_MS = 3500; // status message rotation cadence

// --- SSE frame parsing ---

// Parse complete SSE frames from the buffer (split on blank lines).
// Returns { frames: string[], remainder: string } where remainder is
// any partial frame still being received.
function parseFrames(buf) {
    const parts = buf.split('\n\n');
    return { frames: parts.slice(0, -1), remainder: parts[parts.length - 1] };
}

// Parse a single SSE frame string into { event, data }.
function parseFrame(frame) {
    let event = 'message';
    let data = '';
    for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) {
            event = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
            data += (data ? '\n' : '') + line.slice(6);
        }
        // Lines starting with ':' are comments (keepalive) — silently ignored.
    }
    return { event, data };
}

// Consume the SSE body: parse frames, dispatch token chunks to onToken,
// call onFirstEvent once on the first real model event (not keepalives —
// they arrive before any content and would disarm the watchdog prematurely).
// Returns { tokenUsage, streamComplete }; throws on an error frame.
async function readChatStream(response, { onToken, onFirstEvent }) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let tokenUsage = null;
    let firstEvent = true;
    let streamComplete = false;

    const markFirstEvent = () => {
        if (firstEvent) { onFirstEvent(); firstEvent = false; }
    };

    outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { frames, remainder } = parseFrames(buffer);
        buffer = remainder;

        for (const frame of frames) {
            if (!frame.trim()) continue;
            const { event, data } = parseFrame(frame);

            if (event === 'token') {
                markFirstEvent();
                try {
                    const chunk = JSON.parse(data).chunk || '';
                    if (chunk) onToken(chunk);
                } catch (e) {
                    console.warn('Failed to parse token frame:', e);
                }
            } else if (event === 'done') {
                markFirstEvent();
                try {
                    tokenUsage = JSON.parse(data).token_usage || null;
                } catch (e) {
                    console.warn('Failed to parse done frame:', e);
                }
                streamComplete = true;
                break outer;
            } else if (event === 'error') {
                markFirstEvent();
                let msg = data;
                try { msg = JSON.parse(data).message || data; } catch (_) {}
                throw new Error(msg);
            }
        }
    }

    return { tokenUsage, streamComplete };
}

// --- Status bar shimmer ---

// Status lines shown while the model works: a few grounded ones, some
// Claude-Code-style nonsense gerunds, and some in forensic character.
const STATUS_MESSAGES = [
    'Reading schema…',
    'Generating SQL…',
    'Analyzing question…',
    'Flummering…',
    'Whatchamacalliting…',
    'Cogitating…',
    'Noodling…',
    'Percolating…',
    'Ruminating…',
    'Reticulating…',
    'Marinating…',
    'Mulling…',
    'Dusting for prints…',
    'Interrogating rows…',
    'Cross-examining tables…',
    'Following the foreign keys…',
    'Squinting at timestamps…',
    'Bagging evidence…'
];

// Build the rotating status shimmer in the status bar.
// softDismiss() honors the minimum display time; forceDismiss() clears
// immediately (used in the finally cleanup path).
function createStatusShimmer(statusBar) {
    // Shuffle a copy so each send gets its own rotation order
    const statusMessages = [...STATUS_MESSAGES];
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
    const shownAt = Date.now();

    const interval = setInterval(() => {
        statusIndex = (statusIndex + 1) % statusMessages.length;
        textSpan.textContent = statusMessages[statusIndex];
        const duration = 1.8 + Math.random() * 0.7;
        statusEl.style.setProperty('--shimmer-duration', duration.toFixed(2) + 's');
    }, SHIMMER_ROTATE_MS);

    return {
        softDismiss() {
            clearInterval(interval);
            const remaining = Math.max(0, SHIMMER_MIN_MS - (Date.now() - shownAt));
            setTimeout(() => statusBar.classList.remove('active'), remaining);
        },
        forceDismiss() {
            clearInterval(interval);
            statusBar.classList.remove('active');
        }
    };
}

// --- Error rendering ---

function renderChatError(pText, error) {
    const label = providerLabel(state.currentProvider);

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
        errorDetails.textContent = `The ${label} server did not start responding within ${WATCHDOG_MS / 1000} seconds.`;
    } else if (error.message.includes("503") || error.message.includes("Failed to fetch") || error.message.includes("LM Studio") || error.message.includes("Ollama")) {
        errorTitle.textContent = `Unable to connect to ${label}`;

        const helpList = document.createElement('ol');
        PROVIDER_HELP[state.currentProvider === 'ollama' ? 'ollama' : 'lmstudio'].forEach(item => {
            const li = document.createElement('li');
            li.textContent = item;
            helpList.appendChild(li);
        });

        const helpText = document.createElement('span');
        helpText.textContent = `Please check ${label}:`;
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
}

// Muted "generation stopped" marker appended after a user-initiated stop.
function appendStoppedNote(contentContainer) {
    const note = document.createElement('div');
    note.className = 'gen-stopped-note';
    note.textContent = '◼ generation stopped';
    contentContainer.appendChild(note);
}

// --- Stop control ---

// Abort the in-flight stream (wired to the Send button while streaming).
export function stopGeneration() {
    const controller = state.activeStreamController;
    if (controller) {
        controller.abortCause = 'user';
        controller.abort();
    }
}

// --- Send orchestration ---

export async function sendMessage() {
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const chatHistory = document.getElementById('chat-history');
    const welcomeScreen = document.getElementById('welcome-screen');

    const message = userInput.value.trim();
    if (!message) return;

    minimizeWelcomeScreen(welcomeScreen, chatHistory);

    // Save to input history (arrow-key recall) + visible query history panel
    state.inputHistory.push(message);
    state.historyIndex = -1;
    state.currentDraft = '';

    const userMsgIndex = document.querySelectorAll('.chat-message.user-message').length;
    state.queryHistory.push({ q: message, ts: Date.now(), msgIndex: userMsgIndex });
    renderQueryHistory(state.queryHistory);

    appendMessage(message, 'user');
    userInput.value = '';
    userInput.style.height = 'auto';
    userInput.disabled = true;

    // Send button becomes a Stop button while the stream is active.
    sendButton.classList.add('sending');
    sendButton.textContent = 'Stop';
    sendButton.setAttribute('aria-label', 'Stop generating');

    const shimmer = createStatusShimmer(document.getElementById('status-bar'));

    // Bot message container (created now but empty until streaming)
    const botMessageElement = appendMessage('', 'bot');
    const contentContainer = botMessageElement.querySelector('.content-container');
    const pText = document.createElement('p');
    contentContainer.appendChild(pText);

    // Abort previous stream if still active (rapid send protection)
    if (state.activeStreamController) {
        state.activeStreamController.abortCause = 'superseded';
        state.activeStreamController.abort();
    }
    const controller = new AbortController();
    state.activeStreamController = controller;
    const timeoutId = setTimeout(() => {
        controller.abortCause = 'watchdog';
        controller.abort();
    }, WATCHDOG_MS);

    let fullResponse = '';
    let renderPending = false; // rAF gate — prevents O(n²) re-renders during streaming

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
            let errData = null;
            try { errData = await response.json(); } catch (_) {} // body may be non-JSON
            throw new Error((errData && errData.error) || `HTTP Error: ${response.status}`);
        }

        const { tokenUsage, streamComplete } = await readChatStream(response, {
            onFirstEvent: () => clearTimeout(timeoutId), // disarm watchdog on first real model event
            onToken: (chunk) => {
                fullResponse += chunk;
                if (!renderPending) {
                    renderPending = true;
                    requestAnimationFrame(() => {
                        renderText(pText, fullResponse);
                        chatHistory.scrollTop = chatHistory.scrollHeight;
                        renderPending = false;
                    });
                }
            }
        });

        if (!streamComplete) {
            throw new Error("Connection to LLM timed out or was interrupted.");
        }

        // Final render (ensures any last partial buffer is flushed)
        renderText(pText, fullResponse);
        shimmer.softDismiss();

        // Add token counter to chat bubble if usage data available
        if (tokenUsage) {
            addTokenCounter(contentContainer, tokenUsage);
        }

        // SAVE THE ASSISTANT MESSAGE TO SESSION (with token usage)
        await fetchJson('/save_assistant_message', {
            content: fullResponse,
            token_usage: tokenUsage
        });

        // Execute SQL if present; capture timing + row count for the footer.
        const sqlStart = Date.now();
        const sqlResult = await executeSqlAndRender(fullResponse, contentContainer);
        if (sqlResult && sqlResult.ran) {
            setFooterMetrics({
                status: sqlResult.error ? 'error' : 'ready',
                timingMs: Date.now() - sqlStart,
                rows: sqlResult.rowCount,
            });
        }

    } catch (error) {
        const cause = error.name === 'AbortError' ? (controller.abortCause || 'watchdog') : null;

        if (cause === 'superseded') {
            // A newer message took over; drop this bubble silently.
            botMessageElement.remove();
        } else if (cause === 'user') {
            // Keep whatever streamed in; mark it stopped. SQL from a
            // truncated response is never executed.
            renderText(pText, fullResponse);
            appendStoppedNote(contentContainer);
            if (fullResponse) {
                try {
                    await fetchJson('/save_assistant_message', {
                        content: fullResponse,
                        token_usage: null
                    });
                } catch (e) {
                    console.warn('Failed to save stopped message:', e);
                }
            }
        } else {
            console.error('Chat Error:', error);
            renderChatError(pText, error);
        }
    } finally {
        clearTimeout(timeoutId); // Ensure cleanup
        shimmer.forceDismiss();
        if (state.activeStreamController === controller) {
            state.activeStreamController = null;
        }
        userInput.disabled = false;
        sendButton.classList.remove('sending');
        sendButton.textContent = 'Send';
        sendButton.setAttribute('aria-label', 'Send message');
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

    updateContextBar(cumulativeTotal);
}

// Header context bar. We don't know the model's real context window,
// so use a soft default (32k) — still useful as a "session heft" gauge.
const CONTEXT_WINDOW_SOFT = 32000;
function updateContextBar(cumulativeTokens) {
    const fill = document.getElementById('cp-context-fill');
    const count = document.getElementById('cp-context-count');
    if (!fill || !count) return;
    const pct = Math.min(100, (cumulativeTokens / CONTEXT_WINDOW_SOFT) * 100);
    fill.style.width = pct.toFixed(1) + '%';
    count.textContent = cumulativeTokens < 1000
        ? String(cumulativeTokens)
        : (cumulativeTokens / 1000).toFixed(1) + 'k';
}
