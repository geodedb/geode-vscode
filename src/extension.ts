import * as vscode from 'vscode';
import * as path from 'path';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    ErrorAction,
    CloseAction
} from 'vscode-languageclient/node';
import { openAnalyticsPanel } from './panels/openAnalyticsPanel';
import { registerGraphOpsHandlers } from './bridge/handlers/graphOps';
import {
    ConnectionProfile,
} from './connections';
import { ReactWebviewViewProvider } from './webview/ReactWebviewView';
import {
    registerConnectionsHandlers,
    makePemFilePicker,
    makeVsCodeSecrets,
} from './sidebar/ConnectionsHandler';
import { HttpServerClient } from './server/ServerClient';
import { registerSchemaHandlers } from './sidebar/SchemaHandler';
import { registerHistoryHandlers } from './sidebar/HistoryHandler';
import { registerSavedQueriesHandlers } from './sidebar/SavedQueriesHandler';
import { migrateLegacyHistory } from './sidebar/historyMigration';
import { migrateLegacySavedQueries } from './sidebar/savedQueriesMigration';

// New enhanced components
import { EnhancedConnectionManager } from './client/EnhancedConnectionManager';
import { GeodeMCPServer, registerMCPServer } from './mcp/GeodeMCPServer';
import { secureId } from './utils/security';
import { GeodeServerProcess } from './server/GeodeServerProcess';
import { GeodeLspProcess } from './server/GeodeLspProcess';
import { createLspStream } from './lsp/wsTransport';
import { openReactWebviewPanel } from './webview/ReactWebviewPanel';
import { createHttpForwardHandler } from './bridge/handlers/httpForward';
import { healthPingHandler } from './bridge/handlers/health';
import { HttpQueryRunner } from './server/HttpQueryRunner';
import { createQueryExecuteHandler } from './bridge/handlers/queryExecute';
import { openResultsPanel, pushResults } from './panels/openResultsPanel';

let client: LanguageClient | undefined;
let serverProcess: GeodeServerProcess | undefined;
let lspProcess: GeodeLspProcess | undefined;
let serverInfo: { host: string; port: number; token: string } | undefined;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let connectionManager: EnhancedConnectionManager; // Using new manager
let sidebarProvider: ReactWebviewViewProvider | undefined;
let serverClient: HttpServerClient | undefined;
let _mcpServer: GeodeMCPServer; // MCP server for AI integration
let isConnected = false;
let extensionContext: vscode.ExtensionContext; // Store context for panel access
let queryRunner: HttpQueryRunner | undefined;

const gqlExtensions = new Set(['.gql', '.gcypher', '.pgql']);
const cypherExtensions = new Set(['.cypher']);

async function ensureServerStarted(context: vscode.ExtensionContext): Promise<{ host: string; port: number; token: string }> {
    if (serverInfo) return serverInfo;
    serverProcess = new GeodeServerProcess({
        extensionRoot: context.extensionUri.fsPath,
        onLog: (line) => outputChannel.appendLine(`[geode-ui] ${line}`),
    });
    const info = await serverProcess.start();
    serverInfo = { host: info.host, port: info.port, token: '' };
    return serverInfo;
}

