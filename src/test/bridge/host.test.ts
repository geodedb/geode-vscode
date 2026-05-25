import { strict as assert } from 'assert'
import { BridgeHost } from '../../bridge/host'
import { BridgeMessage, BridgeRequest, BridgeResponse } from '../../bridge/messages'

describe('BridgeHost', () => {
    it('dispatches a registered handler and posts a response', async () => {
        const posted: BridgeMessage[] = []
        const host = new BridgeHost({ postMessage: (m: BridgeMessage) => { posted.push(m); return Promise.resolve(true) } })
        host.register('echo.upper', async (payload: { text: string }) => ({
            upper: payload.text.toUpperCase(),
        }))
        const req: BridgeRequest = { id: 'a1', op: 'echo.upper', payload: { text: 'hi' } }
        await host.handle(req)
        assert.equal(posted.length, 1)
        const res = posted[0] as BridgeResponse
        assert.equal(res.kind, 'response')
        assert.equal(res.id, 'a1')
        assert.equal(res.ok, true)
        assert.deepEqual(res.result, { upper: 'HI' })
    })

    it('returns ok=false with code=NOT_FOUND for unknown ops', async () => {
        const posted: BridgeMessage[] = []
        const host = new BridgeHost({ postMessage: (m: BridgeMessage) => { posted.push(m); return Promise.resolve(true) } })
        await host.handle({ id: 'b1', op: 'no.such.op', payload: {} })
        const res = posted[0] as BridgeResponse
        assert.equal(res.ok, false)
        assert.equal(res.error?.code, 'NOT_FOUND')
    })

    it('catches handler throws and returns code=HANDLER_ERROR', async () => {
        const posted: BridgeMessage[] = []
        const host = new BridgeHost({ postMessage: (m: BridgeMessage) => { posted.push(m); return Promise.resolve(true) } })
        host.register('boom', async () => { throw new Error('kaboom') })
        await host.handle({ id: 'c1', op: 'boom', payload: {} })
        const res = posted[0] as BridgeResponse
        assert.equal(res.ok, false)
        assert.equal(res.error?.code, 'HANDLER_ERROR')
        assert.match(res.error?.message ?? '', /kaboom/)
    })
})
