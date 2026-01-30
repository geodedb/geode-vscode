/**
 * Enhanced Schema Explorer with live data from @geodedb/client
 */

import * as vscode from 'vscode';
import { GeodeClientWrapper, SchemaInfo } from '../client/GeodeClientWrapper';

// Security constants for input validation
const MAX_IDENTIFIER_LENGTH = 128;

/**
 * Sanitize GQL identifiers (labels, relationship types, property names).
 * Throws an error if the value is invalid.
 *
 * SECURITY: Prevents GQL injection by validating against allowed character pattern.
 */
function sanitizeIdentifier(value: string, type: string): string {
    if (!value || typeof value !== 'string') {
        throw new Error(`${type} is required`);
    }

    const trimmed = value.trim();

    if (trimmed.length === 0) {
        throw new Error(`${type} cannot be empty`);
    }

    if (trimmed.length > MAX_IDENTIFIER_LENGTH) {
        throw new Error(`${type} exceeds maximum length of ${MAX_IDENTIFIER_LENGTH}`);
    }

    // GQL identifiers: alphanumeric, underscores, must start with letter or underscore
    const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    if (!identifierPattern.test(trimmed)) {
        throw new Error(`${type} contains invalid characters. Only alphanumeric characters and underscores are allowed.`);
    }

    return trimmed;
}

/**
 * Escape HTML special characters to prevent XSS.
 *
 * SECURITY: Escapes characters that have special meaning in HTML.
 */
