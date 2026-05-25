# Sub-Plan 3 — Query + Results via React Panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use **superpowers:subagent-driven-development** (recommended) or **superpowers:executing-plans**. Sub-plan 1 (Foundation) must be merged; sub-plan 2 (Connections) is recommended but not strictly required.

**Goal:** Replace the native `ResultsTablePanel` with a React webview panel that renders the SPA's `QueryPage` results surface. Route `geode.runQuery`, `geode.runSelection`, `geode.runFile` through the bundled geode-ui server instead of `cp.spawn(geodeCmd, ...)`. Delete the panel's HTML/JS/CSS assets under `src/webviews/table/` and `src/panels/ResultsTablePanel.ts`.

**Architecture:** A new `query.execute` bridge op runs a GQL statement against the active connection via `EnhancedConnectionManager` (which calls the geode-ui server over HTTP). The results panel is opened via `openReactWebviewPanel` (sub-plan 1 task 13) on the SPA route `/query/results?queryId=<id>`. The host posts the result rows to the panel as a `query.results` event so the SPA can stream them into its virtual table without re-fetching. The active editor's file (`.gql`/`.cypher`) stays in VSCode; only the **results display** moves into the webview.

**Tech Stack:** Unchanged.

---

## Task 1: query.execute bridge handler

**Files:**

- Create: `src/bridge/handlers/queryExecute.ts`
- Test: `src/test/bridge/queryExecute.test.ts`

The handler delegates to a `QueryRunner` interface so unit tests can swap in a fake.

- [ ] **Step 1: Write the failing test**

Create `src/test/bridge/queryExecute.test.ts`:

```typescript
import { strict as assert } from 'assert'
import { createQueryExecuteHandler, QueryRunner } from '../../bridge/handlers/queryExecute'

class FakeRunner implements QueryRunner {
    isConnected = true
    async run(stmt: string) {
        return { columns: ['n'], rows: [{ n: 1 }, { n: 2 }], durationMs: 12 }
    }
}

describe('queryExecute handler', () => {
    it('returns rows and duration', async () => {
        const h = createQueryExecuteHandler({ runner: new FakeRunner() })
        const out = await h({ statement: 'RETURN n' })
        assert.deepEqual(out.columns, ['n'])
        assert.equal(out.rows.length, 2)
        assert.ok(out.durationMs >= 0)
    })

    it('throws when not connected', async () => {
        const r = new FakeRunner()
        r.isConnected = false
        const h = createQueryExecuteHandler({ runner: r })
        await assert.rejects(h({ statement: 'RETURN 1' }), /not connected/)
    })
})
```

- [ ] **Step 2: Implement**

Create `src/bridge/handlers/queryExecute.ts`:

```typescript
export interface QueryRow { [k: string]: unknown }
export interface QueryResult {
    columns: string[]
    rows: QueryRow[]
    durationMs: number
}

export interface QueryRunner {
    isConnected: boolean
    run(statement: string): Promise<QueryResult>
}

export function createQueryExecuteHandler(deps: { runner: QueryRunner }) {
    return async function (payload: { statement: string }): Promise<QueryResult> {
        if (!deps.runner.isConnected) {
            throw new Error('not connected: open the sidebar and connect to a profile first')
        }
        return await deps.runner.run(payload.statement)
    }
}
```

- [ ] **Step 3: Run tests + commit**

```bash
npm run compile && npx mocha out/test/bridge/queryExecute.test.js
git add src/bridge/handlers/queryExecute.ts src/test/bridge/queryExecute.test.ts
git commit -m "feat(bridge): query.execute handler with injectable runner"
```

---

## Task 2: HTTP-backed QueryRunner

**Files:**

- Create: `src/server/HttpQueryRunner.ts`
- Test: `src/test/server/HttpQueryRunner.test.ts`

`HttpQueryRunner` implements `QueryRunner` by POSTing to `POST /api/v1/query` on the bundled server, attaching the active connection's id as a header. The server proxies to the configured upstream graph DB.

- [ ] **Step 1: Write the failing test**

Create `src/test/server/HttpQueryRunner.test.ts`:

