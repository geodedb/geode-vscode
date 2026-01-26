import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Base class for Geode webview panels.
 * Provides:
 * - VSCode theme integration
 * - Secure content security policy
 * - Message passing infrastructure
 * - Resource loading helpers
 */
export abstract class BaseWebviewPanel {
    public static readonly viewType: string = 'geode.webviewPanel';

    protected readonly _panel: vscode.WebviewPanel;
    protected readonly _extensionUri: vscode.Uri;
    protected _disposables: vscode.Disposable[] = [];

    protected constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set initial HTML content
        this._updateContent();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Listen for view state changes
        this._panel.onDidChangeViewState(
            () => {
                if (this._panel.visible) {
                    this._updateContent();
                }
            },
            null,
            this._disposables
        );

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            (message) => this._handleMessage(message),
            null,
            this._disposables
        );

        // Listen for theme changes
        vscode.window.onDidChangeActiveColorTheme(
            () => this._updateContent(),
            null,
            this._disposables
        );
    }

    /**
     * Update the webview content.
     */
    protected _updateContent() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    /**
     * Handle messages from the webview.
     * Subclasses should override this to handle their specific messages.
     */
    protected abstract _handleMessage(message: unknown): void;

    /**
     * Get the title for this panel.
     */
    protected abstract get title(): string;

    /**
     * Get the body content for this panel.
     * This will be inserted into the HTML template.
     */
    protected abstract getBodyContent(): string;

    /**
     * Get any additional scripts to include.
     * Returns an array of script URIs.
     */
    protected getScripts(): vscode.Uri[] {
        return [];
    }

    /**
     * Get any additional stylesheets to include.
     * Returns an array of stylesheet URIs.
     */
    protected getStylesheets(): vscode.Uri[] {
        return [];
    }

    /**
     * Send a message to the webview.
     */
    protected postMessage(message: unknown): Thenable<boolean> {
        return this._panel.webview.postMessage(message);
    }

    /**
     * Get a URI for a webview resource.
     */
    protected getWebviewUri(...pathSegments: string[]): vscode.Uri {
        return this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, ...pathSegments)
        );
    }

    /**
     * Generate the full HTML for the webview.
     */
    protected _getHtmlForWebview(): string {
        const webview = this._panel.webview;

        // Get URIs for shared resources
        const themeStyleUri = this.getWebviewUri('src', 'webviews', 'shared', 'theme.css');
        const componentsStyleUri = this.getWebviewUri('src', 'webviews', 'shared', 'components.css');

        // Get additional resources from subclass
        const additionalStyles = this.getStylesheets()
            .map(uri => `<link href="${uri}" rel="stylesheet">`)
            .join('\n        ');
        const additionalScripts = this.getScripts()
            .map(uri => `<script src="${uri}"></script>`)
            .join('\n        ');

        // Use a nonce to only allow specific scripts to run
        const nonce = this._getNonce();

        // Get current theme kind for CSS class
        const themeKind = vscode.window.activeColorTheme.kind;
        const themeClass = themeKind === vscode.ColorThemeKind.Dark ? 'vscode-dark'
            : themeKind === vscode.ColorThemeKind.HighContrast ? 'vscode-high-contrast'
            : themeKind === vscode.ColorThemeKind.HighContrastLight ? 'vscode-high-contrast-light'
            : 'vscode-light';

        return `<!DOCTYPE html>
<html lang="en" class="${themeClass}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource};">
    <title>${this.title}</title>
    <link href="${themeStyleUri}" rel="stylesheet">
    <link href="${componentsStyleUri}" rel="stylesheet">
    ${additionalStyles}
</head>
<body>
    <div class="geode-panel">
        ${this.getBodyContent()}
    </div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        // Expose postMessage helper
        window.postToExtension = function(type, data) {
            vscode.postMessage({ type, ...data });
        };

        // State management helpers
        window.getState = function() {
            return vscode.getState() || {};
        };

        window.setState = function(state) {
            vscode.setState(state);
        };
    </script>
    ${additionalScripts}
</body>
</html>`;
    }

    /**
     * Generate a random nonce for CSP.
     */
    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * Reveal the panel.
     */
    public reveal(column?: vscode.ViewColumn) {
        this._panel.reveal(column);
    }

    /**
     * Dispose of the panel.
     */
    public dispose() {
        // Clean up resources
        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

/**
 * Options for creating a webview panel.
 */
export interface WebviewPanelOptions {
    extensionUri: vscode.Uri;
    viewColumn?: vscode.ViewColumn;
    preserveFocus?: boolean;
}

/**
 * Helper function to create common webview options.
 */
export function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
    return {
        enableScripts: true,
        localResourceRoots: [
            vscode.Uri.joinPath(extensionUri, 'src', 'webviews'),
            vscode.Uri.joinPath(extensionUri, 'media'),
            vscode.Uri.joinPath(extensionUri, 'out')
        ]
    };
}
