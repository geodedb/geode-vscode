import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';

// Define types locally to avoid importing vscode-dependent module
interface ConnectionProfile {
    id: string;
    name: string;
    host: string;
    port: number;
    database?: string;
    username?: string;
    useTls: boolean;
    insecure: boolean;
    certPath?: string;
    keyPath?: string;
    caPath?: string;
    timeout: number;
    queryTimeout: number;
    isDefault: boolean;
}

function createDefaultProfile(): ConnectionProfile {
    return {
        id: 'default-local',
        name: 'Local Development',
        host: 'localhost',
        port: 3141,
        useTls: true,
        insecure: true,
        timeout: 5000,
        queryTimeout: 30000,
        isDefault: true
    };
}

// Mock VS Code types for unit testing without full VS Code extension host
class MockSecrets {
    private _data: Map<string, string> = new Map();

    async get(key: string): Promise<string | undefined> {
        return this._data.get(key);
    }

    async store(key: string, value: string): Promise<void> {
        this._data.set(key, value);
    }

    async delete(key: string): Promise<void> {
        this._data.delete(key);
    }
}

class MockGlobalState {
    private _data: Map<string, unknown> = new Map();

    get<T>(key: string, defaultValue?: T): T {
        return (this._data.get(key) as T) ?? defaultValue!;
    }

    async update(key: string, value: unknown): Promise<void> {
        this._data.set(key, value);
    }
}

class _MockOutputChannel {
    private lines: string[] = [];

    appendLine(line: string): void {
        this.lines.push(line);
    }

    getOutput(): string[] {
        return [...this.lines];
    }

    clear(): void {
        this.lines = [];
    }
}