export async function activate(context: vscode.ExtensionContext) {
    extensionContext = context; // Store for later use
    outputChannel = vscode.window.createOutputChannel('Geode GQL');
    context.subscriptions.push(outputChannel);

    outputChannel.appendLine('Activating Geode GQL extension with enhanced components...');

    // Initialize NEW enhanced connection manager
    connectionManager = new EnhancedConnectionManager(context, outputChannel);
    await connectionManager.initialize();
    context.subscriptions.push({ dispose: () => connectionManager.dispose() });

    outputChannel.appendLine('Enhanced connection manager initialized');

    // Initialize MCP server for AI assistant integration
    _mcpServer = registerMCPServer(context, connectionManager.getClient(), outputChannel);
    outputChannel.appendLine('MCP server registered');

    // Listen to connection changes
    connectionManager.onDidChangeActiveConnection(profile => {
        if (profile) {
            isConnected = true;
            updateStatusBar('connected', profile as any); // Type assertion for compatibility
        } else {
            isConnected = false;
            updateStatusBar('disconnected');
        }
        vscode.commands.executeCommand('setContext', 'geode.hasActiveConnection', isConnected);
    });

    // Ensure files with GQL-ish extensions don't get hijacked by SQL/Postgres modes
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(ensureGeodeLanguageMode)
    );
    vscode.workspace.textDocuments.forEach(ensureGeodeLanguageMode);

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.command = 'geode.connections.add';
    context.subscriptions.push(statusBarItem);
    updateStatusBar('disconnected');

    // Eagerly start the bundled server so the sidebar can boot with it.
    let startedServerInfo: { host: string; port: number; token: string } | undefined;
    try {
        startedServerInfo = await ensureServerStarted(context);
    } catch (err) {
        outputChannel.appendLine(`[geode] bundled server did not start: ${err}`);
    }

    if (startedServerInfo) {
        queryRunner = new HttpQueryRunner({
            serverInfo: startedServerInfo,
            activeConnectionId: () => connectionManager.getActiveProfile()?.id ?? null,
        });
        serverClient = new HttpServerClient(startedServerInfo);
    }

    // Register sidebar webview provider
    sidebarProvider = new ReactWebviewViewProvider({
        extensionRoot: context.extensionUri.fsPath,
        route: '/sidebar',
        serverInfo: startedServerInfo ?? { host: 'localhost', port: 0, token: '' },
        register: (host) => {
            if (startedServerInfo) {
                host.register('http.request', createHttpForwardHandler({ serverInfo: startedServerInfo }));
                host.register('health.ping', healthPingHandler({ serverInfo: startedServerInfo }));
            }
            registerConnectionsHandlers(host, {
                manager: connectionManager,
                secrets: makeVsCodeSecrets(context.secrets),
                pickFile: makePemFilePicker(),
            });
            if (serverClient) {
                registerSchemaHandlers(host, {
                    client: serverClient,
                    activeConnectionId: () => connectionManager.getActiveProfile()?.id ?? null,
                });
                registerHistoryHandlers(host, { client: serverClient });
                registerSavedQueriesHandlers(host, { client: serverClient });
            }
        },
    });
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('geodeSidebar', sidebarProvider, {
            webviewOptions: { retainContextWhenHidden: true },
        })
    );

    if (serverClient) {
        void (async () => {
            try {
                await migrateLegacyHistory({
                    globalState: context.globalState,
                    postEntry: (e) => (serverClient as HttpServerClient).request('/api/v1/history', 'POST', JSON.stringify(e)).then(() => undefined),
                });
            } catch (err) {
                outputChannel.appendLine(`history migration failed: ${err instanceof Error ? err.message : String(err)}`);
            }
            try {
                await migrateLegacySavedQueries({
                    globalState: context.globalState,
                    postBulk: (list) => (serverClient as HttpServerClient).request('/api/v1/saved/bulk', 'POST', JSON.stringify({ items: list })).then(() => undefined),
                });
            } catch (err) {
                outputChannel.appendLine(`saved-queries migration failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        })();
    }

    // Start LSP if enabled
    const config = vscode.workspace.getConfiguration('geode');
    if (config.get<boolean>('lsp.enabled', true)) {
        startLanguageServer(context);
    }

    // Register connection commands — focus the sidebar and broadcast nav events
    const focusSidebar = async () => {
        await vscode.commands.executeCommand('workbench.view.extension.geode-explorer');
        await vscode.commands.executeCommand('geodeSidebar.focus');
    };

    const navigate = (to: string) => {
        sidebarProvider?.broadcast({ kind: 'event', op: 'ui.navigate', payload: { to } });
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('geode.connections.add', async () => {
            await focusSidebar();
            navigate('/sidebar/connections/new');
        }),
        vscode.commands.registerCommand('geode.connections.edit', async (item?: { id: string }) => {
            await focusSidebar();
            navigate(`/sidebar/connections/${item?.id ?? ''}/edit`);
        }),
        vscode.commands.registerCommand('geode.connections.delete', async (item?: { id: string }) => {
            await focusSidebar();
            navigate(`/sidebar/connections/${item?.id ?? ''}/delete`);
        }),
        vscode.commands.registerCommand('geode.connections.connect', async (item?: { id: string }) => {
            if (item?.id) await connectionManager.connect(item.id);
            else await focusSidebar();
        }),
        vscode.commands.registerCommand('geode.connections.disconnect', () => connectionManager.disconnect()),
        vscode.commands.registerCommand('geode.connections.setDefault', async (item?: { id: string }) => {
            if (item?.id) await connectionManager.setDefaultProfile(item.id);
        }),
        vscode.commands.registerCommand('geode.connections.copyDsn', async (item?: { id: string }) => {
            if (!item?.id) return;
            const p = connectionManager.getProfile(item.id);
            if (p) await vscode.env.clipboard.writeText(connectionManager.buildDsn(p));
        }),
        vscode.commands.registerCommand('geode.connections.refresh', async () => {
            sidebarProvider?.broadcast({ kind: 'event', op: 'connections.changed', payload: {} });
        }),
    );

    // Register schema / history / saved-queries commands (re-routed to sidebar webview)
    const focus = async () => vscode.commands.executeCommand('workbench.view.extension.geode-explorer');

    context.subscriptions.push(
        vscode.commands.registerCommand('geode.refreshSchema', async () => {
            await focus(); navigate('/sidebar/schema?refresh=1');
        }),
        vscode.commands.registerCommand('geode.history.clear', async () => {
            await focus(); navigate('/sidebar/history?clear=1');
        }),
        vscode.commands.registerCommand('geode.history.refresh', async () => {
            await focus(); navigate('/sidebar/history');
        }),
        vscode.commands.registerCommand('geode.history.rerunQuery', async (item?: { query: string }) => {
            if (item?.query) {
                const editor = vscode.window.activeTextEditor;
                if (editor) await editor.edit((b) => b.insert(editor.selection.active, item.query));
            }
        }),
        vscode.commands.registerCommand('geode.history.copyQuery', async (item?: { query: string }) => {
            if (item?.query) await vscode.env.clipboard.writeText(item.query);
        }),
        vscode.commands.registerCommand('geode.history.insertQuery', async (item?: { query: string }) => {
            const editor = vscode.window.activeTextEditor;
            if (editor && item?.query) await editor.edit((b) => b.insert(editor.selection.active, item.query));
        }),
        vscode.commands.registerCommand('geode.history.removeEntry', async (item?: { id: string }) => {
            if (item?.id) await serverClient?.request(`/api/v1/history/${encodeURIComponent(item.id)}`, 'DELETE');
            navigate('/sidebar/history');
        }),
        vscode.commands.registerCommand('geode.savedQueries.save', async () => {
            await focus(); navigate('/sidebar/saved/new');
        }),
        vscode.commands.registerCommand('geode.savedQueries.refresh', async () => {
            await focus(); navigate('/sidebar/saved');
        }),
        vscode.commands.registerCommand('geode.savedQueries.open', async (item?: { id: string }) => {
            await focus(); navigate(`/sidebar/saved/${item?.id ?? ''}`);
        }),
        vscode.commands.registerCommand('geode.savedQueries.edit', async (item?: { id: string }) => {
            await focus(); navigate(`/sidebar/saved/${item?.id ?? ''}/edit`);
        }),
        vscode.commands.registerCommand('geode.savedQueries.delete', async (item?: { id: string }) => {
            if (item?.id) await serverClient?.request(`/api/v1/saved/${encodeURIComponent(item.id)}`, 'DELETE');
            navigate('/sidebar/saved');
        }),
        vscode.commands.registerCommand('geode.savedQueries.run', async (item?: { id: string; query: string }) => {
            if (item?.query) await executeQuery(item.query);
        }),
        vscode.commands.registerCommand('geode.savedQueries.copy', async (item?: { query: string }) => {
            if (item?.query) await vscode.env.clipboard.writeText(item.query);
        }),
        vscode.commands.registerCommand('geode.savedQueries.exportAll', async () => {
            const data = await serverClient?.request('/api/v1/saved/export', 'GET');
            const uri = await vscode.window.showSaveDialog({ filters: { JSON: ['json'] }, defaultUri: vscode.Uri.file('geode-saved-queries.json') });
            if (uri) {
                const fsp = await import('fs/promises');
                await fsp.writeFile(uri.fsPath, JSON.stringify(data, null, 2));
            }
        }),
        vscode.commands.registerCommand('geode.savedQueries.importAll', async () => {
            const uris = await vscode.window.showOpenDialog({ filters: { JSON: ['json'] }, canSelectMany: false });
            if (!uris || uris.length === 0) return;
            const fsp = await import('fs/promises');
            const text = await fsp.readFile(uris[0].fsPath, 'utf8');
            await serverClient?.request('/api/v1/saved/bulk', 'POST', text);
            navigate('/sidebar/saved');
        }),
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.runQuery', runQuery),
        vscode.commands.registerCommand('geode.runSelection', runSelection),
        vscode.commands.registerCommand('geode.formatDocument', formatDocument),
        vscode.commands.registerCommand('geode.showDocumentation', showDocumentation),
        vscode.commands.registerCommand('geode.explainQuery', explainQuery),
        vscode.commands.registerCommand('geode.restartLsp', () => restartLanguageServer(context)),
        vscode.commands.registerCommand('geode.runFile', runFile),
    );

    // Analytics panels (graph visualization)
    const registerSimplePanel = (cmd: string, key: string, route: string, title: string) =>
        vscode.commands.registerCommand(cmd, () => {
            if (!serverInfo) {
                vscode.window.showWarningMessage('Geode server not ready yet.')
                return
            }
            openAnalyticsPanel({
                key: { id: key, route, title, viewColumn: vscode.ViewColumn.Two },
                extensionRoot: context.extensionUri.fsPath,
                serverInfo: serverInfo,
                register: (host) => {
                    host.register('http.request', createHttpForwardHandler({ serverInfo: serverInfo! }))
                    if (queryRunner) {
                        host.register('query.execute', createQueryExecuteHandler({ runner: queryRunner }))
                    }
                },
            })
        })

    context.subscriptions.push(
        registerSimplePanel('geode.showPerformanceMetrics', 'metrics', '/dashboard', 'Geode Metrics'),
        registerSimplePanel('geode.showAnalyticsDashboard', 'dashboard', '/dashboard', 'Geode Analytics'),
        registerSimplePanel('geode.showQueryPlan', 'plan', '/query/plan', 'Query Plan'),
        registerSimplePanel('geode.showPathExplorer', 'paths', '/graph/paths', 'Path Explorer'),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('geode.showGraphVisualization', () => {
            if (!serverInfo) {
                vscode.window.showWarningMessage('Geode server not ready yet.')
                return
            }
            openAnalyticsPanel({
                key: { id: 'graph', route: '/graph', title: 'Geode Graph', viewColumn: vscode.ViewColumn.Two },
                extensionRoot: context.extensionUri.fsPath,
                serverInfo: serverInfo,
                register: (host) => {
                    host.register('http.request', createHttpForwardHandler({ serverInfo: serverInfo! }))
                    if (queryRunner) {
                        host.register('query.execute', createQueryExecuteHandler({ runner: queryRunner }))
                        registerGraphOpsHandlers(host, { runner: queryRunner })
                    }
                },
            })
        }),
        vscode.commands.registerCommand('geode.visualizeQuery', async () => {
            const editor = vscode.window.activeTextEditor
            if (!editor) {
                vscode.window.showWarningMessage('No active editor')
                return
            }
            const text = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection)
            if (!text.trim() || !serverInfo || !queryRunner) return
            const panel = openAnalyticsPanel({
                key: { id: 'graph', route: '/graph?from=editor', title: 'Geode Graph' },
                extensionRoot: context.extensionUri.fsPath,
                serverInfo: serverInfo,
                register: (host) => {
                    host.register('http.request', createHttpForwardHandler({ serverInfo: serverInfo! }))
                    host.register('query.execute', createQueryExecuteHandler({ runner: queryRunner! }))
                    registerGraphOpsHandlers(host, { runner: queryRunner! })
                },
            })
            try {
                const result = await queryRunner.run(text)
                const { extractGraph } = await import('./bridge/handlers/graphOps')
                const elements = extractGraph(result.rows as Array<Record<string, unknown>>)
                void panel.panel.webview.postMessage({
                    kind: 'event',
                    op: 'graph.load',
                    payload: { statement: text, ...elements, durationMs: result.durationMs },
                })
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                outputChannel.appendLine(`Graph visualization failed: ${msg}`)
                vscode.window.showErrorMessage(`Visualization failed: ${msg}`)
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('geode.showSpaShell', async () => {
            const info = await ensureServerStarted(context);
            openReactWebviewPanel({
                extensionRoot: context.extensionUri.fsPath,
                route: '/dashboard',
                title: 'Geode',
                serverInfo: info,
                register: (host) => {
                    host.register('http.request', createHttpForwardHandler({ serverInfo: info }));
                    host.register('health.ping', healthPingHandler({ serverInfo: info }));
                },
            });
        })
    );

    outputChannel.appendLine('Geode GQL extension activated successfully');
}

export function deactivate(): Thenable<void> | undefined {
    serverProcess?.stop();
    lspProcess?.stop();
    if (!client) {
        return undefined;
    }
    return client.stop();
}

function ensureGeodeLanguageMode(doc: vscode.TextDocument) {
    if (doc.languageId === 'gql' || doc.languageId === 'cypher') {
        return;
    }

    if (doc.uri.scheme !== 'file') {
        return;
    }

    const ext = path.extname(doc.fileName).toLowerCase();

    if (gqlExtensions.has(ext)) {
        void vscode.languages.setTextDocumentLanguage(doc, 'gql').then(() => {
            outputChannel.appendLine(`Switched language mode to Geode GQL for ${path.basename(doc.fileName)}`);
        }, () => {
            // Ignore language switch failures; VS Code may refuse if the document is mid-close.
        });
    } else if (cypherExtensions.has(ext)) {
        void vscode.languages.setTextDocumentLanguage(doc, 'cypher').then(() => {
            outputChannel.appendLine(`Switched language mode to Geode Cypher for ${path.basename(doc.fileName)}`);
        }, () => {
            // Ignore language switch failures; VS Code may refuse if the document is mid-close.
        });
    }
}

// ============================================================================
// Language Server
// ============================================================================

async function startLanguageServer(context: vscode.ExtensionContext): Promise<void> {
    // Boot the bundled graph-DB binary in LSP mode.
    const bundledCfg = vscode.workspace.getConfiguration('geode.bundledServer')
    const startupTimeoutMs = bundledCfg.get<number>('startupTimeoutMs', 10_000)

    lspProcess = new GeodeLspProcess({
        extensionRoot: context.extensionUri.fsPath,
        startupTimeoutMs,
        onLog: (line) => outputChannel.appendLine(`[geode-db] ${line}`),
    })
    let lspInfo
    try {
        lspInfo = await lspProcess.start()
    } catch (err) {
        outputChannel.appendLine(`LSP startup failed: ${err instanceof Error ? err.message : String(err)}`)
        return
    }
    outputChannel.appendLine(`Geode graph-DB LSP listening on 127.0.0.1:${lspInfo.port}`)

    // Restart the geode-ui server with --lsp-upstream now that we know
    // the port. If it is already running without LSP wiring, stop it.
    if (serverProcess) {
        serverProcess.stop()
        serverProcess = undefined
        serverInfo = undefined
    }
    serverProcess = new GeodeServerProcess({
        extensionRoot: context.extensionUri.fsPath,
        startupTimeoutMs,
        onLog: (line) => outputChannel.appendLine(`[geode-ui] ${line}`),
        lspUpstream: `127.0.0.1:${lspInfo.port}`,
    })
    // TODO: wire geode.bundledServer.logLevel to server args when supported
    let info
    try {
        info = await serverProcess.start()
    } catch (err) {
        outputChannel.appendLine(`Server restart for LSP failed: ${err instanceof Error ? err.message : String(err)}`)
        return
    }
    serverInfo = { host: info.host, port: info.port, token: '' }

    // Connect the LanguageClient to ws://<host>:<port>/ws/lsp.
    const url = `ws://${info.host}:${info.port}/ws/lsp`
    const serverOptions: ServerOptions = () => createLspStream({ url })
    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'gql' },
            { scheme: 'file', language: 'cypher' },
            { scheme: 'untitled', language: 'gql' },
            { scheme: 'untitled', language: 'cypher' },
        ],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{gql,gcypher,cypher,pgql}'),
        },
        outputChannel,
        traceOutputChannel: outputChannel,
        diagnosticCollectionName: 'geode-gql',
        initializationFailedHandler: (e) => {
            outputChannel.appendLine(`LSP init failed: ${e}`)
            return false
        },
        errorHandler: {
            error: (e, m, count) => {
                outputChannel.appendLine(`LSP error: ${e} - ${m} (count: ${count})`)
                return { action: ErrorAction.Continue }
            },
            closed: () => {
                outputChannel.appendLine('LSP closed')
                return { action: CloseAction.DoNotRestart }
            },
        },
    }
    client = new LanguageClient('geode-gql', 'Geode GQL Language Server', serverOptions, clientOptions)
    client.onDidChangeState((event) => {
        outputChannel.appendLine(`LSP state: ${event.oldState} -> ${event.newState}`)
    })
    await client.start()
    updateStatusBar('lsp-ready')
}

