# Sub-Plan 6 - Eliminate the geode CLI Dependency

> **For agentic workers:** REQUIRED SUB-SKILL: Use **superpowers:subagent-driven-development** or **superpowers:executing-plans**. Sub-plans 1, 3, and 5 must be merged. This is the final sub-plan.

**Goal:** Switch the LSP client from a stdio subprocess to a WebSocket connection against `ws://localhost:<port>/ws/lsp` on the bundled geode-ui server. Spawn the bundled `geode` graph-DB binary as the LSP upstream (the geode-ui server bridges to it). Delete every remaining `cp.spawn` call site that targets the host CLI, the binary resolution helpers, and the `geode.lsp.*` / `geode.server.*` configuration settings that referenced a host-installed binary. The extension must work end-to-end on a machine where no `geode` binary is present on PATH.

**Architecture:** A new `server/GeodeLspProcess.ts` spawns the bundled `geode` binary in `serve --lsp-port=0` mode and reads back the assigned LSP listener port (the binary writes `LSP_LISTENING port=<N>` on stdout). The `GeodeServerProcess` (sub-plan 1) is extended with a `--lsp-upstream=127.0.0.1:<N>` flag set after the LSP process is up. The `LanguageClient` in `src/extension.ts` is rewired from the stdio `ServerOptions` to a `StreamInfo`-returning factory that opens a WebSocket via `vscode-ws-jsonrpc`. New settings: `geode.bundledServer.startupTimeoutMs`, `geode.bundledServer.logLevel`. Old settings (`geode.lsp.path`, `geode.lsp.args`, `geode.server.host`, `geode.server.port`, `geode.server.autoConnect`, `geode.server.insecure`) are removed from `package.json`.

**Tech Stack:** `vscode-ws-jsonrpc`, `ws`, plus existing.

---

## Task 1: GeodeLspProcess

**Files:**

- Create: `src/server/GeodeLspProcess.ts`
- Test: `src/test/server/GeodeLspProcess.test.ts`

Mirrors `GeodeServerProcess` (sub-plan 1 task 8) but for the graph-DB binary. The binary supports `serve --lsp-port=0`, picks a port, then prints `LSP_LISTENING port=N` on stdout.

- [ ] **Step 1: Test + implement**

```typescript
// src/server/GeodeLspProcess.ts
import * as cp from 'child_process'
import * as readline from 'readline'
import { BundledBinary, resolveBundledBinary } from './binaryPath'

export interface LspInfo { port: number }

export interface LspOpts {
    extensionRoot: string
    startupTimeoutMs?: number
    onLog?: (line: string) => void
}

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
            stdoutRl.on('line', (line) => {
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
```

- [ ] **Step 2: Test using the same fake-binary pattern as `GeodeServerProcess.test.ts`**

Skeleton (POSIX only for the first cut):

```typescript
// src/test/server/GeodeLspProcess.test.ts — fake binary prints LSP_LISTENING
// and the wrapper resolves with the parsed port. See sub-plan 1 task 8 for
// the equivalent server-binary harness; copy that fixture pattern verbatim
// and swap the LISTENING regex for LSP_LISTENING.
```

- [ ] **Step 3: Commit**

```bash
npm run compile && npx mocha out/test/server/GeodeLspProcess.test.js
git add src/server/GeodeLspProcess.ts src/test/server/
git commit -m "feat(server): spawn bundled geode graph-db for LSP"
```

---

## Task 2: Extend GeodeServerProcess with --lsp-upstream

**Files:**

- Modify: `src/server/GeodeServerProcess.ts`

- [ ] **Step 1: Accept the upstream address as an option**

```typescript
export interface ServerOpts {
    extensionRoot: string
    port?: number
    startupTimeoutMs?: number
    onLog?: (line: string) => void
    lspUpstream?: string // "host:port" or null/undefined to keep --lsp-enabled=false
}
```

Update the args block in `start()`:

