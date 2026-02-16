// SQL execution, result table rendering, CSV export

import { escapeHtml, downloadBlob, fetchJson } from './ui.js';
import { chartIconSVG, toggleChart } from './charts.js';

export async function executeSqlAndRender(fullText, contentContainer) {
    const sqlRegex = /```sql\n([\s\S]*?)\n```/;
    const match = fullText.match(sqlRegex);

    if (!match) return; // No SQL to execute

    const sqlQuery = match[1].trim();

    try {
        const data = await fetchJson('/execute_sql', { sql_query: sqlQuery });

        // Show auto-corrected badge if retry happened
        if (data.retried) {
            const badge = document.createElement('details');
            badge.className = 'auto-corrected-badge';
            const summary = document.createElement('summary');
            summary.textContent = 'Auto-corrected';
            badge.appendChild(summary);
            const detail = document.createElement('div');
            detail.className = 'auto-corrected-detail';
            detail.innerHTML = `<strong>Original:</strong><pre><code>${escapeHtml(data.original_sql)}</code></pre><strong>Corrected:</strong><pre><code>${escapeHtml(data.corrected_sql)}</code></pre>`;
            badge.appendChild(detail);
            contentContainer.appendChild(badge);
        }

        // Render Result Table
        if (data.query_results && data.query_results.length > 0) {
            appendResultsTable(data.query_results, contentContainer, sqlQuery);
        } else {
            const emptyState = document.createElement('div');
            emptyState.className = 'sql-empty-state';

            const icon = document.createElement('span');
            icon.className = 'empty-icon';
            icon.textContent = '∅';

            const text = document.createElement('span');
            text.textContent = 'Query executed successfully. No results returned.';

            emptyState.appendChild(icon);
            emptyState.appendChild(text);
            contentContainer.appendChild(emptyState);
        }

    } catch (error) {
        console.error('SQL Error:', error);
        const errorDiv = document.createElement('div');
        errorDiv.className = 'sql-error-message';
        errorDiv.setAttribute('role', 'alert');

        const icon = document.createElement('span');
        icon.className = 'error-icon';
        icon.textContent = '⚠';

        const text = document.createElement('span');
        text.textContent = `SQL Execution Error: ${error.message}`;

        errorDiv.appendChild(icon);
        errorDiv.appendChild(text);
        contentContainer.appendChild(errorDiv);
    }
}

export function appendResultsTable(queryResults, container, sqlQuery = '') {
    if (typeof gridjs === 'undefined') {
        console.error("Grid.js not loaded");
        return;
    }

    // Row count + chart button row
    const actionsRow = document.createElement('div');
    actionsRow.className = 'results-actions-row';

    const rowCountLabel = document.createElement('span');
    rowCountLabel.className = 'results-row-count';
    rowCountLabel.textContent = `${queryResults.length} rows returned`;
    actionsRow.appendChild(rowCountLabel);

    // CSV export button
    const actionsRight = document.createElement('div');
    actionsRight.className = 'results-actions-right';

    const csvBtn = document.createElement('button');
    csvBtn.className = 'csv-export-btn';
    csvBtn.textContent = 'CSV';
    csvBtn.title = 'Download results as CSV';
    csvBtn.setAttribute('aria-label', 'Download results as CSV');
    csvBtn.addEventListener('click', () => {
        downloadCSV(queryResults);
    });
    actionsRight.appendChild(csvBtn);

    if (typeof Chart !== 'undefined' && queryResults.length > 0) {
        const chartBtn = document.createElement('button');
        chartBtn.className = 'chart-toggle-btn';
        chartBtn.innerHTML = chartIconSVG() + ' Chart';
        chartBtn.title = 'Visualize as chart';
        chartBtn.setAttribute('aria-label', 'Toggle chart visualization');
        actionsRight.appendChild(chartBtn);

        chartBtn.addEventListener('click', () => {
            toggleChart(queryResults, container, chartBtn);
        });
    }

    actionsRow.appendChild(actionsRight);
    container.appendChild(actionsRow);

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'results-table-container';
    container.appendChild(tableWrapper);

    // Render Grid.js with built-in search (store reference for cleanup)
    const grid = new gridjs.Grid({
        columns: Object.keys(queryResults[0]),
        data: queryResults.map(row => Object.values(row)),
        pagination: { limit: 10, summary: true },
        search: { placeholder: 'Filter results...' },
        sort: { multiColumn: true },
        resizable: true,
        style: {
            table: { 'white-space': 'nowrap', 'font-size': '0.85rem', 'table-layout': 'auto', 'width': '100%' },
            th: { 'background-color': 'var(--background-lighter)', 'color': 'var(--foreground)', 'border': '1px solid var(--border)' },
            td: { 'background-color': 'var(--background-light)', 'color': 'var(--foreground)', 'border': '1px solid var(--border)' },
            footer: { 'background-color': 'var(--card)' }
        },
        className: { table: 'custom-grid-table', th: 'custom-grid-th', td: 'custom-grid-td', container: 'custom-grid-container' }
    }).render(tableWrapper);
    tableWrapper._gridInstance = grid;

    // Reset scroll on pagination to prevent sticky header clipping
    tableWrapper.addEventListener('click', (e) => {
        if (e.target.closest('.gridjs-pagination button')) {
            const wrapper = tableWrapper.querySelector('.gridjs-wrapper');
            if (wrapper) wrapper.scrollTop = 0;
        }
    });
}

// --- CSV Export ---

function downloadCSV(queryResults) {
    if (!queryResults || queryResults.length === 0) return;

    const columns = Object.keys(queryResults[0]);

    // RFC 4180: escape fields containing commas, quotes, or newlines
    const escapeField = (val) => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    };

    const header = columns.map(escapeField).join(',');
    const rows = queryResults.map(row =>
        columns.map(col => escapeField(row[col])).join(',')
    );
    const csv = header + '\n' + rows.join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, 'query_results.csv');
}

// --- Grid.js Cleanup ---
export function destroyAllGrids() {
    document.querySelectorAll('.results-table-container').forEach(wrapper => {
        if (wrapper._gridInstance) {
            wrapper._gridInstance.destroy();
            wrapper._gridInstance = null;
        }
    });
}
