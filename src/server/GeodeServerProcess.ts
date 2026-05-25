import * as cp from 'child_process'
import * as crypto from 'crypto'
import * as readline from 'readline'
import { allocatePort } from '../bridge/portAlloc'
import { BundledBinary, resolveBundledBinary } from './binaryPath'

export interface ServerInfo {
    host: string
    port: number
}

export interface ServerOpts {
    extensionRoot: string
    port?: number
    startupTimeoutMs?: number
    onLog?: (line: string) => void
    lspUpstream?: string // "host:port" or undefined to keep -lsp-enabled=false
}

// Spawns the bundled geode-ui Go server and waits for it to log a
// listening line. Owners must call stop() on disposal.
export class GeodeServerProcess {
    private child?: cp.ChildProcess
    private info?: ServerInfo
    private exited = false

    constructor(private opts: ServerOpts) {}

    async start(): Promise<ServerInfo> {
        if (this.info) return this.info
        const bin = resolveBundledBinary(this.opts.extensionRoot, BundledBinary.GeodeUiServer)
        const port = this.opts.port ?? await allocatePort()
        const jwtSecretHex = crypto.randomBytes(32).toString('hex')
        const profilestoreKey = crypto.randomBytes(32).toString('base64')

        const args = [
            '-listen', `127.0.0.1:${port}`,
            '-jwt-secret-hex', jwtSecretHex,
            '-profile-store', ':memory:',
        ]
        if (this.opts.lspUpstream) {
            args.push('-lsp-enabled=true', '-lsp-upstream', this.opts.lspUpstream)
        } else {
            args.push('-lsp-enabled=false')
        }

        this.child = cp.spawn(bin, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, GEODE_PROFILESTORE_KEY: profilestoreKey },
        })
        this.child.on('exit', () => { this.exited = true })

        const stdoutRl = readline.createInterface({ input: this.child.stdout! })
        if (this.opts.onLog) stdoutRl.on('line', this.opts.onLog)

        // Logs go to stderr in JSON-Lines format.
        const stderrRl = readline.createInterface({ input: this.child.stderr! })
        if (this.opts.onLog) stderrRl.on('line', this.opts.onLog)

        const timeoutMs = this.opts.startupTimeoutMs ?? 10_000
        this.info = await new Promise<ServerInfo>((resolve, reject) => {
            const timer = setTimeout(() => {
                stdoutRl.close()
                stderrRl.close()
                reject(new Error(`server did not log "listening" within ${timeoutMs} ms`))
            }, timeoutMs)
            const onExit = () => {
                clearTimeout(timer)
                stdoutRl.close()
                stderrRl.close()
                reject(new Error('server exited before listening'))
            }
            this.child!.once('exit', onExit)

            const matchListening = (line: string) => {
                // Match either JSON-Lines ({"msg":"listening","addr":"H:P"}) or
                // the old fake-binary shape (LISTENING addr=H:P) so unit tests
                // that shipped before this fix continue to work.
                const jsonMatch = /"msg":"listening".*?"addr":"([^"]+:\d+)"/.exec(line)
                if (jsonMatch) {
                    const [host, portStr] = jsonMatch[1].split(':')
                    // Server may echo port 0 from -listen 127.0.0.1:0. Trust
                    // the port we allocated in that case.
                    const reportedPort = Number(portStr)
                    const finalPort = reportedPort > 0 ? reportedPort : port
                    clearTimeout(timer)
                    this.child!.removeListener('exit', onExit)
                    resolve({ host, port: finalPort })
                    return true
                }
                const oldMatch = /^LISTENING\s+addr=([^:\s]+):(\d+)/.exec(line)
                if (oldMatch) {
                    clearTimeout(timer)
                    this.child!.removeListener('exit', onExit)
                    resolve({ host: oldMatch[1], port: Number(oldMatch[2]) })
                    return true
                }
                return false
            }

            stdoutRl.on('line', matchListening)
            stderrRl.on('line', matchListening)
        })
        return this.info
    }

    stop(): void {
        if (this.child && !this.exited) {
            this.child.kill('SIGTERM')
        }
    }

    getInfo(): ServerInfo | undefined {
        return this.info
    }
}
