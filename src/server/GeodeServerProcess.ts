import * as cp from 'child_process'
import * as readline from 'readline'
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
}

// Spawns the bundled geode-ui Go server and waits for it to log a
// LISTENING line. Owners must call stop() on disposal.
export class GeodeServerProcess {
    private child?: cp.ChildProcess
    private info?: ServerInfo
    private exited = false

    constructor(private opts: ServerOpts) {}

    async start(): Promise<ServerInfo> {
        if (this.info) return this.info
        const bin = resolveBundledBinary(this.opts.extensionRoot, BundledBinary.GeodeUiServer)
        const args = [
            '--http-addr', `127.0.0.1:${this.opts.port ?? 0}`,
            '--lsp-enabled=false',
            '--issuer-mode=ephemeral',
            '--log-format=text',
        ]
        this.child = cp.spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
        this.child.on('exit', () => { this.exited = true })

        const stderrRl = readline.createInterface({ input: this.child.stderr! })
        if (this.opts.onLog) stderrRl.on('line', this.opts.onLog)

        const stdoutRl = readline.createInterface({ input: this.child.stdout! })
        const timeoutMs = this.opts.startupTimeoutMs ?? 10_000
        this.info = await new Promise<ServerInfo>((resolve, reject) => {
            const timer = setTimeout(() => {
                stdoutRl.close()
                reject(new Error(`server did not log LISTENING within ${timeoutMs} ms`))
            }, timeoutMs)
            const onExit = () => {
                clearTimeout(timer)
                stdoutRl.close()
                reject(new Error('server exited before listening'))
            }
            this.child!.once('exit', onExit)
            stdoutRl.on('line', (line) => {
                const m = /^LISTENING\s+addr=([^:\s]+):(\d+)/.exec(line)
                if (m) {
                    clearTimeout(timer)
                    this.child!.removeListener('exit', onExit)
                    resolve({ host: m[1], port: Number(m[2]) })
                }
            })
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
