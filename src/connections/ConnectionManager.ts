import * as vscode from 'vscode';

/**
 * Connection profile for Geode database
 * Passwords are stored separately in SecretStorage for security
 */
export interface ConnectionProfile {
    /** Unique identifier for this connection */
    id: string;
    /** Display name for the connection */
    name: string;
    /** Server hostname */
    host: string;
    /** Server port (default: 3141) */
    port: number;
    /** Database name (optional) */
    database?: string;
    /** Username for authentication */
    username?: string;
    /** Use TLS encryption */
    useTls: boolean;
    /** Skip TLS certificate verification (development only) */
    insecure: boolean;
    /** Path to client certificate file */
    certPath?: string;
    /** Path to client key file */
    keyPath?: string;
    /** Path to CA certificate file */
    caPath?: string;
    /** Connection timeout in milliseconds */
    timeout: number;
    /** Query timeout in milliseconds */
    queryTimeout: number;
    /** Is this the default connection */
    isDefault: boolean;
}

/**
 * Default connection profile for localhost development
 */
export function createDefaultProfile(): ConnectionProfile {
    return {
        id: 'default-local',
        name: 'Local Development',
        host: 'localhost',
        port: 3141,
        useTls: true,
        insecure: true, // Skip cert verification for local dev
        timeout: 5000,
        queryTimeout: 30000,
        isDefault: true
    };
}

/**
 * Manages Geode database connections with secure credential storage
 *
 * Security considerations:
 * - Passwords are stored in VS Code's SecretStorage (local only, never synced)
 * - Connection profiles are stored in globalState (syncs but no secrets)
 * - No passwords in project files or workspace settings
 */
export class ConnectionManager {
    private static readonly CONNECTIONS_KEY = 'geode.connections';
    private static readonly ACTIVE_CONNECTION_KEY = 'geode.activeConnection';
    private static readonly PASSWORD_PREFIX = 'geode.password.';

    private connections: Map<string, ConnectionProfile> = new Map();
    private activeConnectionId: string | null = null;
    private _onDidChangeConnections = new vscode.EventEmitter<void>();
    private _onDidChangeActiveConnection = new vscode.EventEmitter<ConnectionProfile | null>();

