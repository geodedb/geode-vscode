/**
 * Integration tests for the HTTP transport path in GeodeClientWrapper.
 *
 * Spins up a local HTTP server that mimics the bundled geode-ui server and
 * asserts that connect() registers a profile, issues RETURN 1, and that
 * query() returns rows correctly.
 */

import { strict as assert } from 'assert';
import * as http from 'http';

// ---------------------------------------------------------------------------
// Minimal vscode shim needed for GeodeClientWrapper (no vscode host available
// during unit tests run by mocha).
// ---------------------------------------------------------------------------
const Module = require('module');
const _originalLoad = Module._load.bind(Module);
Module._load = function (request: string, parent: any, isMain: boolean): any {
    if (request === 'vscode') {
        return {
            workspace: { getConfiguration: () => ({ get: () => undefined }) },
            window: { showInformationMessage: () => undefined },
        };
    }
    return _originalLoad(request, parent, isMain);
};

// Now safe to import GeodeClientWrapper (it will see the shim above).
const { GeodeClientWrapper } = require('../../client/GeodeClientWrapper') as typeof import('../../client/GeodeClientWrapper');

// ---------------------------------------------------------------------------
// Fake vscode OutputChannel
// ---------------------------------------------------------------------------
function makeOutputChannel(): import('vscode').OutputChannel {
    return {
        appendLine: () => undefined,
        append: () => undefined,
        clear: () => undefined,
        show: () => undefined,
        hide: () => undefined,
        dispose: () => undefined,
        name: 'test',
        replace: () => undefined,
    } as unknown as import('vscode').OutputChannel;
}

// ---------------------------------------------------------------------------
// Helper: spin up an HTTP server that handles profiles + query endpoints.
// ---------------------------------------------------------------------------
interface FakeServerState {
    profiles: Record<string, { name: string; dsn: string }>;
    lastQuery?: { statement: string; connection: string };
    queryResponse: object;
}

function startFakeServer(state: FakeServerState): Promise<{ server: http.Server; port: number }> {
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
            const url = req.url ?? '';

            // POST /api/v1/profiles
            if (req.method === 'POST' && url === '/api/v1/profiles') {
                const parsed = JSON.parse(body || '{}');
                const id = `srv-profile-${Object.keys(state.profiles).length + 1}`;
                state.profiles[id] = { name: parsed.name, dsn: parsed.dsn };
                res.writeHead(201, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ id }));
                return;
            }

            // DELETE /api/v1/profiles/:id
            if (req.method === 'DELETE' && url.startsWith('/api/v1/profiles/')) {
                const id = decodeURIComponent(url.slice('/api/v1/profiles/'.length));
                delete state.profiles[id];
                res.writeHead(204);
                res.end();
                return;
            }

            // POST /api/v1/query
            if (req.method === 'POST' && url === '/api/v1/query') {
                const parsed = JSON.parse(body || '{}');
                state.lastQuery = { statement: parsed.statement, connection: parsed.connection };
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(state.queryResponse));
                return;
            }

            res.writeHead(404);
            res.end('not found');
        });
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as { port: number }).port;
            resolve({ server, port });
        });
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GeodeClientWrapper HTTP transport', () => {
    let server: http.Server;
    let port: number;
    let state: FakeServerState;

    beforeEach(async () => {
        state = {
            profiles: {},
            queryResponse: { columns: ['result'], rows: [{ result: 1 }], durationMs: 1 },
        };
        ({ server, port } = await startFakeServer(state));
    });

    afterEach(() => server.close());

    it('connect() registers a profile and runs RETURN 1', async () => {
        const wrapper = new GeodeClientWrapper(makeOutputChannel());
        wrapper.attachServerInfoProvider(() => ({ host: '127.0.0.1', port, token: '' }));

        await wrapper.connect({ host: 'db.local', port: 3141 });

        assert.ok(wrapper.isConnected(), 'should be connected');
        // Profile was registered on the fake server
        assert.equal(Object.keys(state.profiles).length, 1);
        // Connection test query was issued
        assert.equal(state.lastQuery?.statement, 'RETURN 1');
    });

    it('query() sends statement and parses flat response', async () => {
        state.queryResponse = { columns: ['n'], rows: [{ n: 42 }], durationMs: 5 };
        const wrapper = new GeodeClientWrapper(makeOutputChannel());
        wrapper.attachServerInfoProvider(() => ({ host: '127.0.0.1', port, token: '' }));

        await wrapper.connect({ host: 'db.local', port: 3141 });
        const result = await wrapper.query('RETURN 42 AS n');

        assert.deepEqual(result.columnNames, ['n']);
        const rows = await result.toObjects();
        assert.equal(rows[0].n, 42);
    });

    it('connect() rejects with a clear message when server info is unavailable', async () => {
        const wrapper = new GeodeClientWrapper(makeOutputChannel());
        // No attachServerInfoProvider call — serverInfoProvider is undefined

        await assert.rejects(
            () => wrapper.connect({ host: 'db.local', port: 3141 }),
            (err: Error) => {
                assert.match(err.message, /bundled server/i);
                return true;
            }
        );
        assert.equal(wrapper.isConnected(), false);
    });

    it('disconnect() removes the server-side profile', async () => {
        const wrapper = new GeodeClientWrapper(makeOutputChannel());
        wrapper.attachServerInfoProvider(() => ({ host: '127.0.0.1', port, token: '' }));

        await wrapper.connect({ host: 'db.local', port: 3141 });
        assert.equal(Object.keys(state.profiles).length, 1);

        await wrapper.disconnect();
        assert.equal(wrapper.isConnected(), false);
        // Give the best-effort DELETE a tick to complete
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(Object.keys(state.profiles).length, 0);
    });

    it('ping() returns a latency number when connected', async () => {
        const wrapper = new GeodeClientWrapper(makeOutputChannel());
        wrapper.attachServerInfoProvider(() => ({ host: '127.0.0.1', port, token: '' }));
        await wrapper.connect({ host: 'db.local', port: 3141 });

        const latency = await wrapper.ping();
        assert.equal(typeof latency, 'number');
        assert.ok(latency >= 0);
    });

    it('sends Authorization header when token is set', async () => {
        let capturedAuth: string | undefined;
        server.close();

        // Rebuild a server that captures the auth header
        const authServer = http.createServer((req, res) => {
            let body = '';
            req.on('data', (c) => (body += c));
            req.on('end', () => {
                capturedAuth = req.headers.authorization;
                const url = req.url ?? '';
                if (req.method === 'POST' && url === '/api/v1/profiles') {
                    res.writeHead(201, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ id: 'p1' }));
                } else if (req.method === 'POST' && url === '/api/v1/query') {
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ columns: ['x'], rows: [{ x: 1 }], durationMs: 0 }));
                } else {
                    res.writeHead(204);
                    res.end();
                }
            });
        });

        const authPort: number = await new Promise((r) => {
            authServer.listen(0, '127.0.0.1', () => {
                r((authServer.address() as { port: number }).port);
            });
        });

        try {
            const wrapper = new GeodeClientWrapper(makeOutputChannel());
            wrapper.attachServerInfoProvider(() => ({ host: '127.0.0.1', port: authPort, token: 'my-secret-token' }));
            await wrapper.connect({ host: 'db.local', port: 3141 });
            assert.equal(capturedAuth, 'Bearer my-secret-token');
        } finally {
            authServer.close();
        }
    });
});
