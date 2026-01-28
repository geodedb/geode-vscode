/**
 * Enhanced ConnectionManager using CLI-based GeodeClientWrapper
 */

import * as vscode from 'vscode';
import { GeodeClientWrapper, ConnectionStatus, GeodeConfig } from './GeodeClientWrapper';

export interface ConnectionProfile {
    id: string;
    name: string;
    host: string;
    port: number;
    username?: string;
    password?: string;
    database?: string;
    useTLS?: boolean; // Optional for new code (uppercase 'S')
    useTls: boolean; // Required for compatibility (lowercase 's')
    insecure: boolean; // Required for CLI args
    isDefault: boolean; // Required, matches old type
    timeout: number; // Required, connection timeout in ms
    queryTimeout: number; // Required, query timeout in ms
}

export class EnhancedConnectionManager {
    private profiles: Map<string, ConnectionProfile> = new Map();
    private activeProfile: ConnectionProfile | null = null;
    private clientWrapper: GeodeClientWrapper;
    private secretStorage: vscode.SecretStorage;

    private _onDidChangeProfiles = new vscode.EventEmitter<void>();
    readonly onDidChangeProfiles = this._onDidChangeProfiles.event;

    private _onDidChangeActiveConnection = new vscode.EventEmitter<ConnectionProfile | null>();
    readonly onDidChangeActiveConnection = this._onDidChangeActiveConnection.event;

    constructor(
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel
    ) {
        this.secretStorage = context.secrets;
        this.clientWrapper = new GeodeClientWrapper(outputChannel);

        // Listen to client status changes
        this.clientWrapper.onStatusChange((status) => {
            this.handleStatusChange(status);
        });
    }

    /**
     * Initialize connection manager
     */
    async initialize(): Promise<void> {
        await this.loadProfiles();

        // Auto-connect to default profile if configured
        const config = vscode.workspace.getConfiguration('geode');
        if (config.get<boolean>('server.autoConnect', false)) {
            const defaultProfile = this.getDefaultProfile();
            if (defaultProfile) {
                await this.connect(defaultProfile.id);
            }
        }
    }

    /**
     * Add a new connection profile
     */
    async addProfile(profile: Omit<ConnectionProfile, 'id'>): Promise<string> {
        const id = this.generateId();
        const fullProfile: ConnectionProfile = {
            ...profile,
            id,
            useTls: profile.useTLS || profile.useTls || false, // Sync both fields
            useTLS: profile.useTLS || profile.useTls || false,
            insecure: profile.insecure || false, // Ensure insecure is always set
            isDefault: profile.isDefault || false,
            timeout: profile.timeout || 5000,
            queryTimeout: profile.queryTimeout || 30000
        };

        // Store password in secret storage
        if (profile.password) {
            await this.secretStorage.store(`geode.password.${id}`, profile.password);
            delete (fullProfile as any).password; // Don't store password in settings
        }

        this.profiles.set(id, fullProfile);
        await this.saveProfiles();
        this._onDidChangeProfiles.fire();

        return id;
    }

    /**
     * Update an existing connection profile
     */
    async updateProfile(id: string, updates: Partial<ConnectionProfile>): Promise<void> {
        const profile = this.profiles.get(id);
        if (!profile) {
            throw new Error(`Profile ${id} not found`);
        }

        // Update password in secret storage if provided
        if (updates.password) {
            await this.secretStorage.store(`geode.password.${id}`, updates.password);
            delete updates.password;
        }

        Object.assign(profile, updates);
        await this.saveProfiles();
        this._onDidChangeProfiles.fire();

        // Reconnect if this is the active profile
        if (this.activeProfile?.id === id && this.clientWrapper.isConnected()) {
            await this.reconnect();
        }
    }

    /**
     * Delete a connection profile
     */
    async deleteProfile(id: string): Promise<void> {
        const profile = this.profiles.get(id);
        if (!profile) {
            throw new Error(`Profile ${id} not found`);
        }

        // Disconnect if this is the active profile
        if (this.activeProfile?.id === id) {
            await this.disconnect();
        }

        // Delete password from secret storage
        await this.secretStorage.delete(`geode.password.${id}`);

        this.profiles.delete(id);
        await this.saveProfiles();
        this._onDidChangeProfiles.fire();
    }

