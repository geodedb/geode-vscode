import * as vscode from 'vscode';
import { BaseWebviewPanel, getWebviewOptions, WebviewPanelOptions } from './BaseWebviewPanel';
import { escapeHtml } from '../utils/security';

/**
 * Graph node data structure
 */
export interface GraphNode {
    id: string | number;
    labels?: string[];
    properties?: Record<string, unknown>;
    x?: number;
    y?: number;
}

/**
 * Graph edge data structure
 */
export interface GraphEdge {
    id: string | number;
    source: string | number;
    target: string | number;
    type?: string;
    properties?: Record<string, unknown>;
}

/**
 * Graph data structure
 */
export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

/**
 * Layout options for graph visualization
 */
export type LayoutType = 'force' | 'hierarchical' | 'circular' | 'grid';

/**
 * Panel for interactive graph visualization.
 * Features:
 * - Force-directed and hierarchical layouts
 * - Node/edge selection and inspection
 * - Zoom and pan
 * - Node filtering by label
 * - Edge filtering by type
 * - Export to PNG/SVG
 */
export class GraphViewPanel extends BaseWebviewPanel {
    public static readonly viewType: string = 'geode.graphView';

    private static _instance: GraphViewPanel | undefined;
    private _graphData: GraphData | undefined;
    private _layout: LayoutType = 'force';
    private _query: string = '';

    /**
     * Get or create the graph view panel singleton.
     */
    public static createOrShow(options: WebviewPanelOptions): GraphViewPanel {
        const column = options.viewColumn || vscode.ViewColumn.Two;

        // If we already have a panel, show it
        if (GraphViewPanel._instance) {
            GraphViewPanel._instance.reveal(column);
            return GraphViewPanel._instance;
        }

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            GraphViewPanel.viewType,
            'Graph Visualization',
            { viewColumn: column, preserveFocus: options.preserveFocus ?? true },
            getWebviewOptions(options.extensionUri)
        );

