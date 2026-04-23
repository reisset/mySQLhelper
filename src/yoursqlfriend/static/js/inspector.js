// Row Inspector: right-pane detail view with foreign-key navigation.

import { state } from './state.js';
import { escapeHtml, fetchJson } from './ui.js';

const inspectorStack = [];

export function showRowInInspector(row, tableName) {
    inspectorStack.length = 0;
    inspectorStack.push({ row, tableName });
    render();
}

function pushRelated(row, tableName) {
    inspectorStack.push({ row, tableName });
    render();
}

function popOne() {
    inspectorStack.pop();
    render();
}

function render() {
    const body = document.getElementById('rp-body');
    const sub = document.getElementById('rp-sub');
    if (!body) return;

    if (!inspectorStack.length) {
        sub.textContent = '';
        body.innerHTML = `<div class="rp-empty">Click any row in a results table to inspect it.<span class="hint">foreign keys become clickable links</span></div>`;
        return;
    }

    const current = inspectorStack[inspectorStack.length - 1];
    const { row, tableName } = current;
    const tableInfo = tableName ? state.richSchema[tableName] : null;
    const columns = tableInfo ? tableInfo.columns : Object.keys(row).map(n => ({ name: n, type: '', pk: false, fk: null }));
    const fks = tableInfo ? tableInfo.foreign_keys : [];

    sub.textContent = tableName ? tableName : '—';

    body.innerHTML = '';

    if (inspectorStack.length > 1) {
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'rp-back';
        back.textContent = '← back';
        back.addEventListener('click', popOne);
        body.appendChild(back);
    }

    const kv = document.createElement('div');
    kv.className = 'kv';

    const columnsByName = Object.fromEntries(columns.map(c => [c.name, c]));

    Object.keys(row).forEach(colName => {
        const k = document.createElement('div');
        k.className = 'k';
        k.textContent = colName;

        const v = document.createElement('div');
        v.className = 'v';
        const colInfo = columnsByName[colName];
        if (colInfo && colInfo.pk) v.classList.add('pk');

        const raw = row[colName];
        if (raw === null || raw === undefined || raw === '') {
            v.innerHTML = '<span class="null">null</span>';
        } else if (colInfo && colInfo.fk) {
            const fk = colInfo.fk;
            const link = document.createElement('span');
            link.className = 'fk';
            link.textContent = String(raw);
            link.title = `follow to ${fk.ref_table}.${fk.ref_column}`;
            link.addEventListener('click', () => followFk(fk.ref_table, fk.ref_column, raw));
            v.appendChild(link);
        } else {
            v.textContent = String(raw);
        }

        kv.appendChild(k);
        kv.appendChild(v);
    });
    body.appendChild(kv);

    if (fks && fks.length) {
        const pkColumn = (columns.find(c => c.pk) || {}).name;
        const pkValue = pkColumn ? row[pkColumn] : null;

        fks.forEach(fk => {
            const block = document.createElement('div');
            block.className = 'rel';
            block.innerHTML = `
                <div class="rel-head">
                    <span class="chev">↗</span>
                    <span>references</span>
                    <span class="nm">${escapeHtml(fk.ref_table)}.${escapeHtml(fk.ref_column)}</span>
                </div>
                <div class="rel-body" data-loading="1">loading…</div>
            `;
            body.appendChild(block);
            loadRelated(block.querySelector('.rel-body'), fk.ref_table, fk.ref_column, row[fk.column]);
        });

        // Reverse relationships: any other table whose FK points at this one
        const incoming = [];
        Object.entries(state.richSchema || {}).forEach(([otherTable, info]) => {
            if (otherTable === tableName) return;
            (info.foreign_keys || []).forEach(ofk => {
                if (ofk.ref_table === tableName && pkColumn && ofk.ref_column === pkColumn) {
                    incoming.push({ otherTable, otherColumn: ofk.column });
                }
            });
        });
        if (pkValue != null && incoming.length) {
            incoming.forEach(({ otherTable, otherColumn }) => {
                const block = document.createElement('div');
                block.className = 'rel';
                block.innerHTML = `
                    <div class="rel-head">
                        <span class="chev">↘</span>
                        <span>referenced by</span>
                        <span class="nm">${escapeHtml(otherTable)}.${escapeHtml(otherColumn)}</span>
                    </div>
                    <div class="rel-body" data-loading="1">loading…</div>
                `;
                body.appendChild(block);
                loadRelated(block.querySelector('.rel-body'), otherTable, otherColumn, pkValue);
            });
        }
    }
}

async function loadRelated(container, table, column, value) {
    try {
        const data = await fetchJson('/api/row/lookup', { table, column, value, limit: 25 });
        container.removeAttribute('data-loading');
        container.innerHTML = '';
        if (!data.rows || !data.rows.length) {
            container.innerHTML = '<div class="more">no matches</div>';
            return;
        }
        data.rows.slice(0, 10).forEach(r => {
            const row = document.createElement('div');
            row.className = 'rrow';
            const preview = Object.entries(r).slice(0, 3)
                .map(([k, v]) => `${k}=${v == null ? '∅' : String(v).slice(0, 24)}`)
                .join('  ');
            row.textContent = preview;
            row.title = 'open this row';
            row.addEventListener('click', () => pushRelated(r, table));
            container.appendChild(row);
        });
        if (data.rows.length > 10) {
            const more = document.createElement('div');
            more.className = 'more';
            more.textContent = `+${data.rows.length - 10} more`;
            container.appendChild(more);
        }
    } catch (e) {
        container.removeAttribute('data-loading');
        container.innerHTML = `<div class="more">error: ${escapeHtml(e.message)}</div>`;
    }
}

async function followFk(refTable, refColumn, value) {
    try {
        const data = await fetchJson('/api/row/lookup', { table: refTable, column: refColumn, value, limit: 1 });
        if (data.rows && data.rows.length) {
            pushRelated(data.rows[0], refTable);
        }
    } catch (e) {
        console.warn('followFk failed', e);
    }
}

export function resetInspector() {
    inspectorStack.length = 0;
    render();
}