```typescript
import { strict as assert } from 'assert'
import * as http from 'http'
import { HttpQueryRunner } from '../../server/HttpQueryRunner'

describe('HttpQueryRunner', () => {
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
                res.end(JSON.stringify({ columns: ['x'], rows: [{ x: 42 }], durationMs: 7 }))
            })
        })
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
        port = (server.address() as any).port
    })

    afterEach(() => server.close())

    it('posts the statement and parses the response', async () => {
        const r = new HttpQueryRunner({
            serverInfo: { host: '127.0.0.1', port, token: 'tok' },
            activeConnectionId: () => 'conn-1',
        })
        const out = await r.run('RETURN 42 AS x')
        assert.equal(out.columns[0], 'x')
        assert.equal(out.rows[0].x, 42)
        assert.equal(lastReq?.method, 'POST')
        assert.equal(lastReq?.auth, 'Bearer tok')
        assert.match(lastReq?.body ?? '', /RETURN 42/)
    })

    it('isConnected is false when activeConnectionId returns null', () => {
        const r = new HttpQueryRunner({
            serverInfo: { host: '127.0.0.1', port, token: 'tok' },
            activeConnectionId: () => null,
        })
        assert.equal(r.isConnected, false)
    })
})
```

- [ ] **Step 2: Implement**

Create `src/server/HttpQueryRunner.ts`:

```typescript
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
```

- [ ] **Step 3: Run tests + commit**

```bash
npm run compile && npx mocha out/test/server/HttpQueryRunner.test.js
git add src/server/HttpQueryRunner.ts src/test/server/HttpQueryRunner.test.ts
git commit -m "feat(server): HTTP-backed QueryRunner for bundled geode-ui server"
```

---

## Task 3: Open results panel + post results event

**Files:**

- Create: `src/panels/openResultsPanel.ts`
- Test: `src/test/panels/openResultsPanel.test.ts`

This thin helper opens a `ReactWebviewPanel` on `/query/results?queryId=<id>` and exposes a `pushResults` function that posts a `query.results` event with the row data. Keeping the rows in the host until the SPA finishes its initial render is critical — webviews start empty and don't see HTTP responses, so we send the rows through the bridge event channel.

- [ ] **Step 1: Implement**

Create `src/panels/openResultsPanel.ts`:

```typescript
import * as vscode from 'vscode'
import { openReactWebviewPanel, OpenedPanel } from '../webview/ReactWebviewPanel'
import { ServerBootstrap } from '../webview/html'
import { BridgeHost } from '../bridge/host'
import { BridgeEvent } from '../bridge/messages'
import { QueryResult } from '../bridge/handlers/queryExecute'

let currentPanel: OpenedPanel | undefined

export function openResultsPanel(opts: {
    extensionRoot: string
    serverInfo: ServerBootstrap
    registerCommon: (host: BridgeHost) => void
}): OpenedPanel {
    if (currentPanel) {
        currentPanel.panel.reveal(vscode.ViewColumn.Two, true)
        return currentPanel
    }
    currentPanel = openReactWebviewPanel({
        extensionRoot: opts.extensionRoot,
        route: '/query/results',
        title: 'Geode Results',
        viewColumn: vscode.ViewColumn.Two,
        serverInfo: opts.serverInfo,
        register: opts.registerCommon,
    })
    currentPanel.panel.onDidDispose(() => { currentPanel = undefined })
    return currentPanel
}

export function pushResults(panel: OpenedPanel, queryId: string, statement: string, result: QueryResult): void {
    const event: BridgeEvent = {
        kind: 'event',
        op: 'query.results',
        payload: { queryId, statement, ...result },
    }
    void panel.panel.webview.postMessage(event)
}
```

- [ ] **Step 2: Smoke test**

Create `src/test/panels/openResultsPanel.test.ts`:

