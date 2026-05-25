# Sub-Plan 4 — Schema Explorer + History + Saved Queries

> **For agentic workers:** REQUIRED SUB-SKILL: Use **superpowers:subagent-driven-development** (recommended) or **superpowers:executing-plans**. Sub-plans 1 and 2 must be merged.

**Goal:** Replace the three remaining native tree views (`geodeSchemaExplorer`, `geodeQueryHistory`, `geodeSavedQueries`) with React surfaces inside the sidebar webview. Migrate query history and saved query persistence from `globalState`/`workspaceState` JSON to the bundled server's `/api/v1/history` and `/api/v1/saved` endpoints. Delete `EnhancedSchemaExplorerProvider.ts`, `QueryHistoryProvider.ts`, and `SavedQueriesProvider.ts`.

**Architecture:** The sidebar webview from sub-plan 2 grows additional sub-routes (`/sidebar/schema`, `/sidebar/history`, `/sidebar/saved`). New bridge handlers in `src/sidebar/SchemaHandler.ts`, `HistoryHandler.ts`, `SavedQueriesHandler.ts` translate webview requests into HTTP calls against the bundled server. The SPA already implements these screens (`SchemaPage.tsx`, history components inside `QueryPage`, saved-queries components — verified in `../geode-ui/src/pages/`). Migration of old workspace state runs once on activation: existing JSON entries are POSTed to the server then deleted from `globalState`.

**Tech Stack:** Unchanged.

---

## Task 1: SchemaHandler

**Files:**

- Create: `src/sidebar/SchemaHandler.ts`
- Test: `src/test/sidebar/SchemaHandler.test.ts`

The handler proxies `schema.refresh`, `schema.list`, `schema.getNode`, `schema.getRelationship` ops. All of these are simple GET/POST forwards to the bundled server.

- [ ] **Step 1: Write the failing test**

Create `src/test/sidebar/SchemaHandler.test.ts`:

```typescript
import { strict as assert } from 'assert'
import { createSchemaHandlers, SchemaDeps } from '../../sidebar/SchemaHandler'

class FakeServer implements SchemaDeps['client'] {
    last?: { path: string; method: string; body: string | null }
    async request(path: string, method: string, body?: string | null) {
        this.last = { path, method, body: body ?? null }
        if (path.startsWith('/api/v1/schema/refresh')) return { ok: true }
        if (path === '/api/v1/schema') return { labels: ['Person'], types: ['KNOWS'] }
        return {}
    }
}

describe('SchemaHandler', () => {
    it('refresh POSTs to /api/v1/schema/refresh with connection id', async () => {
        const client = new FakeServer()
        const h = createSchemaHandlers({ client, activeConnectionId: () => 'c1' })
        await h.refresh({})
        assert.equal(client.last?.method, 'POST')
        assert.match(client.last?.path ?? '', /\/api\/v1\/schema\/refresh/)
    })

    it('list returns the parsed schema payload', async () => {
        const client = new FakeServer()
        const h = createSchemaHandlers({ client, activeConnectionId: () => 'c1' })
        const out = await h.list({})
        assert.deepEqual(out.labels, ['Person'])
    })

    it('throws when no active connection', async () => {
        const h = createSchemaHandlers({ client: new FakeServer(), activeConnectionId: () => null })
        await assert.rejects(h.refresh({}), /no active connection/)
    })
})
```

- [ ] **Step 2: Implement**

Create `src/sidebar/SchemaHandler.ts`:

