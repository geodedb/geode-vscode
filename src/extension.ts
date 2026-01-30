import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
    ErrorAction,
    CloseAction,
    RevealOutputChannelOn
} from 'vscode-languageclient/node';
import { registerSchemaExplorer } from './views/SchemaExplorerProvider';
import { registerQueryPlanPanel } from './panels/QueryPlanPanel';
import { registerTimeSeriesPanel } from './panels/TimeSeriesPanel';
import { ResultsTablePanel, QueryResults } from './panels/ResultsTablePanel';
import { GraphViewPanel, GraphData, GraphNode, GraphEdge } from './panels/GraphViewPanel';
import { PerformanceMetricsPanel } from './panels/PerformanceMetricsPanel';
import {
    GraphVisualizationPanel,
    GraphElements,
    buildExpandQuery,
    buildRelatedQuery
} from './panels/GraphVisualizationPanel';
// Old connection manager - keeping for backward compatibility during transition
import {
    ConnectionManager as OldConnectionManager,
    ConnectionProfile,
    registerConnectionsView,
    ConnectionsTreeProvider
} from './connections';

// New enhanced components
import { GeodeClientWrapper } from './client/GeodeClientWrapper';
import { EnhancedConnectionManager } from './client/EnhancedConnectionManager';
import {
    EnhancedSchemaExplorerProvider,
    registerSchemaExplorerCommands
} from './views/EnhancedSchemaExplorerProvider';
import {
    QueryHistoryProvider,
    registerQueryHistoryCommands
} from './views/QueryHistoryProvider';
import {
    SavedQueriesProvider,
    registerSavedQueriesCommands
} from './views/SavedQueriesProvider';
import { GeodeMCPServer, registerMCPServer } from './mcp/GeodeMCPServer';

let client: LanguageClient | undefined;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let connectionManager: EnhancedConnectionManager; // Using new manager
let connectionsTreeProvider: ConnectionsTreeProvider;
let schemaExplorer: EnhancedSchemaExplorerProvider; // New schema explorer
let queryHistoryProvider: QueryHistoryProvider; // Query history tracking
let savedQueriesProvider: SavedQueriesProvider; // Saved queries management
let mcpServer: GeodeMCPServer; // MCP server for AI integration
let isConnected = false;
let extensionContext: vscode.ExtensionContext; // Store context for panel access

