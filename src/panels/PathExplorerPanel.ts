// CANARY: REQ=REQ-VSCODE-PATHS-001; FEATURE="PathExplorerPanel"; ASPECT=Implementation; STATUS=IMPL; OWNER=vscode; UPDATED=2026-01-03
import * as vscode from 'vscode';
import { BaseWebviewPanel, getWebviewOptions, WebviewPanelOptions } from './BaseWebviewPanel';

// Security constants for input validation
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_STRING_VALUE_LENGTH = 10000;
const MAX_DEPTH = 20;

/**
 * Sanitize GQL identifiers (labels, relationship types, property names).
 * Returns null if the value is invalid.
 *
 * SECURITY: Prevents GQL injection by validating against allowed character pattern.
 */
function sanitizeIdentifier(value: string | undefined | null): string | null {
    if (!value || typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    if (trimmed.length === 0 || trimmed.length > MAX_IDENTIFIER_LENGTH) {
        return null;
    }

    // GQL identifiers: alphanumeric, underscores, must start with letter or underscore
    const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    if (!identifierPattern.test(trimmed)) {
        return null;
    }

    return trimmed;
}

/**
 * Escape string values for safe interpolation in GQL queries.
 *
 * SECURITY: Escapes single quotes and backslashes to prevent injection.
 */
function escapeStringValue(value: string): string {
    if (value === null || value === undefined) {
        return '';
    }

    const strValue = String(value);

    if (strValue.length > MAX_STRING_VALUE_LENGTH) {
        return strValue.substring(0, MAX_STRING_VALUE_LENGTH).replace(/\\/g, '\\\\').replace(/'/g, "''");
    }

    return strValue.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

/**
 * Sanitize numeric depth value with bounds checking.
 *
 * SECURITY: Prevents injection via depth parameter and limits resource usage.
 */
function sanitizeDepth(value: number): number {
    if (typeof value !== 'number' || isNaN(value)) {
        return 5; // Safe default
    }
    return Math.max(1, Math.min(Math.floor(value), MAX_DEPTH));
}

/**
 * Path and Relationship Explorer Panel
 * Visualizes paths between nodes and relationship patterns in the graph.
 */
export class PathExplorerPanel extends BaseWebviewPanel {
    public static readonly viewType = 'geode.pathExplorer';

    private static _instance: PathExplorerPanel | undefined;
    private _pathResults: PathResult[] = [];
    private _searchParams: PathSearchParams = {
        sourceNode: '',
        targetNode: '',
        relationshipTypes: [],
        maxDepth: 5,
        pathType: 'shortest'
    };

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        super(panel, extensionUri);
    }

    public static createOrShow(options: WebviewPanelOptions): PathExplorerPanel {
        const column = options.viewColumn || vscode.ViewColumn.Two;

        if (PathExplorerPanel._instance) {
            PathExplorerPanel._instance.reveal(column);
            return PathExplorerPanel._instance;
        }

        const panel = vscode.window.createWebviewPanel(
            PathExplorerPanel.viewType,
            'Geode Path Explorer',
            column,
            getWebviewOptions(options.extensionUri)
        );

        PathExplorerPanel._instance = new PathExplorerPanel(panel, options.extensionUri);
        return PathExplorerPanel._instance;
    }

    protected get title(): string {
        return 'Geode Path Explorer';
    }

    protected _handleMessage(message: { type: string; [key: string]: unknown }): void {
        switch (message.type) {
            case 'searchPaths':
                this._searchPaths(message.params as PathSearchParams);
                break;
            case 'expandPath':
                this._expandPath(message.pathIndex as number);
                break;
            case 'exportPaths':
                this._exportPaths();
                break;
            case 'generateQuery':
                this._generateQuery();
                break;
            case 'visualizePath':
                this._visualizePath(message.pathIndex as number);
                break;
        }
    }

    protected getStylesheets(): vscode.Uri[] {
        return [this.getWebviewUri('src', 'webviews', 'paths', 'paths.css')];
    }

    protected getScripts(): vscode.Uri[] {
        return [this.getWebviewUri('src', 'webviews', 'paths', 'paths.js')];
    }

    protected getBodyContent(): string {
        return `
        <div class="path-explorer">
            <div class="search-panel">
                <h2>Path Search</h2>

                <div class="search-form">
                    <div class="form-row">
                        <div class="form-group">
                            <label for="sourceNode">Source Node</label>
                            <input type="text" id="sourceNode" placeholder="Node ID or label:property"
                                   value="${this._escapeHtml(this._searchParams.sourceNode)}">
                        </div>
                        <div class="form-group">
                            <label for="targetNode">Target Node</label>
                            <input type="text" id="targetNode" placeholder="Node ID or label:property"
                                   value="${this._escapeHtml(this._searchParams.targetNode)}">
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label for="relTypes">Relationship Types (comma-separated)</label>
                            <input type="text" id="relTypes" placeholder="FOLLOWS, KNOWS, LIKES"
                                   value="${this._searchParams.relationshipTypes.join(', ')}">
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label for="maxDepth">Max Depth</label>
                            <input type="number" id="maxDepth" min="1" max="20"
                                   value="${this._searchParams.maxDepth}">
                        </div>
                        <div class="form-group">
                            <label for="pathType">Path Type</label>
                            <select id="pathType">
                                <option value="shortest" ${this._searchParams.pathType === 'shortest' ? 'selected' : ''}>Shortest Path</option>
                                <option value="all" ${this._searchParams.pathType === 'all' ? 'selected' : ''}>All Paths</option>
                                <option value="weighted" ${this._searchParams.pathType === 'weighted' ? 'selected' : ''}>Weighted Shortest</option>
                            </select>
                        </div>
                    </div>

                    <div class="form-actions">
                        <button class="btn btn-primary" onclick="searchPaths()">
                            Search Paths
                        </button>
                        <button class="btn btn-secondary" onclick="postToExtension('generateQuery')">
                            Generate GQL
                        </button>
                    </div>
                </div>
            </div>

            <div class="results-panel">
                <div class="results-header">
                    <h2>Path Results</h2>
                    <div class="results-actions">
                        <span class="result-count">${this._pathResults.length} paths found</span>
                        <button class="btn btn-secondary" onclick="postToExtension('exportPaths')"
                                ${this._pathResults.length === 0 ? 'disabled' : ''}>
                            Export
                        </button>
                    </div>
                </div>

                <div class="path-list">
                    ${this._renderPathResults()}
                </div>
            </div>

            <div class="relationship-patterns">
                <h3>Common Relationship Patterns</h3>
                <div class="pattern-grid">
                    ${this._renderRelationshipPatterns()}
                </div>
            </div>
        </div>
        `;
    }

    private _renderPathResults(): string {
        if (this._pathResults.length === 0) {
            return '<div class="no-results">No paths found. Enter source and target nodes to search.</div>';
        }

        return this._pathResults.map((path, index) => `
            <div class="path-item ${path.expanded ? 'expanded' : ''}">
                <div class="path-header" onclick="togglePath(${index})">
                    <span class="path-icon">${path.expanded ? '▼' : '▶'}</span>
                    <span class="path-summary">
                        <strong>Path ${index + 1}</strong>: ${path.nodes.length} nodes, ${path.relationships.length} relationships
                    </span>
                    <span class="path-length">Length: ${path.length}</span>
                    ${path.cost !== undefined ? `<span class="path-cost">Cost: ${path.cost.toFixed(2)}</span>` : ''}
                    <button class="btn-icon" onclick="event.stopPropagation(); postToExtension('visualizePath', {pathIndex: ${index}})" title="Visualize">
                        ◎
                    </button>
                </div>
                ${path.expanded ? this._renderExpandedPath(path) : ''}
            </div>
        `).join('');
    }

    private _renderExpandedPath(path: PathResult): string {
        const segments: string[] = [];

        for (let i = 0; i < path.nodes.length; i++) {
            const node = path.nodes[i];
            segments.push(`
                <div class="path-node">
                    <span class="node-icon">●</span>
                    <span class="node-label">${this._escapeHtml(node.labels.join(':'))}</span>
                    <span class="node-id">#${node.id}</span>
                    ${node.properties ? `<span class="node-props">${this._formatProperties(node.properties)}</span>` : ''}
                </div>
            `);

            if (i < path.relationships.length) {
                const rel = path.relationships[i];
                segments.push(`
                    <div class="path-edge">
                        <span class="edge-line">──</span>
                        <span class="edge-type">${this._escapeHtml(rel.type)}</span>
                        <span class="edge-arrow">→</span>
                        ${rel.properties ? `<span class="edge-props">${this._formatProperties(rel.properties)}</span>` : ''}
                    </div>
                `);
            }
        }

        return `<div class="path-detail">${segments.join('')}</div>`;
    }

    private _renderRelationshipPatterns(): string {
        const patterns = [
            { name: 'Direct Connection', pattern: '(a)-[r]->(b)', description: 'Single hop relationship' },
            { name: 'Two Hops', pattern: '(a)-[*2]->(b)', description: 'Exactly two relationships' },
            { name: 'Variable Length', pattern: '(a)-[*1..5]->(b)', description: '1 to 5 hops' },
            { name: 'Typed Path', pattern: '(a)-[:KNOWS*]->(b)', description: 'Only KNOWS relationships' },
            { name: 'Shortest Path', pattern: 'shortestPath((a)-[*]->(b))', description: 'Minimum hops' },
            { name: 'All Shortest', pattern: 'allShortestPaths((a)-[*]->(b))', description: 'All minimum paths' }
        ];

        return patterns.map(p => `
            <div class="pattern-card" onclick="applyPattern('${p.pattern}')">
                <div class="pattern-name">${p.name}</div>
                <code class="pattern-code">${p.pattern}</code>
                <div class="pattern-desc">${p.description}</div>
            </div>
        `).join('');
    }

    private _formatProperties(props: Record<string, unknown>): string {
        const entries = Object.entries(props).slice(0, 3);
        const formatted = entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
        return `{${formatted}${Object.keys(props).length > 3 ? ', ...' : ''}}`;
    }

    private async _searchPaths(params: PathSearchParams): Promise<void> {
        this._searchParams = params;

        // Generate sample path results for demonstration
        // In production, this would query the Geode server
        this._pathResults = this._generateSamplePaths(params);
        this._updateContent();
    }

    private _generateSamplePaths(params: PathSearchParams): PathResult[] {
        const count = params.pathType === 'all' ? 5 : params.pathType === 'shortest' ? 1 : 3;
        const results: PathResult[] = [];

        for (let i = 0; i < count; i++) {
            const pathLength = Math.min(params.maxDepth, Math.floor(Math.random() * 4) + 2);
            const nodes: PathNode[] = [];
            const relationships: PathRelationship[] = [];

            for (let j = 0; j <= pathLength; j++) {
                nodes.push({
                    id: Math.floor(Math.random() * 10000),
                    labels: ['Node', `Type${j % 3}`],
                    properties: { name: `Node_${j}`, created: new Date().toISOString() }
                });

                if (j < pathLength) {
                    const relTypes = params.relationshipTypes.length > 0
                        ? params.relationshipTypes
                        : ['CONNECTED', 'KNOWS', 'FOLLOWS'];
                    relationships.push({
                        id: Math.floor(Math.random() * 10000),
                        type: relTypes[Math.floor(Math.random() * relTypes.length)],
                        properties: { weight: Math.random() }
                    });
                }
            }

            results.push({
                nodes,
                relationships,
                length: pathLength,
                cost: params.pathType === 'weighted' ? Math.random() * 10 : undefined,
                expanded: false
            });
        }

        return results;
    }

    private _expandPath(pathIndex: number): void {
        if (pathIndex >= 0 && pathIndex < this._pathResults.length) {
            this._pathResults[pathIndex].expanded = !this._pathResults[pathIndex].expanded;
            this._updateContent();
        }
    }

    private async _exportPaths(): Promise<void> {
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('geode-paths.json'),
            filters: { 'JSON': ['json'], 'CSV': ['csv'] }
        });

        if (uri) {
            const ext = uri.path.split('.').pop()?.toLowerCase();
            let content: string;

            if (ext === 'csv') {
                content = this._pathResultsToCsv();
            } else {
                content = JSON.stringify(this._pathResults, null, 2);
            }

            await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
            vscode.window.showInformationMessage('Paths exported successfully');
        }
    }

    private _pathResultsToCsv(): string {
        const lines = ['PathIndex,Length,Cost,NodeCount,RelationshipCount'];
        this._pathResults.forEach((path, i) => {
            lines.push(`${i + 1},${path.length},${path.cost ?? ''},${path.nodes.length},${path.relationships.length}`);
        });
        return lines.join('\n');
    }

    private _generateQuery(): void {
        const params = this._searchParams;
        let query = '';

        // SECURITY: Sanitize relationship types to prevent GQL injection
        const sanitizedRelTypes = params.relationshipTypes
            .map(rt => sanitizeIdentifier(rt))
            .filter((rt): rt is string => rt !== null);

        const relPattern = sanitizedRelTypes.length > 0
            ? `:${sanitizedRelTypes.join('|')}`
            : '';

        // SECURITY: Escape source and target node values to prevent GQL injection
        const escapedSource = escapeStringValue(params.sourceNode);
        const escapedTarget = escapeStringValue(params.targetNode);

        // SECURITY: Sanitize depth parameter with bounds checking
        const safeDepth = sanitizeDepth(params.maxDepth);

        switch (params.pathType) {
            case 'shortest':
                query = `MATCH p = shortestPath((a)-[${relPattern}*1..${safeDepth}]->(b))
WHERE a.id = '${escapedSource}' AND b.id = '${escapedTarget}'
RETURN p`;
                break;
            case 'all':
                query = `MATCH p = (a)-[${relPattern}*1..${safeDepth}]->(b)
WHERE a.id = '${escapedSource}' AND b.id = '${escapedTarget}'
RETURN p`;
                break;
            case 'weighted':
                query = `MATCH p = (a)-[${relPattern}*1..${safeDepth}]->(b)
WHERE a.id = '${escapedSource}' AND b.id = '${escapedTarget}'
WITH p, reduce(cost = 0, r IN relationships(p) | cost + coalesce(r.weight, 1)) AS totalCost
RETURN p, totalCost
ORDER BY totalCost
LIMIT 1`;
                break;
        }

        // Copy to clipboard and show
        vscode.env.clipboard.writeText(query);
        vscode.window.showInformationMessage('GQL query copied to clipboard');
    }

    private _visualizePath(pathIndex: number): void {
        // This would open the GraphViewPanel with just this path
        vscode.window.showInformationMessage(`Visualizing path ${pathIndex + 1}`);
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    public dispose(): void {
        PathExplorerPanel._instance = undefined;
        super.dispose();
    }
}

interface PathSearchParams {
    sourceNode: string;
    targetNode: string;
    relationshipTypes: string[];
    maxDepth: number;
    pathType: 'shortest' | 'all' | 'weighted';
}

interface PathNode {
    id: number;
    labels: string[];
    properties?: Record<string, unknown>;
}

interface PathRelationship {
    id: number;
    type: string;
    properties?: Record<string, unknown>;
}

interface PathResult {
    nodes: PathNode[];
    relationships: PathRelationship[];
    length: number;
    cost?: number;
    expanded: boolean;
}