function escapeHtml(text: string): string {
    if (text === null || text === undefined) {
        return '';
    }
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

/**
 * Generate a random nonce for CSP.
 */
function generateNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export class EnhancedSchemaExplorerProvider implements vscode.TreeDataProvider<SchemaTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SchemaTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private schema: SchemaInfo | null = null;
    private isLoading = false;

    constructor(
        private clientWrapper: GeodeClientWrapper,
        private outputChannel: vscode.OutputChannel
    ) {}

    /**
     * Refresh schema from database
     */
    async refresh(): Promise<void> {
        if (!this.clientWrapper.isConnected()) {
            vscode.window.showWarningMessage('Not connected to Geode server');
            return;
        }

        if (this.isLoading) {
            return;
        }

        try {
            this.isLoading = true;
            this.outputChannel.appendLine('Refreshing schema...');

            this.schema = await this.clientWrapper.getSchema();
            this._onDidChangeTreeData.fire();

            this.outputChannel.appendLine('Schema refreshed successfully');
            vscode.window.showInformationMessage('Schema refreshed');
        } catch (error) {
            this.outputChannel.appendLine(`Schema refresh failed: ${error}`);
            vscode.window.showErrorMessage(`Failed to refresh schema: ${error}`);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Clear schema data
     */
    clear(): void {
        this.schema = null;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SchemaTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SchemaTreeItem): Promise<SchemaTreeItem[]> {
        if (!this.clientWrapper.isConnected()) {
            return [new SchemaTreeItem(
                'Not Connected',
                vscode.TreeItemCollapsibleState.None,
                'message',
                { iconPath: new vscode.ThemeIcon('warning') }
            )];
        }

        if (this.isLoading) {
            return [new SchemaTreeItem(
                'Loading schema...',
                vscode.TreeItemCollapsibleState.None,
                'message',
                { iconPath: new vscode.ThemeIcon('loading~spin') }
            )];
        }

        if (!this.schema) {
            // Auto-load schema on first access
            await this.refresh();
            if (!this.schema) {
                return [new SchemaTreeItem(
                    'Failed to load schema',
                    vscode.TreeItemCollapsibleState.None,
                    'message',
                    { iconPath: new vscode.ThemeIcon('error') }
                )];
            }
        }

        if (!element) {
            // Root level - show node labels and relationship types
            return [
                new SchemaTreeItem(
                    `Node Labels (${this.schema.nodeLabels.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    'category',
                    {
                        iconPath: new vscode.ThemeIcon('symbol-class'),
                        contextValue: 'nodeLabelsCategory'
                    }
                ),
                new SchemaTreeItem(
                    `Relationship Types (${this.schema.relationshipTypes.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    'category',
                    {
                        iconPath: new vscode.ThemeIcon('symbol-interface'),
                        contextValue: 'relationshipTypesCategory'
                    }
                )
            ];
        }

        if (element.contextValue === 'nodeLabelsCategory') {
            // Show all node labels
            return this.schema.nodeLabels.map(label =>
                new SchemaTreeItem(
                    `${label.name} (${label.count})`,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'nodeLabel',
                    {
                        iconPath: new vscode.ThemeIcon('symbol-class'),
                        contextValue: 'nodeLabel',
                        tooltip: `Node label: ${label.name}\\nCount: ${label.count}`,
                        command: {
                            command: 'geode.schema.showLabelDetails',
                            title: 'Show Details',
                            arguments: [label.name]
                        }
                    },
                    { labelName: label.name }
                )
            );
        }

        if (element.contextValue === 'relationshipTypesCategory') {
            // Show all relationship types
            return this.schema.relationshipTypes.map(relType =>
                new SchemaTreeItem(
                    `${relType.name} (${relType.count})`,
                    vscode.TreeItemCollapsibleState.None,
                    'relationshipType',
                    {
                        iconPath: new vscode.ThemeIcon('symbol-interface'),
                        contextValue: 'relationshipType',
                        tooltip: `Relationship type: ${relType.name}\\nCount: ${relType.count}`,
                        command: {
                            command: 'geode.schema.showRelationshipDetails',
                            title: 'Show Details',
                            arguments: [relType.name]
                        }
                    }
                )
            );
        }

        if (element.contextValue === 'nodeLabel' && element.data?.labelName) {
            // Show properties for this label
            const properties = this.schema.properties[element.data.labelName] || [];
            return properties.map(prop =>
                new SchemaTreeItem(
                    prop,
                    vscode.TreeItemCollapsibleState.None,
                    'property',
                    {
                        iconPath: new vscode.ThemeIcon('symbol-property'),
                        contextValue: 'property',
                        tooltip: `Property: ${prop}`
                    }
                )
            );
        }

        return [];
    }
}

class SchemaTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: 'category' | 'nodeLabel' | 'relationshipType' | 'property' | 'message',
        options?: {
            iconPath?: vscode.ThemeIcon | vscode.Uri;
            contextValue?: string;
            tooltip?: string;
            command?: vscode.Command;
        },
        public readonly data?: any
    ) {
        super(label, collapsibleState);

        if (options) {
            this.iconPath = options.iconPath;
            this.contextValue = options.contextValue || type;
            this.tooltip = options.tooltip;
            this.command = options.command;
        }
    }
}

/**
 * Register schema explorer commands
 */
export function registerSchemaExplorerCommands(
    context: vscode.ExtensionContext,
    provider: EnhancedSchemaExplorerProvider,
    clientWrapper: GeodeClientWrapper
): void {
    // Refresh schema command
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.refreshSchema', () => {
            provider.refresh();
        })
    );

    // Show label details command
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.schema.showLabelDetails', async (labelName: string) => {
            if (!clientWrapper.isConnected()) {
                vscode.window.showWarningMessage('Not connected to Geode server');
                return;
            }

            try {
                // SECURITY: Sanitize label name to prevent GQL injection
                const safeLabelName = sanitizeIdentifier(labelName, 'Label name');

                // Query for label details
                const result = await clientWrapper.query(`
                    MATCH (n:${safeLabelName})
                    RETURN properties(n) as props
                    LIMIT 10
                `);

                // Collect details
                const details = [];
                for await (const row of result) {
                    details.push(row.get('props'));
                }

                const panel = vscode.window.createWebviewPanel(
                    'geodeLabelDetails',
                    `Label: ${labelName}`,
                    vscode.ViewColumn.Beside,
                    {}
                );

                panel.webview.html = generateLabelDetailsHtml(labelName, details);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to fetch label details: ${error}`);
            }
        })
    );

    // Show relationship details command
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.schema.showRelationshipDetails', async (relType: string) => {
            if (!clientWrapper.isConnected()) {
                vscode.window.showWarningMessage('Not connected to Geode server');
                return;
            }

            try {
                // SECURITY: Sanitize relationship type to prevent GQL injection
                const safeRelType = sanitizeIdentifier(relType, 'Relationship type');

                // Query for relationship details
                const result = await clientWrapper.query(`
                    MATCH (a)-[r:${safeRelType}]->(b)
                    RETURN
                        labels(a) as source_labels,
                        labels(b) as target_labels,
                        properties(r) as props
                    LIMIT 10
                `);

                const details = [];
                for await (const row of result) {
                    details.push({
                        source: row.get('source_labels'),
                        target: row.get('target_labels'),
                        properties: row.get('props')
                    });
                }

                const panel = vscode.window.createWebviewPanel(
                    'geodeRelationshipDetails',
                    `Relationship: ${relType}`,
                    vscode.ViewColumn.Beside,
                    {}
                );

                panel.webview.html = generateRelationshipDetailsHtml(relType, details);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to fetch relationship details: ${error}`);
            }
        })
    );

    // Copy label query command
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.schema.copyLabelQuery', async (item: SchemaTreeItem) => {
            if (item.data?.labelName) {
                try {
                    // SECURITY: Sanitize label name to prevent GQL injection
                    const safeLabelName = sanitizeIdentifier(item.data.labelName, 'Label name');
                    const query = `MATCH (n:${safeLabelName}) RETURN n LIMIT 100`;
                    await vscode.env.clipboard.writeText(query);
                    vscode.window.showInformationMessage('Query copied to clipboard');
                } catch (error) {
                    vscode.window.showErrorMessage(`Invalid label name: ${error}`);
                }
            }
        })
    );
}