```typescript
const args = [
    '--http-addr', `127.0.0.1:${this.opts.port ?? 0}`,
    '--issuer-mode=ephemeral',
    '--log-format=text',
]
if (this.opts.lspUpstream) {
    args.push('--lsp-enabled=true', '--lsp-upstream', this.opts.lspUpstream)
} else {
    args.push('--lsp-enabled=false')
}
```

- [ ] **Step 2: Add a test for the args wiring**

In `src/test/server/GeodeServerProcess.test.ts`, add a fake binary that echoes its argv to a file and assert `--lsp-upstream` appears.

- [ ] **Step 3: Commit**

```bash
git add src/server/GeodeServerProcess.ts src/test/server/GeodeServerProcess.test.ts
git commit -m "feat(server): wire --lsp-upstream into GeodeServerProcess"
```

---

## Task 3: LSP-over-WebSocket transport

**Files:**

- Create: `src/lsp/wsTransport.ts`
- Test: `src/test/lsp/wsTransport.test.ts`

A small adapter that opens a WebSocket against `ws://<host>:<port>/ws/lsp` and adapts it to the `MessageReader`/`MessageWriter` pair `vscode-languageclient` expects.

- [ ] **Step 1: Add the `ws` dependency**

```bash
npm install ws@^8 vscode-ws-jsonrpc@^3 --save
npm install --save-dev @types/ws
```

- [ ] **Step 2: Implement**

```typescript
// src/lsp/wsTransport.ts
import WebSocket from 'ws'
import { toSocket, WebSocketMessageReader, WebSocketMessageWriter } from 'vscode-ws-jsonrpc'
import { StreamInfo } from 'vscode-languageclient/node'

export interface WsTransportOpts {
    url: string
    accessToken?: string
    onError?: (e: Error) => void
}

export async function createLspStream(opts: WsTransportOpts): Promise<StreamInfo> {
    const url = new URL(opts.url)
    if (opts.accessToken) url.searchParams.set('access_token', opts.accessToken)
    const ws = new WebSocket(url.toString())
    await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve())
        ws.once('error', reject)
    })
    const socket = toSocket(ws as any)
    const reader = new WebSocketMessageReader(socket)
    const writer = new WebSocketMessageWriter(socket)
    return {
        reader: reader as any,
        writer: writer as any,
        detached: false,
    } as unknown as StreamInfo
}
```

- [ ] **Step 3: Unit test the URL building**

```typescript
// src/test/lsp/wsTransport.test.ts
import { strict as assert } from 'assert'

describe('LSP WS URL building', () => {
    it('attaches access_token when provided', () => {
        const u = new URL('ws://127.0.0.1:9000/ws/lsp')
        u.searchParams.set('access_token', 'abc')
        assert.equal(u.toString(), 'ws://127.0.0.1:9000/ws/lsp?access_token=abc')
    })
})
```

(The real WebSocket open path is exercised by the e2e smoke in Task 6.)

- [ ] **Step 4: Commit**

```bash
git add src/lsp/wsTransport.ts src/test/lsp/wsTransport.test.ts package.json package-lock.json
git commit -m "feat(lsp): WebSocket transport using vscode-ws-jsonrpc"
```

---

## Task 4: Rewire LanguageClient

**Files:**

- Modify: `src/extension.ts` (replace `startLanguageServer`, `startLanguageServerWithPath`, `resolveGeodeBinary`, `findInPath`, `isBinaryPathTrusted`)

- [ ] **Step 1: Add new lifecycle holders**

Module-scoped vars near the existing `serverProcess`:

```typescript
let lspProcess: GeodeLspProcess | undefined
```

- [ ] **Step 2: New `startLanguageServer`**

Replace the entire existing function body and its helpers:

