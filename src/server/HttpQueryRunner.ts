import * as http from 'http'
import { ServerBootstrap } from '../webview/html'
import { QueryRunner, QueryResult } from '../bridge/handlers/queryExecute'

export interface HttpRunnerOpts {
    serverInfo: ServerBootstrap
    activeConnectionId: () => string | null
}

export class HttpQueryRunner implements QueryRunner {
    constructor(private opts: HttpRunnerOpts) {}

    get isConnected(): boolean {
        return this.opts.activeConnectionId() !== null
    }

    run(statement: string): Promise<QueryResult> {
        const connId = this.opts.activeConnectionId()
        if (!connId) return Promise.reject(new Error('no active connection'))
        const body = JSON.stringify({ statement, connection: connId })
        return new Promise((resolve, reject) => {
            const req = http.request(
                {
                    method: 'POST',
                    host: this.opts.serverInfo.host,
                    port: this.opts.serverInfo.port,
                    path: '/api/v1/query',
                    headers: {
                        'content-type': 'application/json',
                        'content-length': Buffer.byteLength(body).toString(),
                        authorization: `Bearer ${this.opts.serverInfo.token}`,
                    },
                },
                (res) => {
                    const chunks: Buffer[] = []
                    res.on('data', (c) => chunks.push(c))
                    res.on('end', () => {
                        const text = Buffer.concat(chunks).toString('utf8')
                        if ((res.statusCode ?? 0) >= 400) {
                            reject(new Error(`server ${res.statusCode}: ${text}`))
                            return
                        }
                        try {
                            const parsed = JSON.parse(text) as QueryResult
                            resolve(parsed)
                        } catch (e) {
                            reject(new Error(`malformed JSON from server: ${(e as Error).message}`))
                        }
                    })
                }
            )
            req.on('error', reject)
            req.write(body)
            req.end()
        })
    }
}
