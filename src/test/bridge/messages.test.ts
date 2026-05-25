import { strict as assert } from 'assert'
import { encodeRequest, decodeMessage, BridgeRequest, BridgeResponse } from '../../bridge/messages'

describe('bridge messages', () => {
    it('encodeRequest produces a well-formed envelope', () => {
        const req: BridgeRequest = { id: 'r1', op: 'health.ping', payload: {} }
        const env = encodeRequest(req)
        assert.equal(env.kind, 'request')
        assert.equal(env.id, 'r1')
        assert.equal(env.op, 'health.ping')
    })

    it('decodeMessage round-trips a response envelope', () => {
        const original: BridgeResponse = {
            kind: 'response',
            id: 'r1',
            ok: true,
            result: { status: 'ok' },
        }
        const decoded = decodeMessage(JSON.parse(JSON.stringify(original)))
        assert.equal(decoded.kind, 'response')
        assert.equal(decoded.id, 'r1')
        assert.equal((decoded as BridgeResponse).ok, true)
    })

    it('decodeMessage rejects malformed input', () => {
        assert.throws(() => decodeMessage(null), /malformed/)
        assert.throws(() => decodeMessage({ kind: 'unknown' }), /malformed/)
        assert.throws(() => decodeMessage({ kind: 'request' }), /malformed/)
    })
})