```typescript
export interface ServerClient {
    request(path: string, method: string, body?: string | null): Promise<unknown>
}

export interface SchemaDeps {
    client: ServerClient
    activeConnectionId: () => string | null
}

export function createSchemaHandlers(deps: SchemaDeps) {
    function assertConn(): string {
        const id = deps.activeConnectionId()
        if (!id) throw new Error('no active connection')
        return id
    }
    return {
        refresh: async (_p: unknown) => {
            const id = assertConn()
            return await deps.client.request(`/api/v1/schema/refresh?connection=${id}`, 'POST')
        },
        list: async (_p: unknown) => {
            const id = assertConn()
            return await deps.client.request(`/api/v1/schema?connection=${id}`, 'GET')
        },
        getNode: async (payload: { label: string }) => {
            const id = assertConn()
            return await deps.client.request(
                `/api/v1/schema/node?connection=${id}&label=${encodeURIComponent(payload.label)}`,
                'GET'
            )
        },
        getRelationship: async (payload: { type: string }) => {
            const id = assertConn()
            return await deps.client.request(
                `/api/v1/schema/relationship?connection=${id}&type=${encodeURIComponent(payload.type)}`,
                'GET'
            )
        },
    }
}

export function registerSchemaHandlers(host: import('../bridge/host').BridgeHost, deps: SchemaDeps): void {
    const h = createSchemaHandlers(deps)
    host.register('schema.refresh', h.refresh)
    host.register('schema.list', h.list)
    host.register('schema.getNode', h.getNode)
    host.register('schema.getRelationship', h.getRelationship)
}
```

- [ ] **Step 3: Commit**

```bash
git add src/sidebar/SchemaHandler.ts src/test/sidebar/SchemaHandler.test.ts
git commit -m "feat(sidebar): schema bridge handlers"
```

---

## Task 2: ServerClient implementation

**Files:**

- Create: `src/server/ServerClient.ts`
- Test: `src/test/server/ServerClient.test.ts`

A thin HTTP wrapper used by `SchemaHandler`, `HistoryHandler`, `SavedQueriesHandler`. Re-uses the same auth-injection pattern as `HttpQueryRunner`.

- [ ] **Step 1: Test + implement**

```typescript
// src/server/ServerClient.ts
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
```

Add a test mirroring `HttpQueryRunner.test.ts`'s pattern. Commit:

```bash
git add src/server/ServerClient.ts src/test/server/ServerClient.test.ts
git commit -m "feat(server): HttpServerClient for sidebar handlers"
```

---

## Task 3: HistoryHandler + migration

**Files:**

- Create: `src/sidebar/HistoryHandler.ts`
- Create: `src/sidebar/historyMigration.ts`
- Test: `src/test/sidebar/HistoryHandler.test.ts`
- Test: `src/test/sidebar/historyMigration.test.ts`

Bridge ops: `history.list`, `history.add`, `history.remove`, `history.clear`. The migration runs once on activation, reads `globalState.get('geode.queryHistory')` (array of entries written by the old `QueryHistoryProvider`), POSTs each to `/api/v1/history`, then clears the key.

- [ ] **Step 1: Write the migration test**

```typescript
// src/test/sidebar/historyMigration.test.ts
import { strict as assert } from 'assert'
import { migrateLegacyHistory } from '../../sidebar/historyMigration'

class FakeState {
    map = new Map<string, unknown>()
    get(key: string) { return this.map.get(key) }
    update(key: string, value: unknown) { this.map.set(key, value); return Promise.resolve() }
}

describe('migrateLegacyHistory', () => {
    it('posts each legacy entry to /api/v1/history and clears storage', async () => {
        const state = new FakeState()
        state.update('geode.queryHistory', [
            { query: 'RETURN 1', timestamp: 1700000000000, duration: 10, rowCount: 1, success: true },
        ])
        const posted: any[] = []
        await migrateLegacyHistory({
            globalState: state as any,
            postEntry: async (e) => { posted.push(e) },
        })
        assert.equal(posted.length, 1)
        assert.equal(state.map.get('geode.queryHistory'), undefined)
    })

    it('is a no-op when the legacy key is absent', async () => {
        const state = new FakeState()
        await migrateLegacyHistory({
            globalState: state as any,
            postEntry: async () => { throw new Error('should not be called') },
        })
    })
})
```

- [ ] **Step 2: Implement**

```typescript
// src/sidebar/historyMigration.ts
import * as vscode from 'vscode'

export interface LegacyHistoryEntry {
    query: string
    timestamp: number
    duration?: number
    rowCount?: number
    connectionName?: string
    success: boolean
    error?: string
}

export interface MigrationDeps {
    globalState: vscode.Memento
    postEntry: (e: LegacyHistoryEntry) => Promise<void>
}

export async function migrateLegacyHistory(deps: MigrationDeps): Promise<void> {
    const entries = deps.globalState.get<LegacyHistoryEntry[]>('geode.queryHistory')
    if (!Array.isArray(entries) || entries.length === 0) return
    for (const e of entries) {
        try { await deps.postEntry(e) }
        catch { /* best-effort migration */ }
    }
    await deps.globalState.update('geode.queryHistory', undefined)
}
```