    readonly onDidChangeConnections = this._onDidChangeConnections.event;
    readonly onDidChangeActiveConnection = this._onDidChangeActiveConnection.event;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel
    ) {}

    /**
     * Initialize the connection manager, loading saved connections
     */
    async initialize(): Promise<void> {
        await this.loadConnections();

        // Ensure default connection exists
        if (this.connections.size === 0) {
            const defaultProfile = createDefaultProfile();
            await this.saveConnection(defaultProfile);
        }

        // Restore active connection
        this.activeConnectionId = this.context.globalState.get<string>(
            ConnectionManager.ACTIVE_CONNECTION_KEY
        ) ?? null;

        this.outputChannel.appendLine(
            `Connection manager initialized with ${this.connections.size} connection(s)`
        );
    }

    /**
     * Get all saved connection profiles
     */
    getConnections(): ConnectionProfile[] {
        return Array.from(this.connections.values());
    }

    /**
     * Get a specific connection profile by ID
     */
    getConnection(id: string): ConnectionProfile | undefined {
        return this.connections.get(id);
    }

    /**
     * Get the currently active connection
     */
    getActiveConnection(): ConnectionProfile | null {
        if (!this.activeConnectionId) {
            return null;
        }
        return this.connections.get(this.activeConnectionId) ?? null;
    }

    /**
     * Get the default connection profile
     */
    getDefaultConnection(): ConnectionProfile | undefined {
        return Array.from(this.connections.values()).find(c => c.isDefault);
    }

    /**
     * Save or update a connection profile
     * Password is stored separately in SecretStorage
     */
    async saveConnection(profile: ConnectionProfile, password?: string): Promise<void> {
        // If this is marked as default, clear default from others
        if (profile.isDefault) {
            for (const conn of this.connections.values()) {
                if (conn.id !== profile.id && conn.isDefault) {
                    conn.isDefault = false;
                }
            }
        }

        this.connections.set(profile.id, profile);
        await this.persistConnections();

        // Store password securely if provided
        if (password !== undefined) {
            await this.setPassword(profile.id, password);
        }

        this._onDidChangeConnections.fire();
        this.outputChannel.appendLine(`Connection saved: ${profile.name}`);
    }

    /**
     * Delete a connection profile
     */
    async deleteConnection(id: string): Promise<void> {
        const profile = this.connections.get(id);
        if (!profile) {
            return;
        }

        this.connections.delete(id);
        await this.persistConnections();

        // Remove stored password
        await this.context.secrets.delete(ConnectionManager.PASSWORD_PREFIX + id);

        // Clear active connection if it was deleted
        if (this.activeConnectionId === id) {
            this.activeConnectionId = null;
            await this.context.globalState.update(ConnectionManager.ACTIVE_CONNECTION_KEY, null);
            this._onDidChangeActiveConnection.fire(null);
        }

        this._onDidChangeConnections.fire();
        this.outputChannel.appendLine(`Connection deleted: ${profile.name}`);
    }

    /**
     * Set the active connection
     */
    async setActiveConnection(id: string | null): Promise<void> {
        this.activeConnectionId = id;
        await this.context.globalState.update(ConnectionManager.ACTIVE_CONNECTION_KEY, id);

        const profile = id ? this.connections.get(id) ?? null : null;
        this._onDidChangeActiveConnection.fire(profile);

        if (profile) {
            this.outputChannel.appendLine(`Active connection set to: ${profile.name}`);
        } else {
            this.outputChannel.appendLine('Active connection cleared');
        }
    }

    /**
     * Get the password for a connection (from SecretStorage)
     */
    async getPassword(connectionId: string): Promise<string | undefined> {
        return this.context.secrets.get(ConnectionManager.PASSWORD_PREFIX + connectionId);
    }

    /**
     * Set the password for a connection (in SecretStorage)
     */
    async setPassword(connectionId: string, password: string): Promise<void> {
        if (password) {
            await this.context.secrets.store(
                ConnectionManager.PASSWORD_PREFIX + connectionId,
                password
            );
        } else {
            await this.context.secrets.delete(ConnectionManager.PASSWORD_PREFIX + connectionId);
        }
    }

    /**
     * Build the connection arguments for the geode CLI
     *
     * Supported CLI flags:
     *   --server <addr:port>   Server address
     *   --insecure             Skip TLS certificate verification
     *   --timeout <secs>       Connection timeout in seconds
     *   -U, --user <username>  Authenticate as user
     *   -P, --password <pass>  Authentication password
     */
    buildConnectionArgs(profile: ConnectionProfile): string[] {
        const args: string[] = [];

        args.push('--server', `${profile.host}:${profile.port}`);

        if (profile.insecure) {
            args.push('--insecure');
        }

        if (profile.timeout) {
            // Convert ms to seconds
            args.push('--timeout', Math.ceil(profile.timeout / 1000).toString());
        }

        if (profile.username) {
            args.push('-U', profile.username);
        }

        return args;
    }

    /**
     * Build connection arguments including password
     * Password is passed via -P flag
     */
    buildConnectionArgsWithPassword(profile: ConnectionProfile, password?: string): string[] {
        const args = this.buildConnectionArgs(profile);

        if (password) {
            args.push('-P', password);
        }

        return args;
    }

    /**
     * Build the DSN string for the connection
     */
    buildDsn(profile: ConnectionProfile, password?: string): string {
        let dsn = profile.useTls ? 'geodes://' : 'geode://';

        if (profile.username) {
            dsn += encodeURIComponent(profile.username);
            if (password) {
                dsn += ':' + encodeURIComponent(password);
            }
            dsn += '@';
        }

        dsn += profile.host;
        if (profile.port !== 3141) {
            dsn += ':' + profile.port;
        }

        if (profile.database) {
            dsn += '/' + encodeURIComponent(profile.database);
        }

        // Add query parameters
        const params: string[] = [];
        if (profile.insecure) {
            params.push('insecure=true');
        }
        if (profile.timeout !== 5000) {
            params.push(`timeout=${profile.timeout}`);
        }

        if (params.length > 0) {
            dsn += '?' + params.join('&');
        }

        return dsn;
    }

    /**
     * Generate a unique ID for a new connection
     */
    generateId(): string {
        return `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    private async loadConnections(): Promise<void> {
        const stored = this.context.globalState.get<ConnectionProfile[]>(
            ConnectionManager.CONNECTIONS_KEY,
            []
        );

        this.connections.clear();
        for (const profile of stored) {
            this.connections.set(profile.id, profile);
        }
    }

    private async persistConnections(): Promise<void> {
        const profiles = Array.from(this.connections.values());
        await this.context.globalState.update(ConnectionManager.CONNECTIONS_KEY, profiles);
    }

    dispose(): void {
        this._onDidChangeConnections.dispose();
        this._onDidChangeActiveConnection.dispose();
    }
}
