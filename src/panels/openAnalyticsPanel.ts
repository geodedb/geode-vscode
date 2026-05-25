import type * as vscode from 'vscode'
import { openReactWebviewPanel, OpenedPanel } from '../webview/ReactWebviewPanel'
import { ServerBootstrap } from '../webview/html'
import { BridgeHost } from '../bridge/host'

interface PanelKey { id: string; route: string; title: string; viewColumn?: vscode.ViewColumn }
const panels = new Map<string, OpenedPanel>()

export function openAnalyticsPanel(opts: {
    key: PanelKey
    extensionRoot: string
    serverInfo: ServerBootstrap
    register: (host: BridgeHost) => void
}): OpenedPanel {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vscodeApi: typeof vscode = require('vscode')
    const existing = panels.get(opts.key.id)
    if (existing) {
        existing.panel.reveal(opts.key.viewColumn ?? vscodeApi.ViewColumn.Two, true)
        return existing
    }
    const opened = openReactWebviewPanel({
        extensionRoot: opts.extensionRoot,
        route: opts.key.route,
        title: opts.key.title,
        viewColumn: opts.key.viewColumn ?? vscodeApi.ViewColumn.Two,
        serverInfo: opts.serverInfo,
        register: opts.register,
    })
    panels.set(opts.key.id, opened)
    opened.panel.onDidDispose(() => panels.delete(opts.key.id))
    return opened
}