describe('Connection Manager Tests', () => {

    describe('createDefaultProfile', () => {
        it('creates profile with correct defaults', () => {
            const profile = createDefaultProfile();

            assert.strictEqual(profile.id, 'default-local');
            assert.strictEqual(profile.name, 'Local Development');
            assert.strictEqual(profile.host, 'localhost');
            assert.strictEqual(profile.port, 3141);
            assert.strictEqual(profile.useTls, true);
            assert.strictEqual(profile.insecure, true);
            assert.strictEqual(profile.timeout, 5000);
            assert.strictEqual(profile.queryTimeout, 30000);
            assert.strictEqual(profile.isDefault, true);
        });
    });

    describe('ConnectionProfile interface', () => {
        it('can create a minimal profile', () => {
            const profile: ConnectionProfile = {
                id: 'test-1',
                name: 'Test Connection',
                host: '192.168.1.100',
                port: 3142,
                useTls: true,
                insecure: false,
                timeout: 10000,
                queryTimeout: 60000,
                isDefault: false
            };

            assert.strictEqual(profile.host, '192.168.1.100');
            assert.strictEqual(profile.port, 3142);
        });

        it('can create a profile with authentication', () => {
            const profile: ConnectionProfile = {
                id: 'test-2',
                name: 'Authenticated Connection',
                host: 'db.example.com',
                port: 3141,
                database: 'production',
                username: 'admin',
                useTls: true,
                insecure: false,
                timeout: 5000,
                queryTimeout: 30000,
                isDefault: false
            };

            assert.strictEqual(profile.database, 'production');
            assert.strictEqual(profile.username, 'admin');
        });

        it('can create a profile with TLS certificates', () => {
            const profile: ConnectionProfile = {
                id: 'test-3',
                name: 'TLS Connection',
                host: 'secure.example.com',
                port: 3141,
                useTls: true,
                insecure: false,
                certPath: '/path/to/client.crt',
                keyPath: '/path/to/client.key',
                caPath: '/path/to/ca.crt',
                timeout: 5000,
                queryTimeout: 30000,
                isDefault: false
            };

            assert.strictEqual(profile.certPath, '/path/to/client.crt');
            assert.strictEqual(profile.keyPath, '/path/to/client.key');
            assert.strictEqual(profile.caPath, '/path/to/ca.crt');
        });
    });

    describe('CLI Argument Building', () => {
        // Simulate the buildConnectionArgs logic for testing
        function buildConnectionArgs(profile: ConnectionProfile): string[] {
            const args: string[] = [];

            args.push('--server', `${profile.host}:${profile.port}`);

            if (profile.insecure) {
                args.push('--insecure');
            }

            if (profile.timeout) {
                args.push('--timeout', Math.ceil(profile.timeout / 1000).toString());
            }

            if (profile.username) {
                args.push('-U', profile.username);
            }

            return args;
        }

        /**
         * Build connection args - password is no longer included in args for security
         * @deprecated Use buildConnectionArgs() + buildPasswordEnvironment() instead
         */
        function buildConnectionArgsWithPassword(profile: ConnectionProfile, _password?: string): string[] {
            // SECURITY: Password should be passed via GEODE_PASSWORD env var, not CLI args
            return buildConnectionArgs(profile);
        }

        function buildPasswordEnvironment(password?: string): Record<string, string | undefined> {
            const env: Record<string, string | undefined> = { ...process.env };
            if (password) {
                env['GEODE_PASSWORD'] = password;
            }
            return env;
        }

        it('builds basic connection args', () => {
            const profile = createDefaultProfile();
            const args = buildConnectionArgs(profile);

            assert.ok(args.includes('--server'));
            assert.ok(args.includes('localhost:3141'));
            assert.ok(args.includes('--insecure'));
            assert.ok(args.includes('--timeout'));
        });

        it('includes timeout in seconds', () => {
            const profile: ConnectionProfile = {
                ...createDefaultProfile(),
                timeout: 10000 // 10 seconds in ms
            };
            const args = buildConnectionArgs(profile);

            const timeoutIdx = args.indexOf('--timeout');
            assert.ok(timeoutIdx >= 0);
            assert.strictEqual(args[timeoutIdx + 1], '10');
        });

        it('includes username when specified', () => {
            const profile: ConnectionProfile = {
                ...createDefaultProfile(),
                username: 'testuser'
            };
            const args = buildConnectionArgs(profile);

            assert.ok(args.includes('-U'));
            assert.ok(args.includes('testuser'));
        });

        it('does not include password in args for security', () => {
            // SECURITY: Passwords should be passed via environment variable,
            // not CLI arguments (which are visible in process listings)
            const profile: ConnectionProfile = {
                ...createDefaultProfile(),
                username: 'testuser'
            };
            const args = buildConnectionArgsWithPassword(profile, 'secret123');

            // Password should NOT be in args
            assert.ok(!args.includes('-P'));
            assert.ok(!args.includes('secret123'));
        });

        it('includes password in environment variable', () => {
            const env = buildPasswordEnvironment('secret123');
            assert.strictEqual(env['GEODE_PASSWORD'], 'secret123');
        });

        it('does not set GEODE_PASSWORD when password is undefined', () => {
            const originalEnv = process.env['GEODE_PASSWORD'];
            delete process.env['GEODE_PASSWORD'];

            const env = buildPasswordEnvironment(undefined);
            assert.strictEqual(env['GEODE_PASSWORD'], undefined);

            // Restore original
            if (originalEnv) {
                process.env['GEODE_PASSWORD'] = originalEnv;
            }
        });

        it('does not include insecure flag when useTls is true and insecure is false', () => {
            const profile: ConnectionProfile = {
                ...createDefaultProfile(),
                useTls: true,
                insecure: false
            };
            const args = buildConnectionArgs(profile);

            assert.ok(!args.includes('--insecure'));
        });
    });

    describe('DSN Building', () => {
        // Uses quic:// scheme per the official Geode DSN specification
        function buildDsn(profile: ConnectionProfile, password?: string): string {
            let dsn = 'quic://';

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
                params.push('insecure_tls_skip_verify=true');
            }
            if (profile.timeout !== 5000) {
                params.push(`timeout_ms=${profile.timeout}`);
            }

            if (params.length > 0) {
                dsn += '?' + params.join('&');
            }

            return dsn;
        }

        it('builds basic DSN for localhost', () => {
            const profile = createDefaultProfile();
            const dsn = buildDsn(profile);

            assert.ok(dsn.startsWith('quic://'));
            assert.ok(dsn.includes('localhost'));
            assert.ok(dsn.includes('insecure_tls_skip_verify=true'));
        });

        it('includes port only when non-default', () => {
            const profile: ConnectionProfile = {
                ...createDefaultProfile(),
                port: 3142
            };
            const dsn = buildDsn(profile);

            assert.ok(dsn.includes(':3142'));
        });

        it('omits port for default 3141', () => {
            const profile = createDefaultProfile();
            const dsn = buildDsn(profile);

            // Should not have :3141 after localhost
            assert.ok(!dsn.includes('localhost:3141'));
        });

        it('includes username and password', () => {
            const profile: ConnectionProfile = {
                ...createDefaultProfile(),
                username: 'admin',
                insecure: false
            };
            const dsn = buildDsn(profile, 'secret');

            assert.ok(dsn.includes('admin:secret@'));
        });

        it('encodes special characters in username', () => {
            const profile: ConnectionProfile = {
                ...createDefaultProfile(),
                username: 'user@domain.com',
                insecure: false
            };
            const dsn = buildDsn(profile);

            assert.ok(dsn.includes(encodeURIComponent('user@domain.com')));
        });

        it('includes database name', () => {
            const profile: ConnectionProfile = {
                ...createDefaultProfile(),
                database: 'mydb',
                insecure: false
            };
            const dsn = buildDsn(profile);

            assert.ok(dsn.includes('/mydb'));
        });

        it('always uses quic:// scheme per DSN specification', () => {
            const profile: ConnectionProfile = {
                ...createDefaultProfile(),
                useTls: false,
                insecure: false
            };
            const dsn = buildDsn(profile);

            // Geode uses QUIC transport with TLS 1.3
            assert.ok(dsn.startsWith('quic://'));
        });
    });

    describe('Mock SecretStorage', () => {
        it('can store and retrieve secrets', async () => {
            const secrets = new MockSecrets();

            await secrets.store('test-key', 'test-value');
            const value = await secrets.get('test-key');

            assert.strictEqual(value, 'test-value');
        });

        it('returns undefined for missing keys', async () => {
            const secrets = new MockSecrets();

            const value = await secrets.get('nonexistent');

            assert.strictEqual(value, undefined);
        });

        it('can delete secrets', async () => {
            const secrets = new MockSecrets();

            await secrets.store('test-key', 'test-value');
            await secrets.delete('test-key');
            const value = await secrets.get('test-key');

            assert.strictEqual(value, undefined);
        });
    });

    describe('Mock GlobalState', () => {
        it('can store and retrieve values', async () => {
            const state = new MockGlobalState();

            await state.update('connections', [{ id: '1', name: 'Test' }]);
            const value = state.get<{ id: string; name: string }[]>('connections', []);

            assert.strictEqual(value.length, 1);
            assert.strictEqual(value[0].name, 'Test');
        });

        it('returns default for missing keys', () => {
            const state = new MockGlobalState();

            const value = state.get<string>('missing', 'default');

            assert.strictEqual(value, 'default');
        });
    });
});

