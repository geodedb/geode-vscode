import * as http from 'http'
import { ServerBootstrap } from '../../webview/html'

export interface HttpRequestPayload {
    url: string
    method: string
    headers: Record<string, string>
    body: { kind: 'text'; value: string } | null
}

export interface HttpResponsePayload {
    status: number
    statusText: string
    headers: Record<string, string>
    body: string
}

export function createHttpForwardHandler(opts: { serverInfo: ServerBootstrap }) {
    const origin = `http://${opts.serverInfo.host}:${opts.serverInfo.port}`
    return async function (payload: HttpRequestPayload): Promise<HttpResponsePayload> {
        if (!payload.url.startsWith(origin)) {
            throw new Error(`url not on bundled server origin: ${payload.url}`)
        }
        const u = new URL(payload.url)
        const headers: Record<string, string> = { ...payload.headers }
        if (opts.serverInfo.token) {
            headers['authorization'] = `Bearer ${opts.serverInfo.token}`
        }
        return await new Promise((resolve, reject) => {
            const req = http.request(
                {
                    method: payload.method,
                    host: u.hostname,
                    port: Number(u.port),
                    path: u.pathname + u.search,
                    headers,
                },
                (res) => {
                    const chunks: Buffer[] = []
                    res.on('data', (c) => chunks.push(c))
                    res.on('end', () => {
                        const body = Buffer.concat(chunks).toString('utf8')
                        const outHeaders: Record<string, string> = {}
                        for (const [k, v] of Object.entries(res.headers)) {
                            if (typeof v === 'string') outHeaders[k] = v
                            else if (Array.isArray(v)) outHeaders[k] = v.join(', ')
                        }
                        resolve({
                            status: res.statusCode ?? 0,
                            statusText: res.statusMessage ?? '',
                            headers: outHeaders,
                            body,
                        })
                    })
                }
            )
            req.on('error', reject)
            if (payload.body && payload.body.kind === 'text') req.write(payload.body.value)
            req.end()
        })
    }
}
