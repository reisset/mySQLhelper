// Chart visualization: detection, rendering, theme updates

export function chartIconSVG() {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="12" width="4" height="9"></rect><rect x="10" y="7" width="4" height="14"></rect><rect x="17" y="3" width="4" height="18"></rect></svg>';
}

export function detectChartType(queryResults) {
    if (!queryResults || queryResults.length === 0) return null;

    const columns = Object.keys(queryResults[0]);
    if (columns.length < 2) return null;

    // Classify columns as numeric or text
    const colTypes = {};
    for (const col of columns) {
        const sampleValues = queryResults.slice(0, 50).map(row => row[col]).filter(v => v !== null && v !== '');
        const numericCount = sampleValues.filter(v => typeof v === 'number' || (!isNaN(Number(v)) && String(v).trim() !== '')).length;
        colTypes[col] = (numericCount / Math.max(sampleValues.length, 1)) > 0.7 ? 'numeric' : 'text';
    }

    const numericCols = columns.filter(c => colTypes[c] === 'numeric');
    const textCols = columns.filter(c => colTypes[c] === 'text');

    // 1 text/date column + 1+ numeric columns → bar
    if (textCols.length === 1 && numericCols.length >= 1) {
        return { type: 'bar', labelCol: textCols[0], dataCols: numericCols };
    }

    // 2 columns, both numeric → scatter
    if (columns.length === 2 && numericCols.length === 2) {
        return { type: 'scatter', xCol: numericCols[0], yCol: numericCols[1], dataCols: numericCols };
    }

    // 1 text + 1 numeric, ≤20 rows → pie
    if (textCols.length === 1 && numericCols.length === 1 && queryResults.length <= 20) {
        return { type: 'pie', labelCol: textCols[0], dataCols: numericCols };
    }

    // Multiple numeric + at least 1 text → bar with first text as labels
    if (numericCols.length >= 1 && textCols.length >= 1) {
        return { type: 'bar', labelCol: textCols[0], dataCols: numericCols };
    }

    // 2+ numeric, no text → use row index
    if (numericCols.length >= 2) {
        return { type: 'bar', labelCol: null, dataCols: numericCols };
    }

    return null;
}