- [ ] **Step 3: HistoryHandler**

```typescript
// src/sidebar/HistoryHandler.ts
import { ServerClient } from './SchemaHandler'
import { LegacyHistoryEntry } from './historyMigration'

export interface HistoryDeps {
    client: ServerClient
}

export function createHistoryHandlers(deps: HistoryDeps) {
    return {
        list: async () => deps.client.request('/api/v1/history', 'GET'),
        add: async (e: LegacyHistoryEntry) =>
            deps.client.request('/api/v1/history', 'POST', JSON.stringify(e)),
        remove: async (payload: { id: string }) =>
            deps.client.request(`/api/v1/history/${encodeURIComponent(payload.id)}`, 'DELETE'),
        clear: async () => deps.client.request('/api/v1/history', 'DELETE'),
    }
}

export function registerHistoryHandlers(host: import('../bridge/host').BridgeHost, deps: HistoryDeps): void {
    const h = createHistoryHandlers(deps)
    host.register('history.list', h.list)
    host.register('history.add', h.add as any)
    host.register('history.remove', h.remove)
    host.register('history.clear', h.clear)
}
```

- [ ] **Step 4: Tests + commit**

```bash
npm run compile && npx mocha out/test/sidebar/historyMigration.test.js out/test/sidebar/HistoryHandler.test.js
git add src/sidebar/HistoryHandler.ts src/sidebar/historyMigration.ts src/test/sidebar/
git commit -m "feat(sidebar): history handlers + legacy migration"
```

---

## Task 4: SavedQueriesHandler

**Files:**

- Create: `src/sidebar/SavedQueriesHandler.ts`
- Create: `src/sidebar/savedQueriesMigration.ts`
- Test: `src/test/sidebar/SavedQueriesHandler.test.ts`

Mirror the History pattern. Bridge ops: `saved.list`, `saved.save`, `saved.update`, `saved.delete`, `saved.import`, `saved.export`. Migration reads `globalState.get('geode.savedQueries')`, POSTs to `/api/v1/saved` bulk import, then clears.

- [ ] **Step 1: Test + implement**

Skeleton mirrors HistoryHandler. Commit:

```bash
git add src/sidebar/SavedQueriesHandler.ts src/sidebar/savedQueriesMigration.ts src/test/sidebar/
git commit -m "feat(sidebar): saved-queries handlers + legacy migration"
```

---

## Task 5: Register new handlers in extension.ts + run migration

**Files:**