        GraphViewPanel._instance = new GraphViewPanel(panel, options.extensionUri);
        return GraphViewPanel._instance;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        super(panel, extensionUri);
    }

    protected get title(): string {
        return 'Graph Visualization';
    }

    /**
     * Update the panel with new graph data.
     * SECURITY: Uses postMessage to pass data to webview instead of inline JSON.
     */
    public setGraphData(data: GraphData, query?: string) {
        this._graphData = data;
        if (query) {
            this._query = query;
        }
        this._updateContent();
        // SECURITY: Send data via postMessage instead of inline JSON.stringify
        this.postMessage({ type: 'setGraphData', graphData: data, layout: this._layout });
    }

    /**
     * Clear the graph data.
     */
    public clearGraph() {
        this._graphData = undefined;
        this._query = '';
        this._updateContent();
    }

    /**
     * Set the layout type.
     */
    public setLayout(layout: LayoutType) {
        this._layout = layout;
        this.postMessage({ type: 'setLayout', layout });
    }

    protected _handleMessage(message: { type: string; [key: string]: unknown }): void {
        switch (message.type) {
            case 'nodeSelected':
                this._showNodeDetails(message.node as GraphNode);
                break;
            case 'edgeSelected':
                this._showEdgeDetails(message.edge as GraphEdge);
                break;
            case 'exportPng':
                this._exportToPng(message.dataUrl as string);
                break;
            case 'exportSvg':
                this._exportToSvg(message.svg as string);
                break;
            case 'layoutChange':
                this._layout = message.layout as LayoutType;
                break;
        }
    }

    private _showNodeDetails(node: GraphNode) {
        const props = node.properties ? JSON.stringify(node.properties, null, 2) : 'No properties';
        vscode.window.showInformationMessage(
            `Node ${node.id} [${node.labels?.join(', ') || 'no labels'}]: ${props.slice(0, 100)}...`
        );
    }

    private _showEdgeDetails(edge: GraphEdge) {
        const props = edge.properties ? JSON.stringify(edge.properties, null, 2) : 'No properties';
        vscode.window.showInformationMessage(
            `Edge ${edge.source} -[${edge.type || 'RELATES_TO'}]-> ${edge.target}: ${props.slice(0, 100)}...`
        );
    }

    private async _exportToPng(dataUrl: string) {
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('graph.png'),
            filters: { 'PNG Image': ['png'] }
        });

        if (uri) {
            // Remove data URL prefix
            const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            await vscode.workspace.fs.writeFile(uri, buffer);
            vscode.window.showInformationMessage(`Graph exported to ${uri.fsPath}`);
        }
    }

    private async _exportToSvg(svg: string) {
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('graph.svg'),
            filters: { 'SVG': ['svg'] }
        });

        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(svg, 'utf8'));
            vscode.window.showInformationMessage(`Graph exported to ${uri.fsPath}`);
        }
    }

    protected getStylesheets(): vscode.Uri[] {
        return [
            this.getWebviewUri('src', 'webviews', 'graph', 'graph.css')
        ];
    }

    protected getScripts(): vscode.Uri[] {
        return [
            this.getWebviewUri('src', 'webviews', 'graph', 'graph.js')
        ];
    }

    protected getBodyContent(): string {
        if (!this._graphData) {
            return this._getEmptyState();
        }

        const { nodes, edges } = this._graphData;

        // Get unique labels and types for filters
        const labels = [...new Set(nodes.flatMap(n => n.labels || []))];
        const edgeTypes = [...new Set(edges.map(e => e.type || 'RELATES_TO'))];

        return `
            <div class="graph-container">
                <div class="graph-toolbar geode-toolbar">
                    <div class="graph-info">
                        <span class="geode-badge">${nodes.length} nodes</span>
                        <span class="geode-badge">${edges.length} edges</span>
                    </div>
                    <div class="geode-toolbar__spacer"></div>

                    <select class="geode-select" id="layoutSelect" onchange="changeLayout(this.value)">
                        <option value="force" ${this._layout === 'force' ? 'selected' : ''}>Force Layout</option>
                        <option value="hierarchical" ${this._layout === 'hierarchical' ? 'selected' : ''}>Hierarchical</option>
                        <option value="circular" ${this._layout === 'circular' ? 'selected' : ''}>Circular</option>
                        <option value="grid" ${this._layout === 'grid' ? 'selected' : ''}>Grid</option>
                    </select>

                    <button class="geode-button geode-button--small geode-button--icon" onclick="zoomIn()" data-tooltip="Zoom In">+</button>
                    <button class="geode-button geode-button--small geode-button--icon" onclick="zoomOut()" data-tooltip="Zoom Out">-</button>
                    <button class="geode-button geode-button--small geode-button--icon" onclick="fitToView()" data-tooltip="Fit">Fit</button>

                    <div class="geode-toolbar__divider"></div>

                    <button class="geode-button geode-button--small" onclick="exportPng()">PNG</button>
                    <button class="geode-button geode-button--small geode-button--secondary" onclick="exportSvg()">SVG</button>
                </div>

                ${labels.length > 0 || edgeTypes.length > 0 ? `
                <div class="graph-filters">
                    ${labels.length > 0 ? `
                    <div class="filter-group">
                        <span class="filter-label">Labels:</span>
                        ${labels.map(label => `
                            <label class="geode-checkbox">
                                <input type="checkbox" checked onchange="toggleLabel('${escapeHtml(label)}', this.checked)">
                                <span>${escapeHtml(label)}</span>
                            </label>
                        `).join('')}
                    </div>
                    ` : ''}
                    ${edgeTypes.length > 0 ? `
                    <div class="filter-group">
                        <span class="filter-label">Edge Types:</span>
                        ${edgeTypes.map(type => `
                            <label class="geode-checkbox">
                                <input type="checkbox" checked onchange="toggleEdgeType('${escapeHtml(type)}', this.checked)">
                                <span>${escapeHtml(type)}</span>
                            </label>
                        `).join('')}
                    </div>
                    ` : ''}
                </div>
                ` : ''}

                <div class="graph-canvas-container">
                    <canvas id="graphCanvas"></canvas>
                    <div id="tooltip" class="graph-tooltip" style="display: none;"></div>
                </div>

                <div id="nodeDetails" class="node-details" style="display: none;">
                    <h4 class="node-details__title">Node Details</h4>
                    <div class="node-details__content"></div>
                </div>
            </div>

            <!-- SECURITY: Graph data is passed via postMessage instead of inline JSON -->
        `;
    }

    private _getEmptyState(): string {
        return `
            <div class="geode-empty">
                <div class="geode-empty__icon">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="3"></circle>
                        <circle cx="4" cy="8" r="2"></circle>
                        <circle cx="4" cy="16" r="2"></circle>
                        <circle cx="20" cy="8" r="2"></circle>
                        <circle cx="20" cy="16" r="2"></circle>
                        <line x1="6" y1="8" x2="9" y2="10.5"></line>
                        <line x1="6" y1="16" x2="9" y2="13.5"></line>
                        <line x1="18" y1="8" x2="15" y2="10.5"></line>
                        <line x1="18" y1="16" x2="15" y2="13.5"></line>
                    </svg>
                </div>
                <h3 class="geode-empty__title">No Graph Data</h3>
                <p class="geode-empty__message">
                    Execute a query that returns nodes and relationships to see a visualization here.
                </p>
            </div>
        `;
    }

    public dispose() {
        GraphViewPanel._instance = undefined;
        super.dispose();
    }
}
