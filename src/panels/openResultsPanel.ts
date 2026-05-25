import type * as vscode from 'vscode'
import { openReactWebviewPanel, OpenedPanel } from '../webview/ReactWebviewPanel'
import { ServerBootstrap } from '../webview/html'
import { BridgeHost } from '../bridge/host'
import { BridgeEvent } from '../bridge/messages'
import { QueryResult } from '../bridge/handlers/queryExecute'

let currentPanel: OpenedPanel | undefined

export function openResultsPanel(opts: {
    extensionRoot: string
    serverInfo: ServerBootstrap
    registerCommon: (host: BridgeHost) => void
}): OpenedPanel {
    if (currentPanel) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const vscodeApi: typeof vscode = require('vscode')
        currentPanel.panel.reveal(vscodeApi.ViewColumn.Two, true)
        return currentPanel
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vscodeApi: typeof vscode = require('vscode')
    currentPanel = openReactWebviewPanel({
        extensionRoot: opts.extensionRoot,
        route: '/query/results',
        title: 'Geode Results',
        viewColumn: vscodeApi.ViewColumn.Two,
        serverInfo: opts.serverInfo,
        register: opts.registerCommon,
    })
    currentPanel.panel.onDidDispose(() => { currentPanel = undefined })
    return currentPanel
}

export function pushResults(panel: OpenedPanel, queryId: string, statement: string, result: QueryResult): void {
    const event: BridgeEvent = {
        kind: 'event',
        op: 'query.results',
        payload: { queryId, statement, ...result },
    }
    void panel.panel.webview.postMessage(event)
}
