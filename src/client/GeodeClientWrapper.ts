/**
 * Wrapper for Geode database operations using the bundled geode-ui HTTP server.
 * Replaces the previous CLI subprocess transport with HTTP POST /api/v1/query.
 */

import * as vscode from 'vscode';
import * as http from 'http';
import { secureId } from '../utils/security';

export interface ConnectionStatus {
    connected: boolean;
    profile?: string;
    latency?: number;
    error?: string;
}

export interface GeodeConfig {
    host: string;
    port: number;
    username?: string;
    password?: string;
    insecureSkipVerify?: boolean;
    tlsCA?: string;
}

/**
 * Result object that mimics the @geodedb/client QueryResult interface
 */
export class CLIQueryResult {
    public columnNames: string[];
    private rows: any[];

    constructor(columns: string[], rows: any[]) {
        this.columnNames = columns;
        this.rows = rows;
    }

    /**
     * Convert to array of objects
     */
    async toObjects(): Promise<any[]> {
        return this.rows;
    }

    /**
     * Get first row
     */
    async first(): Promise<any | null> {
        return this.rows.length > 0 ? this.rows[0] : null;
    }

    /**
     * Async iterator for rows
     */
    async *[Symbol.asyncIterator]() {
        for (const row of this.rows) {
            yield new CLIRow(row, this.columnNames);
        }
    }
}

/**
 * Row wrapper that mimics the @geodedb/client Row interface
 */
class CLIRow {
    private data: any;
    private columns: string[];

    constructor(data: any, columns: string[]) {
        this.data = data;
        this.columns = columns;
    }

    get(key: string): CLIValue | undefined {
        const value = this.data[key];
        return value !== undefined ? new CLIValue(value) : undefined;
    }

    keys(): string[] {
        return this.columns;
    }
}

/**
 * Value wrapper that mimics the @geodedb/client GQLValue interface
 */
class CLIValue {
    private value: any;

    constructor(value: any) {
        this.value = value;
    }

    get kind(): string {
        if (Array.isArray(this.value)) return 'ARRAY';
        if (this.value === null) return 'NULL';
        if (typeof this.value === 'number') return 'NUMBER';
        if (typeof this.value === 'string') return 'STRING';
        if (typeof this.value === 'boolean') return 'BOOLEAN';
        if (typeof this.value === 'object') return 'MAP';
        return 'UNKNOWN';
    }

    get asString(): string {
        return String(this.value ?? '');
    }

    get asNumber(): number {
        return Number(this.value ?? 0);
    }

    get asBoolean(): boolean {
        return Boolean(this.value);
    }

    get asArray(): CLIValue[] {
        if (Array.isArray(this.value)) {
            return this.value.map(v => new CLIValue(v));
        }
        return [];
    }
}

/**
 * Shape of the server info provided after the bundled geode-ui starts.
 */
export interface ServerInfo {
    host: string;
    port: number;
    token: string;
}

export class GeodeClientWrapper {
    private config: GeodeConfig | null = null;
    private _isConnected: boolean = false;
    private statusCallback?: (status: ConnectionStatus) => void;
    private serverInfoProvider?: () => ServerInfo | undefined;
    private serverProfileId: string | null = null;

    constructor(
        private outputChannel: vscode.OutputChannel
    ) {}

    /**
     * Attach a lazy provider for the bundled server info.
     * Called from extension.ts after ensureServerStarted() resolves.
     */
    public attachServerInfoProvider(p: () => ServerInfo | undefined): void {
        this.serverInfoProvider = p;
    }

    /**
     * Resolve current server info, throwing a clear error when unavailable.
     */
    private requireServerInfo(): ServerInfo {
        const info = this.serverInfoProvider?.();
        if (!info) {
            throw new Error(
                'Geode bundled server is not running. The extension could not start the geode-ui ' +
                'process. Check the Geode GQL output channel for details.'
            );
        }
        return info;
    }

