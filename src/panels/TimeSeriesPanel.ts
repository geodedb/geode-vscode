// CANARY: REQ=REQ-VSCODE-TIMESERIES-001; FEATURE="TimeSeriesCharting"; ASPECT=VSCodeIntegration; STATUS=IMPL; OWNER=tooling; UPDATED=2026-01-03
import * as vscode from 'vscode';

/**
 * Time Series and Analytics Charting Panel
 * Displays time-series data and analytics visualizations using SVG
 */

export interface TimeSeriesDataPoint {
    timestamp: number | string;
    value: number;
    label?: string;
}

export interface ChartConfig {
    title: string;
    type: 'line' | 'bar' | 'area';
    xLabel?: string;
    yLabel?: string;
    series: Array<{ name: string; data: TimeSeriesDataPoint[]; color?: string; }>;
}

export class TimeSeriesPanel {
    public static currentPanel: TimeSeriesPanel | undefined;
    private static readonly viewType = 'geodeTimeSeries';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private chartConfig: ChartConfig | null = null;

    public static createOrShow(extensionUri: vscode.Uri, config?: ChartConfig): void {
        const column = vscode.window.activeTextEditor?.viewColumn;
        if (TimeSeriesPanel.currentPanel) {
            TimeSeriesPanel.currentPanel._panel.reveal(column);
            if (config) TimeSeriesPanel.currentPanel.updateChart(config);
            return;
        }
        const panel = vscode.window.createWebviewPanel(TimeSeriesPanel.viewType, 'Analytics Dashboard', column || vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
        TimeSeriesPanel.currentPanel = new TimeSeriesPanel(panel, extensionUri, config);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, config?: ChartConfig) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this.chartConfig = config || null;
        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.onDidChangeViewState(() => { if (this._panel.visible) this._update(); }, null, this._disposables);
    }

    public updateChart(config: ChartConfig): void { this.chartConfig = config; this._update(); }

    private _update(): void { this._panel.webview.html = this._getHtmlContent(); }

    private getNonce(): string {
        let text = '';
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
        return text;
    }

    private _getHtmlContent(): string {
        const nonce = this.getNonce();
        const configJson = JSON.stringify(this.chartConfig || this.getExampleConfig());

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Analytics Dashboard</title>
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; background: var(--vscode-editor-background); color: var(--vscode-foreground); }
        .chart-container { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 20px; }
        .chart-header { display: flex; justify-content: space-between; margin-bottom: 16px; }
        .chart-title { font-size: 16px; font-weight: bold; margin: 0; }
        svg { width: 100%; height: 300px; }
        .grid-line { stroke: var(--vscode-editorWidget-border); stroke-width: 0.5; stroke-dasharray: 2,2; }
        .data-line { fill: none; stroke-width: 2; }
        .axis-label { font-size: 11px; fill: var(--vscode-foreground); }
        .legend { display: flex; gap: 16px; margin-top: 12px; font-size: 12px; }
        .legend-item { display: flex; align-items: center; gap: 6px; }
        .legend-color { width: 12px; height: 12px; border-radius: 2px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-top: 16px; }
        .stat-card { background: var(--vscode-input-background); padding: 12px; border-radius: 4px; text-align: center; }
        .stat-value { font-size: 20px; font-weight: bold; color: var(--vscode-textLink-foreground); }
        .stat-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; }
    </style>