function generateLabelDetailsHtml(labelName: string, samples: any[]): string {
    // SECURITY: Generate nonce for CSP
    const nonce = generateNonce();

    // SECURITY: Escape label name to prevent XSS
    const safeLabelName = escapeHtml(labelName);

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'none';">
            <style nonce="${nonce}">
                body { font-family: var(--vscode-font-family); padding: 20px; background: var(--vscode-editor-background); color: var(--vscode-foreground); }
                h1 { color: var(--vscode-foreground); }
                .sample {
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    padding: 10px;
                    margin: 10px 0;
                }
                pre {
                    background: var(--vscode-textBlockQuote-background);
                    padding: 10px;
                    border-radius: 4px;
                    overflow-x: auto;
                }
            </style>
        </head>
        <body>
            <h1>Label: ${safeLabelName}</h1>
            <h2>Sample Nodes</h2>
            ${samples.map((sample, i) => `
                <div class="sample">
                    <h3>Sample ${i + 1}</h3>
                    <pre>${escapeHtml(JSON.stringify(sample, null, 2))}</pre>
                </div>
            `).join('')}
        </body>
        </html>
    `;
}

function generateRelationshipDetailsHtml(relType: string, samples: any[]): string {
    // SECURITY: Generate nonce for CSP
    const nonce = generateNonce();

    // SECURITY: Escape relationship type to prevent XSS
    const safeRelType = escapeHtml(relType);

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'none';">
            <style nonce="${nonce}">
                body { font-family: var(--vscode-font-family); padding: 20px; background: var(--vscode-editor-background); color: var(--vscode-foreground); }
                h1 { color: var(--vscode-foreground); }
                .sample {
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    padding: 10px;
                    margin: 10px 0;
                }
                .pattern {
                    font-family: monospace;
                    background: var(--vscode-textBlockQuote-background);
                    padding: 5px 10px;
                    border-radius: 4px;
                }
                pre {
                    background: var(--vscode-textBlockQuote-background);
                    padding: 10px;
                    border-radius: 4px;
                    overflow-x: auto;
                }
            </style>
        </head>
        <body>
            <h1>Relationship: ${safeRelType}</h1>
            <h2>Sample Relationships</h2>
            ${samples.map((sample, i) => `
                <div class="sample">
                    <h3>Sample ${i + 1}</h3>
                    <div class="pattern">
                        (${escapeHtml(Array.isArray(sample.source) ? sample.source.join(',') : String(sample.source))}) -[:${safeRelType}]-&gt; (${escapeHtml(Array.isArray(sample.target) ? sample.target.join(',') : String(sample.target))})
                    </div>
                    <h4>Properties:</h4>
                    <pre>${escapeHtml(JSON.stringify(sample.properties, null, 2))}</pre>
                </div>
            `).join('')}
        </body>
        </html>
    `;
}