const gqlExtensions = new Set(['.gql', '.gcypher', '.pgql']);
const cypherExtensions = new Set(['.cypher']);

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

    // Initialize enhanced schema explorer
    schemaExplorer = new EnhancedSchemaExplorerProvider(
        connectionManager.getClient(),
        outputChannel
    );

    // Register schema explorer tree view
    const schemaTreeView = vscode.window.createTreeView('geodeSchemaExplorer', {
        treeDataProvider: schemaExplorer,
        showCollapseAll: true
    });
    context.subscriptions.push(schemaTreeView);

    // Register schema explorer commands
    registerSchemaExplorerCommands(context, schemaExplorer, connectionManager.getClient());

    outputChannel.appendLine('Enhanced schema explorer registered');

    // Initialize query history provider
    queryHistoryProvider = new QueryHistoryProvider(context);
    const historyTreeView = vscode.window.createTreeView('geodeQueryHistory', {
        treeDataProvider: queryHistoryProvider,
        showCollapseAll: false
    });
    context.subscriptions.push(historyTreeView);
    registerQueryHistoryCommands(context, queryHistoryProvider);
    outputChannel.appendLine('Query history provider registered');

    // Initialize saved queries provider
    savedQueriesProvider = new SavedQueriesProvider(context);
    const savedQueriesTreeView = vscode.window.createTreeView('geodeSavedQueries', {
        treeDataProvider: savedQueriesProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(savedQueriesTreeView);
    registerSavedQueriesCommands(context, savedQueriesProvider);
    outputChannel.appendLine('Saved queries provider registered');

    // Initialize MCP server for AI assistant integration
    mcpServer = registerMCPServer(context, connectionManager.getClient(), outputChannel);
    outputChannel.appendLine('MCP server registered');

    // Listen to connection changes and refresh schema
    connectionManager.onDidChangeActiveConnection(profile => {
        if (profile) {
            isConnected = true;
            updateStatusBar('connected', profile as any); // Type assertion for compatibility
            // Auto-refresh schema when connected
            schemaExplorer.refresh().catch(err => {
                outputChannel.appendLine(`Schema refresh failed: ${err}`);
            });
        } else {
            isConnected = false;
            updateStatusBar('disconnected');
            schemaExplorer.clear();
        }
        // Update context for menu visibility
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

    // Register connections view and commands (using compatibility layer)
    connectionsTreeProvider = registerConnectionsView(
        context,
        connectionManager as any as OldConnectionManager, // Type bridge for compatibility
        outputChannel,
        handleConnect,
        handleDisconnect
    );

    // Start LSP if enabled
    const config = vscode.workspace.getConfiguration('geode');
    if (config.get<boolean>('lsp.enabled', true)) {
        startLanguageServer(context);
    }

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.runQuery', runQuery),
        vscode.commands.registerCommand('geode.runSelection', runSelection),
        vscode.commands.registerCommand('geode.formatDocument', formatDocument),
        vscode.commands.registerCommand('geode.connectServer', connectServer),
        vscode.commands.registerCommand('geode.disconnectServer', disconnectServer),
        vscode.commands.registerCommand('geode.showDocumentation', showDocumentation),
        vscode.commands.registerCommand('geode.explainQuery', explainQuery),
        vscode.commands.registerCommand('geode.restartLsp', () => restartLanguageServer(context)),
        vscode.commands.registerCommand('geode.runFile', runFile),
        vscode.commands.registerCommand('geode.showPerformanceMetrics', () => {
            PerformanceMetricsPanel.createOrShow({
                extensionUri: context.extensionUri,
                viewColumn: vscode.ViewColumn.Two
            });
        }),
        vscode.commands.registerCommand('geode.showGraphVisualization', showGraphVisualization),
        vscode.commands.registerCommand('geode.visualizeQuery', visualizeQueryAsGraph)
    );

    // Auto-connect if configured
    if (config.get<boolean>('server.autoConnect', false)) {
        const defaultProfile = connectionManager.getDefaultProfile();
        if (defaultProfile) {
            try {
                await connectionManager.connect(defaultProfile.id);
            } catch (error) {
                outputChannel.appendLine(`Auto-connect failed: ${error}`);
            }
        }
    }

    // Register Schema Explorer TreeView (old implementation for backward compatibility)
    registerSchemaExplorer(context);

    // Register Query Plan Visualization Panel
    registerQueryPlanPanel(context);

    // Register Time Series Analytics Panel
    registerTimeSeriesPanel(context);

    outputChannel.appendLine('Geode GQL extension activated successfully');
}

export function deactivate(): Thenable<void> | undefined {
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

/**
 * SECURITY: Check if a binary path is from a trusted source.
 * Paths from user's machine settings or PATH are trusted.
 * Paths from workspace folders require workspace trust.
 */
function isBinaryPathTrusted(binaryPath: string): boolean {
    // If workspace is trusted, all paths are trusted
    if (vscode.workspace.isTrusted) {
        return true;
    }

    // Check if path is within workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of workspaceFolders) {
        if (binaryPath.startsWith(folder.uri.fsPath)) {
            // Path is within an untrusted workspace - not trusted
            return false;
        }
    }

    // Path is not in workspace (e.g., absolute system path or PATH lookup) - trusted
    return true;
}

/**
 * SECURITY: Validate that binary path doesn't contain suspicious patterns.
 */
function isValidBinaryPath(binaryPath: string): boolean {
    // Reject obviously malicious patterns
    const suspiciousPatterns = [
        /[;&|`$]/, // Shell metacharacters
        /\.\.[\/\\]/, // Path traversal
        /^(sh|bash|zsh|cmd|powershell)/i, // Direct shell execution
    ];

    // Allow geode binaries with expected extensions
    const basename = path.basename(binaryPath).toLowerCase();
    const validNames = ['geode', 'geode.exe', 'geode.sh', 'geode.bat'];
    if (validNames.includes(basename)) {
        // Check for shell metacharacters even in valid names
        for (const pattern of suspiciousPatterns.slice(0, 2)) {
            if (pattern.test(binaryPath)) {
                return false;
            }
        }
        return true;
    }

    // Reject script extensions that aren't geode
    if (/\.(sh|bat|cmd|ps1)$/i.test(binaryPath)) {
        return false;
    }

    for (const pattern of suspiciousPatterns) {
        if (pattern.test(binaryPath)) {
            return false;
        }
    }

    return true;
}

/**
 * Core LSP server startup logic.
 * SECURITY: Only call this after validating the binary path.
 */
function startLanguageServerWithPath(
    context: vscode.ExtensionContext,
    serverPath: string,
    serverArgs: string[]
): void {
    // Server options
    const serverOptions: ServerOptions = {
        command: serverPath,
        args: serverArgs,
        transport: TransportKind.stdio
    };

    // Get formatting configuration
    const formatConfig = vscode.workspace.getConfiguration('geode.format');

    // Client options
    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'gql' },
            { scheme: 'file', language: 'cypher' },
            { scheme: 'untitled', language: 'gql' },
            { scheme: 'untitled', language: 'cypher' }
        ],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{gql,gcypher,cypher,pgql}')
        },
        outputChannel: outputChannel,
        traceOutputChannel: outputChannel,
        diagnosticCollectionName: 'geode-gql',
        initializationOptions: {
            format: {
                foldPropertyMaps: formatConfig.get<boolean>('foldPropertyMaps', true),
                indentSize: formatConfig.get<number>('indentSize', 4),
                maxLineLength: formatConfig.get<number>('maxLineLength', 80),
                minPropertiesToFold: formatConfig.get<number>('minPropertiesToFold', 2)
            }
        },
        initializationFailedHandler: (error) => {
            outputChannel.appendLine(`LSP initialization failed: ${error}`);
            return false;
        },
        errorHandler: {
            error: (error, message, count) => {
                outputChannel.appendLine(`LSP error: ${error} - ${message} (count: ${count})`);
                return { action: ErrorAction.Continue };
            },
            closed: () => {
                outputChannel.appendLine('LSP connection closed');
                return { action: CloseAction.DoNotRestart };
            }
        }
    };

    outputChannel.appendLine(`Starting LSP server: ${serverPath} ${serverArgs.join(' ')}`);

    // Create and start client
    client = new LanguageClient(
        'geode-gql',
        'Geode GQL Language Server',
        serverOptions,
        clientOptions
    );

    // Set up trace logging for diagnostics
    client.onDidChangeState((event) => {
        outputChannel.appendLine(`LSP state changed: ${event.oldState} -> ${event.newState}`);
    });

    client.start().then(() => {
        outputChannel.appendLine('Language server started successfully');
        updateStatusBar('lsp-ready');
    }).catch((error) => {
        outputChannel.appendLine(`Failed to start language server: ${error}`);
        outputChannel.appendLine(`Server path was: ${serverPath}`);
        vscode.window.showWarningMessage(
            'Geode LSP failed to start. Make sure "geode" is in your PATH.',
            'Show Output'
        ).then(choice => {
            if (choice === 'Show Output') {
                outputChannel.show();
            }
        });
    });
}

async function startLanguageServer(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('geode.lsp');
    const serverPath = resolveGeodeBinary(config);
    const serverArgs = config.get<string[]>('args', ['lsp']);

    // SECURITY: Validate binary path
    if (!isValidBinaryPath(serverPath)) {
        outputChannel.appendLine(`SECURITY: Rejected suspicious binary path: ${serverPath}`);
        vscode.window.showErrorMessage(
            `Geode: Rejected suspicious binary path "${serverPath}". Only legitimate geode binaries are allowed.`
        );
        return;
    }

    // SECURITY: Check workspace trust for workspace-relative binaries
    if (!isBinaryPathTrusted(serverPath)) {
        outputChannel.appendLine(`SECURITY: Binary path "${serverPath}" is from untrusted workspace`);
        const choice = await vscode.window.showWarningMessage(
            `Geode: The binary "${path.basename(serverPath)}" is from an untrusted workspace. ` +
            `Running binaries from untrusted sources can be dangerous. ` +
            `You can trust this workspace via File > Preferences > Manage Workspace Trust.`,
            { modal: true },
            'Use System Binary Instead',
            'Cancel'
        );

        if (choice === 'Use System Binary Instead') {
            // Fall back to PATH lookup
            const pathBinary = findInPath('geode');
            if (pathBinary) {
                outputChannel.appendLine(`Falling back to system binary: ${pathBinary}`);
                startLanguageServerWithPath(context, pathBinary, serverArgs);
                return;
            } else {
                vscode.window.showErrorMessage('Geode binary not found in PATH. Install geode or trust this workspace.');
                return;
            }
        } else {
            // User cancelled or clicked Cancel
            outputChannel.appendLine('User cancelled LSP start due to untrusted workspace');
            return;
        }
    }

    // Path is trusted, start the server
    startLanguageServerWithPath(context, serverPath, serverArgs);
}

function resolveGeodeBinary(config: vscode.WorkspaceConfiguration): string {
    const configured = config.get<string>('path', 'geode');
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

    const candidates: string[] = [];
    const addCandidate = (candidate?: string) => {
        if (candidate && !candidates.includes(candidate)) {
            candidates.push(candidate);
        }
    };

    if (configured) {
        if (path.isAbsolute(configured)) {
            addCandidate(configured);
        } else {
            addCandidate(configured); // rely on PATH or workspace-relative lookup
            for (const folder of workspaceFolders) {
                addCandidate(path.join(folder.uri.fsPath, configured));
            }
        }
    }

    for (const folder of workspaceFolders) {
        addCandidate(path.join(folder.uri.fsPath, 'zig-out', 'bin', 'geode'));
        addCandidate(path.join(folder.uri.fsPath, 'dist', 'bin', 'geode'));
    }

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            outputChannel.appendLine(`Using Geode binary at ${candidate}`);
            return candidate;
        }
    }

    const pathBinary = findInPath(configured || 'geode');
    if (pathBinary) {
        outputChannel.appendLine(`Using Geode binary from PATH at ${pathBinary}`);
        return pathBinary;
    }

    outputChannel.appendLine(`Geode binary not found at configured path (${configured}); falling back to ${configured || 'geode'} and relying on PATH.`);
    return configured || 'geode';
}

function findInPath(binary: string): string | undefined {
    const searchTargets = process.platform === 'win32' && !binary.endsWith('.exe')
        ? [binary, `${binary}.exe`]
        : [binary];

    const parts = (process.env.PATH || '').split(path.delimiter);
    for (const dir of parts) {
        for (const target of searchTargets) {
            const candidate = path.join(dir, target);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    }
    return undefined;
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

    const password = await connectionManager.getPassword(activeConnection.id);
    let successCount = 0;
    let errorCount = 0;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Executing GQL statements',
        cancellable: true
    }, async (progress, token) => {
        for (let i = 0; i < statements.length; i++) {
            if (token.isCancellationRequested) {
                outputChannel.appendLine(`\n--- Cancelled at statement ${i + 1}/${statements.length} ---`);
                break;
            }

            const stmt = statements[i];
            progress.report({
                message: `${i + 1}/${statements.length}`,
                increment: 100 / statements.length
            });

            outputChannel.appendLine(`\n[${i + 1}/${statements.length}] ${stmt.substring(0, 50)}${stmt.length > 50 ? '...' : ''}`);

            try {
                const result = await runGeodeQueryWithProfile(stmt, activeConnection, password);
                successCount++;

                // Parse and display result briefly
                try {
                    const lines = result.trim().split('\n');
                    for (const line of lines) {
                        if (line.trim()) {
                            const json = JSON.parse(line);
                            if (json.result?.rows?.length > 0) {
                                outputChannel.appendLine(`  → ${json.result.rows.length} row(s)`);
                            } else if (json.status_class === '00000') {
                                outputChannel.appendLine(`  → OK`);
                            }
                        }
                    }
                } catch {
                    // Not JSON, show raw
                    if (result.trim()) {
                        outputChannel.appendLine(`  → ${result.trim().substring(0, 100)}`);
                    }
                }
            } catch (error) {
                errorCount++;
                outputChannel.appendLine(`  ✗ Error: ${error}`);
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

async function executeQuery(query: string) {
    const client = connectionManager.getClient();

    if (!client.isConnected()) {
        // Get existing connection profiles
        const profiles = connectionManager.getProfiles();

        if (profiles.length === 0) {
            // No existing connections, prompt to add one
            const result = await vscode.window.showWarningMessage(
                'No connections configured. Would you like to add one?',
                'Add Connection',
                'Cancel'
            );
            if (result === 'Add Connection') {
                await vscode.commands.executeCommand('geode.connections.add');
            }
            return;
        }

        // Show existing connections to choose from
        const items = [
            ...profiles.map(p => ({
                label: p.name,
                description: `${p.host}:${p.port}`,
                detail: p.isDefault ? '$(star) Default' : undefined,
                profile: p
            })),
            {
                label: '$(add) Add New Connection...',
                description: 'Create a new connection profile',
                profile: null as any
            }
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a connection or add a new one',
            title: 'Connect to Geode Server'
        });

        if (!selected) {
            return; // Cancelled
        }

        if (!selected.profile) {
            // Add new connection
            await vscode.commands.executeCommand('geode.connections.add');
            return;
        }

        // Connect to the selected profile
        try {
            await connectionManager.connect(selected.profile.id);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to connect: ${error.message}`);
            return;
        }
    }

    const activeProfile = connectionManager.getActiveProfile();
    outputChannel.appendLine(`\n--- Executing Query on ${activeProfile?.name || 'Geode'} ---`);
    outputChannel.appendLine(query);
    outputChannel.appendLine('---');

    try {
        const startTime = Date.now();
        const result = await client.query(query);
        const duration = Date.now() - startTime;

        outputChannel.appendLine(`Query completed in ${duration}ms`);

        // Convert result to displayable format
        const rows = await result.toObjects();
        const columns = result.columnNames || (rows.length > 0 ? Object.keys(rows[0]) : []);

        outputChannel.appendLine(`Returned ${rows.length} rows`);

        // Prepare results for table panel
        const queryResults: QueryResults = {
            columns: columns,
            rows: rows,
            executionTime: duration,
            rowCount: rows.length
        };

        // Show results in table panel
        const extensionUri = extensionContext.extensionUri;
        const tablePanel = ResultsTablePanel.createOrShow({
            extensionUri,
            viewColumn: vscode.ViewColumn.Two,
            preserveFocus: true
        });
        tablePanel.setResults(queryResults, query);

        // Check if result contains graph data and show graph view
        const graphData = extractGraphData(rows);
        if (graphData && (graphData.nodes.length > 0 || graphData.edges.length > 0)) {
            const graphPanel = GraphViewPanel.createOrShow({
                extensionUri,
                viewColumn: vscode.ViewColumn.Three,
                preserveFocus: true
            });
            graphPanel.setGraphData(graphData, query);
        }

        // Add to query history
        queryHistoryProvider.addEntry({
            query: query,
            duration: duration,
            rowCount: rows.length,
            connectionName: activeProfile?.name,
            success: true
        });

        vscode.window.showInformationMessage(
            `Query returned ${rows.length} rows in ${duration}ms`
        );
    } catch (error: any) {
        outputChannel.appendLine(`Error: ${error.message || error}`);
        outputChannel.appendLine(error.stack || '');

        // Add failed query to history
        queryHistoryProvider.addEntry({
            query: query,
            connectionName: activeProfile?.name,
            success: false,
            error: error.message || String(error)
        });

        vscode.window.showErrorMessage(
            `Query failed: ${error.message || error}`,
            'Show Output'
        ).then(action => {
            if (action === 'Show Output') {
                outputChannel.show();
            }
        });
    }
}

/**
 * Extract graph data (nodes and edges) from query result rows
 */
function extractGraphData(rows: any[]): GraphData | null {
    const nodes: Map<string | number, GraphNode> = new Map();
    const edges: GraphEdge[] = [];

    for (const row of rows) {
        for (const key of Object.keys(row)) {
            const value = row[key];
            if (!value || typeof value !== 'object') {
                continue;
            }

            // Check if it's a node (has _labels or labels property)
            if (value._labels || value.labels || value._id !== undefined) {
                const nodeId = value._id ?? value.id ?? `node-${nodes.size}`;
                if (!nodes.has(nodeId)) {
                    nodes.set(nodeId, {
                        id: nodeId,
                        labels: value._labels || value.labels || [],
                        properties: value.properties || value
                    });
                }
            }

            // Check if it's a relationship/edge (has _type or type and _start/_end)
            if ((value._type || value.type) && (value._start !== undefined || value._end !== undefined || value.source !== undefined || value.target !== undefined)) {
                const edgeId = value._id ?? value.id ?? `edge-${edges.length}`;
                edges.push({
                    id: edgeId,
                    source: value._start ?? value.source ?? value.startNodeId,
                    target: value._end ?? value.target ?? value.endNodeId,
                    type: value._type || value.type,
                    properties: value.properties || value
                });
            }
        }
    }

    if (nodes.size === 0 && edges.length === 0) {
        return null;
    }

    return {
        nodes: Array.from(nodes.values()),
        edges: edges
    };
}

function runGeodeQuery(query: string, host: string, port: number, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const config = vscode.workspace.getConfiguration('geode');
        const insecure = config.get<boolean>('server.insecure', false);
        const geodeCmd = resolveGeodeBinary(vscode.workspace.getConfiguration('geode.lsp'));
        const args = ['query', '--server', `${host}:${port}`, '--format', 'json'];

        if (insecure) {
            args.push('--insecure');
        }

        args.push(query);

        const process = cp.spawn(geodeCmd, args, {
            timeout: timeout
        });

        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        process.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(stderr || `Process exited with code ${code}`);
            }
        });

        process.on('error', (err) => {
            reject(err.message);
        });
    });
}