async function restartLanguageServer(context: vscode.ExtensionContext) {
    if (client) {
        await client.stop();
        client = undefined;
    }
    startLanguageServer(context);
    vscode.window.showInformationMessage('Geode Language Server restarted');
}

// ============================================================================
// Query Execution
// ============================================================================

async function runQuery() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const query = editor.document.getText();
    await executeQuery(query);
}

async function runSelection() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const selection = editor.selection;
    const query = editor.document.getText(selection);

    if (!query.trim()) {
        vscode.window.showWarningMessage('No text selected');
        return;
    }

    await executeQuery(query);
}

async function runFile(uri?: vscode.Uri) {
    let fileUri: vscode.Uri | undefined = uri;

    // If called from context menu, uri is provided
    // If called from command palette, use active editor
    if (!fileUri) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor or file selected');
            return;
        }
        fileUri = editor.document.uri;
    }

    try {
        const document = await vscode.workspace.openTextDocument(fileUri);
        const content = document.getText();

        if (!content.trim()) {
            vscode.window.showWarningMessage('File is empty');
            return;
        }

        outputChannel.appendLine(`\n--- Running File: ${path.basename(fileUri.fsPath)} ---`);

        // Split content into individual statements
        const statements = splitGqlStatements(content);

        if (statements.length === 0) {
            vscode.window.showWarningMessage('No valid statements found in file');
            return;
        }

        outputChannel.appendLine(`Found ${statements.length} statement(s)`);

        // Execute statements sequentially
        await executeMultipleStatements(statements);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to read file: ${error}`);
    }
}

/**
 * Split GQL content into individual statements
 * Handles: semicolons, line comments (--), block comments, and quoted strings
 */
function splitGqlStatements(content: string): string[] {
    const statements: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inLineComment = false;
    let inBlockComment = false;
    let i = 0;

    while (i < content.length) {
        const char = content[i];
        const next = content[i + 1];

        // Handle line comments
        if (!inSingleQuote && !inDoubleQuote && !inBlockComment && char === '-' && next === '-') {
            inLineComment = true;
            current += char;
            i++;
            continue;
        }

        if (inLineComment && char === '\n') {
            inLineComment = false;
            current += char;
            i++;
            continue;
        }

        // Handle block comments
        if (!inSingleQuote && !inDoubleQuote && !inLineComment && char === '/' && next === '*') {
            inBlockComment = true;
            current += char;
            i++;
            continue;
        }

        if (inBlockComment && char === '*' && next === '/') {
            inBlockComment = false;
            current += char + next;
            i += 2;
            continue;
        }

        // Handle quoted strings
        if (!inLineComment && !inBlockComment) {
            if (char === "'" && !inDoubleQuote) {
                // Check for escaped quote
                if (i > 0 && content[i - 1] !== '\\') {
                    inSingleQuote = !inSingleQuote;
                }
            } else if (char === '"' && !inSingleQuote) {
                if (i > 0 && content[i - 1] !== '\\') {
                    inDoubleQuote = !inDoubleQuote;
                }
            }
        }

        // Statement terminator
        if (char === ';' && !inSingleQuote && !inDoubleQuote && !inLineComment && !inBlockComment) {
            const stmt = current.trim();
            if (stmt && !isOnlyComments(stmt)) {
                statements.push(stmt);
            }
            current = '';
            i++;
            continue;
        }

        current += char;
        i++;
    }

    // Handle last statement (may not have trailing semicolon)
    const lastStmt = current.trim();
    if (lastStmt && !isOnlyComments(lastStmt)) {
        statements.push(lastStmt);
    }

    return statements;
}

/**
 * Check if content is only comments (no actual statements)
 */
function isOnlyComments(content: string): boolean {
    // Remove line comments
    let stripped = content.replace(/--[^\n]*/g, '');
    // Remove block comments
    stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '');
    // Check if anything remains
    return stripped.trim().length === 0;
}

/**
 * Execute multiple statements sequentially with progress
 */
async function executeMultipleStatements(statements: string[]): Promise<void> {
    const activeConnection = connectionManager.getActiveConnection();

    if (!activeConnection) {
        const result = await vscode.window.showWarningMessage(
            'No connection configured. Would you like to add one?',
            'Add Connection',
            'Cancel'
        );
        if (result === 'Add Connection') {
            await vscode.commands.executeCommand('geode.connections.add');
        }
        return;
    }

    if (!isConnected) {
        const result = await vscode.window.showWarningMessage(
            `Not connected to ${activeConnection.name}. Connect now?`,
            'Connect',
            'Cancel'
        );
        if (result === 'Connect') {
            const password = await connectionManager.getPassword(activeConnection.id);
            const success = await handleConnect(activeConnection, password);
            if (!success) {
                return;
            }
        } else {
            return;
        }
    }

    let successCount = 0;
    let errorCount = 0;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Executing GQL statements',
        cancellable: true
    }, async (progress, token) => {
        for (let i = 0; i < statements.length; i++) {
            if (token.isCancellationRequested) break;
            const stmt = statements[i];
            progress.report({ message: `${i + 1}/${statements.length}`, increment: 100 / statements.length });
            try {
                const result = await queryRunner!.run(stmt);
                successCount++;
                outputChannel.appendLine(`  -> ${result.rows.length} row(s) in ${result.durationMs} ms`);
            } catch (e) {
                errorCount++;
                outputChannel.appendLine(`  X ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    });

    outputChannel.appendLine(`\n--- Execution Complete: ${successCount} succeeded, ${errorCount} failed ---`);

    if (errorCount === 0) {
        vscode.window.showInformationMessage(`Executed ${successCount} statement(s) successfully`);
    } else {
        vscode.window.showWarningMessage(`Completed with ${errorCount} error(s). Check output for details.`);
    }

    outputChannel.show();
}

