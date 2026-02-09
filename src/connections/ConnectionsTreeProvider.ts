import * as vscode from 'vscode';
import { ConnectionManager, ConnectionProfile } from './ConnectionManager';

/**
 * Tree item representing a connection in the sidebar
 */
export class ConnectionTreeItem extends vscode.TreeItem {
    constructor(
        public readonly profile: ConnectionProfile,
        public readonly isActive: boolean,
        public readonly isConnected: boolean
    ) {
        super(profile.name, vscode.TreeItemCollapsibleState.None);

        this.id = profile.id;
        this.description = this.buildDescription();
        this.tooltip = this.buildTooltip();
        this.contextValue = this.buildContextValue();
        this.iconPath = this.getIcon();

        // Only set click command if not already connected
        // This prevents repeated connection attempts
        if (!this.isConnected) {
            this.command = {
                command: 'geode.connections.connect',
                title: 'Connect',
                arguments: [profile.id]
            };
        }
    }

    private buildDescription(): string {
        let desc = `${this.profile.host}:${this.profile.port}`;
        if (this.isConnected) {
            desc += ' (connected)';
        } else if (this.isActive) {
            desc += ' (selected)';
        }
        return desc;
    }

    private buildTooltip(): string {
        const lines = [
            `Name: ${this.profile.name}`,
            `Host: ${this.profile.host}:${this.profile.port}`
        ];

        if (this.profile.database) {
            lines.push(`Database: ${this.profile.database}`);
        }

        if (this.profile.username) {
            lines.push(`User: ${this.profile.username}`);
        }

        lines.push(`TLS: ${this.profile.useTls ? 'Yes' : 'No'}`);

        if (this.profile.isDefault) {
            lines.push('(Default Connection)');
        }

        if (this.isConnected) {
            lines.push('Status: Connected');
        }

        return lines.join('\n');
    }

    private buildContextValue(): string {
        const parts = ['connection'];

        if (this.isActive) {
            parts.push('active');
        }

        if (this.isConnected) {
            parts.push('connected');
        }

        if (this.profile.isDefault) {
            parts.push('default');
        }

        return parts.join('-');
    }

    private getIcon(): vscode.ThemeIcon {
        if (this.isConnected) {
            return new vscode.ThemeIcon('database', new vscode.ThemeColor('charts.green'));
        } else if (this.isActive) {
            return new vscode.ThemeIcon('database', new vscode.ThemeColor('charts.yellow'));
        } else {
            return new vscode.ThemeIcon('database');
        }
    }
}

/**
 * "Add Connection" tree item
 */
class AddConnectionItem extends vscode.TreeItem {
    constructor() {
        super('Add Connection...', vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('add');
        this.command = {
            command: 'geode.connections.add',
            title: 'Add Connection'
        };
        this.contextValue = 'addConnection';
    }
}

/**
 * Tree data provider for the Connections view in the sidebar
 */
export class ConnectionsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private connectedIds: Set<string> = new Set();