```typescript
import { GeodeLspProcess } from './server/GeodeLspProcess'
import { createLspStream } from './lsp/wsTransport'

async function startLanguageServer(context: vscode.ExtensionContext): Promise<void> {
    // Boot the bundled graph-DB binary in LSP mode, then bring up the
    // geode-ui server with the upstream address wired in.
    lspProcess = new GeodeLspProcess({
        extensionRoot: context.extensionUri.fsPath,
        onLog: (line) => outputChannel.appendLine(`[geode-db] ${line}`),
    })
    const lspInfo = await lspProcess.start()
    outputChannel.appendLine(`Geode graph-DB LSP listening on 127.0.0.1:${lspInfo.port}`)

    // Restart the geode-ui server with --lsp-upstream now that we know
    // the port. If it is already running without LSP wiring, stop it.
    if (serverProcess) {
        serverProcess.stop()
        serverProcess = undefined
        serverInfo = undefined
    }
    serverProcess = new GeodeServerProcess({
        extensionRoot: context.extensionUri.fsPath,
        onLog: (line) => outputChannel.appendLine(`[geode-ui] ${line}`),
        lspUpstream: `127.0.0.1:${lspInfo.port}`,
    })
    const info = await serverProcess.start()
    serverInfo = { host: info.host, port: info.port, token: '' }

    // Connect the LanguageClient to ws://<host>:<port>/ws/lsp.
    const url = `ws://${info.host}:${info.port}/ws/lsp`
    const serverOptions: ServerOptions = async () => createLspStream({ url })
    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'gql' },
            { scheme: 'file', language: 'cypher' },
            { scheme: 'untitled', language: 'gql' },
            { scheme: 'untitled', language: 'cypher' },
        ],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{gql,gcypher,cypher,pgql}'),
        },
        outputChannel,
        traceOutputChannel: outputChannel,
        diagnosticCollectionName: 'geode-gql',
        initializationFailedHandler: (e) => {
            outputChannel.appendLine(`LSP init failed: ${e}`)
            return false
        },
        errorHandler: {
            error: (e, m, count) => {
                outputChannel.appendLine(`LSP error: ${e} - ${m} (count: ${count})`)
                return { action: ErrorAction.Continue }
            },
            closed: () => {
                outputChannel.appendLine('LSP closed')
                return { action: CloseAction.DoNotRestart }
            },
        },
    }
    client = new LanguageClient('geode-gql', 'Geode GQL Language Server', serverOptions, clientOptions)
    client.onDidChangeState((event) => {
        outputChannel.appendLine(`LSP state: ${event.oldState} -> ${event.newState}`)
    })
    await client.start()
    updateStatusBar('lsp-ready')
}
```

`ensureServerStarted` from sub-plan 1 must now delegate to `startLanguageServer` if LSP is enabled. Easiest: at activation, call `startLanguageServer(context)` unconditionally (or behind the `geode.lsp.enabled` setting that still exists). Remove all branches that called `startLanguageServerWithPath`.

- [ ] **Step 3: Delete the now-unused helpers**

From `src/extension.ts`, delete:

- `startLanguageServerWithPath`
- `resolveGeodeBinary`
- `findInPath`
- `isBinaryPathTrusted`
- `runGeodeQuery`
- `runGeodeQueryWithProfile`
- `connectServer` (legacy; the React sidebar handles connection now)
- `disconnectServer` (legacy; same)
- The `cp` import if it has no remaining consumers (it likely does not).
- The `fs` import if only used by the deleted helpers.

`explainQuery` currently runs a CLI subprocess; replace its body:

```typescript
async function explainQuery() {
    const editor = vscode.window.activeTextEditor
    if (!editor) return vscode.window.showWarningMessage('No active editor')
    const stmt = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection)
    try {
        const result = await queryRunner.run(`EXPLAIN ${stmt}`)
        outputChannel.appendLine(JSON.stringify(result.rows, null, 2))
        outputChannel.show()
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        outputChannel.appendLine(`EXPLAIN failed: ${msg}`)
        vscode.window.showErrorMessage(`EXPLAIN failed: ${msg}`)
    }
}
```

- [ ] **Step 4: Compile + fix**

```bash
npm run compile
```

Fix any lingering imports/typos. Existing tests must still pass.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts
git commit -m "feat(lsp): switch LanguageClient to WebSocket against bundled server"
```

---

