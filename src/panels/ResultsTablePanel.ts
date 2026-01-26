import * as vscode from 'vscode';
import { BaseWebviewPanel, getWebviewOptions, WebviewPanelOptions } from './BaseWebviewPanel';

/**
 * Query result row data structure
 */
export interface QueryResultRow {
    [key: string]: unknown;
}

/**
 * Query result data structure
 */
export interface QueryResults {
    columns: string[];
    rows: QueryResultRow[];
    executionTime?: number;
    rowCount?: number;
}

/**
 * Panel for displaying query results in a table format.
 * Features:
 * - Sortable columns
 * - Resizable columns
 * - Row selection
 * - Export to CSV/JSON
 * - Pagination for large result sets
 */
export class ResultsTablePanel extends BaseWebviewPanel {
    public static readonly viewType: string = 'geode.resultsTable';

    private static _instance: ResultsTablePanel | undefined;
    private _results: QueryResults | undefined;
    private _query: string = '';

    /**
     * Get or create the results table panel singleton.
     */
    public static createOrShow(options: WebviewPanelOptions): ResultsTablePanel {
        const column = options.viewColumn || vscode.ViewColumn.Two;

        // If we already have a panel, show it
        if (ResultsTablePanel._instance) {
            ResultsTablePanel._instance.reveal(column);
            return ResultsTablePanel._instance;
        }

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            ResultsTablePanel.viewType,
            'Query Results',
            { viewColumn: column, preserveFocus: options.preserveFocus ?? true },
            getWebviewOptions(options.extensionUri)
        );

        ResultsTablePanel._instance = new ResultsTablePanel(panel, options.extensionUri);
        return ResultsTablePanel._instance;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        super(panel, extensionUri);
    }

    protected get title(): string {
        return 'Query Results';
    }

    /**
     * Update the panel with new query results.
     */
    public setResults(results: QueryResults, query?: string) {
        this._results = results;
        if (query) {
            this._query = query;
        }
        this._updateContent();
    }

    /**
     * Clear the results.
     */
    public clearResults() {
        this._results = undefined;
        this._query = '';
        this._updateContent();
    }

    protected _handleMessage(message: { type: string; [key: string]: unknown }): void {
        switch (message.type) {
            case 'exportCsv':
                this._exportToCsv();
                break;
            case 'exportJson':
                this._exportToJson();
                break;
            case 'copyCell':
                if (typeof message.value === 'string') {
                    vscode.env.clipboard.writeText(message.value);
                    vscode.window.showInformationMessage('Cell value copied to clipboard');
                }
                break;
            case 'copyRow':
                if (message.row !== undefined) {
                    const row = this._results?.rows[message.row as number];
                    if (row) {
                        vscode.env.clipboard.writeText(JSON.stringify(row, null, 2));
                        vscode.window.showInformationMessage('Row copied to clipboard');
                    }
                }
                break;
            case 'sort':
                // Sorting is handled client-side
                break;
        }
    }

    private async _exportToCsv() {
        if (!this._results) return;

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('query_results.csv'),
            filters: { 'CSV': ['csv'] }
        });

        if (uri) {
            const csv = this._toCsv();
            await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf8'));
            vscode.window.showInformationMessage(`Results exported to ${uri.fsPath}`);
        }
    }

    private async _exportToJson() {
        if (!this._results) return;

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('query_results.json'),
            filters: { 'JSON': ['json'] }
        });

        if (uri) {
            const json = JSON.stringify(this._results.rows, null, 2);
            await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf8'));
            vscode.window.showInformationMessage(`Results exported to ${uri.fsPath}`);
        }
    }

    private _toCsv(): string {
        if (!this._results) return '';

        const { columns, rows } = this._results;
        const lines: string[] = [];

        // Header
        lines.push(columns.map(c => this._escapeCsvValue(c)).join(','));

        // Data rows
        for (const row of rows) {
            const values = columns.map(col => {
                const val = row[col];
                return this._escapeCsvValue(this._formatValue(val));
            });
            lines.push(values.join(','));
        }

        return lines.join('\n');
    }

    private _escapeCsvValue(value: string): string {
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
    }

    private _formatValue(value: unknown): string {
        if (value === null || value === undefined) {
            return 'null';
        }
        if (typeof value === 'object') {
            return JSON.stringify(value);
        }
        return String(value);
    }

    protected getStylesheets(): vscode.Uri[] {
        return [
            this.getWebviewUri('src', 'webviews', 'table', 'table.css')
        ];
    }

    protected getScripts(): vscode.Uri[] {
        return [
            this.getWebviewUri('src', 'webviews', 'table', 'table.js')
        ];
    }

    protected getBodyContent(): string {
        if (!this._results) {
            return this._getEmptyState();
        }

        const { columns, rows, executionTime, rowCount } = this._results;

        return `
            <div class="results-container">
                <div class="results-toolbar geode-toolbar">
                    <div class="results-info">
                        <span class="results-count">${rowCount ?? rows.length} rows</span>
                        ${executionTime !== undefined ? `<span class="execution-time">${executionTime.toFixed(2)}ms</span>` : ''}
                    </div>
                    <div class="geode-toolbar__spacer"></div>
                    <button class="geode-button geode-button--small" onclick="exportCsv()">
                        Export CSV
                    </button>
                    <button class="geode-button geode-button--small geode-button--secondary" onclick="exportJson()">
                        Export JSON
                    </button>
                </div>

                ${this._query ? `
                <div class="query-display">
                    <code>${this._escapeHtml(this._query)}</code>
                </div>
                ` : ''}

                <div class="table-wrapper">
                    <table class="geode-table results-table" id="resultsTable">
                        <thead>
                            <tr>
                                ${columns.map((col, i) => `
                                    <th class="sortable" data-column="${i}" onclick="sortColumn(${i})">
                                        ${this._escapeHtml(col)}
                                    </th>
                                `).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map((row, rowIndex) => `
                                <tr data-row="${rowIndex}">
                                    ${columns.map(col => `
                                        <td class="cell" onclick="selectCell(this)" ondblclick="copyCell(this)">
                                            ${this._formatCellHtml(row[col])}
                                        </td>
                                    `).join('')}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    private _getEmptyState(): string {
        return `
            <div class="geode-empty">
                <div class="geode-empty__icon">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="3" y1="9" x2="21" y2="9"></line>
                        <line x1="9" y1="21" x2="9" y2="9"></line>
                    </svg>
                </div>
                <h3 class="geode-empty__title">No Query Results</h3>
                <p class="geode-empty__message">
                    Execute a query to see results here.
                </p>
            </div>
        `;
    }

    private _formatCellHtml(value: unknown): string {
        if (value === null || value === undefined) {
            return '<span class="null-value">null</span>';
        }

        if (typeof value === 'boolean') {
            return `<span class="bool-value">${value}</span>`;
        }

        if (typeof value === 'number') {
            return `<span class="number-value">${value}</span>`;
        }

        if (typeof value === 'object') {
            if (Array.isArray(value)) {
                return `<span class="array-value" title="${this._escapeHtml(JSON.stringify(value))}">[${value.length} items]</span>`;
            }
            return `<span class="object-value" title="${this._escapeHtml(JSON.stringify(value))}">{...}</span>`;
        }

        const strValue = String(value);
        if (strValue.length > 100) {
            return `<span class="truncated-value" title="${this._escapeHtml(strValue)}">${this._escapeHtml(strValue.slice(0, 100))}...</span>`;
        }

        return this._escapeHtml(strValue);
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    public dispose() {
        ResultsTablePanel._instance = undefined;
        super.dispose();
    }
}
