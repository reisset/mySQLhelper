// Schema ER Diagram: modal, layout, SVG rendering, interactions

import { escapeHtml } from './ui.js';

export async function showERDiagramModal() {
    const existing = document.getElementById('er-diagram-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'er-diagram-modal';
    modal.className = 'er-modal-overlay';
    modal.innerHTML = `
        <div class="er-modal" role="dialog" aria-modal="true" aria-labelledby="er-modal-title">
            <div class="er-modal-header">
                <h3 id="er-modal-title">Schema Diagram</h3>
                <button class="er-modal-close" aria-label="Close diagram">&times;</button>
            </div>
            <div class="er-modal-body">
                <div class="er-loading">Loading schema...</div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => {
        document.removeEventListener('keydown', escHandler);
        modal.remove();
    };

    modal.querySelector('.er-modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    const escHandler = (e) => {
        if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', escHandler);

    modal.querySelector('.er-modal-close').focus();

    try {
        const response = await fetch('/api/schema/diagram');
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to load schema');
        }
        const schemaData = await response.json();

        if (schemaData.tables.length === 0) {
            modal.querySelector('.er-modal-body').innerHTML =
                '<div class="er-empty">No tables found in the database.</div>';
            return;
        }

        renderERDiagram(schemaData, modal.querySelector('.er-modal-body'));

    } catch (error) {
        console.error('ER diagram error:', error);
        modal.querySelector('.er-modal-body').innerHTML =
            `<div class="er-error">Error: ${escapeHtml(error.message)}</div>`;
    }
}

function layoutTables(tables, relationships, width, height) {
    const tableCount = tables.length;
    const positions = [];

    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.35;

    for (let i = 0; i < tableCount; i++) {
        const angle = (2 * Math.PI * i) / tableCount;
        positions.push({
            x: centerX + radius * Math.cos(angle),
            y: centerY + radius * Math.sin(angle),
            vx: 0,
            vy: 0
        });
    }

    // Build adjacency lookup
    const adjacency = new Set();
    relationships.forEach(rel => {
        const fromIdx = tables.findIndex(t => t.name === rel.from_table);
        const toIdx = tables.findIndex(t => t.name === rel.to_table);
        if (fromIdx >= 0 && toIdx >= 0) {
            adjacency.add(`${fromIdx}-${toIdx}`);
            adjacency.add(`${toIdx}-${fromIdx}`);
        }
    });

    // Estimate table dimensions
    const tableDims = tables.map(t => ({
        w: Math.max(160, Math.max(t.name.length * 9, ...t.columns.map(c => (c.name.length + c.type.length + 2) * 7)) + 40),
        h: 32 + t.columns.length * 20 + 10
    }));

    // Force-directed simulation
    const iterations = 150;
    for (let iter = 0; iter < iterations; iter++) {
        const damping = 0.85;
        const temp = 1 - (iter / iterations);

        for (let i = 0; i < tableCount; i++) {
            let fx = 0, fy = 0;

            for (let j = 0; j < tableCount; j++) {
                if (i === j) continue;

                const dx = positions[i].x - positions[j].x;
                const dy = positions[i].y - positions[j].y;
                const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);

                // Repulsion
                const repulse = 50000 / (dist * dist);
                fx += (dx / dist) * repulse;
                fy += (dy / dist) * repulse;

                // Attraction for connected tables
                if (adjacency.has(`${i}-${j}`)) {
                    const idealDist = 250;
                    const attract = (dist - idealDist) * 0.05;
                    fx -= (dx / dist) * attract;
                    fy -= (dy / dist) * attract;
                }
            }

            // Centering force
            fx -= (positions[i].x - centerX) * 0.001;
            fy -= (positions[i].y - centerY) * 0.001;

            positions[i].vx = (positions[i].vx + fx) * damping * temp;
            positions[i].vy = (positions[i].vy + fy) * damping * temp;
        }

        for (let i = 0; i < tableCount; i++) {
            positions[i].x += positions[i].vx;
            positions[i].y += positions[i].vy;
        }
    }

    return positions.map((pos, i) => ({
        x: pos.x,
        y: pos.y,
        w: tableDims[i].w,
        h: tableDims[i].h
    }));
}

function renderERDiagram(schemaData, container) {
    container.innerHTML = '';

    const { tables, relationships } = schemaData;

    const svgWidth = Math.max(800, tables.length * 250);
    const svgHeight = Math.max(600, tables.length * 200);

    const layout = layoutTables(tables, relationships, svgWidth, svgHeight);

    // Calculate bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    layout.forEach(pos => {
        minX = Math.min(minX, pos.x - 40);
        minY = Math.min(minY, pos.y - 40);
        maxX = Math.max(maxX, pos.x + pos.w + 40);
        maxY = Math.max(maxY, pos.y + pos.h + 40);
    });

    const viewBoxW = maxX - minX;
    const viewBoxH = maxY - minY;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'er-svg');
    svg.setAttribute('viewBox', `${minX} ${minY} ${viewBoxW} ${viewBoxH}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');

    // Defs
    const defs = document.createElementNS(svgNS, 'defs');
    const marker = document.createElementNS(svgNS, 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('refX', '10');
    marker.setAttribute('refY', '3.5');
    marker.setAttribute('orient', 'auto');
    const arrow = document.createElementNS(svgNS, 'polygon');
    arrow.setAttribute('points', '0 0, 10 3.5, 0 7');
    arrow.setAttribute('class', 'er-arrow');
    marker.appendChild(arrow);
    defs.appendChild(marker);
    svg.appendChild(defs);

    // Relationship layer (behind tables)
    const relGroup = document.createElementNS(svgNS, 'g');
    relGroup.setAttribute('class', 'er-relationships');
    svg.appendChild(relGroup);

    // Table layer
    const tableGroup = document.createElementNS(svgNS, 'g');
    tableGroup.setAttribute('class', 'er-tables');
    svg.appendChild(tableGroup);

    const tableElements = [];

    // Render tables
    tables.forEach((table, i) => {
        const pos = layout[i];
        const g = document.createElementNS(svgNS, 'g');
        g.setAttribute('class', 'er-table-group');
        g.setAttribute('data-table', table.name);
        g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);

        const headerHeight = 32;
        const colHeight = 20;
        const bodyHeight = table.columns.length * colHeight + 8;
        const totalHeight = headerHeight + bodyHeight;
        const tableWidth = pos.w;

        g._erData = { x: pos.x, y: pos.y, w: tableWidth, h: totalHeight, table: table.name };

        // Full background rect (rounded)
        const bgRect = document.createElementNS(svgNS, 'rect');
        bgRect.setAttribute('x', 0);
        bgRect.setAttribute('y', 0);
        bgRect.setAttribute('width', tableWidth);
        bgRect.setAttribute('height', totalHeight);
        bgRect.setAttribute('rx', 6);
        bgRect.setAttribute('class', 'er-table-bg');
        g.appendChild(bgRect);

        // Header rect
        const headerRect = document.createElementNS(svgNS, 'rect');
        headerRect.setAttribute('x', 0);
        headerRect.setAttribute('y', 0);
        headerRect.setAttribute('width', tableWidth);
        headerRect.setAttribute('height', headerHeight);
        headerRect.setAttribute('rx', 6);
        headerRect.setAttribute('class', 'er-table-header');
        g.appendChild(headerRect);

        // Square off header bottom corners
        const headerFix = document.createElementNS(svgNS, 'rect');
        headerFix.setAttribute('x', 0);
        headerFix.setAttribute('y', headerHeight - 6);
        headerFix.setAttribute('width', tableWidth);
        headerFix.setAttribute('height', 6);
        headerFix.setAttribute('class', 'er-table-header');
        g.appendChild(headerFix);

        // Header text
        const headerText = document.createElementNS(svgNS, 'text');
        headerText.setAttribute('x', tableWidth / 2);
        headerText.setAttribute('y', 21);
        headerText.setAttribute('text-anchor', 'middle');
        headerText.setAttribute('class', 'er-table-name');
        headerText.textContent = table.name;
        g.appendChild(headerText);

        // Separator line
        const sep = document.createElementNS(svgNS, 'line');
        sep.setAttribute('x1', 0);
        sep.setAttribute('y1', headerHeight);
        sep.setAttribute('x2', tableWidth);
        sep.setAttribute('y2', headerHeight);
        sep.setAttribute('class', 'er-separator');
        g.appendChild(sep);

        // Columns
        table.columns.forEach((col, ci) => {
            const y = headerHeight + 4 + (ci + 1) * colHeight - 4;

            // PK indicator
            if (col.pk) {
                const pkText = document.createElementNS(svgNS, 'text');
                pkText.setAttribute('x', 8);
                pkText.setAttribute('y', y);
                pkText.setAttribute('class', 'er-pk-label');
                pkText.textContent = 'PK';
                g.appendChild(pkText);
            }

            // Check if this column is a FK
            const isFK = relationships.some(r => r.from_table === table.name && r.from_column === col.name);

            // Column name
            const colText = document.createElementNS(svgNS, 'text');
            colText.setAttribute('x', col.pk ? 30 : 12);
            colText.setAttribute('y', y);
            colText.setAttribute('class', 'er-col-name' + (isFK ? ' er-fk' : ''));
            colText.textContent = col.name;
            g.appendChild(colText);

            // Column type (right-aligned)
            const typeText = document.createElementNS(svgNS, 'text');
            typeText.setAttribute('x', tableWidth - 8);
            typeText.setAttribute('y', y);
            typeText.setAttribute('text-anchor', 'end');
            typeText.setAttribute('class', 'er-col-type');
            typeText.textContent = col.type;
            g.appendChild(typeText);
        });

        pos.h = totalHeight;
        tableGroup.appendChild(g);
        tableElements.push(g);
    });

    // Render relationship lines
    relationships.forEach(rel => {
        const fromEl = tableElements.find(el => el._erData.table === rel.from_table);
        const toEl = tableElements.find(el => el._erData.table === rel.to_table);
        if (!fromEl || !toEl) return;

        const from = fromEl._erData;
        const to = toEl._erData;

        const fromCX = from.x + from.w / 2;
        const fromCY = from.y + from.h / 2;
        const toCX = to.x + to.w / 2;
        const toCY = to.y + to.h / 2;

        let x1, y1, x2, y2;
        if (fromCX < toCX) {
            x1 = from.x + from.w; y1 = fromCY;
            x2 = to.x;            y2 = toCY;
        } else {
            x1 = from.x;          y1 = fromCY;
            x2 = to.x + to.w;     y2 = toCY;
        }

        const midX = (x1 + x2) / 2;
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
        path.setAttribute('class', 'er-relationship-line');
        path.setAttribute('marker-end', 'url(#arrowhead)');
        path.setAttribute('data-from', rel.from_table);
        path.setAttribute('data-to', rel.to_table);
        relGroup.appendChild(path);

        // Label at midpoint
        const label = document.createElementNS(svgNS, 'text');
        label.setAttribute('x', midX);
        label.setAttribute('y', (y1 + y2) / 2 - 6);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('class', 'er-rel-label');
        label.textContent = `${rel.from_column} \u2192 ${rel.to_column}`;
        relGroup.appendChild(label);
    });

    // No-FK notice
    if (relationships.length === 0) {
        const notice = document.createElementNS(svgNS, 'text');
        notice.setAttribute('x', minX + viewBoxW / 2);
        notice.setAttribute('y', minY + 20);
        notice.setAttribute('text-anchor', 'middle');
        notice.setAttribute('class', 'er-no-fk-notice');
        notice.textContent = 'No foreign key relationships declared in this database';
        svg.appendChild(notice);
    }

    container.appendChild(svg);
    initERInteractions(svg, tableElements);
}

function initERInteractions(svg, tableElements) {
    let dragTarget = null;
    let dragOffset = { x: 0, y: 0 };
    let isPanning = false;
    let panStart = { x: 0, y: 0 };
    let viewBoxStart = null;
    let highlightedTable = null;

    function getSVGPoint(e) {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        return pt.matrixTransform(svg.getScreenCTM().inverse());
    }

    // Table drag
    tableElements.forEach(g => {
        g.style.cursor = 'grab';

        g.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            dragTarget = g;
            const pt = getSVGPoint(e);
            dragOffset.x = pt.x - g._erData.x;
            dragOffset.y = pt.y - g._erData.y;
            g.style.cursor = 'grabbing';
            svg.style.cursor = 'grabbing';
        });
    });

    svg.addEventListener('mousemove', (e) => {
        if (dragTarget) {
            const pt = getSVGPoint(e);
            const newX = pt.x - dragOffset.x;
            const newY = pt.y - dragOffset.y;
            dragTarget.setAttribute('transform', `translate(${newX}, ${newY})`);
            dragTarget._erData.x = newX;
            dragTarget._erData.y = newY;
            updateRelationshipLines(svg, tableElements);
        } else if (isPanning) {
            const dx = (e.clientX - panStart.x) / svg.getScreenCTM().a;
            const dy = (e.clientY - panStart.y) / svg.getScreenCTM().d;
            const vb = viewBoxStart;
            svg.setAttribute('viewBox', `${vb[0] - dx} ${vb[1] - dy} ${vb[2]} ${vb[3]}`);
        }
    });

    svg.addEventListener('mouseup', () => {
        if (dragTarget) {
            dragTarget.style.cursor = 'grab';
            svg.style.cursor = 'default';
            dragTarget = null;
        }
        isPanning = false;
    });

    svg.addEventListener('mouseleave', () => {
        if (dragTarget) {
            dragTarget.style.cursor = 'grab';
            svg.style.cursor = 'default';
            dragTarget = null;
        }
        isPanning = false;
    });

    // Pan background
    svg.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target === svg || e.target.closest('.er-relationships')) {
            isPanning = true;
            panStart = { x: e.clientX, y: e.clientY };
            viewBoxStart = svg.getAttribute('viewBox').split(' ').map(Number);
        }
    });

    // Zoom
    svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const vb = svg.getAttribute('viewBox').split(' ').map(Number);
        const scale = e.deltaY > 0 ? 1.1 : 0.9;

        const pt = getSVGPoint(e);
        const newW = vb[2] * scale;
        const newH = vb[3] * scale;
        const newX = pt.x - (pt.x - vb[0]) * scale;
        const newY = pt.y - (pt.y - vb[1]) * scale;

        svg.setAttribute('viewBox', `${newX} ${newY} ${newW} ${newH}`);
    }, { passive: false });

    // Click table to highlight
    tableElements.forEach(g => {
        g.addEventListener('click', (e) => {
            if (dragTarget) return;
            e.stopPropagation();
            const tableName = g.getAttribute('data-table');

            if (highlightedTable === tableName) {
                clearERHighlight(svg);
                highlightedTable = null;
                return;
            }

            highlightedTable = tableName;
            highlightERTable(svg, tableName);
        });
    });

    // Click background to clear
    svg.addEventListener('click', (e) => {
        if (e.target === svg || e.target.closest('.er-relationships')) {
            clearERHighlight(svg);
            highlightedTable = null;
        }
    });
}