    constructor(private readonly connectionManager: ConnectionManager) {
        // Refresh when connections change
        connectionManager.onDidChangeConnections(() => {
            this.refresh();
        });

        connectionManager.onDidChangeActiveConnection(() => {
            this.refresh();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    setConnected(connectionId: string, connected: boolean): void {
        if (connected) {
            this.connectedIds.add(connectionId);
        } else {
            this.connectedIds.delete(connectionId);
        }
        this.refresh();
    }

    clearConnections(): void {
        this.connectedIds.clear();
        this.refresh();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
        if (element) {
            return []; // No nested items
        }

        const items: vscode.TreeItem[] = [];
        const activeConnection = this.connectionManager.getActiveConnection();

        // Add all connections
        for (const profile of this.connectionManager.getConnections()) {
            const isActive = activeConnection?.id === profile.id;
            const isConnected = this.connectedIds.has(profile.id);
            items.push(new ConnectionTreeItem(profile, isActive, isConnected));
        }

        // Sort: active first, then by name
        items.sort((a, b) => {
            if (a instanceof ConnectionTreeItem && b instanceof ConnectionTreeItem) {
                if (a.isActive && !b.isActive) return -1;
                if (!a.isActive && b.isActive) return 1;
                if (a.profile.isDefault && !b.profile.isDefault) return -1;
                if (!a.profile.isDefault && b.profile.isDefault) return 1;
                return a.profile.name.localeCompare(b.profile.name);
            }
            return 0;
        });

        // Add the "Add Connection" item at the end
        items.push(new AddConnectionItem());

        return items;
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}

/**
 * Register the connections tree view and commands
 */
export function registerConnectionsView(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    outputChannel: vscode.OutputChannel,
    onConnect: (profile: ConnectionProfile, password?: string) => Promise<boolean>,
    onDisconnect: () => void
): ConnectionsTreeProvider {
    const treeProvider = new ConnectionsTreeProvider(connectionManager);

    // Register the tree view
    const treeView = vscode.window.createTreeView('geodeConnections', {
        treeDataProvider: treeProvider,
        showCollapseAll: false
    });
    context.subscriptions.push(treeView);

    // Register connection commands
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.connections.add', async () => {
            await showConnectionEditor(connectionManager, outputChannel);
        }),

        vscode.commands.registerCommand('geode.connections.edit', async (item: ConnectionTreeItem) => {
            if (item instanceof ConnectionTreeItem) {
                await showConnectionEditor(connectionManager, outputChannel, item.profile);
            }
        }),

        vscode.commands.registerCommand('geode.connections.delete', async (item: ConnectionTreeItem) => {
            if (item instanceof ConnectionTreeItem) {
                const confirm = await vscode.window.showWarningMessage(
                    `Delete connection "${item.profile.name}"?`,
                    { modal: true },
                    'Delete'
                );

                if (confirm === 'Delete') {
                    await connectionManager.deleteConnection(item.profile.id);
                    treeProvider.setConnected(item.profile.id, false);
                }
            }
        }),

        vscode.commands.registerCommand('geode.connections.connect', async (idOrItem: string | ConnectionTreeItem) => {
            const id = typeof idOrItem === 'string' ? idOrItem : idOrItem.profile.id;
            const profile = connectionManager.getConnection(id);

            if (!profile) {
                vscode.window.showErrorMessage('Connection not found');
                return;
            }

            // Get password if needed
            let password: string | undefined;
            if (profile.username) {
                password = await connectionManager.getPassword(profile.id);

                if (!password) {
                    password = await vscode.window.showInputBox({
                        prompt: `Enter password for ${profile.username}@${profile.host}`,
                        password: true,
                        placeHolder: 'Password'
                    });

                    if (password === undefined) {
                        return; // Cancelled
                    }

                    // Ask if they want to save the password
                    const save = await vscode.window.showQuickPick(
                        ['Save password securely', 'Use for this session only'],
                        { placeHolder: 'Save password?' }
                    );

                    if (save === 'Save password securely') {
                        await connectionManager.setPassword(profile.id, password);
                    }
                }
            }

            // Set as active and connect
            await connectionManager.setActiveConnection(profile.id);
            const success = await onConnect(profile, password);

            if (success) {
                treeProvider.setConnected(profile.id, true);
            }
        }),

        vscode.commands.registerCommand('geode.connections.disconnect', async (_item?: ConnectionTreeItem) => {
            onDisconnect();
            treeProvider.clearConnections();
        }),

        vscode.commands.registerCommand('geode.connections.setDefault', async (item: ConnectionTreeItem) => {
            if (item instanceof ConnectionTreeItem) {
                const profile = { ...item.profile, isDefault: true };
                await connectionManager.saveConnection(profile);
                vscode.window.showInformationMessage(
                    `"${profile.name}" is now the default connection`
                );
            }
        }),

        vscode.commands.registerCommand('geode.connections.copyDsn', async (item: ConnectionTreeItem) => {
            if (item instanceof ConnectionTreeItem) {
                const dsn = connectionManager.buildDsn(item.profile);
                await vscode.env.clipboard.writeText(dsn);
                vscode.window.showInformationMessage('Connection string copied to clipboard');
            }
        }),

        vscode.commands.registerCommand('geode.connections.refresh', () => {
            treeProvider.refresh();
        })
    );

    return treeProvider;
}

/**
 * Show the connection editor dialog
 */
async function showConnectionEditor(
    connectionManager: ConnectionManager,
    outputChannel: vscode.OutputChannel,
    existingProfile?: ConnectionProfile
): Promise<ConnectionProfile | undefined> {
    const isNew = !existingProfile;
    const profile: ConnectionProfile = existingProfile ? { ...existingProfile } : {
        id: connectionManager.generateId(),
        name: '',
        host: 'localhost',
        port: 3141,
        useTls: true,
        insecure: false,
        timeout: 5000,
        queryTimeout: 30000,
        isDefault: false
    };

    // Step 1: Connection name
    const name = await vscode.window.showInputBox({
        prompt: 'Connection name',
        value: profile.name,
        placeHolder: 'My Geode Server',
        validateInput: (value) => {
            if (!value.trim()) {
                return 'Name is required';
            }
            return undefined;
        }
    });

    if (!name) {
        return undefined;
    }
    profile.name = name;

    // Step 2: Host
    const host = await vscode.window.showInputBox({
        prompt: 'Server hostname',
        value: profile.host,
        placeHolder: 'localhost'
    });

    if (!host) {
        return undefined;
    }
    profile.host = host;

    // Step 3: Port
    const portStr = await vscode.window.showInputBox({
        prompt: 'Server port',
        value: profile.port.toString(),
        placeHolder: '3141',
        validateInput: (value) => {
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 1 || num > 65535) {
                return 'Port must be between 1 and 65535';
            }
            return undefined;
        }
    });

