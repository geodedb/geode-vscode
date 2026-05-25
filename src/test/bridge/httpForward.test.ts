import { strict as assert } from 'assert'
import * as http from 'http'
import { createHttpForwardHandler } from '../../bridge/handlers/httpForward'

describe('createHttpForwardHandler', () => {
    let server: http.Server
    let port: number

    beforeEach(async () => {
        server = http.createServer((req, res) => {
            let body = ''
            req.on('data', (c) => (body += c))
            req.on('end', () => {
                res.writeHead(200, { 'content-type': 'application/json' })
                res.end(JSON.stringify({
                    received: { method: req.method, url: req.url, auth: req.headers.authorization, body },
                }))
            })
        })
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
        port = (server.address() as { port: number }).port
    })

    afterEach(() => server.close())

    it('forwards a GET with the host-supplied bearer token', async () => {
        const handler = createHttpForwardHandler({
            serverInfo: { host: '127.0.0.1', port, token: 't0p_s3cr3t' },
        })
        const result = await handler({
            url: `http://127.0.0.1:${port}/api/v1/whoami`,
            method: 'GET',
            headers: {},
            body: null,
        })
        assert.equal(result.status, 200)
        const decoded = JSON.parse(result.body as string)
        assert.equal(decoded.received.method, 'GET')
        assert.equal(decoded.received.auth, 'Bearer t0p_s3cr3t')
    })

    it('rejects URLs outside the bundled server origin', async () => {
        const handler = createHttpForwardHandler({
            serverInfo: { host: '127.0.0.1', port, token: 'x' },
        })
        await assert.rejects(
            handler({ url: 'https://evil.example/x', method: 'GET', headers: {}, body: null }),
            /url not on bundled server/
        )
    })
})
