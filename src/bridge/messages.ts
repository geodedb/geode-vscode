// Bridge protocol — every message that crosses the webview boundary
// is one of these. The op field is namespaced ("scope.verb"). Adding
// a new op requires:
//   - adding a constant to BridgeOps
//   - registering a handler in src/bridge/host.ts
//   - documenting the request/response payload here

export interface BridgeRequest {
    kind?: 'request'
    id: string
    op: string
    payload: unknown
}

export interface BridgeResponse {
    kind: 'response'
    id: string
    ok: boolean
    result?: unknown
    error?: { code: string; message: string; details?: unknown }
}

export interface BridgeEvent {
    kind: 'event'
    op: string
    payload: unknown
}

export type BridgeMessage = BridgeRequest | BridgeResponse | BridgeEvent

export const BridgeOps = {
    Health: { Ping: 'health.ping' },
    Server: { Info: 'server.info' },
} as const

export function encodeRequest(req: BridgeRequest): BridgeRequest & { kind: 'request' } {
    return { ...req, kind: 'request' }
}

export function decodeMessage(raw: unknown): BridgeMessage {
    if (raw === null || typeof raw !== 'object') {
        throw new Error('malformed bridge message (not an object)')
    }
    const obj = raw as Record<string, unknown>
    if (obj.kind === 'request') {
        if (typeof obj.id !== 'string' || typeof obj.op !== 'string') {
            throw new Error('malformed request envelope')
        }
        return { kind: 'request', id: obj.id, op: obj.op, payload: obj.payload }
    }
    if (obj.kind === 'response') {
        if (typeof obj.id !== 'string' || typeof obj.ok !== 'boolean') {
            throw new Error('malformed response envelope')
        }
        return obj as unknown as BridgeResponse
    }
    if (obj.kind === 'event') {
        if (typeof obj.op !== 'string') {
            throw new Error('malformed event envelope')
        }
        return obj as unknown as BridgeEvent
    }
    throw new Error(`malformed bridge message (unknown kind: ${String(obj.kind)})`)
}
