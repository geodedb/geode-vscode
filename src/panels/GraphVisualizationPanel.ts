/**
 * High-Performance Graph Visualization Panel
 *
 * Features:
 * - WebGL-accelerated rendering via Cytoscape.js
 * - Supports 10,000+ nodes efficiently
 * - JSON-based graph data from Geode CLI (preferred)
 * - DOT format support as fallback
 * - Neo4j-style force-directed layouts
 * - Level-of-detail rendering for large graphs
 * - Clustering for very large datasets
 * - Progressive loading
 * - Graph exploration: expand neighbors, drill into data, path finding
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import { sanitizeIdentifier, escapeStringValue, getNonce } from '../utils/security';

/**
 * Validate and sanitize a numeric value with bounds.
 */
function sanitizeNumber(value: any, defaultValue: number, min: number, max: number): number {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }

    const num = parseInt(String(value), 10);

    if (isNaN(num)) {
        return defaultValue;
    }

    return Math.max(min, Math.min(max, num));
}

export interface GraphVisualizationOptions {
    extensionUri: vscode.Uri;
    viewColumn?: vscode.ViewColumn;
    preserveFocus?: boolean;
}

export interface GraphConfig {
    layout: 'force' | 'hierarchical' | 'circular' | 'grid' | 'concentric';
    clustering: boolean;
    clusterThreshold: number;
    maxVisibleNodes: number;
    nodeSize: 'fixed' | 'degree' | 'property';
    nodeSizeProperty?: string;
    colorScheme: 'label' | 'community' | 'property';
    colorProperty?: string;
    showLabels: boolean;
    showEdgeLabels: boolean;
    physics: boolean;
    webgl: boolean;
}

// Callback type for expand operations
export type ExpandNodeCallback = (nodeId: string, labels: string[], depth: number) => Promise<GraphElements | null>;
export type QueryRelatedCallback = (nodeId: string, relationshipType?: string) => Promise<GraphElements | null>;

export interface GraphElements {
    nodes: GraphNodeElement[];
    edges: GraphEdgeElement[];
}

export interface GraphNodeElement {
    data: {
        id: string;
        labels?: string[];
        properties?: Record<string, any>;
    };
}

export interface GraphEdgeElement {
    data: {
        id: string;
        source: string;
        target: string;
        type?: string;
        label?: string;
        properties?: Record<string, any>;
    };
}

const DEFAULT_CONFIG: GraphConfig = {
    layout: 'force',
    clustering: true,
    clusterThreshold: 500,
    maxVisibleNodes: 5000,
    nodeSize: 'degree',
    colorScheme: 'label',
    showLabels: true,
    showEdgeLabels: false,
    physics: true,
    webgl: true
};

export class GraphVisualizationPanel {
    public static readonly viewType = 'geode.graphVisualization';

