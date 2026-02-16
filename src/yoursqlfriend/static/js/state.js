// Shared application state — imported by modules that need cross-cutting state

export const state = {
    databaseLoaded: false,
    currentProvider: 'lmstudio',
    ollamaAvailable: false,
    ollamaModels: [],
    selectedOllamaModel: null,
    statusCheckInterval: null,
    activeStreamController: null,
    inputHistory: [],
    historyIndex: -1,
    currentDraft: '',
};
