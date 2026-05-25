import { BridgeRequest, BridgeResponse, BridgeMessage } from './messages'

export type BridgeHandler<P = unknown, R = unknown> = (
    payload: P
) => Promise<R> | R

export interface PostTarget {
    postMessage(msg: BridgeMessage): Thenable<boolean>
}

// Receives decoded request envelopes and posts response envelopes.
// Owners register one handler per op and pass every inbound message
// to handle(). The PostTarget is anything with a postMessage method —
// typically a vscode.Webview, but the contract is intentionally thin
// so the dispatcher is unit-testable without spinning up vscode.
export class BridgeHost {
    private handlers = new Map<string, BridgeHandler>()

    constructor(private target: PostTarget) {}

    register<P, R>(op: string, handler: BridgeHandler<P, R>): void {
        this.handlers.set(op, handler as BridgeHandler)
    }

    async handle(req: BridgeRequest): Promise<void> {
        const handler = this.handlers.get(req.op)
        if (!handler) {
            await this.respond(req.id, {
                ok: false,
                error: { code: 'NOT_FOUND', message: `no handler for op ${req.op}` },
            })
            return
        }
        try {
            const result = await handler(req.payload)
            await this.respond(req.id, { ok: true, result })
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            await this.respond(req.id, {
                ok: false,
                error: { code: 'HANDLER_ERROR', message },
            })
        }
    }

    private respond(id: string, body: Pick<BridgeResponse, 'ok' | 'result' | 'error'>): Thenable<boolean> {
        const msg: BridgeResponse = { kind: 'response', id, ...body }
        return this.target.postMessage(msg)
    }
}