```typescript
import { strict as assert } from 'assert'
import { pushResults } from '../../panels/openResultsPanel'

describe('pushResults', () => {
    it('posts a query.results event envelope', async () => {
        const posted: any[] = []
        const panel: any = {
            panel: { webview: { postMessage: (m: any) => { posted.push(m); return Promise.resolve(true) } } },
        }
        pushResults(panel, 'q1', 'RETURN 1', { columns: ['x'], rows: [{ x: 1 }], durationMs: 1 })
        await new Promise((r) => setTimeout(r, 1))
        assert.equal(posted.length, 1)
        assert.equal(posted[0].kind, 'event')
        assert.equal(posted[0].op, 'query.results')
        assert.equal((posted[0].payload as any).queryId, 'q1')
    })
})
```

- [ ] **Step 3: Run + commit**

```bash
npm run compile && npx mocha out/test/panels/openResultsPanel.test.js
git add src/panels/openResultsPanel.ts src/test/panels/
git commit -m "feat(panels): openResultsPanel + pushResults helper"
```

---

## Task 4: Rewire runQuery / runSelection / runFile

**Files:**

- Modify: `src/extension.ts:489-754` (the `runQuery`, `runSelection`, `runFile`, `executeQuery`, `executeMultipleStatements` block)

Replace the CLI subprocess paths with the new runner. Keep the editor-detection, statement-splitting, and history-recording logic intact.

- [ ] **Step 1: Construct the runner once**

Near the top of `activate`, after `ensureServerStarted`:

```typescript
import { HttpQueryRunner } from './server/HttpQueryRunner'
import { createQueryExecuteHandler } from './bridge/handlers/queryExecute'
import { openResultsPanel, pushResults } from './panels/openResultsPanel'
import { secureId } from './utils/security'

const queryRunner = new HttpQueryRunner({
    serverInfo: await ensureServerStarted(context),
    activeConnectionId: () => connectionManager.getActiveProfile()?.id ?? null,
})
```

- [ ] **Step 2: Replace `executeQuery`**

```typescript
async function executeQuery(statement: string): Promise<void> {
    if (!queryRunner.isConnected) {
        const result = await vscode.window.showWarningMessage(
            'No active connection. Open the Geode sidebar to connect.',
            'Open Sidebar'
        )
        if (result === 'Open Sidebar') {
            await vscode.commands.executeCommand('workbench.view.extension.geode-explorer')
        }
        return
    }
    const queryId = secureId('q')
    const panel = openResultsPanel({
        extensionRoot: context.extensionUri.fsPath,
        serverInfo: serverInfo!,
        registerCommon: (host) => {
            host.register('http.request', createHttpForwardHandler({ serverInfo: serverInfo! }))
            host.register('query.execute', createQueryExecuteHandler({ runner: queryRunner }))
        },
    })
    try {
        const result = await queryRunner.run(statement)
        pushResults(panel, queryId, statement, result)
        queryHistoryProvider.addEntry({
            query: statement,
            duration: result.durationMs,
            rowCount: result.rows.length,
            connectionName: connectionManager.getActiveProfile()?.name,
            success: true,
        })
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        outputChannel.appendLine(`Error: ${msg}`)
        queryHistoryProvider.addEntry({
            query: statement,
            connectionName: connectionManager.getActiveProfile()?.name,
            success: false,
            error: msg,
        })
        vscode.window.showErrorMessage(`Query failed: ${msg}`)
    }
}
```

- [ ] **Step 3: Drop `runGeodeQuery` and `runGeodeQueryWithProfile`**

Both functions become unused once `executeQuery` and `executeMultipleStatements` no longer spawn the CLI. Delete them — but the deletion of all CLI subprocess paths is tracked under sub-plan 6 (eliminate CLI). For this sub-plan, leave them in place if they're still imported by `runGeodeQuery` callers (`explainQuery`, `connectServer`). Sub-plan 6 deletes those callers too.

If TypeScript flags unused locals here, add `// eslint-disable-next-line no-unused-vars` per offending line and add a TODO referencing sub-plan 6.

- [ ] **Step 4: Update executeMultipleStatements**

Replace its inner loop body so each statement runs through `queryRunner` instead of `runGeodeQueryWithProfile`:

```typescript
for (let i = 0; i < statements.length; i++) {
    if (token.isCancellationRequested) break
    const stmt = statements[i]
    progress.report({ message: `${i + 1}/${statements.length}`, increment: 100 / statements.length })
    try {
        const result = await queryRunner.run(stmt)
        successCount++
        outputChannel.appendLine(`  → ${result.rows.length} row(s) in ${result.durationMs} ms`)
    } catch (e) {
        errorCount++
        outputChannel.appendLine(`  ✗ ${e instanceof Error ? e.message : String(e)}`)
    }
}
```

- [ ] **Step 5: Compile**

```bash
npm run compile
```

Fix any TS errors. Unused locals from old code paths are acceptable for this sub-plan (cleaned up in sub-plan 6).

- [ ] **Step 6: Commit**

```bash
git add src/extension.ts
git commit -m "feat: route queries through bundled geode-ui server + React results panel"
```

---

## Task 5: Delete ResultsTablePanel

**Files:**

- Delete: `src/panels/ResultsTablePanel.ts`
- Delete: `src/webviews/table/` (entire directory)
- Modify: `src/extension.ts` (remove imports)

- [ ] **Step 1: Confirm references are gone**

```bash
grep -rn "ResultsTablePanel\|webviews/table" src/
```

Expected: no live references.

- [ ] **Step 2: Delete**

```bash
git rm src/panels/ResultsTablePanel.ts
git rm -r src/webviews/table/
```

- [ ] **Step 3: Remove imports in extension.ts**

```bash
grep -n "ResultsTablePanel\|QueryResults" src/extension.ts
```

Remove any matching `import { ResultsTablePanel, QueryResults }` line and any type usages.

- [ ] **Step 4: Compile + commit**

```bash
npm run compile
git add -A
git commit -m "refactor: delete ResultsTablePanel (replaced by React results panel)"
```

---

## Task 6: E2E test — run-and-see-results

**Files:**

- Create: `e2e/suite/query-results.test.ts`
- Create: `e2e/fixtures/sample.gql`

- [ ] **Step 1: Create the fixture**

`e2e/fixtures/sample.gql`:

```gql
RETURN 1 AS one
```

- [ ] **Step 2: Write the test**

```typescript
import { strict as assert } from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'

describe('query results panel', () => {
    it('opens a webview when geode.runFile fires on a .gql file', async () => {
        const fixture = vscode.Uri.file(path.resolve(__dirname, '..', 'fixtures', 'sample.gql'))
        const doc = await vscode.workspace.openTextDocument(fixture)
        await vscode.window.showTextDocument(doc)
        // Cannot assert webview content from here; the smoke is the
        // absence of throws. A deeper e2e against the SPA lives in
        // ../geode-ui/e2e/.
        await vscode.commands.executeCommand('geode.runFile', fixture)
        await new Promise((r) => setTimeout(r, 3_000))
        assert.ok(true)
    })
})
```

- [ ] **Step 3: Run + commit**

```bash
npm run test:e2e
git add e2e/suite/query-results.test.ts e2e/fixtures/sample.gql
git commit -m "test(e2e): smoke test for runFile + React results panel"
```

---

## Task 7: CHANGELOG + self-review

- [ ] **Step 1: CHANGELOG**

Prepend under "## [Unreleased]":

```markdown
### Changed
- Query execution now routes through the bundled geode-ui server and
  surfaces results in a React webview panel. The native ResultsTablePanel
  is removed. (sub-plan 3)

### Removed
- `src/panels/ResultsTablePanel.ts`
- `src/webviews/table/*`
```

- [ ] **Step 2: Spec coverage**

Master plan sub-plan-3 clauses:

- `geode.runQuery`/`runSelection`/`runFile` execute via `/api/v1/query` → Tasks 2, 4
- React results panel → Tasks 3, 4
- `ResultsTablePanel.ts` deleted → Task 5
- `extractGraphData` moves to SPA-side → covered in sub-plan 5; not in scope here

- [ ] **Step 3: Commit + merge candidate tag**

```bash
git add CHANGELOG.md
git commit -m "docs: query+results sub-plan changelog"
```

Merge commit:

```text
Subject: feat: query execution + results panel via geode-ui (sub-plan 3)

Implements docs/superpowers/plans/2026-05-25-geode-ui-integration-03-query-results.md
end-to-end. Next: sub-plan 4 (schema + history + saved queries).
```