    if (!portStr) {
        return undefined;
    }
    profile.port = parseInt(portStr, 10);

    // Step 4: Database (optional)
    const database = await vscode.window.showInputBox({
        prompt: 'Database name (optional)',
        value: profile.database || '',
        placeHolder: 'Leave empty for default'
    });

    if (database === undefined) {
        return undefined;
    }
    profile.database = database || undefined;

    // Step 5: Username (optional)
    const username = await vscode.window.showInputBox({
        prompt: 'Username (optional)',
        value: profile.username || '',
        placeHolder: 'Leave empty for anonymous'
    });

    if (username === undefined) {
        return undefined;
    }
    profile.username = username || undefined;

    // Step 6: Password (if username provided)
    let password: string | undefined;
    if (profile.username) {
        password = await vscode.window.showInputBox({
            prompt: 'Password (optional)',
            password: true,
            placeHolder: 'Leave empty if not required'
        });

        if (password === undefined) {
            return undefined;
        }
    }

    // Step 7: TLS settings
    const tlsOption = await vscode.window.showQuickPick([
        { label: 'TLS Enabled (Recommended)', value: 'tls' },
        { label: 'TLS with self-signed certificate', value: 'insecure' },
        { label: 'No TLS (Insecure)', value: 'none' }
    ], {
        placeHolder: 'TLS Settings'
    });

    if (!tlsOption) {
        return undefined;
    }

    profile.useTls = tlsOption.value !== 'none';
    profile.insecure = tlsOption.value === 'insecure';

    // Step 8: Make default?
    if (isNew) {
        const makeDefault = await vscode.window.showQuickPick([
            { label: 'Yes', value: true },
            { label: 'No', value: false }
        ], {
            placeHolder: 'Set as default connection?'
        });

        if (makeDefault === undefined) {
            return undefined;
        }
        profile.isDefault = makeDefault.value;
    }

    // Save the connection
    await connectionManager.saveConnection(profile, password);

    vscode.window.showInformationMessage(
        `Connection "${profile.name}" ${isNew ? 'created' : 'updated'}`
    );

    return profile;
}