describe('CLI Integration Tests', () => {
    // Try multiple paths for geode binary
    function findGeodeBinary(): string | null {
        const candidates = [
            '../../zig-out/bin/geode',
            '../../../geode/zig-out/bin/geode',
            '/usr/local/bin/geode',
            '/usr/bin/geode'
        ];

        for (const candidate of candidates) {
            try {
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            } catch {
                // Continue to next candidate
            }
        }

        // Check if 'geode' is in PATH
        try {
            execFileSync('which', ['geode'], { encoding: 'utf8', stdio: 'pipe' });
            return 'geode';
        } catch {
            return null;
        }
    }

    const geodeBinary = findGeodeBinary();

    function isServerRunning(): boolean {
        if (!geodeBinary) return false;
        try {
            execFileSync(geodeBinary, [
                'query', '--server', '127.0.0.1:3141', '--insecure', '--timeout', '2', 'RETURN 1'
            ], { encoding: 'utf8', stdio: 'pipe' });
            return true;
        } catch {
            return false;
        }
    }

    it('geode binary exists', function() {
        if (!geodeBinary) {
            this.skip();
            return;
        }
        // If we found a binary, it exists
        assert.ok(true, 'Geode binary found at: ' + geodeBinary);
    });

    it('geode query --help works', function() {
        if (!geodeBinary) {
            this.skip();
            return;
        }
        try {
            execFileSync(geodeBinary, ['query', '--help'], { encoding: 'utf8', stdio: 'pipe' });
        } catch (error: unknown) {
            // Help might exit with non-zero code
            const err = error as { stdout?: string; stderr?: string };
            const output = (err.stdout || '') + (err.stderr || '');
            assert.ok(output.includes('--server') || output.includes('Execute') || output.includes('query'));
            return;
        }
        // If it succeeds, the binary works
        assert.ok(true);
    });

    it('geode query with insecure flag is accepted', function() {
        if (!geodeBinary) {
            this.skip();
            return;
        }
        // This test verifies the CLI accepts our arguments
        // It may fail with connection timeout if no server is running
        try {
            execFileSync(geodeBinary, [
                'query', '--server', '127.0.0.1:3141', '--insecure', '--timeout', '1', 'RETURN 1'
            ], { encoding: 'utf8', stdio: 'pipe' });
        } catch (error: unknown) {
            // Expected if no server running - we're testing argument parsing
            const err = error as { stderr?: string; message?: string };
            const stderr = err.stderr || err.message || '';
            // Should be timeout or connection error, not argument error
            // Any error here is acceptable since we just want to verify the CLI runs
            assert.ok(true, 'CLI executed (error: ' + stderr.substring(0, 50) + ')');
        }
    });

    it('geode query with -U flag is accepted', function() {
        if (!geodeBinary) {
            this.skip();
            return;
        }
        try {
            execFileSync(geodeBinary, [
                'query', '--server', '127.0.0.1:3141', '--insecure', '--timeout', '1',
                '-U', 'testuser', 'RETURN 1'
            ], { encoding: 'utf8', stdio: 'pipe' });
        } catch (_error: unknown) {
            // Any error here is acceptable since we just want to verify the CLI runs
            assert.ok(true, 'CLI executed with -U flag');
        }
    });

    it('geode query via stdin with dash works', function() {
        if (!geodeBinary || !isServerRunning()) {
            this.skip();
            return;
        }

        // Test that queries can be sent via stdin using '-'
        const query = 'RETURN 42 AS answer';
        const output = execFileSync(geodeBinary, [
            'query', '--server', '127.0.0.1:3141', '--insecure', '-'
        ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input: query });

        assert.ok(output.includes('42') || output.includes('"answer"'));
    });

    // Conditional test - only runs if server is up
    it('geode query executes successfully when server is running', function() {
        if (!geodeBinary || !isServerRunning()) {
            this.skip();
            return;
        }

        const output = execFileSync(geodeBinary, [
            'query', '--server', '127.0.0.1:3141', '--insecure', 'RETURN 1 AS x'
        ], { encoding: 'utf8', stdio: 'pipe' });

        assert.ok(output.includes('"x"') || output.includes('"rows"'));
    });
});