/**
 * Run a query using a connection profile
 */
function runGeodeQueryWithProfile(
    query: string,
    profile: ConnectionProfile,
    password?: string
): Promise<string> {
    return new Promise((resolve, reject) => {
        const geodeCmd = resolveGeodeBinary(vscode.workspace.getConfiguration('geode.lsp'));
        const args = ['query', '--format', 'json'];

        // Add connection arguments (without password - password is passed via env var)
        args.push(...connectionManager.buildConnectionArgsWithPassword(profile));

        // Use stdin for query to avoid issues with queries starting with '--' (comments)
        // The geode CLI accepts '-' to read query from stdin
        args.push('-');

        outputChannel.appendLine(`Executing: ${geodeCmd} ${args.join(' ')}`);

        // SECURITY: Pass password via environment variable instead of CLI args
        // to prevent exposure in process listings (ps aux)
        const spawnEnv = connectionManager.buildPasswordEnvironment(password);

        const childProcess = cp.spawn(geodeCmd, args, {
            timeout: profile.queryTimeout,
            env: spawnEnv
        });

        let stdout = '';
        let stderr = '';

        childProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        childProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        childProcess.on('close', (code) => {
            // Log stderr for debugging (contains debug output from CLI)
            if (stderr) {
                outputChannel.appendLine(`CLI stderr: ${stderr}`);
            }

            if (code === 0) {
                resolve(stdout);
            } else {
                // Extract error message from stderr, filtering debug lines
                const errorLines = stderr.split('\n')
                    .filter(line => !line.startsWith('debug('))
                    .join('\n').trim();
                reject(errorLines || `Process exited with code ${code}`);
            }
        });

        childProcess.on('error', (err) => {
            reject(err.message);
        });

        // Write query to stdin and close it
        childProcess.stdin.write(query);
        childProcess.stdin.end();
    });
}

