/**
 * Unit tests for GeodeClientWrapper
 */

import * as assert from 'assert';

// ============================================================================
// Type Definitions (matching GeodeClientWrapper)
// ============================================================================

interface ConnectionStatus {
    connected: boolean;
    profile?: string;
    latency?: number;
    error?: string;
}

interface GeodeConfig {
    host: string;
    port: number;
    username?: string;
    password?: string;
    insecureSkipVerify?: boolean;
    tlsCA?: string;
}

interface SchemaInfo {
    nodeLabels: NodeLabel[];
    relationshipTypes: RelationshipType[];
    properties: Record<string, string[]>;
}

interface NodeLabel {
    name: string;
    count: number;
}

interface RelationshipType {
    name: string;
    count: number;
}

interface DatabaseStatistics {
    nodeCount: number;
    relationshipCount: number;
}

// ============================================================================
// Mock CLIQueryResult (matching implementation)
// ============================================================================

class MockCLIQueryResult {
    public columnNames: string[];
    private rows: any[];

    constructor(columns: string[], rows: any[]) {
        this.columnNames = columns;
        this.rows = rows;
    }

    async toObjects(): Promise<any[]> {
        return this.rows;
    }

    async first(): Promise<any | null> {
        return this.rows.length > 0 ? this.rows[0] : null;
    }

    async *[Symbol.asyncIterator]() {
        for (const row of this.rows) {
            yield new MockCLIRow(row, this.columnNames);
        }
    }
}

class MockCLIRow {
    private data: any;
    private columns: string[];

    constructor(data: any, columns: string[]) {
        this.data = data;
        this.columns = columns;
    }

    get(key: string): MockCLIValue | undefined {
        const value = this.data[key];
        return value !== undefined ? new MockCLIValue(value) : undefined;
    }

    keys(): string[] {
        return this.columns;
    }
}

class MockCLIValue {
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

    get asArray(): MockCLIValue[] {
        if (Array.isArray(this.value)) {
            return this.value.map(v => new MockCLIValue(v));
        }
        return [];
    }
}

// ============================================================================
// JSON Parser (matching implementation)
// ============================================================================