async function executeQuery(statement: string): Promise<void> {
    if (!queryRunner || !queryRunner.isConnected) {
        const result = await vscode.window.showWarningMessage(
            'No active connection. Open the Geode sidebar to connect.',
            'Open Sidebar'
        );
        if (result === 'Open Sidebar') {
            await vscode.commands.executeCommand('workbench.view.extension.geode-explorer');
        }
        return;
    }
    if (!serverInfo) return;
    const queryId = secureId('q');
    const panel = openResultsPanel({
        extensionRoot: extensionContext.extensionUri.fsPath,
        serverInfo: serverInfo,
        registerCommon: (host) => {
            host.register('http.request', createHttpForwardHandler({ serverInfo: serverInfo! }));
            host.register('query.execute', createQueryExecuteHandler({ runner: queryRunner! }));
        },
    });
    try {
        const result = await queryRunner.run(statement);
        pushResults(panel, queryId, statement, result);
        if (serverClient) {
            void serverClient.request('/api/v1/history', 'POST', JSON.stringify({
                query: statement,
                timestamp: Date.now(),
                duration: result.durationMs,
                rowCount: result.rows.length,
                connectionName: connectionManager.getActiveProfile()?.name,
                success: true,
            })).catch(() => undefined);
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputChannel.appendLine(`Error: ${msg}`);
        if (serverClient) {
            void serverClient.request('/api/v1/history', 'POST', JSON.stringify({
                query: statement,
                timestamp: Date.now(),
                connectionName: connectionManager.getActiveProfile()?.name,
                success: false,
                error: msg,
            })).catch(() => undefined);
        }
        vscode.window.showErrorMessage(`Query failed: ${msg}`);
    }
}

/**
 * Handle connecting to a Geode server
 */
async function handleConnect(profile: ConnectionProfile, _password?: string): Promise<boolean> {
    outputChannel.appendLine(`Connecting to ${profile.name} (${profile.host}:${profile.port})...`);
    updateStatusBar('connecting', profile);

    try {
        // Use the enhanced connection manager to connect
        await connectionManager.connect(profile.id);
        isConnected = true;
        updateStatusBar('connected', profile);
        await vscode.commands.executeCommand('setContext', 'geode.hasActiveConnection', true);
        vscode.window.showInformationMessage(`Connected to ${profile.name}`);
        return true;
    } catch (error: any) {
        isConnected = false;
        updateStatusBar('error', profile);
        vscode.window.showErrorMessage(`Failed to connect to ${profile.name}: ${error.message || error}`);
        return false;
    }
}

async function explainQuery() {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
        vscode.window.showWarningMessage('No active editor')
        return
    }
    const stmt = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection)
    if (!queryRunner) {
        vscode.window.showWarningMessage('Geode runner not ready yet.')
        return
    }
    try {
        const result = await queryRunner.run(`EXPLAIN ${stmt}`)
        outputChannel.appendLine(JSON.stringify(result.rows, null, 2))
        outputChannel.show()
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        outputChannel.appendLine(`EXPLAIN failed: ${msg}`)
        vscode.window.showErrorMessage(`EXPLAIN failed: ${msg}`)
    }
}

