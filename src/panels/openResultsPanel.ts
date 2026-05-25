import { openAnalyticsPanel } from './openAnalyticsPanel'
import { OpenedPanel } from '../webview/ReactWebviewPanel'
import { ServerBootstrap } from '../webview/html'
import { BridgeHost } from '../bridge/host'
import { BridgeEvent } from '../bridge/messages'
import { QueryResult } from '../bridge/handlers/queryExecute'

export function openResultsPanel(opts: {
    extensionRoot: string
    serverInfo: ServerBootstrap
    registerCommon: (host: BridgeHost) => void
}): OpenedPanel {
    return openAnalyticsPanel({
        key: { id: 'results', route: '/query/results', title: 'Geode Results' },
        extensionRoot: opts.extensionRoot,
        serverInfo: opts.serverInfo,
        register: opts.registerCommon,
    })
}

export function pushResults(panel: OpenedPanel, queryId: string, statement: string, result: QueryResult): void {
    const event: BridgeEvent = {
        kind: 'event',
        op: 'query.results',
        payload: { queryId, statement, ...result },
    }
    void panel.panel.webview.postMessage(event)
}