/**
 * Handle connecting to a Geode server
 */
async function handleConnect(profile: ConnectionProfile, password?: string): Promise<boolean> {
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

/**
 * Handle disconnecting from the current server
 */
async function handleDisconnect(): Promise<void> {
    await connectionManager.disconnect();
    isConnected = false;
    updateStatusBar('disconnected');
    vscode.commands.executeCommand('setContext', 'geode.hasActiveConnection', false);
    vscode.window.showInformationMessage('Disconnected from Geode server');
}

function showQueryResults(result: string) {
    const config = vscode.workspace.getConfiguration('geode');
    const maxResults = config.get<number>('query.maxResults', 1000);

    outputChannel.appendLine('Results:');
    outputChannel.appendLine(result);
    outputChannel.show();

    // Also show in a webview panel for better visualization
    try {
        const data = JSON.parse(result);
        if (Array.isArray(data) && data.length > 0) {
            vscode.window.showInformationMessage(
                `Query returned ${data.length} result(s). See Output panel for details.`
            );
        }
    } catch {
        // Not JSON, just show in output
    }
}

async function explainQuery() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const selection = editor.selection;
    const query = selection.isEmpty
        ? editor.document.getText()
        : editor.document.getText(selection);

    const config = vscode.workspace.getConfiguration('geode');
    const host = config.get<string>('server.host', 'localhost');
    const port = config.get<number>('server.port', 3141);

    outputChannel.appendLine(`\n--- Query Plan ---`);
    outputChannel.appendLine(query);
    outputChannel.appendLine('---');

    try {
        const result = await runGeodeQuery(`EXPLAIN ${query}`, host, port, 30000);
        outputChannel.appendLine(result);
        outputChannel.show();
    } catch (error) {
        outputChannel.appendLine(`Error: ${error}`);
        vscode.window.showErrorMessage(`EXPLAIN failed: ${error}`);
    }
}