export function toggleChart(queryResults, container, chartBtn) {
    const existingChart = container.querySelector('.chart-container');
    if (existingChart) {
        const canvas = existingChart.querySelector('canvas');
        if (canvas) {
            const inst = Chart.getChart(canvas);
            if (inst) inst.destroy();
        }
        existingChart.remove();
        chartBtn.classList.remove('active');
        return;
    }

    const detection = detectChartType(queryResults);
    if (!detection) {
        const msg = document.createElement('div');
        msg.className = 'chart-not-suitable';
        msg.textContent = 'Data not suitable for charting. Need at least 1 label column and 1 numeric column.';
        container.appendChild(msg);
        setTimeout(() => msg.remove(), 4000);
        return;
    }

    chartBtn.classList.add('active');

    const chartContainer = document.createElement('div');
    chartContainer.className = 'chart-container';

    // Store data for theme updates
    chartContainer._chartData = { queryResults, detection };

    const typeSelector = document.createElement('div');
    typeSelector.className = 'chart-type-selector';
    const types = ['bar', 'line', 'pie', 'scatter'];
    types.forEach(type => {
        const btn = document.createElement('button');
        btn.className = 'chart-type-btn' + (type === detection.type ? ' active' : '');
        btn.textContent = type.charAt(0).toUpperCase() + type.slice(1);
        btn.addEventListener('click', () => {
            typeSelector.querySelectorAll('.chart-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderChart(canvas, queryResults, detection, type);
        });
        typeSelector.appendChild(btn);
    });
    chartContainer.appendChild(typeSelector);

    const canvas = document.createElement('canvas');
    canvas.className = 'chart-canvas';
    chartContainer.appendChild(canvas);

    container.appendChild(chartContainer);
    renderChart(canvas, queryResults, detection, detection.type);
}

export function renderChart(canvas, queryResults, detection, chartType) {
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

    const gridColor = isDark ? 'rgba(42, 42, 58, 0.8)' : 'rgba(200, 200, 208, 0.8)';
    const textColor = isDark ? '#8a8a9a' : '#4a4a5a';
    const legendColor = isDark ? '#e8e8ec' : '#1a1a24';

    const palette = isDark
        ? ['#f0a030', '#40d0d0', '#40c060', '#e0a020', '#a070e0', '#4090f0', '#e06060', '#60e0a0']
        : ['#b06800', '#006868', '#30a050', '#b07800', '#7050b0', '#3070c0', '#c04040', '#40b080'];

    let labels;
    if (detection.labelCol) {
        labels = queryResults.map(row => {
            const val = row[detection.labelCol];
            return String(val).length > 25 ? String(val).substring(0, 22) + '...' : String(val);
        });
    } else {
        labels = queryResults.map((_, i) => `Row ${i + 1}`);
    }

    let datasets;
    if (chartType === 'scatter') {
        const xCol = detection.dataCols[0];
        const yCol = detection.dataCols[1];
        datasets = [{
            label: `${xCol} vs ${yCol}`,
            data: queryResults.map(row => ({
                x: Number(row[xCol]) || 0,
                y: Number(row[yCol]) || 0
            })),
            backgroundColor: palette[0] + '80',
            borderColor: palette[0],
            pointRadius: 4
        }];
    } else if (chartType === 'pie') {
        datasets = [{
            data: queryResults.map(row => Number(row[detection.dataCols[0]]) || 0),
            backgroundColor: palette.slice(0, queryResults.length).map(c => c + 'cc'),
            borderColor: palette.slice(0, queryResults.length),
            borderWidth: 1
        }];
    } else {
        datasets = detection.dataCols.map((col, i) => ({
            label: col,
            data: queryResults.map(row => Number(row[col]) || 0),
            backgroundColor: palette[i % palette.length] + '80',
            borderColor: palette[i % palette.length],
            borderWidth: chartType === 'line' ? 2 : 1,
            tension: chartType === 'line' ? 0.3 : 0
        }));
    }

    const config = {
        type: chartType === 'pie' ? 'pie' : chartType,
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            plugins: {
                legend: {
                    display: datasets.length > 1 || chartType === 'pie',
                    labels: { color: legendColor, font: { family: "'JetBrains Mono', monospace", size: 11 } }
                },
                tooltip: {
                    backgroundColor: isDark ? '#1a1a24' : '#ffffff',
                    titleColor: isDark ? '#f0a030' : '#b06800',
                    bodyColor: textColor,
                    borderColor: isDark ? '#2a2a3a' : '#c8c8d0',
                    borderWidth: 1,
                    titleFont: { family: "'JetBrains Mono', monospace" },
                    bodyFont: { family: "'IBM Plex Sans', sans-serif" }
                }
            },
            scales: (chartType === 'pie') ? {} : {
                x: {
                    ticks: { color: textColor, font: { family: "'JetBrains Mono', monospace", size: 10 }, maxRotation: 45 },
                    grid: { color: gridColor }
                },
                y: {
                    ticks: { color: textColor, font: { family: "'JetBrains Mono', monospace", size: 10 } },
                    grid: { color: gridColor },
                    beginAtZero: true
                }
            }
        }
    };

    new Chart(canvas, config);
}

export function destroyAllCharts() {
    document.querySelectorAll('.chart-container canvas').forEach(canvas => {
        const inst = Chart.getChart(canvas);
        if (inst) inst.destroy();
    });
}

export function updateChartsForTheme() {
    document.querySelectorAll('.chart-container').forEach(chartContainer => {
        const data = chartContainer._chartData;
        if (!data) return;
        const canvas = chartContainer.querySelector('canvas');
        if (!canvas) return;
        const activeBtn = chartContainer.querySelector('.chart-type-btn.active');
        const chartType = activeBtn ? activeBtn.textContent.toLowerCase() : data.detection.type;
        renderChart(canvas, data.queryResults, data.detection, chartType);
    });
}
