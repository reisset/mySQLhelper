// Shared application state — imported by modules that need cross-cutting state

export const state = {
    databaseLoaded: false,
    currentProvider: 'lmstudio',
    ollamaAvailable: false,
    selectedOllamaModel: null,
    statusCheckInterval: null,
    activeStreamController: null,
    inputHistory: [],
    historyIndex: -1,
    currentDraft: '',
    queryHistory: [], // visible bottom-left panel; entries: { q, ts, msgIndex }
    richSchema: {},
    contextTokens: 0,    // last completed turn's total_tokens — prompt already includes system+schema+history
    contextWindow: null, // model context window from /api/provider/status; null = unknown
};