// ============================================================================
// Server Connection
// ============================================================================

async function connectServer() {
    const config = vscode.workspace.getConfiguration('geode');
    const host = config.get<string>('server.host', 'localhost');
    const port = config.get<number>('server.port', 3141);

    outputChannel.appendLine(`Connecting to ${host}:${port}...`);
    updateStatusBar('connecting');

    try {
        // Test connection with a simple query
        await runGeodeQuery('RETURN 1', host, port, 5000);
        isConnected = true;
        updateStatusBar('connected');
        vscode.window.showInformationMessage(`Connected to Geode server at ${host}:${port}`);
    } catch (error) {
        isConnected = false;
        updateStatusBar('disconnected');
        vscode.window.showErrorMessage(`Failed to connect: ${error}`);
    }
}

function disconnectServer() {
    isConnected = false;
    updateStatusBar('disconnected');
    vscode.window.showInformationMessage('Disconnected from Geode server');
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
    const panel = vscode.window.createWebviewPanel(
        'geodeDocumentation',
        'GQL Documentation',
        vscode.ViewColumn.Two,
        { enableScripts: true }
    );

    panel.webview.html = getDocumentationHtml();
}

function getDocumentationHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
        <li><a href="https://github.com/geode-db/geode">Geode GitHub Repository</a></li>
        <li><a href="https://www.iso.org/standard/76120.html">ISO/IEC 39075 GQL Standard</a></li>
    </ul>