## Task 5: Update package.json settings

**Files:**

- Modify: `package.json` (`contributes.configuration.properties`)

- [ ] **Step 1: Remove settings**

Delete these entries from `contributes.configuration.properties`:

- `geode.lsp.path`
- `geode.lsp.args`
- `geode.server.host`
- `geode.server.port`
- `geode.server.autoConnect`
- `geode.server.insecure`

Keep:

- `geode.lsp.enabled` (controls whether LSP boots at all)
- `geode.lsp.trace.server`
- `geode.query.timeout`
- `geode.query.maxResults`
- `geode.format.*`

- [ ] **Step 2: Add new settings**

```json
"geode.bundledServer.startupTimeoutMs": {
    "type": "number",
    "default": 10000,
    "description": "Milliseconds to wait for the bundled geode-ui server to log its LISTENING line before failing activation."
},
"geode.bundledServer.logLevel": {
    "type": "string",
    "enum": ["debug", "info", "warn", "error"],
    "default": "info",
    "description": "Log level passed to the bundled geode-ui server."
}
```

- [ ] **Step 3: Honor new settings**

In `extension.ts`, when constructing `GeodeServerProcess` / `GeodeLspProcess`, read the timeout:

```typescript
const cfg = vscode.workspace.getConfiguration('geode.bundledServer')
const startupTimeoutMs = cfg.get<number>('startupTimeoutMs', 10_000)
```

Pass to both process constructors.

- [ ] **Step 4: Commit**

```bash
git add package.json src/extension.ts
git commit -m "config: replace host-binary settings with bundled-server settings"
```

---

## Task 6: E2E - confirm no host geode required

**Files:**

- Create: `e2e/suite/no-host-binary.test.ts`

- [ ] **Step 1: Hide the host PATH for the test run**

The test launches the extension dev host with `process.env.PATH=/usr/bin` (no developer-installed binaries) and asserts:

- The extension activates
- LSP starts (the bundled binary is found)
- A GQL file gets diagnostics (LSP up)
- A trivial query (`RETURN 1`) runs via the runner

```typescript
// e2e/suite/no-host-binary.test.ts
import { strict as assert } from 'assert'
import * as vscode from 'vscode'

describe('no host geode binary', () => {
    it('activates and starts LSP without a host-installed geode', async () => {
        const ext = vscode.extensions.getExtension('codeprosorg.geode-vscode')
        assert.ok(ext)
        await ext.activate()
        // The output channel should report "Geode graph-DB LSP listening"
        // within ~10 s.
        await new Promise((r) => setTimeout(r, 12_000))
        assert.equal(ext.isActive, true)
    })
})
```

`e2e/runTest.ts` accepts an env override; prepend to the existing `runTest.ts`:

```typescript
process.env.PATH = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/usr/bin'
```

(This is a coarse test - it does not strip every possible path source. CI runs a stricter version inside a minimal container.)

- [ ] **Step 2: Run**

```bash
npm run test:e2e
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add e2e/
git commit -m "test(e2e): smoke check that no host geode is required"
```

---

## Task 7: Audit + delete dead code

**Files:**

- Modify/delete: any file that still imports `cp` or references `geode` CLI binary discovery.

- [ ] **Step 1: Find stragglers**

```bash
grep -rn "cp\.spawn\|child_process\.spawn\|resolveGeodeBinary\|findInPath\|isBinaryPathTrusted\|geode\.lsp\.path\|geode\.lsp\.args\|geode\.server\.host" src/
```

Expected: only matches inside `src/server/GeodeServerProcess.ts` and `src/server/GeodeLspProcess.ts`. Any other match is dead code - delete it.

- [ ] **Step 2: Check `src/utils/security.ts`**

```bash
grep -n "isValidBinaryPath\|DEFAULT_PORT\|CONNECTION_TIMEOUT_MS\|QUERY_TIMEOUT_MS" src/extension.ts src/connections/ src/client/
```

