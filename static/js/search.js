// Search All Tables modal

import { escapeHtml, showAlertModal } from './ui.js';

export function showSearchModal() {
    // Remove existing modal if any
    const existing = document.getElementById('search-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'search-modal';
    modal.className = 'search-modal-overlay';
    modal.innerHTML = `
        <div class="search-modal" role="dialog" aria-modal="true" aria-labelledby="search-modal-title">
            <div class="search-modal-header">
                <h3 id="search-modal-title">Search All Tables</h3>
                <button class="search-modal-close">&times;</button>
            </div>
            <div class="search-modal-body">
                <div class="search-input-row">
                    <input type="text" id="search-term-input" placeholder="Enter search term..." autofocus>
                    <button id="execute-search-btn">Search</button>
                </div>
                <div class="search-options-row">
                    <label class="match-case-toggle">
                        <input type="checkbox" id="match-case-checkbox">
                        <span class="toggle-box"></span>
                        Match case
                    </label>
                </div>
                <div id="search-results-container"></div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => {
        document.removeEventListener('keydown', escHandler);
        modal.remove();
    };

    // Event listeners
    modal.querySelector('.search-modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Escape key closes modal
    const escHandler = (e) => {
        if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', escHandler);

    const searchInput = modal.querySelector('#search-term-input');
    const searchBtn = modal.querySelector('#execute-search-btn');
    const caseSensitive = modal.querySelector('#match-case-checkbox');

    searchBtn.addEventListener('click', () => executeTableSearch(searchInput.value, caseSensitive.checked));
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') executeTableSearch(searchInput.value, caseSensitive.checked);
    });

    searchInput.focus();
}

async function executeTableSearch(searchTerm, caseSensitive = false) {
    if (!searchTerm.trim()) {
        showAlertModal('Search', 'Please enter a search term.');
        return;
    }

    const resultsContainer = document.getElementById('search-results-container');
    resultsContainer.innerHTML = '<div class="search-loading">Searching...</div>';

    try {
        const response = await fetch('/search_all_tables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ search_term: searchTerm, case_sensitive: caseSensitive })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Search failed');
        }

        const data = await response.json();
        renderSearchResults(data, searchTerm, resultsContainer, caseSensitive);

    } catch (error) {
        console.error('Search error:', error);
        resultsContainer.innerHTML = `<div class="search-error">Error: ${escapeHtml(error.message)}</div>`;
    }
}

function renderSearchResults(data, searchTerm, container, caseSensitive = false) {
    if (data.total_matches === 0) {
        container.innerHTML = `<div class="search-no-results">No matches found for "${escapeHtml(searchTerm)}"</div>`;
        return;
    }

    let html = `<div class="search-summary">Found ${data.total_matches} matches in ${data.tables_with_matches} table(s)</div>`;

    for (const [tableName, tableData] of Object.entries(data.results)) {
        const moreCount = tableData.total_matches > 3 ? tableData.total_matches - 3 : 0;
        const safeTableName = escapeHtml(tableName);

        html += `<div class="search-table-card">`;
        html += `<div class="search-table-title">${safeTableName}</div>`;

        // Build column entries
        for (const [colName, values] of Object.entries(tableData.columns)) {
            const safeColName = escapeHtml(colName);

            // Escape values first, then highlight search term
            const highlightedValues = values.map(val => {
                const safeVal = escapeHtml(val);
                const safeSearchTerm = escapeHtml(searchTerm);
                const regex = caseSensitive
                    ? new RegExp(safeSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
                    : new RegExp(safeSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                return safeVal.replace(regex, match => `<mark>${match}</mark>`);
            });

            html += `<div class="search-column-entry">`;
            html += `<span class="search-col-name">${safeColName}:</span> `;
            html += `<span class="search-col-values">${highlightedValues.join(', ')}</span>`;
            html += `</div>`;
        }

        // Show "and X more" if there are more matches
        if (moreCount > 0) {
            html += `<div class="search-more-indicator">...and ${moreCount} more matches</div>`;
        }

        html += `</div>`;
    }

    container.innerHTML = html;
}