</head>
<body>
    <div class="chart-container">
        <div class="chart-header"><h2 class="chart-title" id="chartTitle">Analytics</h2></div>
        <svg id="chartSvg"></svg>
        <div class="legend" id="legend"></div>
        <div class="stats-grid" id="statsGrid"></div>
    </div>
    <script nonce="${nonce}">
        const config = ${configJson};
        const colors = ['#4ecdc4', '#ff6b6b', '#45b7d1', '#96ceb4', '#ffeaa7'];
        const margin = { top: 20, right: 30, bottom: 40, left: 50 };

        function init() {
            document.getElementById('chartTitle').textContent = config.title || 'Analytics';
            renderChart();
            renderLegend();
            renderStats();
        }

        function renderChart() {
            const svg = document.getElementById('chartSvg');
            while (svg.firstChild) svg.removeChild(svg.firstChild);
            const rect = svg.getBoundingClientRect();
            const width = rect.width || 600, height = rect.height || 300;
            const chartW = width - margin.left - margin.right, chartH = height - margin.top - margin.bottom;
            const allData = config.series.flatMap(s => s.data);
            if (!allData.length) return;
            const timestamps = allData.map(d => new Date(d.timestamp).getTime());
            const values = allData.map(d => d.value);
            const xMin = Math.min(...timestamps), xMax = Math.max(...timestamps);
            const yMin = Math.min(0, ...values), yMax = Math.max(...values) * 1.1;
            const xScale = t => margin.left + ((t - xMin) / (xMax - xMin || 1)) * chartW;
            const yScale = v => margin.top + chartH - ((v - yMin) / (yMax - yMin || 1)) * chartH;

            // Grid lines
            for (let i = 0; i <= 5; i++) {
                const y = margin.top + (i / 5) * chartH;
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', String(margin.left)); line.setAttribute('y1', String(y));
                line.setAttribute('x2', String(width - margin.right)); line.setAttribute('y2', String(y));
                line.setAttribute('class', 'grid-line');
                svg.appendChild(line);
                const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.setAttribute('x', String(margin.left - 5)); label.setAttribute('y', String(y + 4));
                label.setAttribute('class', 'axis-label'); label.setAttribute('text-anchor', 'end');
                label.textContent = formatValue(yMax - (i / 5) * (yMax - yMin));
                svg.appendChild(label);
            }

            // Series
            config.series.forEach((series, idx) => {
                const color = series.color || colors[idx % colors.length];
                const sorted = [...series.data].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                const pathD = sorted.map((d, i) => {
                    const x = xScale(new Date(d.timestamp).getTime()), y = yScale(d.value);
                    return (i === 0 ? 'M' : 'L') + x + ',' + y;
                }).join(' ');
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', pathD); path.setAttribute('stroke', color); path.setAttribute('class', 'data-line');
                svg.appendChild(path);
                sorted.forEach(d => {
                    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    circle.setAttribute('cx', String(xScale(new Date(d.timestamp).getTime())));
                    circle.setAttribute('cy', String(yScale(d.value)));
                    circle.setAttribute('r', '4'); circle.setAttribute('fill', color);
                    svg.appendChild(circle);
                });
            });
        }

        function formatValue(v) { return Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'K' : v.toFixed(v % 1 === 0 ? 0 : 2); }

        function renderLegend() {
            const legend = document.getElementById('legend');
            while (legend.firstChild) legend.removeChild(legend.firstChild);
            config.series.forEach((series, i) => {
                const item = document.createElement('div'); item.className = 'legend-item';
                const colorBox = document.createElement('div'); colorBox.className = 'legend-color';
                colorBox.style.background = series.color || colors[i % colors.length];
                const label = document.createElement('span'); label.textContent = series.name;
                item.appendChild(colorBox); item.appendChild(label); legend.appendChild(item);
            });
        }

        function renderStats() {
            const grid = document.getElementById('statsGrid');
            while (grid.firstChild) grid.removeChild(grid.firstChild);
            const allValues = config.series.flatMap(s => s.data.map(d => d.value));
            if (!allValues.length) return;
            const stats = [
                { label: 'Points', value: allValues.length },
                { label: 'Min', value: formatValue(Math.min(...allValues)) },
                { label: 'Max', value: formatValue(Math.max(...allValues)) },
                { label: 'Avg', value: formatValue(allValues.reduce((a,b) => a+b, 0) / allValues.length) }
            ];
            stats.forEach(stat => {
                const card = document.createElement('div'); card.className = 'stat-card';
                const val = document.createElement('div'); val.className = 'stat-value'; val.textContent = String(stat.value);
                const lbl = document.createElement('div'); lbl.className = 'stat-label'; lbl.textContent = stat.label;
                card.appendChild(val); card.appendChild(lbl); grid.appendChild(card);
            });
        }

        window.addEventListener('resize', renderChart);
        init();
    </script>
</body>
</html>`;
    }

    private getExampleConfig(): ChartConfig {
        const now = Date.now(), dayMs = 86400000;
        return {
            title: 'Query Performance Over Time', type: 'line', xLabel: 'Date', yLabel: 'Response Time (ms)',
            series: [
                { name: 'Latency', data: Array.from({ length: 30 }, (_, i) => ({ timestamp: now - (29 - i) * dayMs, value: 50 + Math.random() * 30 })) },
                { name: 'Throughput', data: Array.from({ length: 30 }, (_, i) => ({ timestamp: now - (29 - i) * dayMs, value: 100 + Math.random() * 50 })) }
            ]
        };
    }

    public dispose(): void {
        TimeSeriesPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) { const d = this._disposables.pop(); if (d) d.dispose(); }
    }
}

export function registerTimeSeriesPanel(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.commands.registerCommand('geode.showAnalyticsDashboard', () => { TimeSeriesPanel.createOrShow(context.extensionUri); }));
}