If `isValidBinaryPath` is unused everywhere outside `utils/security.ts`, delete the function. Keep timing constants - they are still referenced by `EnhancedConnectionManager.ts`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: prune dead CLI-binary helpers"
```

---

## Task 8: CHANGELOG + final self-review

**Files:**

- Modify: `CHANGELOG.md`
- Modify: `README.md` (drop "Install Geode CLI" prerequisite)

- [ ] **Step 1: CHANGELOG**

```markdown
### Changed
- LSP runs over WebSocket against the bundled geode-ui server. The
  host system no longer needs the `geode` binary on PATH or in any
  configured location. (sub-plan 6)

### Removed
- Settings: `geode.lsp.path`, `geode.lsp.args`, `geode.server.host`,
  `geode.server.port`, `geode.server.autoConnect`, `geode.server.insecure`.
- Helpers: `resolveGeodeBinary`, `findInPath`, `isBinaryPathTrusted`,
  `runGeodeQuery`, `runGeodeQueryWithProfile`, `connectServer`,
  `disconnectServer`.

### Added
- Settings: `geode.bundledServer.startupTimeoutMs`,
  `geode.bundledServer.logLevel`.
- `src/server/GeodeLspProcess.ts` spawns the bundled graph-DB binary
  for LSP upstream.
- `src/lsp/wsTransport.ts` adapts WebSocket to the LanguageClient
  StreamInfo contract.
```

- [ ] **Step 2: README**

Remove any "Prerequisites" item referencing a host `geode` installation. Add:

```markdown
## Prerequisites

None. The VSIX bundles the geode-ui server and the geode graph-DB
binary; the extension boots them on activation.

If you need to point at an external geode server, set
`geode.connections.add` and configure the host/port through the
sidebar UI. The bundled binaries continue to run alongside; they
provide LSP and the management UI.
```

- [ ] **Step 3: Spec coverage check**

Master plan sub-plan-6 clauses:

- LSP via WebSocket -> Tasks 3, 4
- All `cp.spawn` to host CLI removed -> Task 7
- `geode.lsp.path`/`geode.lsp.args`/`geode.server.*` deleted from package.json -> Task 5
- New `geode.bundledServer.*` settings -> Task 5 (note: master plan said `.port`, plan landed `.startupTimeoutMs` + `.logLevel`; update the master plan in the same commit if the discrepancy matters to the reader)
- Smoke that no host geode is required -> Task 6

- [ ] **Step 4: Bump version + tag release**

Bump `package.json` `version` to `1.3.0` (this is a major-functionality bump). Update `CHANGELOG.md` heading from `## [Unreleased]` to `## [1.3.0] - 2026-MM-DD`.

```bash
git add package.json CHANGELOG.md README.md
git commit -m "release: v1.3.0 (geode-ui integration complete; sub-plan 6)"
git tag v1.3.0
```

- [ ] **Step 5: Final merge candidate tag**

Merge commit:

```text
Subject: feat: eliminate geode CLI dependency (sub-plan 6 - final)

Implements docs/superpowers/plans/2026-05-25-geode-ui-integration-06-eliminate-cli.md
end-to-end. The geode-vscode extension is now fully self-contained:
bundled geode-ui SPA, bundled geode-ui Go server, bundled geode
graph-DB binary, LSP over WebSocket, all UI surfaces routed through
the React app. The host system no longer needs any geode tooling.

This completes the geode-ui integration master plan
(docs/superpowers/plans/2026-05-25-geode-ui-integration-master.md).
```

---

## Closing notes

After this sub-plan lands:

- The `src/connections/` directory contains only `ConnectionManager.ts`, `index.ts` (compatibility shim).
- The `src/views/` directory is gone.
- The `src/panels/` directory contains only `openAnalyticsPanel.ts` and `openResultsPanel.ts`.
- The `src/webviews/` directory is gone.
- The extension activates without any host `geode` binary.
- LSP, queries, results, graphs, schema, history, saved queries, admin, profiles all render through the geode-ui SPA.

If a future regression demands a "geode CLI fallback", that is a separate plan - not a rollback of this one.