    /**
     * Build a quic:// DSN from connection config.
     */
    private buildDsn(config: GeodeConfig): string {
        let dsn = 'quic://';

        const username = config.username?.trim();
        const password = config.password?.trim();

        if (username && username.length > 0) {
            dsn += encodeURIComponent(username);
            if (password && password.length > 0) {
                dsn += ':' + encodeURIComponent(password);
            }
            dsn += '@';
        }

        dsn += config.host + ':' + config.port;

        if (config.insecureSkipVerify) {
            dsn += '?insecure_tls_skip_verify=true';
        }

        return dsn;
    }

    /**
     * Register a profile with the bundled server via POST /api/v1/profiles.
     * Returns the profile id assigned by the server.
     */
    private async registerProfile(serverInfo: ServerInfo, config: GeodeConfig): Promise<string> {
        const name = `vscode-${secureId('profile')}`;
        const dsn = this.buildDsn(config);
        const body = JSON.stringify({ name, dsn });

        return new Promise<string>((resolve, reject) => {
            const req = http.request(
                {
                    method: 'POST',
                    host: serverInfo.host,
                    port: serverInfo.port,
                    path: '/api/v1/profiles',
                    headers: {
                        'content-type': 'application/json',
                        'content-length': Buffer.byteLength(body).toString(),
                        ...(serverInfo.token ? { authorization: `Bearer ${serverInfo.token}` } : {}),
                    },
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (c) => chunks.push(c));
                    res.on('end', () => {
                        const text = Buffer.concat(chunks).toString('utf8');
                        if ((res.statusCode ?? 0) >= 400) {
                            reject(new Error(`Profile registration failed (${res.statusCode}): ${text}`));
                            return;
                        }
                        try {
                            const parsed = JSON.parse(text);
                            const id = parsed.id ?? parsed.profile_id ?? parsed.profileId;
                            if (!id) {
                                reject(new Error(`Profile registration response missing id field: ${text}`));
                                return;
                            }
                            resolve(String(id));
                        } catch (e) {
                            reject(new Error(`Failed to parse profile registration response: ${(e as Error).message}`));
                        }
                    });
                }
            );
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    /**
     * Delete the server-side profile via DELETE /api/v1/profiles/{id}.
     * Best effort — errors are swallowed.
     */
    private deleteProfile(serverInfo: ServerInfo, profileId: string): void {
        try {
            const req = http.request(
                {
                    method: 'DELETE',
                    host: serverInfo.host,
                    port: serverInfo.port,
                    path: `/api/v1/profiles/${encodeURIComponent(profileId)}`,
                    headers: {
                        ...(serverInfo.token ? { authorization: `Bearer ${serverInfo.token}` } : {}),
                    },
                },
                () => { /* intentionally empty — best effort */ }
            );
            req.on('error', () => { /* swallow */ });
            req.end();
        } catch {
            // best effort — ignore
        }
    }

    /**
     * Execute a GQL statement against the bundled server via POST /api/v1/query.
     */
    private runHttpQuery(gql: string): Promise<CLIQueryResult> {
        return new Promise((resolve, reject) => {
            if (!this.serverProfileId) {
                reject(new Error('No server profile registered. Call connect() first.'));
                return;
            }

            let serverInfo: ServerInfo;
            try {
                serverInfo = this.requireServerInfo();
            } catch (err) {
                reject(err);
                return;
            }

            const body = JSON.stringify({ statement: gql, connection: this.serverProfileId });

            const req = http.request(
                {
                    method: 'POST',
                    host: serverInfo.host,
                    port: serverInfo.port,
                    path: '/api/v1/query',
                    headers: {
                        'content-type': 'application/json',
                        'content-length': Buffer.byteLength(body).toString(),
                        ...(serverInfo.token ? { authorization: `Bearer ${serverInfo.token}` } : {}),
                    },
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (c) => chunks.push(c));
                    res.on('end', () => {
                        const text = Buffer.concat(chunks).toString('utf8');
                        if ((res.statusCode ?? 0) >= 400) {
                            reject(new Error(`Query failed (${res.statusCode}): ${text}`));
                            return;
                        }
                        try {
                            resolve(this.parseHttpResponse(text));
                        } catch (e) {
                            reject(new Error(`Failed to parse query response: ${(e as Error).message}`));
                        }
                    });
                }
            );
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    /**
     * Parse the HTTP query response into a CLIQueryResult.
     *
     * Primary shape (flat JSON): { columns, rows, durationMs }
     * Fallback shape (JSON-Lines): lines of { result: { type: 'SCHEMA'|'BINDINGS', ... } }
     */
    private parseHttpResponse(text: string): CLIQueryResult {
        const trimmed = text.trim();

        // Try primary shape first: { columns: string[], rows: object[], durationMs: number }
        if (trimmed.startsWith('{')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed.rows)) {
                    const columns: string[] = Array.isArray(parsed.columns)
                        ? parsed.columns.map((c: any) => (typeof c === 'string' ? c : c.name ?? String(c)))
                        : (parsed.rows.length > 0 ? Object.keys(parsed.rows[0]) : []);
                    return new CLIQueryResult(columns, parsed.rows);
                }
            } catch {
                // fall through to JSON-Lines parser
            }
        }

        // Fallback: JSON-Lines format (same as old CLI output)
        return this.parseJsonLines(trimmed);
    }

    /**
     * JSON-Lines parser (fallback for line-delimited server output).
     */
    private parseJsonLines(output: string): CLIQueryResult {
        const lines = output.split('\n').filter(line => line.trim());
        let columns: string[] = [];
        const rows: any[] = [];

        for (const line of lines) {
            try {
                const json = JSON.parse(line);

                if (json.result?.type === 'SCHEMA' && json.result.columns) {
                    columns = json.result.columns.map((col: any) => col.name || col);
                }

                if (json.result?.type === 'BINDINGS' && json.result.rows) {
                    for (const row of json.result.rows) {
                        if (typeof row === 'object' && !Array.isArray(row)) {
                            rows.push(row);
                        } else if (Array.isArray(row) && columns.length > 0) {
                            const obj: any = {};
                            for (let i = 0; i < columns.length; i++) {
                                obj[columns[i]] = row[i];
                            }
                            rows.push(obj);
                        }
                    }
                }

                // Legacy format support
                if (json.columns && !json.result) {
                    columns = json.columns;
                }
                if (json.row) {
                    rows.push(json.row);
                }
                if (json.bindings) {
                    for (const binding of json.bindings) {
                        rows.push(binding);
                    }
                }
            } catch {
                // Skip non-JSON lines
            }
        }

        return new CLIQueryResult(columns, rows);
    }

    /**
     * Connect to Geode server using configuration
     */
    async connect(config: GeodeConfig): Promise<void> {
        try {
            this.outputChannel.appendLine(`Connecting to ${config.host}:${config.port}...`);

            const serverInfo = this.requireServerInfo();
            this.config = config;

            // Register a profile with the bundled server
            const profileId = await this.registerProfile(serverInfo, config);
            this.serverProfileId = profileId;
            this.outputChannel.appendLine(`Registered profile ${profileId} with bundled server`);

            // Test the connection with a simple query
            await this.runHttpQuery('RETURN 1');

            this._isConnected = true;
            this.outputChannel.appendLine('Connected successfully');
            this.updateStatus({ connected: true });
        } catch (error) {
            this._isConnected = false;
            this.serverProfileId = null;
            this.outputChannel.appendLine(`Connection failed: ${error}`);
            this.updateStatus({ connected: false, error: String(error) });
            throw error;
        }
    }

    /**
     * Disconnect from Geode server
     */
    async disconnect(): Promise<void> {
        // Best-effort cleanup of server-side profile
        if (this.serverProfileId) {
            try {
                const serverInfo = this.serverInfoProvider?.();
                if (serverInfo) {
                    this.deleteProfile(serverInfo, this.serverProfileId);
                }
            } catch {
                // best effort
            }
            this.serverProfileId = null;
        }

        this._isConnected = false;
        this.config = null;
        this.outputChannel.appendLine('Disconnected from server');
        this.updateStatus({ connected: false });
    }

    /**
     * Execute a GQL query
     */
    async query(gql: string, _params?: Record<string, any>): Promise<CLIQueryResult> {
        if (!this._isConnected || !this.config) {
            throw new Error('Not connected to Geode server. Please connect first.');
        }

        try {
            this.outputChannel.appendLine(`Executing query: ${gql.substring(0, 100)}...`);
            const startTime = Date.now();

            const result = await this.runHttpQuery(gql);

            const duration = Date.now() - startTime;
            this.outputChannel.appendLine(`Query completed in ${duration}ms`);

            return result;
        } catch (error) {
            this.outputChannel.appendLine(`Query error: ${error}`);
            throw error;
        }
    }

    /**
     * Execute multiple queries in a batch
     */
    async batch(queries: Array<{ gql: string; params?: Record<string, any> }>): Promise<CLIQueryResult[]> {
        if (!this._isConnected || !this.config) {
            throw new Error('Not connected to Geode server. Please connect first.');
        }

        try {
            this.outputChannel.appendLine(`Executing batch of ${queries.length} queries...`);
            const startTime = Date.now();

            const results: CLIQueryResult[] = [];
            for (const q of queries) {
                const result = await this.runHttpQuery(q.gql);
                results.push(result);
            }

            const duration = Date.now() - startTime;
            this.outputChannel.appendLine(`Batch completed in ${duration}ms`);

            return results;
        } catch (error) {
            this.outputChannel.appendLine(`Batch error: ${error}`);
            throw error;
        }
    }

    /**
     * Get query execution plan
     */
    async explain(gql: string, _params?: Record<string, any>): Promise<any> {
        if (!this._isConnected || !this.config) {
            throw new Error('Not connected to Geode server. Please connect first.');
        }

        try {
            this.outputChannel.appendLine(`Explaining query: ${gql.substring(0, 100)}...`);
            const result = await this.runHttpQuery(`EXPLAIN ${gql}`);
            return result;
        } catch (error) {
            this.outputChannel.appendLine(`Explain error: ${error}`);
            throw error;
        }
    }

    /**
     * Get database schema through introspection
     */
    async getSchema(): Promise<SchemaInfo> {
        if (!this._isConnected || !this.config) {
            throw new Error('Not connected to Geode server. Please connect first.');
        }

        try {
            this.outputChannel.appendLine('Fetching schema...');

            // Get node labels
            const labelsResult = await this.runHttpQuery(`
                MATCH (n)
                WITH labels(n) as labelList
                UNWIND labelList as label
                RETURN DISTINCT label, COUNT(*) as count
            `);

            // Get relationship types
            const relsResult = await this.runHttpQuery(`
                MATCH ()-[r]->()
                RETURN DISTINCT type(r) as type, COUNT(r) as count
            `);

            // Get property keys for each label
            const propsResult = await this.runHttpQuery(`
                MATCH (n)
                WITH labels(n) as labelList, keys(n) as keyList
                UNWIND labelList as label
                UNWIND keyList as key
                WITH label, key
                RETURN DISTINCT label, COLLECT(DISTINCT key) as properties
            `);

            const schema: SchemaInfo = {
                nodeLabels: await this.parseLabels(labelsResult),
                relationshipTypes: await this.parseRelationships(relsResult),
                properties: await this.parseProperties(propsResult)
            };

            this.outputChannel.appendLine('Schema fetched successfully');
            return schema;
        } catch (error) {
            this.outputChannel.appendLine(`Schema fetch error: ${error}`);
            throw error;
        }
    }

    /**
     * Get server statistics
     */
    async getStatistics(): Promise<DatabaseStatistics> {
        if (!this._isConnected || !this.config) {
            throw new Error('Not connected to Geode server. Please connect first.');
        }

        try {
            const result = await this.runHttpQuery(`
                MATCH (n)
                WITH COUNT(n) as nodeCount
                MATCH ()-[r]->()
                WITH nodeCount, COUNT(r) as relCount
                RETURN nodeCount, relCount
            `);

            const rows = await result.toObjects();
            if (rows.length === 0) {
                return { nodeCount: 0, relationshipCount: 0 };
            }

            return {
                nodeCount: rows[0].nodeCount || 0,
                relationshipCount: rows[0].relCount || 0
            };
        } catch (error) {
            this.outputChannel.appendLine(`Statistics error: ${error}`);
            throw error;
        }
    }

    /**
     * Get server metrics using the current authenticated session.
     */
    async getMetrics(): Promise<any> {
        if (!this._isConnected || !this.config) {
            throw new Error('Not connected to Geode server. Please connect first.');
        }

        try {
            const result = await this.runHttpQuery(`CALL cdc.get_telemetry_metrics()`);

            const rows = await result.toObjects();
            if (rows.length === 0) {
                return {};
            }

            return rows[0];
        } catch (error) {
            this.outputChannel.appendLine(`Metrics error: ${error}`);
            throw error;
        }
    }

    /**
     * Test connection health
     */
    async ping(): Promise<number> {
        if (!this._isConnected || !this.config) {
            throw new Error('Not connected to Geode server. Please connect first.');
        }

        try {
            const startTime = Date.now();
            await this.runHttpQuery('RETURN 1');
            const latency = Date.now() - startTime;

            this.updateStatus({ connected: true, latency });
            return latency;
        } catch (error) {
            this._isConnected = false;
            this.updateStatus({ connected: false, error: String(error) });
            throw error;
        }
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this._isConnected;
    }

    /**
     * Get current connection config
     */
    getConfig(): GeodeConfig | null {
        return this.config;
    }

    /**
     * Set status callback for connection changes
     */
    onStatusChange(callback: (status: ConnectionStatus) => void): void {
        this.statusCallback = callback;
    }

    /**
     * Update connection status and notify callback
     */
    private updateStatus(status: ConnectionStatus): void {
        if (this.statusCallback) {
            this.statusCallback(status);
        }
    }

    /**
     * Parse label results
     */
    private async parseLabels(result: CLIQueryResult): Promise<NodeLabel[]> {
        const labels: NodeLabel[] = [];

        for await (const row of result) {
            labels.push({
                name: row.get('label')?.asString || '',
                count: row.get('count')?.asNumber || 0
            });
        }

        return labels;
    }

    /**
     * Parse relationship results
     */
    private async parseRelationships(result: CLIQueryResult): Promise<RelationshipType[]> {
        const types: RelationshipType[] = [];

        for await (const row of result) {
            types.push({
                name: row.get('type')?.asString || '',
                count: row.get('count')?.asNumber || 0
            });
        }

        return types;
    }

    /**
     * Parse property results
     */
    private async parseProperties(result: CLIQueryResult): Promise<Record<string, string[]>> {
        const props: Record<string, string[]> = {};

        for await (const row of result) {
            const label = row.get('label')?.asString || '';
            const propertiesValue = row.get('properties');
            const properties: string[] = [];

            if (propertiesValue && propertiesValue.kind === 'ARRAY') {
                for (const prop of propertiesValue.asArray) {
                    if (prop) {
                        properties.push(prop.asString);
                    }
                }
            }
            props[label] = properties;
        }

        return props;
    }
}

// Type definitions
export interface SchemaInfo {
    nodeLabels: NodeLabel[];
    relationshipTypes: RelationshipType[];
    properties: Record<string, string[]>;
}

export interface NodeLabel {
    name: string;
    count: number;
}

export interface RelationshipType {
    name: string;
    count: number;
}

export interface DatabaseStatistics {
    nodeCount: number;
    relationshipCount: number;
}