function updateRelationshipLines(svg, tableElements) {
    const lines = svg.querySelectorAll('.er-relationship-line');
    const labels = svg.querySelectorAll('.er-rel-label');

    lines.forEach((path, idx) => {
        const fromName = path.getAttribute('data-from');
        const toName = path.getAttribute('data-to');

        const fromEl = tableElements.find(el => el._erData.table === fromName);
        const toEl = tableElements.find(el => el._erData.table === toName);
        if (!fromEl || !toEl) return;

        const from = fromEl._erData;
        const to = toEl._erData;

        const fromCX = from.x + from.w / 2;
        const fromCY = from.y + from.h / 2;
        const toCX = to.x + to.w / 2;
        const toCY = to.y + to.h / 2;

        let x1, y1, x2, y2;
        if (fromCX < toCX) {
            x1 = from.x + from.w; y1 = fromCY;
            x2 = to.x;            y2 = toCY;
        } else {
            x1 = from.x;          y1 = fromCY;
            x2 = to.x + to.w;     y2 = toCY;
        }

        const midX = (x1 + x2) / 2;
        path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);

        if (labels[idx]) {
            labels[idx].setAttribute('x', midX);
            labels[idx].setAttribute('y', (y1 + y2) / 2 - 6);
        }
    });
}

function highlightERTable(svg, tableName) {
    svg.querySelectorAll('.er-table-group').forEach(g => {
        g.classList.add('er-dimmed');
        g.classList.remove('er-highlighted');
    });
    svg.querySelectorAll('.er-relationship-line').forEach(line => {
        line.classList.add('er-dimmed');
        line.classList.remove('er-highlighted');
    });
    svg.querySelectorAll('.er-rel-label').forEach(label => {
        label.classList.add('er-dimmed');
    });

    const targetGroup = svg.querySelector(`.er-table-group[data-table="${CSS.escape(tableName)}"]`);
    if (targetGroup) {
        targetGroup.classList.remove('er-dimmed');
        targetGroup.classList.add('er-highlighted');
    }

    svg.querySelectorAll('.er-relationship-line').forEach((line, idx) => {
        const from = line.getAttribute('data-from');
        const to = line.getAttribute('data-to');
        if (from === tableName || to === tableName) {
            line.classList.remove('er-dimmed');
            line.classList.add('er-highlighted');

            const connectedName = from === tableName ? to : from;
            const connGroup = svg.querySelector(`.er-table-group[data-table="${CSS.escape(connectedName)}"]`);
            if (connGroup) {
                connGroup.classList.remove('er-dimmed');
                connGroup.classList.add('er-highlighted');
            }

            const labels = svg.querySelectorAll('.er-rel-label');
            if (labels[idx]) {
                labels[idx].classList.remove('er-dimmed');
            }
        }
    });
}

function clearERHighlight(svg) {
    svg.querySelectorAll('.er-dimmed').forEach(el => el.classList.remove('er-dimmed'));
    svg.querySelectorAll('.er-highlighted').forEach(el => el.classList.remove('er-highlighted'));
}
