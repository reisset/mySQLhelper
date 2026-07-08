// SQL execution, result table rendering, CSV export

import { escapeHtml, downloadBlob, fetchJson } from './ui.js';
import { showRowInInspector } from './inspector.js';

function inferTableName(sqlQuery) {
    if (!sqlQuery) return null;
    const stripped = sqlQuery.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const match = stripped.match(/\bFROM\s+["'`]?([A-Za-z_][\w]*)["'`]?/i);
    return match ? match[1] : null;
}

// Mirrors the backend's extract_sql_from_response() tiers (llm.py), with one
// difference: chat answers mix prose and code, so untagged fences and bare
// text only count when they start with an allowed statement keyword —
// otherwise a fenced JSON/example block would trigger a spurious execution
// error. Server-side validate_sql() remains the security boundary.
const TAGGED_SQL_RE = /```(?:sqlite|sql)[ \t]*\r?\n?([\s\S]*?)```/i;
const ANY_FENCE_RE = /```[^\n`]*\r?\n([\s\S]*?)```/;
const SQL_START_RE = /^(SELECT|WITH|EXPLAIN|PRAGMA)\b/i;

function extractSql(fullText) {
    const tagged = fullText.match(TAGGED_SQL_RE);
    if (tagged) return tagged[1].trim() || null;
    const fence = fullText.match(ANY_FENCE_RE);
    const candidate = (fence ? fence[1] : fullText).trim();
    return SQL_START_RE.test(candidate) ? candidate : null;
}

export async function executeSqlAndRender(fullText, contentContainer) {
    const sqlQuery = extractSql(fullText);
    if (!sqlQuery) return { ran: false }; // No SQL to execute

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
        const rowCount = (data.query_results && data.query_results.length) || 0;
        if (rowCount > 0) {
            appendResultsTable(data.query_results, contentContainer, sqlQuery, !!data.truncated);
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

        return { ran: true, rowCount };

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
        return { ran: true, error: true, rowCount: 0 };
    }
}

export function appendResultsTable(queryResults, container, sqlQuery = '', truncated = false) {
    if (typeof gridjs === 'undefined') {
        console.error("Grid.js not loaded");
        return;
    }

    // Truncation must be loudly visible: "2000 rows returned" with more
    // matching rows silently dropped misrepresents the evidence.
    if (truncated) {
        const note = document.createElement('div');
        note.className = 'results-truncation-note';
        note.setAttribute('role', 'status');
        note.textContent = `⚠ Results truncated: only the first ${queryResults.length.toLocaleString()} rows are shown. More rows matched — narrow the query (filters, LIMIT/OFFSET) to see the rest.`;
        container.appendChild(note);
    }

    // Row count + CSV export row
    const actionsRow = document.createElement('div');
    actionsRow.className = 'results-actions-row';

    const rowCountLabel = document.createElement('span');
    rowCountLabel.className = 'results-row-count';
    rowCountLabel.textContent = truncated
        ? `first ${queryResults.length.toLocaleString()} rows (truncated)`
        : `${queryResults.length} rows returned`;
    actionsRow.appendChild(rowCountLabel);

    // CSV export button
    const actionsRight = document.createElement('div');
    actionsRight.className = 'results-actions-right';

    const csvBtn = document.createElement('button');
    csvBtn.className = 'csv-export-btn';
    csvBtn.textContent = 'CSV';
    csvBtn.title = truncated ? 'Download the first rows only (result set was truncated)' : 'Download results as CSV';
    csvBtn.setAttribute('aria-label', csvBtn.title);
    csvBtn.addEventListener('click', () => {
        downloadCSV(queryResults, truncated);
    });
    actionsRight.appendChild(csvBtn);

    actionsRow.appendChild(actionsRight);
    container.appendChild(actionsRow);

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'results-table-container';
    container.appendChild(tableWrapper);

    const inferredTable = inferTableName(sqlQuery);

    // Render Grid.js with built-in search (store reference for cleanup)
    const grid = new gridjs.Grid({
        columns: Object.keys(queryResults[0]),
        data: queryResults.map(row => Object.values(row)),
        pagination: { limit: 10, summary: true },
        search: { placeholder: 'Filter results...' },
        sort: { multiColumn: true },
        resizable: true,
        style: {
            table: { 'white-space': 'nowrap', 'table-layout': 'auto', 'width': '100%' }
        }
    }).render(tableWrapper);
    tableWrapper._gridInstance = grid;
    tableWrapper._resultData = queryResults;
    tableWrapper._tableName = inferredTable;

    // Select a data row: highlight it and feed it to the Row Inspector.
    function selectRow(tr) {
        if (!tr || !tr.parentElement || tr.parentElement.tagName !== 'TBODY') return;
        const tbody = tr.parentElement;

        const cols = Object.keys(queryResults[0] || {});
        const cells = tr.querySelectorAll('td.gridjs-td');
        const rowObj = {};
        cells.forEach((cell, i) => {
            if (cols[i]) rowObj[cols[i]] = cell.textContent;
        });

        tbody.querySelectorAll('tr.row-selected').forEach(r => r.classList.remove('row-selected'));
        tr.classList.add('row-selected');

        showRowInInspector(rowObj, inferredTable);
    }

    // Row clicks feed the Row Inspector; pagination clicks reset scroll.
    tableWrapper.addEventListener('click', (e) => {
        if (e.target.closest('.gridjs-pagination button')) {
            const wrapper = tableWrapper.querySelector('.gridjs-wrapper');
            if (wrapper) wrapper.scrollTop = 0;
            return;
        }
        selectRow(e.target.closest('tr.gridjs-tr'));
    });

    // Keyboard path to the Row Inspector: rows are focusable, Enter/Space selects.
    tableWrapper.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const tr = e.target.closest('tr.gridjs-tr');
        if (!tr) return;
        e.preventDefault();
        selectRow(tr);
    });

    // Grid.js rebuilds the tbody on pagination/sort/filter — reapply
    // focusability whenever rows are (re)rendered.
    const makeRowsFocusable = () => {
        tableWrapper.querySelectorAll('tbody tr.gridjs-tr:not([tabindex])').forEach(tr => {
            tr.setAttribute('tabindex', '0');
        });
    };
    makeRowsFocusable();
    const rowObserver = new MutationObserver(makeRowsFocusable);
    rowObserver.observe(tableWrapper, { childList: true, subtree: true });
    tableWrapper._rowObserver = rowObserver; // disconnected in destroyAllGrids
}

// --- CSV Export ---

function downloadCSV(queryResults, truncated = false) {
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
    // Truncated exports are flagged in the filename so a saved file can't
    // masquerade as the complete result set later.
    downloadBlob(blob, truncated ? 'query_results_TRUNCATED.csv' : 'query_results.csv');
}

// --- Grid.js Cleanup ---
export function destroyAllGrids() {
    document.querySelectorAll('.results-table-container').forEach(wrapper => {
        if (wrapper._gridInstance) {
            wrapper._gridInstance.destroy();
            wrapper._gridInstance = null;
        }
        if (wrapper._rowObserver) {
            wrapper._rowObserver.disconnect();
            wrapper._rowObserver = null;
        }
    });
}
