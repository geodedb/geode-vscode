import * as http from 'http'
import { ServerBootstrap } from '../webview/html'
import { ServerClient } from '../sidebar/SchemaHandler'

export class HttpServerClient implements ServerClient {
    constructor(private serverInfo: ServerBootstrap) {}

    request(path: string, method: string, body?: string | null): Promise<unknown> {
        const buf = body ? Buffer.from(body) : null
        return new Promise((resolve, reject) => {
            const req = http.request(
                {
                    method,
                    host: this.serverInfo.host,
                    port: this.serverInfo.port,
                    path,
                    headers: {
                        authorization: `Bearer ${this.serverInfo.token}`,
                        ...(buf ? { 'content-type': 'application/json', 'content-length': String(buf.length) } : {}),
                    },
                },
                (res) => {
                    const chunks: Buffer[] = []
                    res.on('data', (c) => chunks.push(c))
                    res.on('end', () => {
                        const text = Buffer.concat(chunks).toString('utf8')
                        if ((res.statusCode ?? 0) >= 400) {
                            reject(new Error(`${method} ${path} -> ${res.statusCode}: ${text}`))
                            return
                        }
                        try { resolve(text ? JSON.parse(text) : {}) }
                        catch (e) { reject(new Error(`bad JSON from ${path}: ${(e as Error).message}`)) }
                    })
                }
            )
            req.on('error', reject)
            if (buf) req.write(buf)
            req.end()
        })
    }
}
