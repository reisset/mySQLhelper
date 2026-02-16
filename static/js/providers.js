// LLM provider management: status polling, model selection

import { state } from './state.js';
import { showAlertModal } from './ui.js';

export async function checkProviderStatus() {
    try {
        const response = await fetch(`/api/provider/status?provider=${state.currentProvider}`);
        const data = await response.json();

        if (state.currentProvider === 'ollama') {
            state.ollamaAvailable = data.available;
            state.ollamaModels = data.models || [];
            state.selectedOllamaModel = data.selected_model;
        }

        updateProviderStatusUI(data.available, data.models || []);

    } catch (error) {
        console.error('Failed to check provider status:', error);
        updateProviderStatusUI(false, []);
    }
}

function updateProviderStatusUI(available, models) {
    const ollamaStatus = document.getElementById('ollama-status');
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    const modelSelector = document.getElementById('model-selector');
    const modelSelect = document.getElementById('ollama-model-select');

    if (!ollamaStatus || !statusIndicator || !statusText) return;

    ollamaStatus.style.display = 'flex';

    // Remove existing guidance if any
    const existingGuidance = document.querySelector('.llm-guidance');
    if (existingGuidance) existingGuidance.remove();

    if (available) {
        statusIndicator.classList.remove('offline');
        statusIndicator.classList.add('online');
        statusText.textContent = state.currentProvider === 'ollama' ? 'Ollama Connected' : 'LM Studio Connected';

        // Populate model dropdown for Ollama only
        if (state.currentProvider === 'ollama' && modelSelector && modelSelect) {
            modelSelector.style.display = 'block';
            modelSelect.disabled = false;
            modelSelect.innerHTML = '<option value="">Select model...</option>';

            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                if (model === state.selectedOllamaModel) {
                    option.selected = true;
                }
                modelSelect.appendChild(option);
            });

            // Auto-select first model if none selected
            if (!state.selectedOllamaModel && models.length > 0) {
                modelSelect.value = models[0];
                state.selectedOllamaModel = models[0];
                setOllamaModel(models[0]);
            }
        } else {
            // LM Studio - hide model selector
            if (modelSelector) modelSelector.style.display = 'none';
        }
    } else {
        statusIndicator.classList.remove('online');
        statusIndicator.classList.add('offline');
        statusText.textContent = state.currentProvider === 'ollama' ? 'Ollama Offline' : 'LM Studio Offline';
        if (modelSelector) modelSelector.style.display = 'none';
        if (modelSelect) modelSelect.disabled = true;

        // Add friendly guidance
        const guidanceDiv = document.createElement('div');
        guidanceDiv.className = 'llm-guidance';

        if (state.currentProvider === 'ollama') {
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
            state.selectedOllamaModel = model;
            console.log('Ollama model set to:', model);
        }
    } catch (error) {
        console.error('Failed to set model:', error);
        showAlertModal('Error', 'Failed to set Ollama model.');
    }
}

export function initProviderSelector() {
    const providerSelect = document.getElementById('llm-provider-select');
    if (!providerSelect) return;

    // Check status on page load for default provider
    checkProviderStatus();

    // Start polling for status
    if (!state.statusCheckInterval) {
        state.statusCheckInterval = setInterval(checkProviderStatus, 30000);
    }

    providerSelect.addEventListener('change', async (e) => {
        state.currentProvider = e.target.value;
        // Immediately check status for new provider
        await checkProviderStatus();
    });
}

export function initModelSelector() {
    const modelSelect = document.getElementById('ollama-model-select');
    if (!modelSelect) return;

    modelSelect.addEventListener('change', async (e) => {
        const model = e.target.value;
        if (!model) return;
        await setOllamaModel(model);
    });
}