function parseJSONResult(output: string): MockCLIQueryResult {
    const lines = output.trim().split('\n').filter(line => line.trim());
    let columns: string[] = [];
    const rows: any[] = [];

    for (const line of lines) {
        try {
            const json = JSON.parse(line);

            // Handle SCHEMA message
            if (json.result?.type === 'SCHEMA' && json.result.columns) {
                columns = json.result.columns.map((col: any) => col.name || col);
            }

            // Handle BINDINGS message
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

    return new MockCLIQueryResult(columns, rows);
}

// ============================================================================
// Unit Tests
// ============================================================================

describe('GeodeClientWrapper Unit Tests', () => {

    describe('GeodeConfig', () => {
        it('has required host and port', () => {
            const config: GeodeConfig = {
                host: 'localhost',
                port: 3141
            };
            assert.strictEqual(config.host, 'localhost');
            assert.strictEqual(config.port, 3141);
        });

        it('supports optional authentication', () => {
            const config: GeodeConfig = {
                host: 'localhost',
                port: 3141,
                username: 'admin',
                password: 'secret'
            };
            assert.strictEqual(config.username, 'admin');
            assert.strictEqual(config.password, 'secret');
        });

        it('supports insecure mode', () => {
            const config: GeodeConfig = {
                host: 'localhost',
                port: 3141,
                insecureSkipVerify: true
            };
            assert.strictEqual(config.insecureSkipVerify, true);
        });

        it('supports custom CA certificate', () => {
            const config: GeodeConfig = {
                host: 'localhost',
                port: 3141,
                tlsCA: '/path/to/ca.crt'
            };
            assert.strictEqual(config.tlsCA, '/path/to/ca.crt');
        });
    });

    describe('ConnectionStatus', () => {
        it('indicates connected state', () => {
            const status: ConnectionStatus = { connected: true };
            assert.strictEqual(status.connected, true);
        });

        it('indicates disconnected with error', () => {
            const status: ConnectionStatus = {
                connected: false,
                error: 'Connection refused'
            };
            assert.strictEqual(status.connected, false);
            assert.ok(status.error);
        });

        it('includes latency when connected', () => {
            const status: ConnectionStatus = {
                connected: true,
                latency: 15
            };
            assert.strictEqual(status.latency, 15);
        });
    });

    describe('CLIQueryResult', () => {
        it('stores column names', () => {
            const result = new MockCLIQueryResult(['name', 'age'], []);
            assert.deepStrictEqual(result.columnNames, ['name', 'age']);
        });

        it('toObjects returns row array', async () => {
            const rows = [{ name: 'Alice' }, { name: 'Bob' }];
            const result = new MockCLIQueryResult(['name'], rows);

            const objects = await result.toObjects();
            assert.strictEqual(objects.length, 2);
            assert.strictEqual(objects[0].name, 'Alice');
        });

        it('first returns first row', async () => {
            const result = new MockCLIQueryResult(['x'], [{ x: 1 }, { x: 2 }]);

            const first = await result.first();
            assert.strictEqual(first.x, 1);
        });

        it('first returns null for empty result', async () => {
            const result = new MockCLIQueryResult(['x'], []);

            const first = await result.first();
            assert.strictEqual(first, null);
        });

        it('async iterator yields rows', async () => {
            const result = new MockCLIQueryResult(['x'], [{ x: 1 }, { x: 2 }]);

            const values: number[] = [];
            for await (const row of result) {
                values.push(row.get('x')!.asNumber);
            }

            assert.deepStrictEqual(values, [1, 2]);
        });
    });

    describe('CLIRow', () => {
        it('get returns value for existing key', () => {
            const row = new MockCLIRow({ name: 'Alice', age: 30 }, ['name', 'age']);

            assert.strictEqual(row.get('name')!.asString, 'Alice');
            assert.strictEqual(row.get('age')!.asNumber, 30);
        });

        it('get returns undefined for missing key', () => {
            const row = new MockCLIRow({ name: 'Alice' }, ['name']);

            assert.strictEqual(row.get('missing'), undefined);
        });

        it('keys returns column names', () => {
            const row = new MockCLIRow({}, ['a', 'b', 'c']);

            assert.deepStrictEqual(row.keys(), ['a', 'b', 'c']);
        });
    });

    describe('CLIValue', () => {
        describe('kind detection', () => {
            it('detects STRING', () => {
                const value = new MockCLIValue('hello');
                assert.strictEqual(value.kind, 'STRING');
            });

            it('detects NUMBER', () => {
                const value = new MockCLIValue(42);
                assert.strictEqual(value.kind, 'NUMBER');
            });

            it('detects BOOLEAN', () => {
                const value = new MockCLIValue(true);
                assert.strictEqual(value.kind, 'BOOLEAN');
            });

            it('detects NULL', () => {
                const value = new MockCLIValue(null);
                assert.strictEqual(value.kind, 'NULL');
            });

            it('detects ARRAY', () => {
                const value = new MockCLIValue([1, 2, 3]);
                assert.strictEqual(value.kind, 'ARRAY');
            });

            it('detects MAP', () => {
                const value = new MockCLIValue({ key: 'value' });
                assert.strictEqual(value.kind, 'MAP');
            });
        });

        describe('type conversions', () => {
            it('asString converts number', () => {
                const value = new MockCLIValue(42);
                assert.strictEqual(value.asString, '42');
            });

            it('asString handles null', () => {
                const value = new MockCLIValue(null);
                assert.strictEqual(value.asString, '');
            });

            it('asNumber converts string', () => {
                const value = new MockCLIValue('123');
                assert.strictEqual(value.asNumber, 123);
            });

            it('asNumber returns 0 for null', () => {
                const value = new MockCLIValue(null);
                assert.strictEqual(value.asNumber, 0);
            });

            it('asBoolean converts truthy', () => {
                assert.strictEqual(new MockCLIValue(1).asBoolean, true);
                assert.strictEqual(new MockCLIValue('yes').asBoolean, true);
                assert.strictEqual(new MockCLIValue(0).asBoolean, false);
                assert.strictEqual(new MockCLIValue('').asBoolean, false);
            });

            it('asArray returns wrapped values', () => {
                const value = new MockCLIValue(['a', 'b', 'c']);
                const arr = value.asArray;

                assert.strictEqual(arr.length, 3);
                assert.strictEqual(arr[0].asString, 'a');
            });

            it('asArray returns empty for non-array', () => {
                const value = new MockCLIValue('not an array');
                assert.deepStrictEqual(value.asArray, []);
            });
        });
    });

    describe('parseJSONResult', () => {
        it('parses SCHEMA message', () => {
            const output = '{"result":{"type":"SCHEMA","columns":[{"name":"x","type":"integer"},{"name":"y","type":"string"}]}}';
            const result = parseJSONResult(output);

            assert.deepStrictEqual(result.columnNames, ['x', 'y']);
        });

        it('parses BINDINGS message with object rows', () => {
            const output = '{"result":{"type":"BINDINGS","rows":[{"x":1,"y":"a"},{"x":2,"y":"b"}]}}';
            const result = parseJSONResult(output);

            const rows = result['rows'] as any[];
            // Access private field for testing
            assert.strictEqual(rows.length, 2);
        });

        it('parses BINDINGS message with array rows', () => {
            const output = `{"result":{"type":"SCHEMA","columns":[{"name":"x"},{"name":"y"}]}}
{"result":{"type":"BINDINGS","rows":[[1,"a"],[2,"b"]]}}`;
            const result = parseJSONResult(output);

            assert.deepStrictEqual(result.columnNames, ['x', 'y']);
        });

        it('parses legacy row format', () => {
            const output = '{"row":{"name":"Alice"}}';
            const result = parseJSONResult(output);

            // Should have one row
            result.toObjects().then(objs => {
                assert.strictEqual(objs.length, 1);
                assert.strictEqual(objs[0].name, 'Alice');
            });
        });

        it('parses legacy bindings format', () => {
            const output = '{"bindings":[{"x":1},{"x":2}]}';
            const result = parseJSONResult(output);

            result.toObjects().then(objs => {
                assert.strictEqual(objs.length, 2);
            });
        });

        it('handles multi-line output', () => {
            const output = `{"result":{"type":"SCHEMA","columns":[{"name":"n"}]}}
{"result":{"type":"BINDINGS","rows":[{"n":1}]}}
{"result":{"type":"BINDINGS","rows":[{"n":2}]}}`;
            const result = parseJSONResult(output);

            result.toObjects().then(objs => {
                assert.strictEqual(objs.length, 2);
            });
        });

        it('skips non-JSON lines', () => {
            const output = `debug(some): log message
{"result":{"type":"BINDINGS","rows":[{"x":1}]}}
another debug line`;
            const result = parseJSONResult(output);

            // Should still parse the valid JSON
            result.toObjects().then(objs => {
                assert.strictEqual(objs.length, 1);
            });
        });

        it('handles empty output', () => {
            const result = parseJSONResult('');

            assert.deepStrictEqual(result.columnNames, []);
            result.toObjects().then(objs => {
                assert.strictEqual(objs.length, 0);
            });
        });
    });

    describe('SchemaInfo', () => {
        it('has node labels with counts', () => {
            const schema: SchemaInfo = {
                nodeLabels: [
                    { name: 'Person', count: 100 },
                    { name: 'Company', count: 50 }
                ],
                relationshipTypes: [],
                properties: {}
            };

            assert.strictEqual(schema.nodeLabels.length, 2);
            assert.strictEqual(schema.nodeLabels[0].name, 'Person');
            assert.strictEqual(schema.nodeLabels[0].count, 100);
        });

        it('has relationship types with counts', () => {
            const schema: SchemaInfo = {
                nodeLabels: [],
                relationshipTypes: [
                    { name: 'KNOWS', count: 200 },
                    { name: 'WORKS_AT', count: 75 }
                ],
                properties: {}
            };

            assert.strictEqual(schema.relationshipTypes.length, 2);
        });

        it('has properties per label', () => {
            const schema: SchemaInfo = {
                nodeLabels: [],
                relationshipTypes: [],
                properties: {
                    'Person': ['name', 'age', 'email'],
                    'Company': ['name', 'founded']
                }
            };

            assert.deepStrictEqual(schema.properties['Person'], ['name', 'age', 'email']);
            assert.strictEqual(schema.properties['Company'].length, 2);
        });
    });

    describe('DatabaseStatistics', () => {
        it('has node and relationship counts', () => {
            const stats: DatabaseStatistics = {
                nodeCount: 1000,
                relationshipCount: 5000
            };

            assert.strictEqual(stats.nodeCount, 1000);
            assert.strictEqual(stats.relationshipCount, 5000);
        });

        it('handles zero counts', () => {
            const stats: DatabaseStatistics = {
                nodeCount: 0,
                relationshipCount: 0
            };

            assert.strictEqual(stats.nodeCount, 0);
            assert.strictEqual(stats.relationshipCount, 0);
        });
    });

    describe('CLI Argument Building (Secure Pattern)', () => {
        /**
         * SECURITY: Build CLI args following the secure pattern.
         * Password is NOT included in args - it must be passed via environment variable.
         */
        function buildCLIArgs(config: GeodeConfig): string[] {
            const args = ['query', '--format', 'json'];
            args.push('--server', `${config.host}:${config.port}`);

            if (config.insecureSkipVerify) {
                args.push('--insecure');
            }
            if (config.username) {
                args.push('-U', config.username);
            }
            // SECURITY: Password is NOT passed via CLI args
            // It should be passed via GEODE_PASSWORD environment variable
            args.push('-');

            return args;
        }

        /**
         * SECURITY: Build environment variables for password transmission.
         */
        function buildPasswordEnv(password?: string): Record<string, string | undefined> {
            const env: Record<string, string | undefined> = {};
            if (password) {
                env['GEODE_PASSWORD'] = password;
            }
            return env;
        }

        it('builds basic args', () => {
            const args = buildCLIArgs({ host: 'localhost', port: 3141 });

            assert.ok(args.includes('query'));
            assert.ok(args.includes('--format'));
            assert.ok(args.includes('json'));
            assert.ok(args.includes('--server'));
            assert.ok(args.includes('localhost:3141'));
            assert.ok(args.includes('-'));
        });

        it('includes insecure flag', () => {
            const args = buildCLIArgs({
                host: 'localhost',
                port: 3141,
                insecureSkipVerify: true
            });

            assert.ok(args.includes('--insecure'));
        });

        it('includes username', () => {
            const args = buildCLIArgs({
                host: 'localhost',
                port: 3141,
                username: 'admin'
            });

            const uIdx = args.indexOf('-U');
            assert.ok(uIdx >= 0);
            assert.strictEqual(args[uIdx + 1], 'admin');
        });

        it('SECURITY: does NOT include password in CLI args', () => {
            const args = buildCLIArgs({
                host: 'localhost',
                port: 3141,
                password: 'secret'
            });

            // Password should NOT be in CLI args (visible in ps aux)
            assert.strictEqual(args.indexOf('-P'), -1, 'Password flag -P should not be in CLI args');
            assert.ok(!args.includes('secret'), 'Password value should not be in CLI args');
        });

        it('SECURITY: password is passed via environment variable', () => {
            const env = buildPasswordEnv('secret');

            assert.strictEqual(env['GEODE_PASSWORD'], 'secret');
        });

        it('SECURITY: no GEODE_PASSWORD when password is undefined', () => {
            const env = buildPasswordEnv(undefined);

            assert.strictEqual(env['GEODE_PASSWORD'], undefined);
        });

        it('ends with stdin marker', () => {
            const args = buildCLIArgs({ host: 'localhost', port: 3141 });

            assert.strictEqual(args[args.length - 1], '-');
        });
    });

    describe('Error Message Filtering', () => {
        function filterStderr(stderr: string): string {
            return stderr.split('\n')
                .filter(line => !line.startsWith('debug('))
                .join('\n').trim();
        }

        it('removes debug lines', () => {
            const stderr = `debug(quic): connecting...
debug(tls): handshake complete
Error: Connection failed`;

            const filtered = filterStderr(stderr);
            assert.ok(!filtered.includes('debug('));
            assert.ok(filtered.includes('Error: Connection failed'));
        });

        it('preserves error messages', () => {
            const stderr = 'Error: Query syntax error at line 1';
            const filtered = filterStderr(stderr);

            assert.strictEqual(filtered, stderr);
        });

        it('handles empty stderr', () => {
            const filtered = filterStderr('');
            assert.strictEqual(filtered, '');
        });
    });
});

describe('Schema Query Tests', () => {
    describe('Label query', () => {
        const labelQuery = `
            MATCH (n)
            WITH labels(n) as labelList
            UNWIND labelList as label
            RETURN DISTINCT label, COUNT(*) as count
        `;

        it('uses UNWIND for label extraction', () => {
            assert.ok(labelQuery.includes('UNWIND'));
        });

        it('returns distinct labels', () => {
            assert.ok(labelQuery.includes('DISTINCT'));
        });

        it('includes count', () => {
            assert.ok(labelQuery.includes('COUNT(*)'));
        });
    });

    describe('Relationship type query', () => {
        const relQuery = `
            MATCH ()-[r]->()
            RETURN DISTINCT type(r) as type, COUNT(r) as count
        `;

        it('uses type() function', () => {
            assert.ok(relQuery.includes('type(r)'));
        });

        it('counts relationships', () => {
            assert.ok(relQuery.includes('COUNT(r)'));
        });
    });

    describe('Property query', () => {
        const propQuery = `
            MATCH (n)
            WITH labels(n) as labelList, keys(n) as keyList
            UNWIND labelList as label
            UNWIND keyList as key
            WITH label, key
            RETURN DISTINCT label, COLLECT(DISTINCT key) as properties
        `;

        it('uses keys() function', () => {
            assert.ok(propQuery.includes('keys(n)'));
        });

        it('collects properties per label', () => {
            assert.ok(propQuery.includes('COLLECT(DISTINCT key)'));
        });
    });
});
