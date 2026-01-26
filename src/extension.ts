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
    CloseAction
} from 'vscode-languageclient/node';
import { registerSchemaExplorer } from './views/SchemaExplorerProvider';
import { registerQueryPlanPanel } from './panels/QueryPlanPanel';
import { registerTimeSeriesPanel } from './panels/TimeSeriesPanel';
import {
    ConnectionManager,
    ConnectionProfile,
    registerConnectionsView,
    ConnectionsTreeProvider
} from './connections';

let client: LanguageClient | undefined;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let connectionManager: ConnectionManager;
let connectionsTreeProvider: ConnectionsTreeProvider;
let isConnected = false;

const gqlExtensions = new Set(['.gql', '.gcypher', '.pgql']);
const cypherExtensions = new Set(['.cypher']);

export async function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Geode GQL');
    context.subscriptions.push(outputChannel);

    // Initialize connection manager
    connectionManager = new ConnectionManager(context, outputChannel);
    await connectionManager.initialize();
    context.subscriptions.push({ dispose: () => connectionManager.dispose() });

    // Ensure files with GQL-ish extensions don't get hijacked by SQL/Postgres modes
    // and that the language server activates even when VS Code guesses wrong.
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

    // Register connections view and commands
    connectionsTreeProvider = registerConnectionsView(
        context,
        connectionManager,
        outputChannel,
        handleConnect,
        handleDisconnect
    );

    // Update status bar when active connection changes
    connectionManager.onDidChangeActiveConnection((profile) => {
        if (profile && isConnected) {
            updateStatusBar('connected', profile);
        } else if (profile) {
            updateStatusBar('disconnected', profile);
        } else {
            updateStatusBar('disconnected');
        }
        // Update context for menu visibility
        vscode.commands.executeCommand('setContext', 'geode.hasActiveConnection', isConnected);
    });

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
        vscode.commands.registerCommand('geode.runFile', runFile)
    );

    // Auto-connect if configured
    if (config.get<boolean>('server.autoConnect', false)) {
        const defaultConn = connectionManager.getDefaultConnection();
        if (defaultConn) {
            const password = await connectionManager.getPassword(defaultConn.id);
            await handleConnect(defaultConn, password);
        }
    }

    // Register Schema Explorer TreeView (#76)
    registerSchemaExplorer(context);

    // Register Query Plan Visualization Panel (#75)
    registerQueryPlanPanel(context);

    // Register Time Series Analytics Panel (#74)
    registerTimeSeriesPanel(context);

    outputChannel.appendLine('Geode GQL extension activated');
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

function startLanguageServer(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('geode.lsp');
    const serverPath = resolveGeodeBinary(config);
    const serverArgs = config.get<string[]>('args', ['lsp']);

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
            return false;  // Don't try to restart
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
    // Get active connection or fall back to settings
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

    outputChannel.appendLine(`\n--- Executing Query on ${activeConnection.name} ---`);
    outputChannel.appendLine(query);
    outputChannel.appendLine('---');

    try {
        const password = await connectionManager.getPassword(activeConnection.id);
        const result = await runGeodeQueryWithProfile(query, activeConnection, password);
        showQueryResults(result);
    } catch (error) {
        outputChannel.appendLine(`Error: ${error}`);
        vscode.window.showErrorMessage(`Query failed: ${error}`);
    }
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

        // Add connection arguments including password
        args.push(...connectionManager.buildConnectionArgsWithPassword(profile, password));

        // Use stdin for query to avoid issues with queries starting with '--' (comments)
        // The geode CLI accepts '-' to read query from stdin
        args.push('-');

        outputChannel.appendLine(`Executing: ${geodeCmd} ${args.map(a => a.startsWith('-P') ? '-P ***' : a).join(' ')}`);

        const childProcess = cp.spawn(geodeCmd, args, {
            timeout: profile.queryTimeout
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
        // Test connection with a simple query
        await runGeodeQueryWithProfile('RETURN 1', profile, password);
        isConnected = true;
        updateStatusBar('connected', profile);
        await vscode.commands.executeCommand('setContext', 'geode.hasActiveConnection', true);
        vscode.window.showInformationMessage(`Connected to ${profile.name}`);
        return true;
    } catch (error) {
        isConnected = false;
        updateStatusBar('error', profile);
        vscode.window.showErrorMessage(`Failed to connect to ${profile.name}: ${error}`);
        return false;
    }
}

/**
 * Handle disconnecting from the current server
 */
function handleDisconnect(): void {
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
