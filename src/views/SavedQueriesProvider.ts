/**
 * Saved Queries Provider - Manage favorite/saved queries
 */

import * as vscode from 'vscode';

export interface SavedQuery {
    id: string;
    name: string;
    query: string;
    description?: string;
    category?: string;
    createdAt: number;
    updatedAt: number;
}

/**
 * Tree item representing a saved query or category
 */
class SavedQueryItem extends vscode.TreeItem {
    constructor(
        public readonly savedQuery?: SavedQuery,
        public readonly category?: string,
        public readonly isCategory: boolean = false
    ) {
        super(
            isCategory ? category! : savedQuery!.name,
            isCategory
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None
        );

        if (isCategory) {
            this.contextValue = 'savedQueryCategory';
            this.iconPath = new vscode.ThemeIcon('folder');
        } else if (savedQuery) {
            this.id = savedQuery.id;
            this.description = SavedQueryItem.getDescription(savedQuery);
            this.tooltip = SavedQueryItem.getTooltip(savedQuery);
            this.contextValue = 'savedQuery';
            this.iconPath = new vscode.ThemeIcon('file-code');

            // Double-click to open query
            this.command = {
                command: 'geode.savedQueries.open',
                title: 'Open Query',
                arguments: [savedQuery]
            };
        }
    }

    private static getDescription(query: SavedQuery): string {
        // Show truncated query as description
        const cleaned = query.query.replace(/\s+/g, ' ').trim();
        return cleaned.length > 40 ? cleaned.substring(0, 40) + '...' : cleaned;
    }

    private static getTooltip(query: SavedQuery): string {
        const lines = [query.name];

        if (query.description) {
            lines.push('', query.description);
        }

        lines.push('', '--- Query ---', query.query);

        if (query.category) {
            lines.push('', `Category: ${query.category}`);
        }

        lines.push(`Created: ${new Date(query.createdAt).toLocaleDateString()}`);

        return lines.join('\n');
    }
}

/**
 * Provider for saved queries tree view
 */
