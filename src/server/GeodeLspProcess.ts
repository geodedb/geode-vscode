import * as cp from 'child_process'
import * as readline from 'readline'
import { allocatePort } from '../bridge/portAlloc'
import { BundledBinary, resolveBundledBinary } from './binaryPath'

export interface LspInfo { port: number }

export interface LspOpts {
    extensionRoot: string
    startupTimeoutMs?: number
    onLog?: (line: string) => void
}

// Spawns the bundled geode graph-db binary in LSP-server mode and waits for
// it to log an "LSP listening" line. Owners must call stop() on disposal.
export class GeodeLspProcess {
    private child?: cp.ChildProcess
    private info?: LspInfo
    private exited = false

    constructor(private opts: LspOpts) {}

    async start(): Promise<LspInfo> {
        if (this.info) return this.info
        const bin = resolveBundledBinary(this.opts.extensionRoot, BundledBinary.GeodeGraphDb)
        const port = await allocatePort()
        // NOTE: geode lsp --listen=tcp:// requires auth (the --no-auth flag is
        // refused when --listen is set). The geode-ui server's /ws/lsp bridge
        // is configured to satisfy this auth handshake. If you're running
        // this binary standalone for debugging, expect a 401 on the LSP
        // socket until auth is wired by the upstream bridge.
        // Future work: wire auth tokens through the LSP bridge path.
        this.child = cp.spawn(bin, ['lsp', `--listen=tcp://127.0.0.1:${port}`], {
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        this.child.on('exit', () => { this.exited = true })
        const stderrRl = readline.createInterface({ input: this.child.stderr! })
        if (this.opts.onLog) stderrRl.on('line', this.opts.onLog)
        const stdoutRl = readline.createInterface({ input: this.child.stdout! })
        if (this.opts.onLog) stdoutRl.on('line', this.opts.onLog)
        const timeoutMs = this.opts.startupTimeoutMs ?? 10_000
        this.info = await new Promise<LspInfo>((resolve, reject) => {
            const timer = setTimeout(() => {
                stdoutRl.close()
                stderrRl.close()
                reject(new Error(`graph-db did not log "LSP listening" within ${timeoutMs} ms`))
            }, timeoutMs)
            const onExit = () => {
                clearTimeout(timer)
                stdoutRl.close()
                stderrRl.close()
                reject(new Error('graph-db exited before LSP listening'))
            }
            this.child!.once('exit', onExit)

            const matchListening = (line: string) => {
                // Match either "LSP listening on H:P" (real binary) or the
                // older fake-binary shape "LSP_LISTENING port=N" so unit
                // tests that shipped before this fix continue to work.
                const realMatch = /^LSP listening on \S+?:(\d+)/.exec(line)
                if (realMatch) {
                    const reportedPort = Number(realMatch[1])
                    const finalPort = reportedPort > 0 ? reportedPort : port
                    clearTimeout(timer)
                    this.child!.removeListener('exit', onExit)
                    resolve({ port: finalPort })
                    return true
                }
                const oldMatch = /^LSP_LISTENING\s+port=(\d+)/.exec(line)
                if (oldMatch) {
                    clearTimeout(timer)
                    this.child!.removeListener('exit', onExit)
                    resolve({ port: Number(oldMatch[1]) })
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
        if (this.child && !this.exited) this.child.kill('SIGTERM')
    }

    getInfo(): LspInfo | undefined { return this.info }
}
