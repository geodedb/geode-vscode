import { strict as assert } from 'assert'
import * as http from 'http'
import { HttpServerClient } from '../../server/ServerClient'

describe('HttpServerClient', () => {
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
                res.end(JSON.stringify({ echo: { method: req.method, body } }))
            })
        })
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
        port = (server.address() as { port: number }).port
    })

    afterEach(() => server.close())

    it('forwards GET with bearer', async () => {
        const c = new HttpServerClient({ host: '127.0.0.1', port, token: 't' })
        const out = await c.request('/api/v1/schema?connection=c1', 'GET') as { echo: { method: string } }
        assert.equal(out.echo.method, 'GET')
        assert.equal(lastReq?.auth, 'Bearer t')
        assert.equal(lastReq?.url, '/api/v1/schema?connection=c1')
    })

    it('forwards POST with JSON body', async () => {
        const c = new HttpServerClient({ host: '127.0.0.1', port, token: 't' })
        const out = await c.request('/api/v1/history', 'POST', JSON.stringify({ x: 1 })) as { echo: { body: string } }
        assert.equal(out.echo.body, '{"x":1}')
    })

    it('rejects 4xx with status code in message', async () => {
        // restart server with a 404 response
        server.close()
        server = http.createServer((_req, res) => {
            res.writeHead(404)
            res.end('not found')
        })
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
        port = (server.address() as { port: number }).port
        const c = new HttpServerClient({ host: '127.0.0.1', port, token: 't' })
        await assert.rejects(c.request('/missing', 'GET'), /404/)
    })
})