// ============================================================================
// Formatting
// ============================================================================

async function formatDocument() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    // Use LSP formatting if available
    if (client) {
        await vscode.commands.executeCommand('editor.action.formatDocument');
    } else {
        vscode.window.showWarningMessage('LSP not available for formatting');
    }
}

// ============================================================================
// Documentation
// ============================================================================

function showDocumentation() {
    // SECURITY: Issue #36 - Disable scripts and add CSP for documentation panel
    // Documentation is static content and doesn't need JavaScript
    const panel = vscode.window.createWebviewPanel(
        'geodeDocumentation',
        'GQL Documentation',
        vscode.ViewColumn.Two,
        { enableScripts: false }
    );

    panel.webview.html = getDocumentationHtml();
}

function getDocumentationHtml(): string {
    // SECURITY: Issue #36 - Add strict CSP for documentation panel
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:;">
    <title>GQL Documentation</title>
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; }
        h1, h2, h3 { color: var(--vscode-foreground); }
        code { background: var(--vscode-textCodeBlock-background); padding: 2px 6px; border-radius: 3px; }
        pre { background: var(--vscode-textCodeBlock-background); padding: 10px; overflow-x: auto; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid var(--vscode-panel-border); padding: 8px; text-align: left; }
        th { background: var(--vscode-editor-background); }
    </style>