- Modify: `src/extension.ts` (extend the sidebar provider's `register` callback)

- [ ] **Step 1: Wire**

```typescript
import { HttpServerClient } from './server/ServerClient'
import { registerSchemaHandlers } from './sidebar/SchemaHandler'
import { registerHistoryHandlers } from './sidebar/HistoryHandler'
import { registerSavedQueriesHandlers } from './sidebar/SavedQueriesHandler'
import { migrateLegacyHistory } from './sidebar/historyMigration'
import { migrateLegacySavedQueries } from './sidebar/savedQueriesMigration'

const serverClient = new HttpServerClient(serverInfo!)

const sidebarProvider = new ReactWebviewViewProvider({
    extensionRoot: context.extensionUri.fsPath,
    route: '/sidebar',
    serverInfo: serverInfo!,
    register: (host) => {
        host.register('http.request', createHttpForwardHandler({ serverInfo: serverInfo! }))
        registerConnectionsHandlers(host, { manager: connectionManager, secrets: makeVsCodeSecrets(context.secrets), pickFile: makePemFilePicker() })
        registerSchemaHandlers(host, { client: serverClient, activeConnectionId: () => connectionManager.getActiveProfile()?.id ?? null })
        registerHistoryHandlers(host, { client: serverClient })
        registerSavedQueriesHandlers(host, { client: serverClient })
    },
})
```

After the sidebar is registered, kick off migrations (do not block activation):

```typescript
void (async () => {
    await migrateLegacyHistory({
        globalState: context.globalState,
        postEntry: (e) => serverClient.request('/api/v1/history', 'POST', JSON.stringify(e)).then(() => undefined),
    })
    await migrateLegacySavedQueries({
        globalState: context.globalState,
        postBulk: (list) => serverClient.request('/api/v1/saved/bulk', 'POST', JSON.stringify({ items: list })).then(() => undefined),
    })
})()
```

- [ ] **Step 2: Commit**

```bash
git add src/extension.ts
git commit -m "feat: register schema/history/saved handlers + run one-shot migrations"
```

---

## Task 6: Re-route schema/history/saved commands

**Files:**

- Modify: `src/extension.ts` (`registerSchemaExplorerCommands`, `registerQueryHistoryCommands`, `registerSavedQueriesCommands` → re-implementations)

All three `register*Commands` exports came from the deleted/about-to-be-deleted view providers. Each command should now:

1. Focus the sidebar (`workbench.view.extension.geode-explorer`).
2. Broadcast a `ui.navigate` event to the React app.

- [ ] **Step 1: Replace registrations**

```typescript
const navigate = (to: string) => {
    sidebarProvider.broadcast({ kind: 'event', op: 'ui.navigate', payload: { to } })
}
const focus = async () => vscode.commands.executeCommand('workbench.view.extension.geode-explorer')

context.subscriptions.push(
    vscode.commands.registerCommand('geode.refreshSchema', async () => {
        await focus(); navigate('/sidebar/schema?refresh=1')
    }),
    vscode.commands.registerCommand('geode.history.clear', async () => {
        await focus(); navigate('/sidebar/history?clear=1')
    }),
    vscode.commands.registerCommand('geode.history.refresh', async () => {
        await focus(); navigate('/sidebar/history')
    }),
    vscode.commands.registerCommand('geode.history.rerunQuery', async (item?: { query: string }) => {
        if (item?.query) {
            // Insert into the active editor or open a scratch editor.
            const editor = vscode.window.activeTextEditor
            if (editor) await editor.edit((b) => b.insert(editor.selection.active, item.query))
        }
    }),
    vscode.commands.registerCommand('geode.history.copyQuery', async (item?: { query: string }) => {
        if (item?.query) await vscode.env.clipboard.writeText(item.query)
    }),
    vscode.commands.registerCommand('geode.history.insertQuery', async (item?: { query: string }) => {
        const editor = vscode.window.activeTextEditor
        if (editor && item?.query) await editor.edit((b) => b.insert(editor.selection.active, item.query))
    }),
    vscode.commands.registerCommand('geode.history.removeEntry', async (item?: { id: string }) => {
        if (item?.id) await serverClient.request(`/api/v1/history/${encodeURIComponent(item.id)}`, 'DELETE')
        navigate('/sidebar/history')
    }),
    vscode.commands.registerCommand('geode.savedQueries.save', async () => {
        await focus(); navigate('/sidebar/saved/new')
    }),
    vscode.commands.registerCommand('geode.savedQueries.refresh', async () => {
        await focus(); navigate('/sidebar/saved')
    }),
    vscode.commands.registerCommand('geode.savedQueries.open', async (item?: { id: string }) => {
        await focus(); navigate(`/sidebar/saved/${item?.id ?? ''}`)
    }),
    vscode.commands.registerCommand('geode.savedQueries.edit', async (item?: { id: string }) => {
        await focus(); navigate(`/sidebar/saved/${item?.id ?? ''}/edit`)
    }),
    vscode.commands.registerCommand('geode.savedQueries.delete', async (item?: { id: string }) => {
        if (item?.id) await serverClient.request(`/api/v1/saved/${encodeURIComponent(item.id)}`, 'DELETE')
        navigate('/sidebar/saved')
    }),
    vscode.commands.registerCommand('geode.savedQueries.run', async (item?: { id: string; query: string }) => {
        if (item?.query) await executeQuery(item.query)
    }),
    vscode.commands.registerCommand('geode.savedQueries.copy', async (item?: { query: string }) => {
        if (item?.query) await vscode.env.clipboard.writeText(item.query)
    }),
    vscode.commands.registerCommand('geode.savedQueries.exportAll', async () => {
        const data = await serverClient.request('/api/v1/saved/export', 'GET')
        const uri = await vscode.window.showSaveDialog({ filters: { JSON: ['json'] }, defaultUri: vscode.Uri.file('geode-saved-queries.json') })
        if (uri) {
            const fs = await import('fs/promises')
            await fs.writeFile(uri.fsPath, JSON.stringify(data, null, 2))
        }
    }),
    vscode.commands.registerCommand('geode.savedQueries.importAll', async () => {
        const uris = await vscode.window.showOpenDialog({ filters: { JSON: ['json'] }, canSelectMany: false })
        if (!uris || uris.length === 0) return
        const fs = await import('fs/promises')
        const text = await fs.readFile(uris[0].fsPath, 'utf8')
        await serverClient.request('/api/v1/saved/bulk', 'POST', text)
        navigate('/sidebar/saved')
    }),
)
```

- [ ] **Step 2: Remove the old `registerSchemaExplorerCommands` / `registerQueryHistoryCommands` / `registerSavedQueriesCommands` call sites** from earlier in `activate`.

- [ ] **Step 3: Compile + commit**

```bash
npm run compile
git add src/extension.ts
git commit -m "feat: re-route schema/history/saved commands to sidebar webview"
```

---

## Task 7: Delete the three old providers

**Files:**

- Delete: `src/views/EnhancedSchemaExplorerProvider.ts`
- Delete: `src/views/SchemaExplorerProvider.ts`
- Delete: `src/views/QueryHistoryProvider.ts`
- Delete: `src/views/SavedQueriesProvider.ts`
- Modify: `package.json` (remove three view declarations)

- [ ] **Step 1: Confirm no live references**

```bash
grep -rn "EnhancedSchemaExplorerProvider\|QueryHistoryProvider\|SavedQueriesProvider" src/
```

Expected: zero matches.

- [ ] **Step 2: Delete**

```bash
git rm src/views/EnhancedSchemaExplorerProvider.ts src/views/SchemaExplorerProvider.ts src/views/QueryHistoryProvider.ts src/views/SavedQueriesProvider.ts
```

If `src/views/` is empty after deletions, `rmdir src/views/`.

- [ ] **Step 3: Trim package.json views**

`contributes.views.geode-explorer` becomes:

```json
"geode-explorer": [
    {
        "type": "webview",
        "id": "geodeSidebar",
        "name": "Geode",
        "icon": "$(database)",
        "contextualTitle": "Geode"
    }
]
```

Remove the three `(legacy)` entries.

- [ ] **Step 4: Compile + commit**

```bash
npm run compile
git add -A
git commit -m "refactor: delete schema/history/saved tree providers (replaced by sidebar)"
```

---

## Task 8: E2E + CHANGELOG

**Files:**

- Create: `e2e/suite/sidebar-management.test.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: E2E smoke**

```typescript
import { strict as assert } from 'assert'
import * as vscode from 'vscode'

describe('sidebar management surfaces', () => {
    it('refreshSchema/historyClear/savedSave commands exist', async () => {
        const all = await vscode.commands.getCommands(true)
        ;['geode.refreshSchema', 'geode.history.clear', 'geode.savedQueries.save'].forEach((c) =>
            assert.ok(all.includes(c), `missing command: ${c}`)
        )
    })
})
```

- [ ] **Step 2: CHANGELOG**

```markdown
### Changed
- Schema explorer, query history, and saved queries now live in the
  geode-ui sidebar webview. Tree views removed. Persistence migrated
  from workspaceState/globalState to the bundled server's REST API.
  (sub-plan 4)

### Removed
- `src/views/EnhancedSchemaExplorerProvider.ts`
- `src/views/SchemaExplorerProvider.ts`
- `src/views/QueryHistoryProvider.ts`
- `src/views/SavedQueriesProvider.ts`
- `geodeSchemaExplorer`, `geodeQueryHistory`, `geodeSavedQueries` view declarations.
```

- [ ] **Step 3: Commit + merge candidate tag**

```bash
git add e2e/suite/sidebar-management.test.ts CHANGELOG.md
git commit -m "test+docs: schema/history/saved sub-plan"
```

Merge commit:

```text
Subject: feat: schema + history + saved queries via sidebar (sub-plan 4)

Implements docs/superpowers/plans/2026-05-25-geode-ui-integration-04-schema-history-saved.md
end-to-end. Next: sub-plan 5 (analytics panels).
```