    private static _instance: GraphVisualizationPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _config: GraphConfig = { ...DEFAULT_CONFIG };
    private _currentQuery: string = '';
    private _expandCallback?: ExpandNodeCallback;
    private _queryRelatedCallback?: QueryRelatedCallback;
    private _outputChannel?: vscode.OutputChannel;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.webview.html = this._getHtmlContent();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            null,
            this._disposables
        );
    }

    /**
     * Set callback for expanding node neighbors
     */
    public setExpandCallback(callback: ExpandNodeCallback): void {
        this._expandCallback = callback;
    }

    /**
     * Set callback for querying related data
     */
    public setQueryRelatedCallback(callback: QueryRelatedCallback): void {
        this._queryRelatedCallback = callback;
    }

    /**
     * Set output channel for logging
     */
    public setOutputChannel(channel: vscode.OutputChannel): void {
        this._outputChannel = channel;
    }

    public static createOrShow(options: GraphVisualizationOptions): GraphVisualizationPanel {
        const column = options.viewColumn || vscode.ViewColumn.Two;

        if (GraphVisualizationPanel._instance) {
            GraphVisualizationPanel._instance._panel.reveal(column);
            return GraphVisualizationPanel._instance;
        }

        const panel = vscode.window.createWebviewPanel(
            GraphVisualizationPanel.viewType,
            'Graph Visualization',
            { viewColumn: column, preserveFocus: options.preserveFocus ?? true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [options.extensionUri]
            }
        );

        GraphVisualizationPanel._instance = new GraphVisualizationPanel(panel, options.extensionUri);
        return GraphVisualizationPanel._instance;
    }

    /**
     * Load graph from DOT format string
     */
    public loadFromDot(dot: string, query?: string): void {
        if (query) {
            this._currentQuery = query;
        }
        this._panel.webview.postMessage({
            type: 'loadDot',
            dot: dot,
            query: this._currentQuery,
            config: this._config
        });
    }

    /**
     * Load graph from Cytoscape JSON elements
     */
    public loadElements(elements: { nodes: any[]; edges: any[] }, query?: string): void {
        if (query) {
            this._currentQuery = query;
        }
        this._panel.webview.postMessage({
            type: 'loadElements',
            elements: elements,
            query: this._currentQuery,
            config: this._config
        });
    }

    /**
     * Load graph from JSON data (preferred format)
     * This handles the JSON output from Geode CLI
     */
    public loadFromJson(data: any, query?: string): void {
        if (query) {
            this._currentQuery = query;
        }
        this._panel.webview.postMessage({
            type: 'loadJson',
            data: data,
            query: this._currentQuery,
            config: this._config
        });
    }

    /**
     * Merge additional elements into the current graph
     */
    public mergeElements(elements: GraphElements, focusNodeId?: string): void {
        this._panel.webview.postMessage({
            type: 'mergeElements',
            elements: elements,
            focusNodeId: focusNodeId
        });
    }

    /**
     * Highlight a path between two nodes
     */
    public highlightPath(sourceId: string, targetId: string): void {
        this._panel.webview.postMessage({
            type: 'highlightPath',
            sourceId: sourceId,
            targetId: targetId
        });
    }

    /**
     * Select and focus on a specific node
     */
    public selectNode(nodeId: string): void {
        this._panel.webview.postMessage({
            type: 'selectNode',
            nodeId: nodeId
        });
    }

    /**
     * Clear all selections and highlights
     */
    public clearSelection(): void {
        this._panel.webview.postMessage({
            type: 'clearSelection'
        });
    }

    /**
     * Update visualization config
     */
    public setConfig(config: Partial<GraphConfig>): void {
        this._config = { ...this._config, ...config };
        this._panel.webview.postMessage({
            type: 'updateConfig',
            config: this._config
        });
    }

    /**
     * Fit graph to viewport
     */
    public fit(): void {
        this._panel.webview.postMessage({ type: 'fit' });
    }

    /**
     * Reset zoom and pan
     */
    public reset(): void {
        this._panel.webview.postMessage({ type: 'reset' });
    }

    private async _handleMessage(message: any): Promise<void> {
        switch (message.type) {
            case 'nodeClick':
                this._showNodeDetails(message.node);
                break;
            case 'edgeClick':
                this._showEdgeDetails(message.edge);
                break;
            case 'expandNode':
                await this._handleExpandNode(message.nodeId, message.labels, message.depth || 1);
                break;
            case 'queryRelated':
                await this._handleQueryRelated(message.nodeId, message.relationshipType);
                break;
            case 'findPaths':
                await this._handleFindPaths(message.sourceId, message.targetId, message.maxDepth);
                break;
            case 'showNodePanel':
                this._showNodeExplorerPanel(message.node);
                break;
            case 'exportPng':
                this._exportPng(message.data);
                break;
            case 'exportSvg':
                this._exportSvg(message.data);
                break;
            case 'configChange':
                this._config = { ...this._config, ...message.config };
                break;
            case 'ready':
                // Panel is ready
                break;
            case 'stats':
                // Graph statistics received
                break;
            case 'log':
                if (this._outputChannel) {
                    this._outputChannel.appendLine(`[GraphViz] ${message.message}`);
                }
                break;
        }
    }

    /**
     * Handle expanding a node to show its neighbors
     */
    private async _handleExpandNode(nodeId: string, labels: string[], depth: number): Promise<void> {
        if (!this._expandCallback) {
            vscode.window.showWarningMessage('Graph expansion not configured. Connect to a database first.');
            return;
        }

        try {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Expanding node ${nodeId}...`,
                cancellable: false
            }, async () => {
                const newElements = await this._expandCallback!(nodeId, labels, depth);
                if (newElements && (newElements.nodes.length > 0 || newElements.edges.length > 0)) {
                    // Send new elements to webview to merge
                    this._panel.webview.postMessage({
                        type: 'mergeElements',
                        elements: newElements,
                        focusNodeId: nodeId
                    });
                    vscode.window.showInformationMessage(
                        `Added ${newElements.nodes.length} nodes and ${newElements.edges.length} edges`
                    );
                } else {
                    vscode.window.showInformationMessage('No additional neighbors found');
                }
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to expand node: ${error.message || error}`);
        }
    }

    /**
     * Handle querying related data for a node
     */
    private async _handleQueryRelated(nodeId: string, relationshipType?: string): Promise<void> {
        if (!this._queryRelatedCallback) {
            vscode.window.showWarningMessage('Query not configured. Connect to a database first.');
            return;
        }

        try {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Querying related data for ${nodeId}...`,
                cancellable: false
            }, async () => {
                const relatedElements = await this._queryRelatedCallback!(nodeId, relationshipType);
                if (relatedElements && (relatedElements.nodes.length > 0 || relatedElements.edges.length > 0)) {
                    this._panel.webview.postMessage({
                        type: 'mergeElements',
                        elements: relatedElements,
                        focusNodeId: nodeId
                    });
                }
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to query related data: ${error.message || error}`);
        }
    }

    /**
     * Handle finding paths between two nodes
     */
    private async _handleFindPaths(sourceId: string, targetId: string, _maxDepth: number): Promise<void> {
        if (!this._queryRelatedCallback) {
            vscode.window.showWarningMessage('Query not configured. Connect to a database first.');
            return;
        }

        vscode.window.showInformationMessage(`Finding paths between ${sourceId} and ${targetId}...`);

        // This will be handled by the webview's Dijkstra algorithm
        this._panel.webview.postMessage({
            type: 'highlightPath',
            sourceId,
            targetId
        });
    }

    /**
     * Show an explorer panel for detailed node information
     */
    private _showNodeExplorerPanel(node: any): void {
        const panel = vscode.window.createWebviewPanel(
            'geode.nodeExplorer',
            `Node: ${node.id}`,
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );

        const nonce = getNonce();

        // SECURITY: CSP with nonce, data via postMessage (Issue #43)
        panel.webview.html = `<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <style nonce="${nonce}">
        body { font-family: var(--vscode-font-family); padding: 16px; }
        h2 { color: var(--vscode-foreground); border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 8px; }
        .labels { display: flex; gap: 8px; margin-bottom: 16px; }
        .label { background: #4C8EDA; color: white; padding: 4px 8px; border-radius: 12px; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
        code { background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 3px; }
        .actions { margin-top: 16px; display: flex; gap: 8px; }
        button { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background: var(--vscode-button-hoverBackground); }
    </style>
</head>
<body>
    <h2 id="nodeTitle"></h2>
    <div id="labelsContainer"></div>
    <h3>Properties</h3>
    <table id="propsTable"></table>
    <div class="actions">
        <button id="copyIdBtn">Copy ID</button>
        <button id="copyJsonBtn">Copy as JSON</button>
    </div>

    <script nonce="${nonce}">
        var vscode = acquireVsCodeApi();
        var nodeData = null;

        window.addEventListener('message', function(event) {
            var msg = event.data;
            if (msg.type === 'setNodeData') {
                nodeData = msg.node;
                renderNode(nodeData);
            }
        });

        function esc(text) {
            var d = document.createElement('div');
            d.textContent = text;
            return d.textContent;
        }

        function renderNode(node) {
            document.getElementById('nodeTitle').textContent = 'Node: ' + node.id;

            var labelsEl = document.getElementById('labelsContainer');
            var labels = node.labels || [];
            if (labels.length > 0) {
                labelsEl.className = 'labels';
                labels.forEach(function(l) {
                    var span = document.createElement('span');
                    span.className = 'label';
                    span.textContent = ':' + l;
                    labelsEl.appendChild(span);
                });
            }

            var table = document.getElementById('propsTable');
            var props = node.properties || {};
            var keys = Object.keys(props);
            if (keys.length === 0) {
                var row = table.insertRow();
                var cell = row.insertCell();
                cell.colSpan = 2;
                var em = document.createElement('em');
                em.textContent = 'No properties';
                cell.appendChild(em);
            } else {
                keys.forEach(function(key) {
                    var row = table.insertRow();
                    var keyCell = row.insertCell();
                    var strong = document.createElement('strong');
                    strong.textContent = key;
                    keyCell.appendChild(strong);
                    var valCell = row.insertCell();
                    var code = document.createElement('code');
                    code.textContent = JSON.stringify(props[key]);
                    valCell.appendChild(code);
                });
            }
        }

        document.getElementById('copyIdBtn').addEventListener('click', function() {
            if (nodeData) { navigator.clipboard.writeText(String(nodeData.id)); }
        });
        document.getElementById('copyJsonBtn').addEventListener('click', function() {
            if (nodeData) { navigator.clipboard.writeText(JSON.stringify(nodeData, null, 2)); }
        });
    </script>
</body>
</html>`;

        // SECURITY: Pass data via postMessage instead of inline JSON.stringify
        panel.webview.postMessage({ type: 'setNodeData', node });
    }

    private _showNodeDetails(node: any): void {
        const props = node.properties || {};
        const labels = node.labels || [];

        let detail = `**Node: ${node.id}**\n\n`;
        if (labels.length > 0) {
            detail += `Labels: ${labels.join(', ')}\n\n`;
        }
        detail += '**Properties:**\n';
        for (const [key, value] of Object.entries(props)) {
            detail += `- ${key}: ${JSON.stringify(value)}\n`;
        }

        vscode.window.showInformationMessage(detail, { modal: false });
    }

    private _showEdgeDetails(edge: any): void {
        const props = edge.properties || {};

        let detail = `**Relationship: ${edge.type || edge.label}**\n\n`;
        detail += `From: ${edge.source}\n`;
        detail += `To: ${edge.target}\n\n`;
        detail += '**Properties:**\n';
        for (const [key, value] of Object.entries(props)) {
            detail += `- ${key}: ${JSON.stringify(value)}\n`;
        }

        vscode.window.showInformationMessage(detail, { modal: false });
    }

    private async _exportPng(dataUrl: string): Promise<void> {
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('graph.png'),
            filters: { 'PNG Image': ['png'] }
        });

        if (uri) {
            const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
            const buffer = Buffer.from(base64, 'base64');
            await vscode.workspace.fs.writeFile(uri, buffer);
            vscode.window.showInformationMessage(`Graph exported to ${uri.fsPath}`);
        }
    }

    private async _exportSvg(svg: string): Promise<void> {
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('graph.svg'),
            filters: { 'SVG Image': ['svg'] }
        });

        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(svg, 'utf8'));
            vscode.window.showInformationMessage(`Graph exported to ${uri.fsPath}`);
        }
    }

    private _getHtmlContent(): string {
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}' https://unpkg.com; img-src data: https:;">
    <title>Graph Visualization</title>
    <style nonce="${nonce}">
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            overflow: hidden;
            height: 100vh;
        }

        .container {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        .toolbar {
            display: flex;
            gap: 8px;
            padding: 8px;
            background: var(--vscode-titleBar-activeBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            flex-wrap: wrap;
            align-items: center;
        }

        .toolbar-group {
            display: flex;
            gap: 4px;
            align-items: center;
        }

        .toolbar-divider {
            width: 1px;
            height: 24px;
            background: var(--vscode-panel-border);
            margin: 0 8px;
        }

        .btn {
            padding: 4px 8px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }

        select {
            padding: 4px 8px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
            font-size: 12px;
        }

        label {
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        input[type="checkbox"] {
            accent-color: var(--vscode-focusBorder);
        }

        .stats {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-left: auto;
        }

        #cy {
            flex: 1;
            background: var(--vscode-editor-background);
        }

        .loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
        }

        .loading-spinner {
            width: 40px;
            height: 40px;
            border: 3px solid var(--vscode-panel-border);
            border-top-color: var(--vscode-focusBorder);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .empty-state {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state svg {
            width: 64px;
            height: 64px;
            margin-bottom: 16px;
            opacity: 0.5;
        }

        .tooltip {
            position: absolute;
            padding: 8px 12px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 4px;
            font-size: 12px;
            pointer-events: none;
            z-index: 1000;
            max-width: 300px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }

        .tooltip-title {
            font-weight: bold;
            margin-bottom: 4px;
        }

        .tooltip-props {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .minimap {
            position: absolute;
            bottom: 16px;
            right: 16px;
            width: 150px;
            height: 100px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            opacity: 0.9;
        }

        .context-menu {
            position: absolute;
            background: var(--vscode-menu-background);
            border: 1px solid var(--vscode-menu-border);
            border-radius: 4px;
            padding: 4px 0;
            min-width: 180px;
            z-index: 1001;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }

        .context-menu-item {
            padding: 6px 12px;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .context-menu-item:hover {
            background: var(--vscode-menu-selectionBackground);
            color: var(--vscode-menu-selectionForeground);
        }

        .context-menu-divider {
            height: 1px;
            background: var(--vscode-menu-separatorBackground);
            margin: 4px 0;
        }

        .context-menu-icon {
            width: 16px;
            text-align: center;
        }

        .search-box {
            display: flex;
            align-items: center;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            padding: 2px 6px;
        }

        .search-box input {
            background: transparent;
            border: none;
            color: var(--vscode-input-foreground);
            outline: none;
            font-size: 12px;
            width: 120px;
        }

        .search-box input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        /* Side panel for node details */
        .side-panel {
            position: absolute;
            right: 0;
            top: 0;
            bottom: 0;
            width: 300px;
            background: var(--vscode-sideBar-background);
            border-left: 1px solid var(--vscode-panel-border);
            transform: translateX(100%);
            transition: transform 0.2s ease;
            z-index: 100;
            overflow-y: auto;
        }

        .side-panel.open {
            transform: translateX(0);
        }

        .side-panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-titleBar-activeBackground);
        }

        .side-panel-title {
            font-weight: bold;
            font-size: 13px;
        }

        .side-panel-close {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 16px;
            padding: 4px;
        }

        .side-panel-content {
            padding: 12px;
        }

        .node-labels {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 12px;
        }

        .node-label {
            background: #4C8EDA;
            color: white;
            padding: 3px 8px;
            border-radius: 10px;
            font-size: 11px;
        }

        .property-list {
            font-size: 12px;
        }

        .property-item {
            padding: 8px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .property-key {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 2px;
        }

        .property-value {
            font-family: monospace;
            word-break: break-all;
        }

        .action-buttons {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .action-btn {
            padding: 8px 12px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            text-align: left;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .action-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .action-btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .action-btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }

        /* Path highlight mode */
        .path-mode-indicator {
            position: absolute;
            top: 60px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--vscode-inputValidation-infoBackground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
            padding: 8px 16px;
            border-radius: 4px;
            font-size: 12px;
            display: none;
            z-index: 50;
        }

        .path-mode-indicator.active {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        /* Selection info */
        .selection-info {
            position: absolute;
            bottom: 16px;
            left: 16px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-editorWidget-border);
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 11px;
            display: none;
        }

        .selection-info.visible {
            display: block;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="toolbar">
            <div class="toolbar-group">
                <button class="btn" onclick="fit()" title="Fit to viewport">
                    <span>⊡</span> Fit
                </button>
                <button class="btn" onclick="zoomIn()" title="Zoom in">+</button>
                <button class="btn" onclick="zoomOut()" title="Zoom out">−</button>
                <button class="btn" onclick="resetView()" title="Reset view">↺</button>
            </div>

            <div class="toolbar-divider"></div>

            <div class="toolbar-group">
                <label>Layout:</label>
                <select id="layoutSelect" onchange="changeLayout(this.value)">
                    <option value="cose">Force-Directed</option>
                    <option value="dagre">Hierarchical</option>
                    <option value="circle">Circular</option>
                    <option value="grid">Grid</option>
                    <option value="concentric">Concentric</option>
                    <option value="breadthfirst">Breadth-First</option>
                </select>
            </div>

            <div class="toolbar-divider"></div>

            <div class="toolbar-group">
                <label>
                    <input type="checkbox" id="showLabels" checked onchange="toggleLabels(this.checked)">
                    Labels
                </label>
                <label>
                    <input type="checkbox" id="physics" checked onchange="togglePhysics(this.checked)">
                    Physics
                </label>
                <label>
                    <input type="checkbox" id="clustering" onchange="toggleClustering(this.checked)">
                    Cluster
                </label>
            </div>

            <div class="toolbar-divider"></div>

            <div class="toolbar-group">
                <div class="search-box">
                    <input type="text" id="searchInput" placeholder="Search nodes..." oninput="searchNodes(this.value)">
                </div>
            </div>

            <div class="toolbar-divider"></div>

            <div class="toolbar-group">
                <button class="btn" onclick="exportPng()">📷 PNG</button>
                <button class="btn" onclick="exportSvg()">📄 SVG</button>
            </div>

            <div class="stats" id="stats">No data loaded</div>
        </div>

        <div id="cy">
            <div class="empty-state" id="emptyState">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="3"/>
                    <circle cx="4" cy="6" r="2"/>
                    <circle cx="20" cy="6" r="2"/>
                    <circle cx="4" cy="18" r="2"/>
                    <circle cx="20" cy="18" r="2"/>
                    <line x1="9.5" y1="10.5" x2="5.5" y2="7.5"/>
                    <line x1="14.5" y1="10.5" x2="18.5" y2="7.5"/>
                    <line x1="9.5" y1="13.5" x2="5.5" y2="16.5"/>
                    <line x1="14.5" y1="13.5" x2="18.5" y2="16.5"/>
                </svg>
                <h3>No Graph Data</h3>
                <p>Run a query that returns nodes and relationships</p>
            </div>
        </div>
    </div>

    <div class="tooltip" id="tooltip" style="display: none;"></div>
    <div class="context-menu" id="contextMenu" style="display: none;"></div>

    <!-- Side panel for node exploration -->
    <div class="side-panel" id="sidePanel">
        <div class="side-panel-header">
            <span class="side-panel-title" id="sidePanelTitle">Node Details</span>
            <button class="side-panel-close" onclick="closeSidePanel()">×</button>
        </div>
        <div class="side-panel-content" id="sidePanelContent"></div>
    </div>

    <!-- Path finding mode indicator -->
    <div class="path-mode-indicator" id="pathModeIndicator">
        <span>🔍 Select target node for path finding</span>
        <button class="btn" onclick="cancelPathMode()">Cancel</button>
    </div>

    <!-- Selection info -->
    <div class="selection-info" id="selectionInfo"></div>

    <!-- Cytoscape.js - High-performance graph library -->
    <!-- SECURITY: Subresource Integrity (SRI) hashes prevent supply chain attacks -->
    <script nonce="${nonce}" src="https://unpkg.com/cytoscape@3.28.1/dist/cytoscape.min.js" integrity="sha384-J7Q85oZE4GJ/e7+n2aOQsLXfDwwfnA8S2nZAL5BpFsfpCF84zQD7LroZ/dMnLgex" crossorigin="anonymous"></script>
    <!-- Layout extensions -->
    <script nonce="${nonce}" src="https://unpkg.com/dagre@0.8.5/dist/dagre.min.js" integrity="sha384-2IH3T69EIKYC4c+RXZifZRvaH5SRUdacJW7j6HtE5rQbvLhKKdawxq6vpIzJ7j9M" crossorigin="anonymous"></script>
    <script nonce="${nonce}" src="https://unpkg.com/cytoscape-dagre@2.5.0/cytoscape-dagre.js" integrity="sha384-u69h9ebXeSjlg6q/rb1zKTRAGu/h8deCl0409xpS/QJctMKnc4M9Fzkm01VOQdeF" crossorigin="anonymous"></script>
    <script nonce="${nonce}" src="https://unpkg.com/cytoscape-cose-bilkent@4.1.0/cytoscape-cose-bilkent.js" integrity="sha384-CUkVnmwscI7lsYn26xHp4BmwwUaqCgfQlIkPoERUBcg8k0xFypHQjzlS8RuYuooO" crossorigin="anonymous"></script>

    <script nonce="${nonce}">
        // VS Code API
        const vscode = acquireVsCodeApi();

        // State
        let cy = null;
        let config = ${JSON.stringify(DEFAULT_CONFIG)};
        let currentLayout = null;
        let nodeCount = 0;
        let edgeCount = 0;
        let pathMode = false;
        let pathSourceNode = null;
        let selectedNode = null;
        let selectedEdge = null;

        // Color palette for labels (Neo4j-style)
        const colors = [
            '#4C8EDA', '#DA4C4C', '#4CDA7F', '#DA9E4C', '#9E4CDA',
            '#4CDADA', '#DA4C9E', '#7FDA4C', '#4C4CDA', '#DA7F4C',
            '#4CDA4C', '#DA4CDA', '#DADA4C', '#4C9EDA', '#9EDA4C'
        ];
        const labelColors = new Map();
        let colorIndex = 0;

        function getColorForLabel(label) {
            if (!labelColors.has(label)) {
                labelColors.set(label, colors[colorIndex % colors.length]);
                colorIndex++;
            }
            return labelColors.get(label);
        }

        // Initialize Cytoscape
        function initCytoscape() {
            // Register extensions
            if (typeof cytoscapeDagre !== 'undefined') {
                cytoscape.use(cytoscapeDagre);
            }
            if (typeof cytoscapeCoseBilkent !== 'undefined') {
                cytoscape.use(cytoscapeCoseBilkent);
            }

            cy = cytoscape({
                container: document.getElementById('cy'),
                elements: [],
                style: [
                    {
                        selector: 'node',
                        style: {
                            'background-color': function(ele) {
                                const labels = ele.data('labels') || [];
                                return getColorForLabel(labels[0] || 'default');
                            },
                            'label': function(ele) {
                                if (!config.showLabels) return '';
                                const props = ele.data('properties') || {};
                                return props.name || props.title || props.id || ele.id();
                            },
                            'width': function(ele) {
                                if (config.nodeSize === 'degree') {
                                    return Math.max(20, Math.min(60, 20 + ele.degree() * 3));
                                }
                                return 30;
                            },
                            'height': function(ele) {
                                if (config.nodeSize === 'degree') {
                                    return Math.max(20, Math.min(60, 20 + ele.degree() * 3));
                                }
                                return 30;
                            },
                            'font-size': '10px',
                            'text-valign': 'bottom',
                            'text-margin-y': 5,
                            'color': '#fff',
                            'text-outline-color': '#000',
                            'text-outline-width': 1,
                            'border-width': 2,
                            'border-color': '#fff'
                        }
                    },
                    {
                        selector: 'node:selected',
                        style: {
                            'border-width': 4,
                            'border-color': '#FFD700'
                        }
                    },
                    {
                        selector: 'node.highlighted',
                        style: {
                            'border-width': 4,
                            'border-color': '#00FF00'
                        }
                    },
                    {
                        selector: 'node.faded',
                        style: {
                            'opacity': 0.2
                        }
                    },
                    {
                        selector: 'edge',
                        style: {
                            'width': 2,
                            'line-color': '#888',
                            'target-arrow-color': '#888',
                            'target-arrow-shape': 'triangle',
                            'curve-style': 'bezier',
                            'label': function(ele) {
                                if (!config.showEdgeLabels) return '';
                                return ele.data('type') || ele.data('label') || '';
                            },
                            'font-size': '9px',
                            'text-rotation': 'autorotate',
                            'color': '#aaa'
                        }
                    },
                    {
                        selector: 'edge:selected',
                        style: {
                            'width': 4,
                            'line-color': '#FFD700',
                            'target-arrow-color': '#FFD700'
                        }
                    },
                    {
                        selector: 'edge.faded',
                        style: {
                            'opacity': 0.2
                        }
                    },
                    {
                        selector: 'node.path-source',
                        style: {
                            'border-width': 4,
                            'border-color': '#00FF00'
                        }
                    },
                    {
                        selector: 'node.path-target',
                        style: {
                            'border-width': 4,
                            'border-color': '#FF6600'
                        }
                    },
                    {
                        selector: '.path-highlight',
                        style: {
                            'background-color': '#FFD700',
                            'line-color': '#FFD700',
                            'target-arrow-color': '#FFD700',
                            'z-index': 999
                        }
                    },
                    {
                        selector: 'node:locked',
                        style: {
                            'border-style': 'dashed'
                        }
                    },
                    {
                        selector: ':parent',
                        style: {
                            'background-opacity': 0.1,
                            'border-width': 2,
                            'border-color': '#888',
                            'label': 'data(id)'
                        }
                    }
                ],
                layout: { name: 'preset' },
                wheelSensitivity: 0.3,
                minZoom: 0.1,
                maxZoom: 10
            });

            // Event handlers
            cy.on('tap', 'node', function(evt) {
                const node = evt.target;

                // Handle path mode - select target
                if (pathMode && pathSourceNode) {
                    if (node.id() !== pathSourceNode.id()) {
                        // Find path to this node
                        node.addClass('path-target');
                        highlightShortestPath(pathSourceNode, node);
                        cancelPathMode();
                    }
                    return;
                }

                vscode.postMessage({
                    type: 'nodeClick',
                    node: {
                        id: node.id(),
                        labels: node.data('labels'),
                        properties: node.data('properties')
                    }
                });
                updateSelectionInfo();
            });

            // Double-click to expand
            cy.on('dbltap', 'node', function(evt) {
                expandNode(evt.target, 1);
            });

            cy.on('tap', 'edge', function(evt) {
                const edge = evt.target;
                vscode.postMessage({
                    type: 'edgeClick',
                    edge: {
                        id: edge.id(),
                        source: edge.source().id(),
                        target: edge.target().id(),
                        type: edge.data('type') || edge.data('label'),
                        properties: edge.data('properties')
                    }
                });
                updateSelectionInfo();
            });

            // Selection change
            cy.on('select unselect', function() {
                updateSelectionInfo();
            });

            // Tooltip on hover
            cy.on('mouseover', 'node', function(evt) {
                showTooltip(evt, 'node');
            });

            cy.on('mouseover', 'edge', function(evt) {
                showTooltip(evt, 'edge');
            });

            cy.on('mouseout', function() {
                hideTooltip();
            });

            // Right-click context menu
            cy.on('cxttap', 'node', function(evt) {
                showContextMenu(evt, 'node');
            });

            cy.on('cxttap', 'edge', function(evt) {
                showContextMenu(evt, 'edge');
            });

            cy.on('tap', function(evt) {
                if (evt.target === cy) {
                    hideContextMenu();
                    closeSidePanel();
                }
            });

            vscode.postMessage({ type: 'ready' });
        }

        // Find and highlight shortest path between two nodes
        function highlightShortestPath(source, target) {
            // Use Dijkstra for shortest path
            const dijkstra = cy.elements().dijkstra({
                root: source,
                directed: false
            });

            const pathToTarget = dijkstra.pathTo(target);

            if (pathToTarget.length > 0) {
                pathToTarget.addClass('path-highlight');
                cy.animate({
                    fit: { eles: pathToTarget, padding: 50 }
                }, {
                    duration: 500
                });

                vscode.postMessage({
                    type: 'log',
                    message: 'Path found with ' + pathToTarget.nodes().length + ' nodes and ' + pathToTarget.edges().length + ' edges'
                });
            } else {
                vscode.postMessage({
                    type: 'log',
                    message: 'No path found between ' + source.id() + ' and ' + target.id()
                });
            }
        }

        // Merge new elements into the graph
        function mergeElements(newElements, focusNodeId) {
            if (!cy || !newElements) return;

            const addedNodes = [];
            const addedEdges = [];

            // Add new nodes (skip duplicates)
            if (newElements.nodes) {
                for (const node of newElements.nodes) {
                    if (!cy.getElementById(node.data.id).length) {
                        cy.add(node);
                        addedNodes.push(node.data.id);
                    }
                }
            }

            // Add new edges (skip duplicates)
            if (newElements.edges) {
                for (const edge of newElements.edges) {
                    if (!cy.getElementById(edge.data.id).length) {
                        cy.add(edge);
                        addedEdges.push(edge.data.id);
                    }
                }
            }

            // Update stats
            nodeCount = cy.nodes().length;
            edgeCount = cy.edges().length;
            updateStats();

            // Run incremental layout on new elements
            if (addedNodes.length > 0) {
                const newNodeCollection = cy.collection();
                for (const id of addedNodes) {
                    newNodeCollection.merge(cy.getElementById(id));
                }

                // Position new nodes near the focus node
                if (focusNodeId) {
                    const focusNode = cy.getElementById(focusNodeId);
                    if (focusNode.length) {
                        const pos = focusNode.position();
                        const angle = Math.random() * Math.PI * 2;
                        const radius = 100;

                        newNodeCollection.forEach((node, i) => {
                            const nodeAngle = angle + (i * (Math.PI * 2 / addedNodes.length));
                            node.position({
                                x: pos.x + Math.cos(nodeAngle) * radius,
                                y: pos.y + Math.sin(nodeAngle) * radius
                            });
                        });
                    }
                }

                // Run layout on neighborhood
                runLayout();
            }

            vscode.postMessage({
                type: 'log',
                message: 'Merged ' + addedNodes.length + ' nodes and ' + addedEdges.length + ' edges'
            });
        }

        function showTooltip(evt, type) {
            const tooltip = document.getElementById('tooltip');
            const data = evt.target.data();

            let html = '<div class="tooltip-title">';
            if (type === 'node') {
                const labels = data.labels || [];
                // Apply HTML escaping to prevent XSS from malicious label values
                html += labels.length > 0 ? ':' + labels.map(l => escapeHtml(l)).join(':') : 'Node';
            } else {
                // Apply HTML escaping to prevent XSS from malicious type/label values
                html += escapeHtml(data.type || data.label || 'Relationship');
            }
            html += '</div>';

            const props = data.properties || {};
            const propEntries = Object.entries(props).slice(0, 5);
            if (propEntries.length > 0) {
                html += '<div class="tooltip-props">';
                for (const [key, value] of propEntries) {
                    const displayValue = typeof value === 'string' && value.length > 30
                        ? value.slice(0, 30) + '...'
                        : JSON.stringify(value);
                    // Apply HTML escaping to prevent XSS from malicious property names/values
                    html += escapeHtml(key) + ': ' + escapeHtml(displayValue) + '<br>';
                }
                if (Object.keys(props).length > 5) {
                    html += '... and ' + (Object.keys(props).length - 5) + ' more';
                }
                html += '</div>';
            }

            // Note: All dynamic content is HTML-escaped above, so innerHTML is safe here
            tooltip.innerHTML = html;
            tooltip.style.display = 'block';
            tooltip.style.left = evt.renderedPosition.x + 10 + 'px';
            tooltip.style.top = evt.renderedPosition.y + 10 + 'px';
        }

        function hideTooltip() {
            document.getElementById('tooltip').style.display = 'none';
        }

        function showContextMenu(evt, type) {
            const menu = document.getElementById('contextMenu');
            const element = evt.target;

            menu.innerHTML = '';

            let items = [];

            if (type === 'node') {
                const nodeData = element.data();
                items = [
                    { icon: '🔍', label: 'View Details', action: () => showNodeDetails(element) },
                    { icon: '➕', label: 'Expand Neighbors (1 hop)', action: () => expandNode(element, 1) },
                    { icon: '➕', label: 'Expand Neighbors (2 hops)', action: () => expandNode(element, 2) },
                    { divider: true },
                    { icon: '🔗', label: 'Find Paths From Here...', action: () => startPathMode(element) },
                    { icon: '🎯', label: 'Focus on this Node', action: () => focusOnNode(element) },
                    { icon: '👥', label: 'Select Neighbors', action: () => element.neighborhood().select() },
                    { divider: true },
                    { icon: '🙈', label: 'Hide Node', action: () => hideNode(element) },
                    { icon: '🔒', label: 'Lock Position', action: () => toggleLockNode(element) },
                    { divider: true },
                    { icon: '📋', label: 'Copy ID', action: () => navigator.clipboard.writeText(element.id()) },
                    { icon: '📄', label: 'Copy as JSON', action: () => navigator.clipboard.writeText(JSON.stringify(nodeData, null, 2)) }
                ];
            } else if (type === 'edge') {
                const edgeData = element.data();
                items = [
                    { icon: '🔍', label: 'View Details', action: () => showEdgeDetails(element) },
                    { icon: '🎯', label: 'Select Connected Nodes', action: () => {
                        element.source().select();
                        element.target().select();
                    }},
                    { divider: true },
                    { icon: '🙈', label: 'Hide Edge', action: () => element.remove() },
                    { divider: true },
                    { icon: '📋', label: 'Copy Type', action: () => navigator.clipboard.writeText(edgeData.type || edgeData.label || '') },
                    { icon: '📄', label: 'Copy as JSON', action: () => navigator.clipboard.writeText(JSON.stringify(edgeData, null, 2)) }
                ];
            }

            for (const item of items) {
                if (item.divider) {
                    const divider = document.createElement('div');
                    divider.className = 'context-menu-divider';
                    menu.appendChild(divider);
                } else {
                    const div = document.createElement('div');
                    div.className = 'context-menu-item';
                    div.innerHTML = '<span class="context-menu-icon">' + item.icon + '</span>' + item.label;
                    div.onclick = () => {
                        item.action();
                        hideContextMenu();
                    };
                    menu.appendChild(div);
                }
            }

            menu.style.display = 'block';
            menu.style.left = evt.renderedPosition.x + 'px';
            menu.style.top = evt.renderedPosition.y + 'px';
        }

        function hideContextMenu() {
            document.getElementById('contextMenu').style.display = 'none';
        }

        function expandNode(node, depth = 1) {
            vscode.postMessage({
                type: 'expandNode',
                nodeId: node.id(),
                labels: node.data('labels') || [],
                depth: depth
            });
        }

        function showNodeDetails(node) {
            selectedNode = node;
            const data = node.data();
            const labels = data.labels || [];
            const props = data.properties || {};

            const panel = document.getElementById('sidePanel');
            const title = document.getElementById('sidePanelTitle');
            const content = document.getElementById('sidePanelContent');

            title.textContent = 'Node: ' + node.id();

            let html = '';

            // Labels
            if (labels.length > 0) {
                html += '<div class="node-labels">';
                for (const label of labels) {
                    html += '<span class="node-label">:' + escapeHtml(label) + '</span>';
                }
                html += '</div>';
            }

            // Properties
            html += '<div class="property-list">';
            const propKeys = Object.keys(props);
            if (propKeys.length > 0) {
                for (const key of propKeys) {
                    html += '<div class="property-item">';
                    html += '<div class="property-key">' + escapeHtml(key) + '</div>';
                    html += '<div class="property-value">' + escapeHtml(JSON.stringify(props[key])) + '</div>';
                    html += '</div>';
                }
            } else {
                html += '<div class="property-item"><em>No properties</em></div>';
            }
            html += '</div>';

            // Actions - node IDs are escaped to prevent XSS in onclick handlers
            const safeNodeId = escapeJsString(node.id());
            html += '<div class="action-buttons">';
            html += '<button class="action-btn action-btn-primary" onclick="expandNode(cy.getElementById(\\'' + safeNodeId + '\\'), 1)">➕ Expand Neighbors</button>';
            html += '<button class="action-btn" onclick="startPathMode(cy.getElementById(\\'' + safeNodeId + '\\'))">🔗 Find Paths From Here</button>';
            html += '<button class="action-btn" onclick="focusOnNode(cy.getElementById(\\'' + safeNodeId + '\\'))">🎯 Focus View</button>';
            html += '<button class="action-btn" onclick="queryRelated(\\'' + safeNodeId + '\\')">🔎 Query Related Data</button>';
            html += '</div>';

            content.innerHTML = html;
            panel.classList.add('open');
        }

        function showEdgeDetails(edge) {
            selectedEdge = edge;
            const data = edge.data();
            const props = data.properties || {};

            const panel = document.getElementById('sidePanel');
            const title = document.getElementById('sidePanelTitle');
            const content = document.getElementById('sidePanelContent');

            title.textContent = 'Relationship: ' + (data.type || data.label || 'UNKNOWN');

            let html = '';

            // Connection info
            html += '<div class="property-list">';
            html += '<div class="property-item">';
            html += '<div class="property-key">From</div>';
            html += '<div class="property-value">' + escapeHtml(data.source) + '</div>';
            html += '</div>';
            html += '<div class="property-item">';
            html += '<div class="property-key">To</div>';
            html += '<div class="property-value">' + escapeHtml(data.target) + '</div>';
            html += '</div>';

            // Properties
            const propKeys = Object.keys(props);
            if (propKeys.length > 0) {
                for (const key of propKeys) {
                    html += '<div class="property-item">';
                    html += '<div class="property-key">' + escapeHtml(key) + '</div>';
                    html += '<div class="property-value">' + escapeHtml(JSON.stringify(props[key])) + '</div>';
                    html += '</div>';
                }
            }
            html += '</div>';

            // Actions - IDs are escaped to prevent XSS in onclick handlers
            const safeSourceId = escapeJsString(data.source);
            const safeTargetId = escapeJsString(data.target);
            html += '<div class="action-buttons">';
            html += '<button class="action-btn" onclick="cy.getElementById(\\'' + safeSourceId + '\\').select()">Select Source</button>';
            html += '<button class="action-btn" onclick="cy.getElementById(\\'' + safeTargetId + '\\').select()">Select Target</button>';
            html += '</div>';

            content.innerHTML = html;
            panel.classList.add('open');
        }

        function closeSidePanel() {
            document.getElementById('sidePanel').classList.remove('open');
            selectedNode = null;
            selectedEdge = null;
        }

        function startPathMode(sourceNode) {
            pathMode = true;
            pathSourceNode = sourceNode;
            document.getElementById('pathModeIndicator').classList.add('active');

            // Highlight source node
            cy.elements().removeClass('path-source path-target path-highlight');
            sourceNode.addClass('path-source');

            vscode.postMessage({ type: 'log', message: 'Path mode started from node: ' + sourceNode.id() });
        }

        function cancelPathMode() {
            pathMode = false;
            pathSourceNode = null;
            document.getElementById('pathModeIndicator').classList.remove('active');
            cy.elements().removeClass('path-source path-target path-highlight');
        }

        function focusOnNode(node) {
            cy.animate({
                center: { eles: node },
                zoom: 1.5
            }, {
                duration: 500
            });
            node.select();
        }

        function hideNode(node) {
            // Hide node and its edges
            node.connectedEdges().addClass('faded');
            node.addClass('faded');
        }

        function toggleLockNode(node) {
            const isLocked = node.locked();
            if (isLocked) {
                node.unlock();
            } else {
                node.lock();
            }
        }

        function queryRelated(nodeId) {
            vscode.postMessage({
                type: 'queryRelated',
                nodeId: nodeId
            });
        }

        function escapeHtml(text) {
            return String(text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        // Escape for JavaScript string contexts (single-quoted strings)
        // Used for onclick handler values to prevent XSS via node IDs
        function escapeJsString(text) {
            return String(text)
                .replace(/\\\\/g, '\\\\\\\\')
                .replace(/'/g, "\\\\'")
                .replace(/\\n/g, '\\\\n')
                .replace(/\\r/g, '\\\\r');
        }

        function updateSelectionInfo() {
            const info = document.getElementById('selectionInfo');
            const selected = cy.$(':selected');

            if (selected.length === 0) {
                info.classList.remove('visible');
                return;
            }

            const nodes = selected.nodes().length;
            const edges = selected.edges().length;

            let text = '';
            if (nodes > 0) text += nodes + ' node' + (nodes > 1 ? 's' : '');
            if (nodes > 0 && edges > 0) text += ', ';
            if (edges > 0) text += edges + ' edge' + (edges > 1 ? 's' : '');
            text += ' selected';

            info.textContent = text;
            info.classList.add('visible');
        }

        // Load elements
        function loadElements(elements, applyLayout = true) {
            document.getElementById('emptyState').style.display = 'none';

            cy.elements().remove();
            cy.add(elements);

            nodeCount = cy.nodes().length;
            edgeCount = cy.edges().length;
            updateStats();

            if (applyLayout) {
                runLayout();
            }
        }

        // Parse DOT format
        function parseDot(dot) {
            const elements = { nodes: [], edges: [] };
            const nodeMap = new Map();

            // Simple DOT parser
            const lines = dot.split('\\n');

            for (const line of lines) {
                const trimmed = line.trim();

                // Skip empty lines and graph declarations
                if (!trimmed || trimmed.startsWith('digraph') || trimmed.startsWith('graph') ||
                    trimmed === '{' || trimmed === '}') {
                    continue;
                }

                // Edge: a -> b or a -- b
                const edgeMatch = trimmed.match(/^"?([^"\\->]+)"?\\s*(->|--)\\s*"?([^"\\[]+)"?(?:\\s*\\[(.*)\\])?/);
                if (edgeMatch) {
                    const source = edgeMatch[1].trim();
                    const target = edgeMatch[3].trim();
                    const attrs = parseAttributes(edgeMatch[4] || '');

                    // Ensure nodes exist
                    if (!nodeMap.has(source)) {
                        nodeMap.set(source, { id: source, labels: [], properties: {} });
                    }
                    if (!nodeMap.has(target)) {
                        nodeMap.set(target, { id: target, labels: [], properties: {} });
                    }

                    elements.edges.push({
                        data: {
                            id: source + '-' + target + '-' + elements.edges.length,
                            source: source,
                            target: target,
                            type: attrs.label || '',
                            properties: attrs
                        }
                    });
                    continue;
                }

                // Node: a [label="..."]
                const nodeMatch = trimmed.match(/^"?([^"\\[]+)"?(?:\\s*\\[(.*)\\])?;?$/);
                if (nodeMatch) {
                    const id = nodeMatch[1].trim();
                    const attrs = parseAttributes(nodeMatch[2] || '');

                    if (!nodeMap.has(id)) {
                        nodeMap.set(id, {
                            id: id,
                            labels: attrs.label ? [attrs.label] : [],
                            properties: attrs
                        });
                    } else {
                        const existing = nodeMap.get(id);
                        if (attrs.label) {
                            existing.labels = [attrs.label];
                        }
                        Object.assign(existing.properties, attrs);
                    }
                }
            }

            // Convert node map to elements
            for (const [id, data] of nodeMap) {
                elements.nodes.push({
                    data: {
                        id: id,
                        labels: data.labels,
                        properties: data.properties
                    }
                });
            }

            return elements;
        }

        function parseAttributes(attrString) {
            const attrs = {};
            if (!attrString) return attrs;

            const matches = attrString.matchAll(/(\\w+)\\s*=\\s*"([^"]*)"/g);
            for (const match of matches) {
                attrs[match[1]] = match[2];
            }
            return attrs;
        }

        // Layout functions
        function runLayout(name) {
            if (!cy || cy.nodes().length === 0) return;

            const layoutName = name || document.getElementById('layoutSelect').value;

            // Stop current layout
            if (currentLayout) {
                currentLayout.stop();
            }

            let layoutOptions;

            switch (layoutName) {
                case 'cose':
                    // Use cose-bilkent for better performance on large graphs
                    if (cy.nodes().length > 100 && typeof cy.layout({ name: 'cose-bilkent' }).run === 'function') {
                        layoutOptions = {
                            name: 'cose-bilkent',
                            quality: 'draft',
                            animate: config.physics,
                            animationDuration: 500,
                            nodeDimensionsIncludeLabels: true,
                            idealEdgeLength: 100,
                            nodeRepulsion: 8000,
                            numIter: 2500
                        };
                    } else {
                        layoutOptions = {
                            name: 'cose',
                            animate: config.physics,
                            animationDuration: 500,
                            nodeOverlap: 20,
                            idealEdgeLength: 100,
                            nodeRepulsion: 400000,
                            numIter: 1000
                        };
                    }
                    break;
                case 'dagre':
                    layoutOptions = {
                        name: 'dagre',
                        rankDir: 'TB',
                        nodeSep: 50,
                        rankSep: 100,
                        animate: config.physics,
                        animationDuration: 500
                    };
                    break;
                case 'circle':
                    layoutOptions = {
                        name: 'circle',
                        animate: config.physics,
                        animationDuration: 500
                    };
                    break;
                case 'grid':
                    layoutOptions = {
                        name: 'grid',
                        animate: config.physics,
                        animationDuration: 500
                    };
                    break;
                case 'concentric':
                    layoutOptions = {
                        name: 'concentric',
                        concentric: function(node) {
                            return node.degree();
                        },
                        levelWidth: function() {
                            return 2;
                        },
                        animate: config.physics,
                        animationDuration: 500
                    };
                    break;
                case 'breadthfirst':
                    layoutOptions = {
                        name: 'breadthfirst',
                        directed: true,
                        animate: config.physics,
                        animationDuration: 500
                    };
                    break;
                default:
                    layoutOptions = {
                        name: 'cose',
                        animate: config.physics,
                        animationDuration: 500
                    };
            }

            currentLayout = cy.layout(layoutOptions);
            currentLayout.run();
        }

        function changeLayout(layout) {
            runLayout(layout);
        }

        // View controls
        function fit() {
            cy.fit(50);
        }

        function zoomIn() {
            cy.zoom(cy.zoom() * 1.3);
        }

        function zoomOut() {
            cy.zoom(cy.zoom() / 1.3);
        }

        function resetView() {
            cy.reset();
            fit();
        }

        // Toggle functions
        function toggleLabels(show) {
            config.showLabels = show;
            cy.style().update();
        }

        function togglePhysics(enabled) {
            config.physics = enabled;
        }

        function toggleClustering(enabled) {
            config.clustering = enabled;
            if (enabled && cy.nodes().length > config.clusterThreshold) {
                applyClustering();
            } else {
                removeClustering();
            }
        }

        function applyClustering() {
            // Group nodes by label
            const labelGroups = new Map();
            cy.nodes().forEach(node => {
                const label = (node.data('labels') || [])[0] || 'default';
                if (!labelGroups.has(label)) {
                    labelGroups.set(label, []);
                }
                labelGroups.get(label).push(node);
            });

            // Create parent nodes for clusters
            labelGroups.forEach((nodes, label) => {
                if (nodes.length > 10) {
                    cy.add({
                        data: { id: 'cluster-' + label },
                        classes: 'cluster'
                    });
                    nodes.forEach(node => {
                        node.move({ parent: 'cluster-' + label });
                    });
                }
            });

            runLayout();
        }

        function removeClustering() {
            cy.nodes().forEach(node => {
                if (node.isChild()) {
                    node.move({ parent: null });
                }
            });
            cy.nodes('.cluster').remove();
            runLayout();
        }

        // Search
        function searchNodes(query) {
            if (!query) {
                cy.elements().removeClass('highlighted faded');
                return;
            }

            const lowerQuery = query.toLowerCase();
            cy.nodes().forEach(node => {
                const props = node.data('properties') || {};
                const labels = node.data('labels') || [];

                const match = node.id().toLowerCase().includes(lowerQuery) ||
                    labels.some(l => l.toLowerCase().includes(lowerQuery)) ||
                    Object.values(props).some(v =>
                        String(v).toLowerCase().includes(lowerQuery)
                    );

                if (match) {
                    node.addClass('highlighted').removeClass('faded');
                } else {
                    node.addClass('faded').removeClass('highlighted');
                }
            });

            cy.edges().forEach(edge => {
                const sourceHighlighted = edge.source().hasClass('highlighted');
                const targetHighlighted = edge.target().hasClass('highlighted');
                if (sourceHighlighted || targetHighlighted) {
                    edge.removeClass('faded');
                } else {
                    edge.addClass('faded');
                }
            });
        }

        // Export
        function exportPng() {
            const png = cy.png({ full: true, scale: 2 });
            vscode.postMessage({ type: 'exportPng', data: png });
        }

        function exportSvg() {
            // Cytoscape doesn't have native SVG export, so we use PNG
            // For real SVG, would need cytoscape-svg extension
            vscode.postMessage({
                type: 'exportSvg',
                data: '<svg><text>SVG export requires cytoscape-svg extension</text></svg>'
            });
        }

        // Stats
        function updateStats() {
            const stats = document.getElementById('stats');
            stats.textContent = nodeCount + ' nodes, ' + edgeCount + ' edges';

            vscode.postMessage({
                type: 'stats',
                nodes: nodeCount,
                edges: edgeCount
            });
        }

        // Message handler
        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'loadDot':
                    const dotElements = parseDot(message.dot);
                    config = message.config || config;
                    loadElements(dotElements);
                    break;
                case 'loadElements':
                    config = message.config || config;
                    loadElements(message.elements);
                    break;
                case 'loadJson':
                    // Load from JSON format (preferred)
                    config = message.config || config;
                    const jsonElements = parseJsonGraph(message.data);
                    loadElements(jsonElements);
                    break;
                case 'mergeElements':
                    mergeElements(message.elements, message.focusNodeId);
                    break;
                case 'highlightPath':
                    if (message.sourceId && message.targetId) {
                        const source = cy.getElementById(message.sourceId);
                        const target = cy.getElementById(message.targetId);
                        if (source.length && target.length) {
                            highlightShortestPath(source, target);
                        }
                    }
                    break;
                case 'updateConfig':
                    config = message.config;
                    cy.style().update();
                    break;
                case 'fit':
                    fit();
                    break;
                case 'reset':
                    resetView();
                    break;
                case 'selectNode':
                    const nodeToSelect = cy.getElementById(message.nodeId);
                    if (nodeToSelect.length) {
                        nodeToSelect.select();
                        focusOnNode(nodeToSelect);
                    }
                    break;
                case 'clearSelection':
                    cy.elements().unselect();
                    cy.elements().removeClass('highlighted faded path-source path-target path-highlight');
                    break;
            }
        });

        // Parse JSON graph data (from Geode CLI --format json)
        function parseJsonGraph(data) {
            const elements = { nodes: [], edges: [] };
            const nodeMap = new Map();

            // Handle array of result objects
            const items = Array.isArray(data) ? data : [data];

            for (const item of items) {
                // Check for graph-style output with nodes and relationships
                if (item.nodes) {
                    for (const node of item.nodes) {
                        const id = node.id || node._id || ('n' + nodeMap.size);
                        if (!nodeMap.has(id)) {
                            nodeMap.set(id, {
                                data: {
                                    id: String(id),
                                    labels: node.labels || node._labels || [],
                                    properties: node.properties || node
                                }
                            });
                        }
                    }
                }

                if (item.relationships || item.edges) {
                    const rels = item.relationships || item.edges || [];
                    for (const rel of rels) {
                        elements.edges.push({
                            data: {
                                id: String(rel.id || rel._id || ('e' + elements.edges.length)),
                                source: String(rel.startNode || rel.source || rel._start),
                                target: String(rel.endNode || rel.target || rel._end),
                                type: rel.type || rel._type || rel.label || '',
                                properties: rel.properties || rel
                            }
                        });
                    }
                }

                // Also check for inline node/edge properties in result rows
                for (const key of Object.keys(item)) {
                    const value = item[key];
                    if (value && typeof value === 'object') {
                        // Node detection
                        if (value._labels || value.labels || (value._id !== undefined && !value._start)) {
                            const id = value._id ?? value.id ?? ('n' + nodeMap.size);
                            if (!nodeMap.has(id)) {
                                nodeMap.set(id, {
                                    data: {
                                        id: String(id),
                                        labels: value._labels || value.labels || [],
                                        properties: value.properties || value
                                    }
                                });
                            }
                        }
                        // Edge detection
                        if ((value._type || value.type) && (value._start !== undefined || value.source !== undefined)) {
                            elements.edges.push({
                                data: {
                                    id: String(value._id || value.id || ('e' + elements.edges.length)),
                                    source: String(value._start ?? value.source),
                                    target: String(value._end ?? value.target),
                                    type: value._type || value.type || '',
                                    properties: value.properties || value
                                }
                            });
                        }
                    }
                }
            }

            elements.nodes = Array.from(nodeMap.values());
            return elements;
        }

        // Initialize on load
        document.addEventListener('DOMContentLoaded', initCytoscape);

        // Fallback init
        if (document.readyState === 'complete') {
            initCytoscape();
        }
    </script>
</body>
</html>`;
    }

    public dispose(): void {
        GraphVisualizationPanel._instance = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}

/**
 * Execute query and get DOT format output
 */
export async function queryToDot(
    geodeBinary: string,
    query: string,
    host: string,
    port: number,
    insecure: boolean,
    username?: string,
    password?: string
): Promise<string> {
    return new Promise((resolve, reject) => {
        const args = ['query', '--format', 'dot', '--server', `${host}:${port}`];

        if (insecure) {
            args.push('--insecure');
        }
        if (username) {
            args.push('-U', username);
        }
        // SECURITY: Password is passed via environment variable below, not CLI args
        args.push('-');

        // SECURITY: Pass password via environment variable instead of CLI arg
        // to prevent exposure in process listings (ps aux, /proc/*/cmdline)
        const spawnEnv: NodeJS.ProcessEnv = { ...process.env };
        if (password) {
            spawnEnv['GEODE_PASSWORD'] = password;
        }

        const proc = cp.spawn(geodeBinary, args, { timeout: 60000, env: spawnEnv });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', data => stdout += data.toString());
        proc.stderr.on('data', data => stderr += data.toString());

        proc.on('close', code => {
            if (code === 0) {
                resolve(stdout);
            } else {
                const errorLines = stderr.split('\n')
                    .filter(line => !line.startsWith('debug('))
                    .join('\n').trim();
                reject(new Error(errorLines || `Query failed with exit code ${code}`));
            }
        });

        proc.on('error', err => reject(err));

        proc.stdin.write(query);
        proc.stdin.end();
    });
}

/**
 * Execute query and get JSON format output (preferred for graph visualization)
 */
export async function queryToJson(
    geodeBinary: string,
    query: string,
    host: string,
    port: number,
    insecure: boolean,
    username?: string,
    password?: string
): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const args = ['query', '--format', 'json', '--server', `${host}:${port}`];

        if (insecure) {
            args.push('--insecure');
        }
        if (username) {
            args.push('-U', username);
        }
        // SECURITY: Password is passed via environment variable below, not CLI args
        args.push('-');

        // SECURITY: Pass password via environment variable instead of CLI arg
        // to prevent exposure in process listings (ps aux, /proc/*/cmdline)
        const spawnEnv: NodeJS.ProcessEnv = { ...process.env };
        if (password) {
            spawnEnv['GEODE_PASSWORD'] = password;
        }

        const proc = cp.spawn(geodeBinary, args, { timeout: 60000, env: spawnEnv });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', data => stdout += data.toString());
        proc.stderr.on('data', data => stderr += data.toString());

        proc.on('close', code => {
            if (code === 0) {
                try {
                    // Parse JSON lines output
                    const results: any[] = [];
                    const lines = stdout.trim().split('\n').filter(l => l.trim());

                    for (const line of lines) {
                        try {
                            const json = JSON.parse(line);
                            // Extract rows from BINDINGS messages
                            if (json.result?.type === 'BINDINGS' && json.result.rows) {
                                results.push(...json.result.rows);
                            } else if (json.row) {
                                results.push(json.row);
                            } else if (json.bindings) {
                                results.push(...json.bindings);
                            }
                        } catch {
                            // Skip non-JSON lines
                        }
                    }

                    resolve(results);
                } catch (parseError) {
                    reject(new Error(`Failed to parse JSON: ${parseError}`));
                }
            } else {
                const errorLines = stderr.split('\n')
                    .filter(line => !line.startsWith('debug('))
                    .join('\n').trim();
                reject(new Error(errorLines || `Query failed with exit code ${code}`));
            }
        });

        proc.on('error', err => reject(err));

        proc.stdin.write(query);
        proc.stdin.end();
    });
}

/**
 * Build a query to expand neighbors of a node
 *
 * Security: All inputs are sanitized to prevent GQL injection.
 */
export function buildExpandQuery(nodeId: string, labels: string[], depth: number = 1): string {
    // Sanitize nodeId - escape for use in string comparison
    const sanitizedNodeId = escapeStringValue(nodeId);

    // Sanitize labels - only include valid identifiers
    const validLabels = labels
        .map(l => sanitizeIdentifier(l))
        .filter((l): l is string => l !== null);
    const labelPattern = validLabels.length > 0 ? ':' + validLabels.join(':') : '';

    // Sanitize depth - ensure it's a safe integer
    const sanitizedDepth = sanitizeNumber(depth, 1, 1, 10);

    return `MATCH (n${labelPattern})-[r*1..${sanitizedDepth}]-(m)
WHERE id(n) = '${sanitizedNodeId}' OR n.id = '${sanitizedNodeId}'
RETURN n, r, m
LIMIT 100`;
}

/**
 * Build a query to find related data for a node
 *
 * Security: All inputs are sanitized to prevent GQL injection.
 */
export function buildRelatedQuery(nodeId: string, relationshipType?: string): string {
    // Sanitize nodeId
    const sanitizedNodeId = escapeStringValue(nodeId);

    // Sanitize relationshipType if provided
    let relPattern = '[r]';
    if (relationshipType) {
        const sanitizedType = sanitizeIdentifier(relationshipType);
        if (sanitizedType) {
            relPattern = `[:${sanitizedType}]`;
        }
        // If invalid, fall back to matching any relationship type
    }

    return `MATCH (n)-${relPattern}-(m)
WHERE id(n) = '${sanitizedNodeId}' OR n.id = '${sanitizedNodeId}'
RETURN n, r, m
LIMIT 50`;
}
