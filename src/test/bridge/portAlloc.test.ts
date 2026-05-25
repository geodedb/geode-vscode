import { strict as assert } from 'assert'
import * as net from 'net'
import { allocatePort } from '../../bridge/portAlloc'

describe('allocatePort', () => {
    it('returns a port number above 1024 that is actually bindable', async () => {
        const port = await allocatePort()
        assert.ok(port > 1024, `expected high port, got ${port}`)
        await new Promise<void>((resolve, reject) => {
            const s = net.createServer()
            s.once('error', reject)
            s.listen(port, '127.0.0.1', () => {
                s.close(() => resolve())
            })
        })
    })

    it('returns different ports on repeated calls', async () => {
        const a = await allocatePort()
        const b = await allocatePort()
        assert.ok(a !== b, `expected distinct ports, got ${a} twice`)
    })
})
