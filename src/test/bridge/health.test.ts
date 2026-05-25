import { strict as assert } from 'assert'
import { healthPingHandler } from '../../bridge/handlers/health'

describe('healthPingHandler', () => {
    it('returns server info and timestamp', async () => {
        const result = await healthPingHandler({ serverInfo: { host: '127.0.0.1', port: 1234, token: 't' } })({})
        assert.equal(result.host, '127.0.0.1')
        assert.equal(result.port, 1234)
        assert.equal(typeof result.timestamp, 'number')
        assert.ok(Math.abs(Date.now() - result.timestamp) < 1000)
    })
})