</head>
<body>
    <h1>GQL Quick Reference</h1>

    <h2>Query Clauses</h2>
    <table>
        <tr><th>Clause</th><th>Description</th><th>Example</th></tr>
        <tr><td><code>MATCH</code></td><td>Find patterns in the graph</td><td><code>MATCH (n:Person)</code></td></tr>
        <tr><td><code>WHERE</code></td><td>Filter results</td><td><code>WHERE n.age > 25</code></td></tr>
        <tr><td><code>RETURN</code></td><td>Specify output</td><td><code>RETURN n.name</code></td></tr>
        <tr><td><code>CREATE</code></td><td>Create nodes/edges</td><td><code>CREATE (n:Person {name: 'Alice'})</code></td></tr>
        <tr><td><code>MERGE</code></td><td>Create if not exists</td><td><code>MERGE (n:Person {email: 'a@b.com'})</code></td></tr>
        <tr><td><code>DELETE</code></td><td>Delete nodes/edges</td><td><code>DELETE n</code></td></tr>
    </table>

    <h2>Aggregation Functions</h2>
    <table>
        <tr><th>Function</th><th>Description</th></tr>
        <tr><td><code>count()</code></td><td>Count items</td></tr>
        <tr><td><code>sum()</code></td><td>Sum numeric values</td></tr>
        <tr><td><code>avg()</code></td><td>Average of values</td></tr>
        <tr><td><code>min()</code> / <code>max()</code></td><td>Min/max value</td></tr>
        <tr><td><code>collect()</code></td><td>Collect into list</td></tr>
    </table>

    <h2>Vector Functions (Geode-specific)</h2>
    <table>
        <tr><th>Function</th><th>Description</th></tr>
        <tr><td><code>distance(v1, v2, metric)</code></td><td>Calculate distance (L2, cosine, etc.)</td></tr>
        <tr><td><code>similarity(v1, v2)</code></td><td>Cosine similarity</td></tr>
    </table>

    <h2>Keyboard Shortcuts</h2>
    <table>
        <tr><th>Action</th><th>Windows/Linux</th><th>macOS</th></tr>
        <tr><td>Run Query</td><td><code>Ctrl+Enter</code></td><td><code>Cmd+Enter</code></td></tr>
        <tr><td>Run Selection</td><td><code>Ctrl+Shift+Enter</code></td><td><code>Cmd+Shift+Enter</code></td></tr>
        <tr><td>Format Document</td><td><code>Shift+Alt+F</code></td><td><code>Shift+Option+F</code></td></tr>
    </table>

    <h2>Links</h2>
    <ul>
        <li><a href="https://gitlab.com/devnw/codepros/geode/geode">Geode Repository</a></li>
        <li><a href="https://www.iso.org/standard/76120.html">ISO/IEC 39075 GQL Standard</a></li>
    </ul>