    /**
     * Connect to a profile
     */
    async connect(profileId: string): Promise<void> {
        const profile = this.profiles.get(profileId);
        if (!profile) {
            throw new Error(`Profile ${profileId} not found`);
        }

        // Disconnect if already connected
        if (this.clientWrapper.isConnected()) {
            await this.disconnect();
        }

        // Get password from secret storage
        const password = await this.secretStorage.get(`geode.password.${profileId}`);

        // Build connection config
        // Only include username/password if they are non-empty strings
        const username = profile.username?.trim();
        const config: GeodeConfig = {
            host: profile.host,
            port: profile.port,
            username: username && username.length > 0 ? username : undefined,
            password: password && password.trim().length > 0 ? password.trim() : undefined,
            insecureSkipVerify: profile.insecure || false
        };

        try {
            await this.clientWrapper.connect(config);
            this.activeProfile = profile;
            this._onDidChangeActiveConnection.fire(profile);

            vscode.window.showInformationMessage(`Connected to ${profile.name}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to connect: ${error}`);
            throw error;
        }
    }

    /**
     * Disconnect from current connection
     */
    async disconnect(): Promise<void> {
        if (this.clientWrapper.isConnected()) {
            await this.clientWrapper.disconnect();
            this.activeProfile = null;
            this._onDidChangeActiveConnection.fire(null);

            vscode.window.showInformationMessage('Disconnected from Geode server');
        }
    }

    /**
     * Reconnect to current profile
     */
    async reconnect(): Promise<void> {
        if (this.activeProfile) {
            await this.connect(this.activeProfile.id);
        }
    }

    /**
     * Get client wrapper for queries
     */
    getClient(): GeodeClientWrapper {
        return this.clientWrapper;
    }

    /**
     * Get all profiles
     */
    getProfiles(): ConnectionProfile[] {
        return Array.from(this.profiles.values());
    }

    /**
     * Get a specific profile
     */
    getProfile(id: string): ConnectionProfile | undefined {
        return this.profiles.get(id);
    }

    /**
     * Get active profile
     */
    getActiveProfile(): ConnectionProfile | null {
        return this.activeProfile;
    }

    /**
     * Get default profile
     */
    getDefaultProfile(): ConnectionProfile | undefined {
        return Array.from(this.profiles.values()).find(p => p.isDefault);
    }

    /**
     * Set a profile as default
     */
    async setDefaultProfile(id: string): Promise<void> {
        // Clear previous default
        for (const profile of this.profiles.values()) {
            if (profile.isDefault) {
                profile.isDefault = false;
            }
        }

        // Set new default
        const profile = this.profiles.get(id);
        if (profile) {
            profile.isDefault = true;
            await this.saveProfiles();
            this._onDidChangeProfiles.fire();
        }
    }

    /**
     * Test connection without saving
     */
    async testConnection(config: GeodeConfig): Promise<boolean> {
        const testClient = new GeodeClientWrapper(this.outputChannel);
        try {
            await testClient.connect(config);
            await testClient.ping();
            await testClient.disconnect();
            return true;
        } catch (error) {
            this.outputChannel.appendLine(`Connection test failed: ${error}`);
            return false;
        }
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        if (this.clientWrapper.isConnected()) {
            this.clientWrapper.disconnect();
        }
    }

    // Compatibility methods for old API (ConnectionManager interface)

    /**
     * Alias for onDidChangeProfiles (compatibility with old API)
     */
    get onDidChangeConnections() {
        return this.onDidChangeProfiles;
    }

    /**
     * Get active connection (compatibility with old API)
     */
    getActiveConnection(): ConnectionProfile | null {
        return this.activeProfile;
    }

    /**
     * Get all connections (compatibility with old API)
     */
    getConnections(): ConnectionProfile[] {
        return this.getProfiles();
    }

    /**
     * Get a single connection by ID (compatibility with old API)
     */
    getConnection(id: string): ConnectionProfile | undefined {
        return this.getProfile(id);
    }

    /**
     * Delete a connection (compatibility with old API)
     */
    async deleteConnection(id: string): Promise<void> {
        return this.deleteProfile(id);
    }

