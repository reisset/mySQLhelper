// LLM provider management: status polling, model selection

import { state } from './state.js';
import { showAlertModal, fetchJson, updateContextBar } from './ui.js';

// Human-readable provider name, shared by chat errors and status UI.
export function providerLabel(provider) {
    return provider === 'ollama' ? 'Ollama' : 'LM Studio';
}

// Per-provider connection checklists, rendered both in the sidebar
// offline guidance and in chat connection-error messages.
export const PROVIDER_HELP = {
    ollama: [
        'Start the server: ollama serve',
        'Pull a model if needed (check with: ollama list)',
        'Check port 11434 is accessible'
    ],
    lmstudio: [
        'Open LM Studio and load a model',
        'Start the server (green bar at top)',
        'Check the port is set to 1234'
    ]
};

export async function checkProviderStatus() {
    try {
        const data = await fetchJson(`/api/provider/status?provider=${state.currentProvider}`);

        if (state.currentProvider === 'ollama') {
            state.ollamaAvailable = data.available;
            state.selectedOllamaModel = data.selected_model;
        }

        // Real model window (null when the provider can't report one); the 30s
        // poll + provider-switch re-check keep it fresh across model swaps.
        state.contextWindow = data.context_length || null;
        updateContextBar();

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
    const landingDot = document.getElementById('landing-llm-dot');
    const landingText = document.getElementById('landing-llm-text');

    if (!ollamaStatus || !statusIndicator || !statusText) return;

    if (landingDot) {
        landingDot.classList.toggle('ok', !!available);
        landingDot.classList.toggle('off', !available);
    }
    if (landingText) {
        const label = providerLabel(state.currentProvider);
        landingText.textContent = available ? `${label} connected` : `${label} offline`;
    }

    // Workbench header model indicator: show the active model (Ollama
    // selected model, or provider name for LM Studio which doesn't expose it).
    const cpModel = document.getElementById('cp-model');
    const cpModelName = document.getElementById('cp-model-name');
    if (cpModelName && cpModel) {
        let name;
        if (!available) {
            name = 'offline';
            cpModel.classList.add('off');
        } else if (state.currentProvider === 'ollama') {
            name = state.selectedOllamaModel || (models && models[0]) || 'Ollama';
            cpModel.classList.remove('off');
        } else {
            name = 'LM Studio';
            cpModel.classList.remove('off');
        }
        cpModelName.textContent = name;
    }

    ollamaStatus.style.display = 'flex';

    // Remove existing guidance if any
    const existingGuidance = document.querySelector('.llm-guidance');
    if (existingGuidance) existingGuidance.remove();

    if (available) {
        statusIndicator.classList.remove('offline');
        statusIndicator.classList.add('online');
        statusText.textContent = `${providerLabel(state.currentProvider)} Connected`;

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
        statusText.textContent = `${providerLabel(state.currentProvider)} Offline`;
        if (modelSelector) modelSelector.style.display = 'none';
        if (modelSelect) modelSelect.disabled = true;

        // Add friendly guidance (shared checklist, also used by chat errors)
        const guidanceDiv = document.createElement('div');
        guidanceDiv.className = 'llm-guidance';

        const guidanceIntro = document.createElement('p');
        guidanceIntro.textContent = `To connect ${providerLabel(state.currentProvider)}:`;
        const guidanceList = document.createElement('ol');
        PROVIDER_HELP[state.currentProvider === 'ollama' ? 'ollama' : 'lmstudio'].forEach(item => {
            const li = document.createElement('li');
            li.textContent = item;
            guidanceList.appendChild(li);
        });
        guidanceDiv.appendChild(guidanceIntro);
        guidanceDiv.appendChild(guidanceList);

        // Insert inside the left-pane provider section so offline help
        // lives where the user is configuring the provider.
        const providerSection = document.getElementById('provider-section');
        if (providerSection) {
            providerSection.appendChild(guidanceDiv);
        } else {
            ollamaStatus.parentNode.insertBefore(guidanceDiv, ollamaStatus.nextSibling);
        }
    }
}

async function setOllamaModel(model) {
    try {
        await fetchJson('/api/ollama/model', { model: model });
        state.selectedOllamaModel = model;
        const cpModelName = document.getElementById('cp-model-name');
        if (cpModelName) cpModelName.textContent = model;
        console.log('Ollama model set to:', model);
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

    // Clear existing interval before creating a new one
    if (state.statusCheckInterval) {
        clearInterval(state.statusCheckInterval);
    }
    state.statusCheckInterval = setInterval(checkProviderStatus, 30000);

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
