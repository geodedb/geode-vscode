/**
 * Wrapper for Geode database operations using the CLI
 * Uses the geode CLI instead of native Node.js client to avoid GLIBC compatibility issues
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

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

export class GeodeClientWrapper {
    private config: GeodeConfig | null = null;
    private _isConnected: boolean = false;
    private statusCallback?: (status: ConnectionStatus) => void;
    private geodeBinary: string = 'geode';

    constructor(
        private outputChannel: vscode.OutputChannel
    ) {
        this.geodeBinary = this.resolveGeodeBinary();
    }

    /**
     * Resolve the geode binary path
     */
    private resolveGeodeBinary(): string {
        const config = vscode.workspace.getConfiguration('geode.lsp');
        const configured = config.get<string>('path', 'geode');

        // Check if configured path exists
        if (configured && fs.existsSync(configured)) {
            return configured;
        }

        // Check common locations
        const candidates = [
            '/usr/bin/geode',
            '/usr/local/bin/geode',
            path.join(process.env.HOME || '', '.local/bin/geode')
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        // Fall back to PATH
        return configured || 'geode';
    }

    /**
     * Connect to Geode server using configuration
     */
    async connect(config: GeodeConfig): Promise<void> {
        try {
            this.outputChannel.appendLine(`Connecting to ${config.host}:${config.port}...`);

            this.config = config;

            // Test the connection with a simple query
            await this.runCLIQuery('RETURN 1');

            this._isConnected = true;
            this.outputChannel.appendLine('Connected successfully');
            this.updateStatus({ connected: true });
        } catch (error) {
            this._isConnected = false;
            this.outputChannel.appendLine(`Connection failed: ${error}`);
            this.updateStatus({ connected: false, error: String(error) });
            throw error;
        }
    }

    /**
     * Disconnect from Geode server
     */
    async disconnect(): Promise<void> {
        this._isConnected = false;
        this.config = null;
        this.outputChannel.appendLine('Disconnected from server');
        this.updateStatus({ connected: false });
    }

    /**
     * Execute a GQL query
     */
    async query(gql: string, params?: Record<string, any>): Promise<CLIQueryResult> {
        if (!this._isConnected || !this.config) {
            throw new Error('Not connected to Geode server. Please connect first.');
        }

        try {
            this.outputChannel.appendLine(`Executing query: ${gql.substring(0, 100)}...`);
            const startTime = Date.now();

            const result = await this.runCLIQuery(gql);

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
                const result = await this.runCLIQuery(q.gql);
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
    async explain(gql: string, params?: Record<string, any>): Promise<any> {
        if (!this._isConnected || !this.config) {
            throw new Error('Not connected to Geode server. Please connect first.');
        }

        try {
            this.outputChannel.appendLine(`Explaining query: ${gql.substring(0, 100)}...`);
            const result = await this.runCLIQuery(`EXPLAIN ${gql}`);
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
            const labelsResult = await this.runCLIQuery(`
                MATCH (n)
                WITH labels(n) as labelList
                UNWIND labelList as label
                RETURN DISTINCT label, COUNT(*) as count
            `);

            // Get relationship types
            const relsResult = await this.runCLIQuery(`
                MATCH ()-[r]->()
                RETURN DISTINCT type(r) as type, COUNT(r) as count
            `);

            // Get property keys for each label
            const propsResult = await this.runCLIQuery(`
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
            const result = await this.runCLIQuery(`
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
     * Test connection health
     */
    async ping(): Promise<number> {
        if (!this._isConnected || !this.config) {
            throw new Error('Not connected to Geode server. Please connect first.');
        }

        try {
            const startTime = Date.now();
            await this.runCLIQuery('RETURN 1');
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
     * Run a query using the Geode CLI
     */
    private runCLIQuery(query: string): Promise<CLIQueryResult> {
        return new Promise((resolve, reject) => {
            if (!this.config) {
                reject(new Error('No connection configuration'));
                return;
            }

            const args = ['query', '--format', 'json'];

            // Add connection arguments
            args.push('--server', `${this.config.host}:${this.config.port}`);

            if (this.config.insecureSkipVerify) {
                args.push('--insecure');
            }

            if (this.config.username) {
                args.push('-U', this.config.username);
            }

            if (this.config.password) {
                args.push('-P', this.config.password);
            }

            // Use stdin for query
            args.push('-');

            const proc = cp.spawn(this.geodeBinary, args, {
                timeout: 30000
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    try {
                        const result = this.parseJSONResult(stdout);
                        resolve(result);
                    } catch (parseError) {
                        reject(new Error(`Failed to parse result: ${parseError}`));
                    }
                } else {
                    // Filter debug lines from stderr
                    const errorLines = stderr.split('\n')
                        .filter(line => !line.startsWith('debug('))
                        .join('\n').trim();
                    reject(new Error(errorLines || `Query failed with exit code ${code}`));
                }
            });

            proc.on('error', (err) => {
                reject(new Error(`Failed to execute geode CLI: ${err.message}`));
            });

            // Write query to stdin
            proc.stdin.write(query);
            proc.stdin.end();
        });
    }

    /**
     * Parse JSON result from CLI output
     */
    private parseJSONResult(output: string): CLIQueryResult {
        const lines = output.trim().split('\n').filter(line => line.trim());
        let columns: string[] = [];
        const rows: any[] = [];

        for (const line of lines) {
            try {
                const json = JSON.parse(line);

                // Handle SCHEMA message - extract column names
                // Format: {"result":{"type":"SCHEMA","columns":[{"name":"col1","type":"text"}]}}
                if (json.result?.type === 'SCHEMA' && json.result.columns) {
                    columns = json.result.columns.map((col: any) => col.name || col);
                }

                // Handle BINDINGS message - extract rows
                // Format: {"result":{"type":"BINDINGS","rows":[{...},{...}]}}
                if (json.result?.type === 'BINDINGS' && json.result.rows) {
                    for (const row of json.result.rows) {
                        if (typeof row === 'object' && !Array.isArray(row)) {
                            rows.push(row);
                        } else if (Array.isArray(row) && columns.length > 0) {
                            // Convert array row to object using columns
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