</body>
</html>`;
}

// ============================================================================
// Status Bar
// ============================================================================

// ============================================================================
// Graph Visualization
// ============================================================================

/**
 * Show the graph visualization panel
 */
function showGraphVisualization(): GraphVisualizationPanel {
    const panel = GraphVisualizationPanel.createOrShow({
        extensionUri: extensionContext.extensionUri,
        viewColumn: vscode.ViewColumn.Two
    });

    panel.setOutputChannel(outputChannel);

    // Set up expand callback to query neighbors
    panel.setExpandCallback(async (nodeId: string, labels: string[], depth: number): Promise<GraphElements | null> => {
        const client = connectionManager.getClient();
        if (!client.isConnected()) {
            vscode.window.showWarningMessage('Not connected to database');
            return null;
        }

        try {
            const query = buildExpandQuery(nodeId, labels, depth);
            outputChannel.appendLine(`[GraphViz] Expanding node ${nodeId}: ${query}`);

            const result = await client.query(query);
            const rows = await result.toObjects();

            // Convert rows to graph elements
            return extractGraphElements(rows);
        } catch (error: any) {
            outputChannel.appendLine(`[GraphViz] Expand error: ${error.message}`);
            return null;
        }
    });

    // Set up query related callback
    panel.setQueryRelatedCallback(async (nodeId: string, relationshipType?: string): Promise<GraphElements | null> => {
        const client = connectionManager.getClient();
        if (!client.isConnected()) {
            vscode.window.showWarningMessage('Not connected to database');
            return null;
        }

        try {
            const query = buildRelatedQuery(nodeId, relationshipType);
            outputChannel.appendLine(`[GraphViz] Querying related for ${nodeId}: ${query}`);

            const result = await client.query(query);
            const rows = await result.toObjects();

            return extractGraphElements(rows);
        } catch (error: any) {
            outputChannel.appendLine(`[GraphViz] Query related error: ${error.message}`);
            return null;
        }
    });

    return panel;
}

/**
 * Execute the current query and show results as graph visualization
 */
async function visualizeQueryAsGraph(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const selection = editor.selection;
    const query = selection.isEmpty
        ? editor.document.getText()
        : editor.document.getText(selection);

    if (!query.trim()) {
        vscode.window.showWarningMessage('No query to visualize');
        return;
    }

    const client = connectionManager.getClient();

    if (!client.isConnected()) {
        // Try to connect first
        const profiles = connectionManager.getProfiles();
        if (profiles.length === 0) {
            vscode.window.showWarningMessage('No connections configured. Add a connection first.');
            return;
        }

        const items = profiles.map(p => ({
            label: p.name,
            description: `${p.host}:${p.port}`,
            profile: p
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a connection to visualize graph data'
        });

        if (!selected) {
            return;
        }

        try {
            await connectionManager.connect(selected.profile.id);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to connect: ${error.message}`);
            return;
        }
    }

    outputChannel.appendLine(`\n--- Visualizing Query as Graph ---`);
    outputChannel.appendLine(query);

    try {
        const startTime = Date.now();
        const result = await client.query(query);
        const duration = Date.now() - startTime;
        const rows = await result.toObjects();

        outputChannel.appendLine(`Query completed in ${duration}ms, ${rows.length} rows`);

        // Extract graph elements
        const elements = extractGraphElements(rows);

        if (elements.nodes.length === 0 && elements.edges.length === 0) {
            vscode.window.showInformationMessage(
                'Query returned no graph data (nodes or relationships). Results shown in table view.',
                'Show Table'
            ).then(action => {
                if (action === 'Show Table') {
                    const queryResults: QueryResults = {
                        columns: result.columnNames || (rows.length > 0 ? Object.keys(rows[0]) : []),
                        rows: rows,
                        executionTime: duration,
                        rowCount: rows.length
                    };
                    const tablePanel = ResultsTablePanel.createOrShow({
                        extensionUri: extensionContext.extensionUri,
                        viewColumn: vscode.ViewColumn.Two
                    });
                    tablePanel.setResults(queryResults, query);
                }
            });
            return;
        }

        // Show graph visualization
        const graphPanel = showGraphVisualization();
        graphPanel.loadElements({
            nodes: elements.nodes.map(n => ({ data: n })),
            edges: elements.edges.map(e => ({ data: e }))
        }, query);

        // Add to query history
        queryHistoryProvider.addEntry({
            query: query,
            duration: duration,
            rowCount: rows.length,
            connectionName: connectionManager.getActiveProfile()?.name,
            success: true
        });

        vscode.window.showInformationMessage(
            `Graph: ${elements.nodes.length} nodes, ${elements.edges.length} edges (${duration}ms)`
        );

    } catch (error: any) {
        outputChannel.appendLine(`Visualization error: ${error.message}`);
        vscode.window.showErrorMessage(`Visualization failed: ${error.message}`);
    }
}

