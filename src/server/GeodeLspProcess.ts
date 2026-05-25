import * as cp from 'child_process'
import * as readline from 'readline'
import { BundledBinary, resolveBundledBinary } from './binaryPath'

export interface LspInfo { port: number }

export interface LspOpts {
    extensionRoot: string
    startupTimeoutMs?: number
    onLog?: (line: string) => void
}

// Spawns the bundled geode graph-db binary in LSP-server mode and waits for
// it to log an LSP_LISTENING line. Owners must call stop() on disposal.
export class GeodeLspProcess {
    private child?: cp.ChildProcess
    private info?: LspInfo
    private exited = false

    constructor(private opts: LspOpts) {}

    async start(): Promise<LspInfo> {
        if (this.info) return this.info
        const bin = resolveBundledBinary(this.opts.extensionRoot, BundledBinary.GeodeGraphDb)
        this.child = cp.spawn(bin, ['serve', '--lsp-port=0', '--http-port=0'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        this.child.on('exit', () => { this.exited = true })

        const stderrRl = readline.createInterface({ input: this.child.stderr! })
        if (this.opts.onLog) stderrRl.on('line', this.opts.onLog)

        const stdoutRl = readline.createInterface({ input: this.child.stdout! })
        const timeoutMs = this.opts.startupTimeoutMs ?? 10_000
        this.info = await new Promise<LspInfo>((resolve, reject) => {
            const timer = setTimeout(() => {
                stdoutRl.close()
                reject(new Error(`graph-db did not log LSP_LISTENING within ${timeoutMs} ms`))
            }, timeoutMs)
            const onExit = () => {
                clearTimeout(timer)
                stdoutRl.close()
                reject(new Error('graph-db exited before LSP listening'))
            }
            this.child!.once('exit', onExit)
            stdoutRl.on('line', (line: string) => {
                const m = /^LSP_LISTENING\s+port=(\d+)/.exec(line)
                if (m) {
                    clearTimeout(timer)
                    this.child!.removeListener('exit', onExit)
                    resolve({ port: Number(m[1]) })
                }
            })
        })
        return this.info
    }

    stop(): void {
        if (this.child && !this.exited) this.child.kill('SIGTERM')
    }

    getInfo(): LspInfo | undefined { return this.info }
}