</body>
</html>`;
}

// ============================================================================
// Status Bar
// ============================================================================

function updateStatusBar(
    status: 'disconnected' | 'connecting' | 'connected' | 'lsp-ready' | 'error',
    profile?: ConnectionProfile
) {
    const profileInfo = profile ? ` (${profile.host}:${profile.port})` : '';

    switch (status) {
        case 'disconnected':
            statusBarItem.text = '$(database) Geode';
            statusBarItem.tooltip = profile
                ? `Geode - ${profile.name}${profileInfo}\nClick to manage connections`
                : 'Geode GQL - Click to manage connections';
            statusBarItem.backgroundColor = undefined;
            statusBarItem.command = 'geode.connections.add';
            break;
        case 'connecting':
            statusBarItem.text = '$(sync~spin) Geode';
            statusBarItem.tooltip = profile
                ? `Connecting to ${profile.name}${profileInfo}...`
                : 'Connecting to Geode server...';
            statusBarItem.backgroundColor = undefined;
            break;
        case 'connected':
            statusBarItem.text = '$(database) Geode $(check)';
            statusBarItem.tooltip = profile
                ? `Connected to ${profile.name}${profileInfo}\nClick to disconnect`
                : 'Connected to Geode server';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
            statusBarItem.command = 'geode.connections.disconnect';
            break;
        case 'lsp-ready':
            statusBarItem.text = '$(database) Geode LSP';
            statusBarItem.tooltip = 'Geode Language Server active';
            statusBarItem.backgroundColor = undefined;
            break;
        case 'error':
            statusBarItem.text = '$(database) Geode $(error)';
            statusBarItem.tooltip = profile
                ? `Connection failed: ${profile.name}${profileInfo}\nClick to retry`
                : 'Connection failed - Click to retry';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            statusBarItem.command = 'geode.connections.add';
            break;
    }
    statusBarItem.show();
}
