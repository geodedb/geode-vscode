import WebSocket from 'ws'
import { WebSocketMessageReader, WebSocketMessageWriter } from 'vscode-ws-jsonrpc'
import { MessageTransports } from 'vscode-languageclient/node'
import type { IWebSocket } from 'vscode-ws-jsonrpc'

export interface WsTransportOpts {
    url: string
    accessToken?: string
    onError?: (e: Error) => void
}

/**
 * Adapts a `ws.WebSocket` instance to the `IWebSocket` interface that
 * `vscode-ws-jsonrpc` v3 expects.  The library's `toSocket` helper targets
 * the browser WebSocket shape (property-based event handlers), so we bridge
 * the Node `ws` event-emitter API manually.
 */
function toIWebSocket(ws: WebSocket): IWebSocket {
    return {
        send: (content: string) => ws.send(content),
        onMessage: (cb: (data: unknown) => void) => ws.on('message', cb),
        onError: (cb: (reason: unknown) => void) => ws.on('error', cb),
        onClose: (cb: (code: number, reason: string) => void) =>
            ws.on('close', (code, buf) => cb(code, buf.toString())),
        dispose: () => ws.close(),
    }
}

/**
 * Opens a WebSocket against the bundled geode-ui server's /ws/lsp endpoint
 * and adapts it to the MessageTransports shape that vscode-languageclient
 * expects.  The MessageReader / MessageWriter pair from vscode-ws-jsonrpc
 * satisfies the MessageReader / MessageWriter interface from vscode-jsonrpc.
 */
export async function createLspStream(
    opts: WsTransportOpts,
): Promise<MessageTransports> {
    const url = new URL(opts.url)
    if (opts.accessToken) {
        url.searchParams.set('access_token', opts.accessToken)
    }

    const ws = new WebSocket(url.toString())

    await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve())
        ws.once('error', reject)
    })

    if (opts.onError) {
        ws.on('error', opts.onError)
    }

    const socket = toIWebSocket(ws)
    const reader = new WebSocketMessageReader(socket)
    const writer = new WebSocketMessageWriter(socket)

    return { reader, writer, detached: false }
}