    /**
     * Save or update a connection (compatibility with old API)
     */
    async saveConnection(profile: ConnectionProfile, password?: string): Promise<void> {
        if (this.profiles.has(profile.id)) {
            // Update existing
            await this.updateProfile(profile.id, profile);
        } else {
            // Add new - need to handle the 'id' field
            const { id, ...rest } = profile;
            const newId = await this.addProfile(rest as Omit<ConnectionProfile, 'id'>);
            // If the IDs don't match, we need to update our internal map
            if (newId !== id) {
                const newProfile = this.profiles.get(newId);
                if (newProfile) {
                    this.profiles.delete(newId);
                    newProfile.id = id;
                    this.profiles.set(id, newProfile);
                    await this.saveProfiles();
                }
            }
        }
        if (password) {
            await this.setPassword(profile.id, password);
        }
    }

    /**
     * Set active connection by ID (compatibility with old API)
     */
    async setActiveConnection(id: string | null): Promise<void> {
        if (id === null) {
            await this.disconnect();
        } else {
            // Just set as active without connecting
            const profile = this.profiles.get(id);
            if (profile) {
                this.activeProfile = profile;
                this._onDidChangeActiveConnection.fire(profile);
            }
        }
    }

    /**
     * Get password (compatibility with old API)
     */
    async getPassword(profileId: string): Promise<string | undefined> {
        return await this.secretStorage.get(`geode.password.${profileId}`);
    }

    /**
     * Set password (compatibility with old API)
     */
    async setPassword(profileId: string, password: string): Promise<void> {
        await this.secretStorage.store(`geode.password.${profileId}`, password);
    }

    /**
     * Build DSN string (compatibility with old API)
     * Note: Geode always uses TLS, so we always use geode:// prefix
     */
    buildDsn(profile: ConnectionProfile, password?: string): string {
        let dsn = 'geode://';

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

        const params: string[] = [];
        if (profile.insecure) {
            params.push('insecure=true');
        }

        if (params.length > 0) {
            dsn += '?' + params.join('&');
        }

        return dsn;
    }

    /**
     * Generate unique ID (compatibility with old API - made public)
     */
    generateId(): string {
        return `profile-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Build connection args with password (compatibility stub)
     */
    buildConnectionArgsWithPassword(profile: ConnectionProfile, password?: string): string[] {
        // This is a compatibility method - the new implementation uses DSN
        return [
            '--server', `${profile.host}:${profile.port}`,
            ...(password ? ['--password', password] : []),
            ...(profile.username ? ['--username', profile.username] : []),
            ...(profile.insecure ? ['--insecure'] : [])
        ];
    }

    /**
     * Load profiles from workspace state
     */
    private async loadProfiles(): Promise<void> {
        const stored = this.context.workspaceState.get<ConnectionProfile[]>('geode.profiles', []);

        for (const profile of stored) {
            // Ensure all required fields are set for compatibility
            if (profile.insecure === undefined) {
                profile.insecure = false;
            }
            if (profile.useTLS === undefined && profile.useTls !== undefined) {
                profile.useTLS = profile.useTls;
            }
            if (profile.useTls === undefined && profile.useTLS !== undefined) {
                profile.useTls = profile.useTLS;
            }
            if (profile.useTLS === undefined) {
                profile.useTLS = true;
            }
            if (profile.useTls === undefined) {
                profile.useTls = true;
            }
            if (profile.isDefault === undefined) {
                profile.isDefault = false;
            }
            if (profile.timeout === undefined) {
                profile.timeout = 5000;
            }
            if (profile.queryTimeout === undefined) {
                profile.queryTimeout = 30000;
            }
            this.profiles.set(profile.id, profile);
        }

        this.outputChannel.appendLine(`Loaded ${this.profiles.size} connection profiles`);
    }

    /**
     * Save profiles to workspace state
     */
    private async saveProfiles(): Promise<void> {
        const profiles = Array.from(this.profiles.values());
        await this.context.workspaceState.update('geode.profiles', profiles);
    }

    /**
     * Handle client status changes
     */
    private handleStatusChange(status: ConnectionStatus): void {
        if (!status.connected && this.activeProfile) {
            // Connection lost
            vscode.window.showWarningMessage(
                `Connection to ${this.activeProfile.name} lost. ${status.error || ''}`,
                'Reconnect'
            ).then(action => {
                if (action === 'Reconnect') {
                    this.reconnect();
                }
            });
        }
    }
}