/**
 * Extract graph elements from query result rows
 */
function extractGraphElements(rows: any[]): { nodes: any[]; edges: any[] } {
    const nodes: Map<string, any> = new Map();
    const edges: any[] = [];

    for (const row of rows) {
        for (const key of Object.keys(row)) {
            const value = row[key];
            if (!value || typeof value !== 'object') {
                continue;
            }

            // Handle arrays (e.g., paths with multiple relationships)
            if (Array.isArray(value)) {
                for (const item of value) {
                    processGraphItem(item, nodes, edges);
                }
            } else {
                processGraphItem(value, nodes, edges);
            }
        }
    }

    return {
        nodes: Array.from(nodes.values()),
        edges: edges
    };
}

/**
 * Process a single item that might be a node or edge
 */
function processGraphItem(value: any, nodes: Map<string, any>, edges: any[]): void {
    if (!value || typeof value !== 'object') {
        return;
    }

    // Check if it's a node (has _labels or labels property)
    if (value._labels || value.labels || (value._id !== undefined && value._start === undefined)) {
        const nodeId = String(value._id ?? value.id ?? `node-${nodes.size}`);
        if (!nodes.has(nodeId)) {
            nodes.set(nodeId, {
                id: nodeId,
                labels: value._labels || value.labels || [],
                properties: value.properties || value
            });
        }
    }

    // Check if it's a relationship/edge (has _type or type and _start/_end)
    if ((value._type || value.type) &&
        (value._start !== undefined || value._end !== undefined ||
         value.source !== undefined || value.target !== undefined)) {
        const edgeId = String(value._id ?? value.id ?? `edge-${edges.length}`);
        edges.push({
            id: edgeId,
            source: String(value._start ?? value.source ?? value.startNodeId),
            target: String(value._end ?? value.target ?? value.endNodeId),
            type: value._type || value.type,
            properties: value.properties || value
        });
    }
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
