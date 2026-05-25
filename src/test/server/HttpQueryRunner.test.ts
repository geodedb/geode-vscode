import { strict as assert } from 'assert'
import * as http from 'http'
import { HttpQueryRunner } from '../../server/HttpQueryRunner'

describe('HttpQueryRunner', () => {
    let server: http.Server
    let port: number
    let lastReq: { method: string; url: string; body: string; auth: string | undefined } | null = null

    beforeEach(async () => {
        server = http.createServer((req, res) => {
            let body = ''
            req.on('data', (c) => (body += c))
            req.on('end', () => {
                lastReq = { method: req.method!, url: req.url!, body, auth: req.headers.authorization }
                res.writeHead(200, { 'content-type': 'application/json' })
                res.end(JSON.stringify({ columns: ['x'], rows: [{ x: 42 }], durationMs: 7 }))
            })
        })
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
        port = (server.address() as { port: number }).port
    })

    afterEach(() => server.close())

    it('posts the statement and parses the response', async () => {
        const r = new HttpQueryRunner({
            serverInfo: { host: '127.0.0.1', port, token: 'tok' },
            activeConnectionId: () => 'conn-1',
        })
        const out = await r.run('RETURN 42 AS x')
        assert.equal(out.columns[0], 'x')
        assert.equal(out.rows[0].x, 42)
        assert.equal(lastReq?.method, 'POST')
        assert.equal(lastReq?.auth, 'Bearer tok')
        assert.match(lastReq?.body ?? '', /RETURN 42/)
    })

    it('isConnected is false when activeConnectionId returns null', () => {
        const r = new HttpQueryRunner({
            serverInfo: { host: '127.0.0.1', port, token: 'tok' },
            activeConnectionId: () => null,
        })
        assert.equal(r.isConnected, false)
    })
})
