/**
 * Query History Provider - Tracks executed queries for easy re-execution
 */

import * as vscode from 'vscode';
import { secureId } from '../utils/security';

export interface QueryHistoryEntry {
    id: string;
    query: string;
    timestamp: number;
    duration?: number;
    rowCount?: number;
    connectionName?: string;
    success: boolean;
    error?: string;
}

/**
 * Tree item representing a query in history
 */
class QueryHistoryItem extends vscode.TreeItem {
    constructor(
        public readonly entry: QueryHistoryEntry
    ) {
        super(QueryHistoryItem.getLabel(entry), vscode.TreeItemCollapsibleState.None);

        this.id = entry.id;
        this.description = QueryHistoryItem.getDescription(entry);
        this.tooltip = QueryHistoryItem.getTooltip(entry);
        this.contextValue = entry.success ? 'queryHistory-success' : 'queryHistory-error';
        this.iconPath = entry.success
            ? new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'))
            : new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));

        // Double-click to insert query into editor
        this.command = {
            command: 'geode.history.insertQuery',
            title: 'Insert Query',
            arguments: [entry]
        };
    }

    private static getLabel(entry: QueryHistoryEntry): string {
        // Truncate and clean up query for display
        const cleaned = entry.query.replace(/\s+/g, ' ').trim();
        return cleaned.length > 50 ? cleaned.substring(0, 50) + '...' : cleaned;
    }

    private static getDescription(entry: QueryHistoryEntry): string {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        if (entry.success && entry.rowCount !== undefined) {
            return `${entry.rowCount} rows | ${time}`;
        }
        return time;
    }

    private static getTooltip(entry: QueryHistoryEntry): string {
        const lines = [
            entry.query,
            '',
            `Time: ${new Date(entry.timestamp).toLocaleString()}`
        ];

        if (entry.connectionName) {
            lines.push(`Connection: ${entry.connectionName}`);
        }

        if (entry.duration !== undefined) {
            lines.push(`Duration: ${entry.duration}ms`);
        }

        if (entry.rowCount !== undefined) {
            lines.push(`Rows: ${entry.rowCount}`);
        }

        if (entry.error) {
            lines.push(`Error: ${entry.error}`);
        }

        return lines.join('\n');
    }
}

/**
 * Provider for query history tree view
 */
export class QueryHistoryProvider implements vscode.TreeDataProvider<QueryHistoryItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<QueryHistoryItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private history: QueryHistoryEntry[] = [];
    private maxEntries: number = 100;

    constructor(
        private context: vscode.ExtensionContext
    ) {
        this.loadHistory();
    }

    /**
     * Add a query to history
     */
    addEntry(entry: Omit<QueryHistoryEntry, 'id' | 'timestamp'>): void {
        const fullEntry: QueryHistoryEntry = {
            ...entry,
            id: secureId('query'),
            timestamp: Date.now()
        };

        // Add to beginning (most recent first)
        this.history.unshift(fullEntry);

        // Trim to max entries
        if (this.history.length > this.maxEntries) {
            this.history = this.history.slice(0, this.maxEntries);
        }

        this.saveHistory();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Clear all history
     */
    clearHistory(): void {
        this.history = [];
        this.saveHistory();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Remove a specific entry
     */
    removeEntry(id: string): void {
        this.history = this.history.filter(e => e.id !== id);
        this.saveHistory();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get all history entries
     */
    getEntries(): QueryHistoryEntry[] {
        return [...this.history];
    }

    /**
     * Refresh the view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: QueryHistoryItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: QueryHistoryItem): vscode.ProviderResult<QueryHistoryItem[]> {
        if (element) {
            return []; // No nested items
        }

        if (this.history.length === 0) {
            return [];
        }

        return this.history.map(entry => new QueryHistoryItem(entry));
    }

    private loadHistory(): void {
        // SECURITY: Issue #32 - Use workspaceState instead of globalState
        // to prevent sensitive query text from syncing across devices
        this.history = this.context.workspaceState.get<QueryHistoryEntry[]>('geode.queryHistory', []);

        // MIGRATION: Check if there's data in the old globalState location
        const oldHistory = this.context.globalState.get<QueryHistoryEntry[]>('geode.queryHistory');
        if (oldHistory && oldHistory.length > 0 && this.history.length === 0) {
            // Migrate from globalState to workspaceState
            this.history = oldHistory;
            this.saveHistory();
            // Clear old synced data for security
            this.context.globalState.update('geode.queryHistory', undefined);
        }
    }

    private saveHistory(): void {
        // SECURITY: Issue #32 - Use workspaceState instead of globalState
        // to prevent sensitive query text from syncing across devices
        this.context.workspaceState.update('geode.queryHistory', this.history);
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}

/**
 * Register query history commands
 */
export function registerQueryHistoryCommands(
    context: vscode.ExtensionContext,
    provider: QueryHistoryProvider
): void {
    // Insert query into active editor
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.history.insertQuery', async (entry: QueryHistoryEntry) => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                await editor.edit(editBuilder => {
                    editBuilder.insert(editor.selection.active, entry.query);
                });
            } else {
                // Create a new untitled document with the query
                const doc = await vscode.workspace.openTextDocument({
                    language: 'gql',
                    content: entry.query
                });
                await vscode.window.showTextDocument(doc);
            }
        })
    );

    // Copy query to clipboard
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.history.copyQuery', async (item: QueryHistoryItem) => {
            if (item?.entry) {
                await vscode.env.clipboard.writeText(item.entry.query);
                vscode.window.showInformationMessage('Query copied to clipboard');
            }
        })
    );

    // Re-run query
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.history.rerunQuery', async (item: QueryHistoryItem) => {
            if (item?.entry) {
                // Create a temp document and run it
                const doc = await vscode.workspace.openTextDocument({
                    language: 'gql',
                    content: item.entry.query
                });
                await vscode.window.showTextDocument(doc);
                await vscode.commands.executeCommand('geode.runQuery');
            }
        })
    );

    // Remove entry from history
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.history.removeEntry', (item: QueryHistoryItem) => {
            if (item?.entry) {
                provider.removeEntry(item.entry.id);
            }
        })
    );

    // Clear all history
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.history.clear', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Clear all query history?',
                { modal: true },
                'Clear'
            );
            if (confirm === 'Clear') {
                provider.clearHistory();
                vscode.window.showInformationMessage('Query history cleared');
            }
        })
    );

    // Refresh history view
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.history.refresh', () => {
            provider.refresh();
        })
    );
}
