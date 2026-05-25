import * as fs from 'fs'
import * as path from 'path'
import type * as vscode from 'vscode'
import { buildWebviewHtml, loadAdapterScript, ServerBootstrap, WebviewHtmlInputs } from './html'
import { BridgeHost } from '../bridge/host'
import { decodeMessage, BridgeRequest } from '../bridge/messages'
import { getNonce } from '../utils/security'

export interface PanelOpts {
    extensionRoot: string
    route: string
    title: string
    viewColumn?: vscode.ViewColumn
    serverInfo: ServerBootstrap
    register: (host: BridgeHost) => void
}

// Pure helper extracted so it is unit-testable without a real vscode
// Webview. Production code calls openReactWebviewPanel, which invokes
// this and hands the result to webview.html.
export function computePanelHtml(inputs: Omit<WebviewHtmlInputs, 'spaIndexHtml' | 'adapterScript'> & {
    extensionRoot: string
}): string {
    const spaIndex = fs.readFileSync(
        path.join(inputs.extensionRoot, 'resources/webview/index.html'),
        'utf8'
    )
    const adapter = loadAdapterScript(inputs.extensionRoot)
    return buildWebviewHtml({
        ...inputs,
        spaIndexHtml: spaIndex,
        adapterScript: adapter,
    })
}

function themeKindString(k: vscode.ColorThemeKind): 'light' | 'dark' | 'high-contrast' | 'high-contrast-light' {
    // vscode is required lazily by openReactWebviewPanel; these numeric values
    // match the ColorThemeKind enum: Light=1, Dark=2, HighContrast=3, HighContrastLight=4
    switch (k) {
        case 2 as vscode.ColorThemeKind: return 'dark'
        case 3 as vscode.ColorThemeKind: return 'high-contrast'
        case 4 as vscode.ColorThemeKind: return 'high-contrast-light'
        default: return 'light'
    }
}

export interface OpenedPanel {
    panel: vscode.WebviewPanel
    host: BridgeHost
    dispose: () => void
}

export function openReactWebviewPanel(opts: PanelOpts): OpenedPanel {
    // Lazy-require vscode so this module is loadable in unit-test environments
    // (mocha) that run outside the vscode extension host.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vs = require('vscode') as typeof vscode

    const panel = vs.window.createWebviewPanel(
        'geode.react',
        opts.title,
        opts.viewColumn ?? vs.ViewColumn.Two,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vs.Uri.joinPath(vs.Uri.file(opts.extensionRoot), 'resources', 'webview'),
                vs.Uri.joinPath(vs.Uri.file(opts.extensionRoot), 'out', 'webview'),
            ],
        }
    )

    const host = new BridgeHost(panel.webview)
    opts.register(host)

    const refresh = () => {
        const nonce = getNonce()
        const resolveAsset = (rel: string) => {
            const uri = vs.Uri.joinPath(
                vs.Uri.file(opts.extensionRoot),
                'resources/webview',
                rel
            )
            return panel.webview.asWebviewUri(uri).toString()
        }
        panel.webview.html = computePanelHtml({
            extensionRoot: opts.extensionRoot,
            cspSource: panel.webview.cspSource,
            nonce,
            route: opts.route,
            themeKind: themeKindString(vs.window.activeColorTheme.kind),
            serverInfo: opts.serverInfo,
            resolveAsset,
        })
    }
    refresh()

    const disposables: vscode.Disposable[] = []
    disposables.push(panel.webview.onDidReceiveMessage((raw: unknown) => {
        try {
            const msg = decodeMessage(raw)
            if (msg.kind === 'request') {
                void host.handle(msg as BridgeRequest)
            }
        } catch (err) {
            console.warn('[geode] malformed webview message:', err)
        }
    }))
    disposables.push(vs.window.onDidChangeActiveColorTheme(refresh))
    disposables.push(panel.onDidDispose(() => {
        for (const d of disposables) d.dispose()
    }))

    return {
        panel,
        host,
        dispose: () => panel.dispose(),
    }
}
