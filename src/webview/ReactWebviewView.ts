import type * as vscode from 'vscode'
import { computePanelHtml } from './ReactWebviewPanel'
import { BridgeHost } from '../bridge/host'
import { decodeMessage, BridgeRequest, BridgeEvent } from '../bridge/messages'
import { ServerBootstrap, WebviewHtmlInputs } from './html'
import { getNonce } from '../utils/security'

// Re-export so callers have a single helper-naming convention for the
// sidebar context.
export const computeViewHtml = computePanelHtml

export interface ViewOpts {
    extensionRoot: string
    route: string
    serverInfo: ServerBootstrap
    register: (host: BridgeHost) => void
}

function themeKindString(k: number): WebviewHtmlInputs['themeKind'] {
    // Mirrors vscode.ColorThemeKind enum numeric values.
    // 1 Light, 2 Dark, 3 HighContrast, 4 HighContrastLight.
    if (k === 2) return 'dark'
    if (k === 3) return 'high-contrast'
    if (k === 4) return 'high-contrast-light'
    return 'light'
}

export class ReactWebviewViewProvider implements vscode.WebviewViewProvider {
    private currentView?: vscode.WebviewView

    constructor(private opts: ViewOpts) {}

    resolveWebviewView(view: vscode.WebviewView): void {
        this.currentView = view
        // Lazy-load vscode to keep this module loadable in unit tests
        // that do not have the VSCode extension host.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const vscodeApi: typeof vscode = require('vscode')
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscodeApi.Uri.joinPath(vscodeApi.Uri.file(this.opts.extensionRoot), 'resources', 'webview'),
                vscodeApi.Uri.joinPath(vscodeApi.Uri.file(this.opts.extensionRoot), 'out', 'webview'),
            ],
        }

        const host = new BridgeHost(view.webview)
        this.opts.register(host)

        const refresh = () => {
            const nonce = getNonce()
            const resolveAsset = (rel: string) =>
                view.webview.asWebviewUri(
                    vscodeApi.Uri.joinPath(vscodeApi.Uri.file(this.opts.extensionRoot), 'resources/webview', rel)
                ).toString()
            view.webview.html = computePanelHtml({
                extensionRoot: this.opts.extensionRoot,
                cspSource: view.webview.cspSource,
                nonce,
                route: this.opts.route,
                themeKind: themeKindString(vscodeApi.window.activeColorTheme.kind),
                serverInfo: this.opts.serverInfo,
                resolveAsset,
            })
        }
        refresh()

        view.webview.onDidReceiveMessage((raw: unknown) => {
            try {
                const msg = decodeMessage(raw)
                if (msg.kind === 'request') void host.handle(msg as BridgeRequest)
            } catch (err) {
                console.warn('[geode] malformed sidebar message:', err)
            }
        })
        vscodeApi.window.onDidChangeActiveColorTheme(refresh)
        view.onDidDispose(() => { this.currentView = undefined })
    }

    // Broadcasts an event envelope to the live sidebar webview. Returns
    // false when no view is currently resolved (e.g. user has not opened
    // the activity bar panel yet).
    broadcast(event: BridgeEvent): boolean {
        if (!this.currentView) return false
        void this.currentView.webview.postMessage(event)
        return true
    }
}