export class SavedQueriesProvider implements vscode.TreeDataProvider<SavedQueryItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SavedQueryItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private queries: SavedQuery[] = [];

    constructor(
        private context: vscode.ExtensionContext
    ) {
        this.loadQueries();
    }

    /**
     * Add or update a saved query
     */
    async saveQuery(query: Omit<SavedQuery, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<SavedQuery> {
        const now = Date.now();

        if (query.id) {
            // Update existing
            const index = this.queries.findIndex(q => q.id === query.id);
            if (index >= 0) {
                this.queries[index] = {
                    ...this.queries[index],
                    ...query,
                    updatedAt: now
                };
                this.persistQueries();
                this._onDidChangeTreeData.fire();
                return this.queries[index];
            }
        }

        // Create new
        const newQuery: SavedQuery = {
            id: `saved-${now}-${Math.random().toString(36).substr(2, 9)}`,
            name: query.name,
            query: query.query,
            description: query.description,
            category: query.category,
            createdAt: now,
            updatedAt: now
        };

        this.queries.push(newQuery);
        this.persistQueries();
        this._onDidChangeTreeData.fire();
        return newQuery;
    }

    /**
     * Delete a saved query
     */
    deleteQuery(id: string): void {
        this.queries = this.queries.filter(q => q.id !== id);
        this.persistQueries();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get a specific query by ID
     */
    getQuery(id: string): SavedQuery | undefined {
        return this.queries.find(q => q.id === id);
    }

    /**
     * Get all queries
     */
    getQueries(): SavedQuery[] {
        return [...this.queries];
    }

    /**
     * Get all categories
     */
    getCategories(): string[] {
        const categories = new Set<string>();
        for (const query of this.queries) {
            if (query.category) {
                categories.add(query.category);
            }
        }
        return Array.from(categories).sort();
    }

    /**
     * Refresh the view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SavedQueryItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SavedQueryItem): vscode.ProviderResult<SavedQueryItem[]> {
        if (!element) {
            // Root level - show categories and uncategorized queries
            const items: SavedQueryItem[] = [];
            const categories = this.getCategories();

            // Add category folders
            for (const category of categories) {
                items.push(new SavedQueryItem(undefined, category, true));
            }

            // Add uncategorized queries
            const uncategorized = this.queries.filter(q => !q.category);
            for (const query of uncategorized) {
                items.push(new SavedQueryItem(query));
            }

            return items;
        }

        if (element.isCategory && element.category) {
            // Show queries in this category
            const categoryQueries = this.queries.filter(q => q.category === element.category);
            return categoryQueries.map(q => new SavedQueryItem(q));
        }

        return [];
    }

    private loadQueries(): void {
        this.queries = this.context.globalState.get<SavedQuery[]>('geode.savedQueries', []);
    }

    private persistQueries(): void {
        this.context.globalState.update('geode.savedQueries', this.queries);
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}

/**
 * Register saved queries commands
 */
export function registerSavedQueriesCommands(
    context: vscode.ExtensionContext,
    provider: SavedQueriesProvider
): void {
    // Save current query
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.savedQueries.save', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor with query to save');
                return;
            }

            const query = editor.selection.isEmpty
                ? editor.document.getText()
                : editor.document.getText(editor.selection);

            if (!query.trim()) {
                vscode.window.showWarningMessage('No query text to save');
                return;
            }

            // Get name
            const name = await vscode.window.showInputBox({
                prompt: 'Query name',
                placeHolder: 'My Query',
                validateInput: (value) => value.trim() ? undefined : 'Name is required'
            });

            if (!name) {
                return;
            }

            // Get optional description
            const description = await vscode.window.showInputBox({
                prompt: 'Description (optional)',
                placeHolder: 'What does this query do?'
            });

            if (description === undefined) {
                return;
            }

            // Get optional category
            const categories = provider.getCategories();
            const categoryOptions = [
                { label: '$(add) Create New Category', value: '__new__' },
                { label: '$(circle-slash) No Category', value: '' },
                ...categories.map(c => ({ label: c, value: c }))
            ];

            const categoryChoice = await vscode.window.showQuickPick(categoryOptions, {
                placeHolder: 'Select or create a category'
            });

            if (categoryChoice === undefined) {
                return;
            }

            let category: string | undefined;
            if (categoryChoice.value === '__new__') {
                category = await vscode.window.showInputBox({
                    prompt: 'New category name',
                    placeHolder: 'Analytics'
                });
                if (category === undefined) {
                    return;
                }
            } else if (categoryChoice.value) {
                category = categoryChoice.value;
            }

            // Save the query
            const saved = await provider.saveQuery({
                name,
                query: query.trim(),
                description: description || undefined,
                category: category || undefined
            });

            vscode.window.showInformationMessage(`Query "${saved.name}" saved`);
        })
    );

    // Open saved query
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.savedQueries.open', async (savedQuery: SavedQuery) => {
            const doc = await vscode.workspace.openTextDocument({
                language: 'gql',
                content: savedQuery.query
            });
            await vscode.window.showTextDocument(doc);
        })
    );

    // Edit saved query
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.savedQueries.edit', async (item: SavedQueryItem) => {
            if (!item?.savedQuery) {
                return;
            }

            const query = item.savedQuery;

            // Get new name
            const name = await vscode.window.showInputBox({
                prompt: 'Query name',
                value: query.name,
                validateInput: (value) => value.trim() ? undefined : 'Name is required'
            });

            if (!name) {
                return;
            }

            // Get description
            const description = await vscode.window.showInputBox({
                prompt: 'Description (optional)',
                value: query.description || ''
            });

            if (description === undefined) {
                return;
            }

            // Update
            await provider.saveQuery({
                id: query.id,
                name,
                query: query.query,
                description: description || undefined,
                category: query.category
            });

            vscode.window.showInformationMessage(`Query "${name}" updated`);
        })
    );

    // Delete saved query
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.savedQueries.delete', async (item: SavedQueryItem) => {
            if (!item?.savedQuery) {
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Delete saved query "${item.savedQuery.name}"?`,
                { modal: true },
                'Delete'
            );

            if (confirm === 'Delete') {
                provider.deleteQuery(item.savedQuery.id);
                vscode.window.showInformationMessage('Query deleted');
            }
        })
    );

    // Run saved query
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.savedQueries.run', async (item: SavedQueryItem) => {
            if (!item?.savedQuery) {
                return;
            }

            // Open in editor and run
            const doc = await vscode.workspace.openTextDocument({
                language: 'gql',
                content: item.savedQuery.query
            });
            await vscode.window.showTextDocument(doc);
            await vscode.commands.executeCommand('geode.runQuery');
        })
    );

    // Copy query to clipboard
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.savedQueries.copy', async (item: SavedQueryItem) => {
            if (!item?.savedQuery) {
                return;
            }

            await vscode.env.clipboard.writeText(item.savedQuery.query);
            vscode.window.showInformationMessage('Query copied to clipboard');
        })
    );

    // Refresh view
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.savedQueries.refresh', () => {
            provider.refresh();
        })
    );

    // Export all saved queries
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.savedQueries.exportAll', async () => {
            const queries = provider.getQueries();
            if (queries.length === 0) {
                vscode.window.showInformationMessage('No saved queries to export');
                return;
            }

            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file('geode-queries.json'),
                filters: { 'JSON': ['json'] }
            });

            if (uri) {
                const data = JSON.stringify(queries, null, 2);
                await vscode.workspace.fs.writeFile(uri, Buffer.from(data, 'utf8'));
                vscode.window.showInformationMessage(`Exported ${queries.length} queries to ${uri.fsPath}`);
            }
        })
    );

    // Import saved queries
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.savedQueries.importAll', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: { 'JSON': ['json'] }
            });

            if (!uris || uris.length === 0) {
                return;
            }

            try {
                const content = await vscode.workspace.fs.readFile(uris[0]);
                const queries = JSON.parse(content.toString()) as SavedQuery[];

                let imported = 0;
                for (const query of queries) {
                    if (query.name && query.query) {
                        await provider.saveQuery({
                            name: query.name,
                            query: query.query,
                            description: query.description,
                            category: query.category
                        });
                        imported++;
                    }
                }

                vscode.window.showInformationMessage(`Imported ${imported} queries`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to import queries: ${error}`);
            }
        })
    );
}
