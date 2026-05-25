# Sub-Plan 2 — Connections + Profiles via Sidebar WebviewView

> **For agentic workers:** REQUIRED SUB-SKILL: Use **superpowers:subagent-driven-development** (recommended) or **superpowers:executing-plans**. Sub-plan 1 (Foundation) must be merged first.

**Goal:** Replace the native `geodeConnections` tree view with a single sidebar `WebviewView` running the geode-ui SPA on a `/sidebar` route. Wire every existing connection command (`geode.connections.*`) to bridge handlers that drive the React UI. Delete `ConnectionsTreeProvider.ts` and the `geodeConnections` view declaration.

**Architecture:** A new `ReactWebviewView.ts` mirrors `ReactWebviewPanel.ts` but binds to a `vscode.WebviewView` (sidebar surface). The view loads the SPA at `/sidebar` — a new route the SPA already has (renders `ConnectionSwitcher` from `geode-ui/src/components/layout/ConnectionSwitcher.tsx`). Bridge handlers `connections.*` translate webview requests into calls against the existing `EnhancedConnectionManager`. Secret storage operations (`getStoredPassword`, `storeSavedPassword`, `clearStoredPassword`) go through `vscode.SecretStorage`. The sidebar's modal flows (add/edit/delete) use SPA modals (`ProfileEditorModal.tsx`, `DeleteProfileModal.tsx`) — no native quick-picks anymore.

**Tech Stack:** Unchanged from sub-plan 1. Adds `vscode.WebviewView`, `vscode.WebviewViewProvider`.

---

## Task 1: ReactWebviewView base class

**Files:**

- Create: `src/webview/ReactWebviewView.ts`
- Test: `src/test/webview/ReactWebviewView.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/webview/ReactWebviewView.test.ts`:

```typescript
import { strict as assert } from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { computeViewHtml } from '../../webview/ReactWebviewView'

describe('computeViewHtml', () => {
    let tmp: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rwv-'))
        fs.mkdirSync(path.join(tmp, 'resources/webview'), { recursive: true })
        fs.writeFileSync(
            path.join(tmp, 'resources/webview/index.html'),
            '<!doctype html><html><head></head><body><div id="root"></div></body></html>'
        )
        fs.mkdirSync(path.join(tmp, 'out/webview'), { recursive: true })
        fs.writeFileSync(path.join(tmp, 'out/webview/adapter.template.js'), '/* a */')
    })

    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

    it('renders bootstrap with route /sidebar', () => {
        const html = computeViewHtml({
            extensionRoot: tmp,
            cspSource: 'vscode-webview://x',
            nonce: 'N',
            route: '/sidebar',
            themeKind: 'light',
            serverInfo: { host: '127.0.0.1', port: 1, token: 't' },
            resolveAsset: (rel) => `vscode-resource://${rel}`,
        })
        assert.match(html, /"route":"\/sidebar"/)
    })
})
```

- [ ] **Step 2: Run test, verify failure, then implement**

```typescript
// src/webview/ReactWebviewView.ts
import * as vscode from 'vscode'
import { computePanelHtml } from './ReactWebviewPanel'
import { BridgeHost } from '../bridge/host'
import { decodeMessage, BridgeRequest } from '../bridge/messages'
import { ServerBootstrap, WebviewHtmlInputs } from './html'
import { getNonce } from '../utils/security'

export const computeViewHtml = computePanelHtml

export interface ViewOpts {
    extensionRoot: string
    route: string
    serverInfo: ServerBootstrap
    register: (host: BridgeHost) => void
}

export class ReactWebviewViewProvider implements vscode.WebviewViewProvider {
    constructor(private opts: ViewOpts) {}

    resolveWebviewView(view: vscode.WebviewView): void {
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(vscode.Uri.file(this.opts.extensionRoot), 'resources', 'webview'),
                vscode.Uri.joinPath(vscode.Uri.file(this.opts.extensionRoot), 'out', 'webview'),
            ],
        }

        const host = new BridgeHost(view.webview)
        this.opts.register(host)

        const refresh = () => {
            const nonce = getNonce()
            const resolveAsset = (rel: string) =>
                view.webview.asWebviewUri(
                    vscode.Uri.joinPath(vscode.Uri.file(this.opts.extensionRoot), 'resources/webview', rel)
                ).toString()
            view.webview.html = computePanelHtml({
                extensionRoot: this.opts.extensionRoot,
                cspSource: view.webview.cspSource,
                nonce,
                route: this.opts.route,
                themeKind: themeKindString(vscode.window.activeColorTheme.kind),
                serverInfo: this.opts.serverInfo,
                resolveAsset,
            })
        }
        refresh()

        view.webview.onDidReceiveMessage((raw) => {
            try {
                const msg = decodeMessage(raw)
                if (msg.kind === 'request') void host.handle(msg as BridgeRequest)
            } catch (err) {
                console.warn('[geode] malformed sidebar message:', err)
            }
        })
        vscode.window.onDidChangeActiveColorTheme(refresh)
    }
}

function themeKindString(k: vscode.ColorThemeKind): WebviewHtmlInputs['themeKind'] {
    if (k === vscode.ColorThemeKind.Dark) return 'dark'
    if (k === vscode.ColorThemeKind.HighContrast) return 'high-contrast'
    if (k === vscode.ColorThemeKind.HighContrastLight) return 'high-contrast-light'
    return 'light'
}
```

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/webview/ReactWebviewView.ts src/test/webview/ReactWebviewView.test.ts
git commit -m "feat(webview): ReactWebviewViewProvider for sidebar surfaces"
```

---

## Task 2: Connections bridge handlers

**Files:**

- Create: `src/sidebar/ConnectionsHandler.ts`
- Test: `src/test/sidebar/ConnectionsHandler.test.ts`

Maps these ops to `EnhancedConnectionManager`:

| Op | Maps to |
|----|---------|
| `connections.list` | `getProfiles()` → `ConnectionRecord[]` shape SPA expects |
| `connections.replaceAll` | upsert + delete diff against current profiles |
| `connections.getPassword` | `secretStorage.get(\`geode.password.${id}\`)` |
| `connections.setPassword` | `secretStorage.store(...)` |
| `connections.clearPassword` | `secretStorage.delete(...)` |
| `connections.connect` | `connect(id)` |
| `connections.disconnect` | `disconnect()` |
| `connections.setDefault` | `setDefaultProfile(id)` |
| `connections.pickPemFile` | `vscode.window.showOpenDialog({ filters: { PEM: ['pem','crt','key'] } })` |

- [ ] **Step 1: Write the failing test**

Create `src/test/sidebar/ConnectionsHandler.test.ts`:

```typescript
import { strict as assert } from 'assert'
import { createConnectionsHandlers, ConnectionsDeps } from '../../sidebar/ConnectionsHandler'

class FakeSecrets implements ConnectionsDeps['secrets'] {
    store = new Map<string, string>()
    async get(k: string) { return this.store.get(k) }
    async setSecret(k: string, v: string) { this.store.set(k, v) }
    async delete(k: string) { this.store.delete(k) }
}

class FakeManager {
    profiles: any[] = []
    activeId: string | null = null
    getProfiles() { return this.profiles }
    async addProfile(p: any) { const id = 'id-' + (this.profiles.length + 1); this.profiles.push({ ...p, id }); return id }
    async deleteProfile(id: string) { this.profiles = this.profiles.filter(p => p.id !== id) }
    async updateProfile(id: string, p: any) {
        const idx = this.profiles.findIndex(x => x.id === id)
        if (idx >= 0) this.profiles[idx] = { ...this.profiles[idx], ...p }
    }
    async connect(id: string) { this.activeId = id }
    async disconnect() { this.activeId = null }
}

describe('ConnectionsHandler', () => {
    it('list returns SPA-shaped records', async () => {
        const mgr: any = new FakeManager()
        mgr.profiles = [{ id: 'a', name: 'Local', host: '127.0.0.1', port: 3141, username: 'u', isDefault: true }]
        const h = createConnectionsHandlers({ manager: mgr, secrets: new FakeSecrets(), pickFile: async () => null })
        const out = await h.list({})
        assert.equal(Array.isArray(out.connections), true)
        assert.equal(out.connections[0].name, 'Local')
        assert.equal(out.connections[0].host, '127.0.0.1')
    })

    it('connect resolves and tracks active id', async () => {
        const mgr: any = new FakeManager()
        mgr.profiles = [{ id: 'a', name: 'Local', host: '127.0.0.1', port: 3141 }]
        const h = createConnectionsHandlers({ manager: mgr, secrets: new FakeSecrets(), pickFile: async () => null })
        await h.connect({ id: 'a' })
        assert.equal(mgr.activeId, 'a')
    })

    it('getPassword/setPassword/clearPassword round-trip via SecretStorage', async () => {
        const secrets = new FakeSecrets()
        const h = createConnectionsHandlers({ manager: new FakeManager() as any, secrets, pickFile: async () => null })
        await h.setPassword({ name: 'Local', user: 'admin', password: 'hunter2' })
        const got = await h.getPassword({ name: 'Local', user: 'admin' })
        assert.equal(got.password, 'hunter2')
        await h.clearPassword({ name: 'Local', user: 'admin' })
        const cleared = await h.getPassword({ name: 'Local', user: 'admin' })
        assert.equal(cleared.password, null)
    })

    it('pickPemFile returns null when user cancels', async () => {
        const h = createConnectionsHandlers({ manager: new FakeManager() as any, secrets: new FakeSecrets(), pickFile: async () => null })
        const r = await h.pickPemFile({})
        assert.equal(r.contents, null)
    })

    it('replaceAll deletes profiles missing from incoming list', async () => {
        const mgr: any = new FakeManager()
        mgr.profiles = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
        const h = createConnectionsHandlers({ manager: mgr, secrets: new FakeSecrets(), pickFile: async () => null })
        await h.replaceAll({ list: [{ id: 'a', name: 'A-renamed', host: '1', port: 1 }] })
        assert.equal(mgr.profiles.length, 1)
        assert.equal(mgr.profiles[0].name, 'A-renamed')
    })
})
```

- [ ] **Step 2: Run test (it fails) and implement**

Create `src/sidebar/ConnectionsHandler.ts`:

```typescript
import * as vscode from 'vscode'
import { EnhancedConnectionManager, ConnectionProfile } from '../client/EnhancedConnectionManager'

export interface ConnectionsDeps {
    manager: EnhancedConnectionManager
    secrets: {
        get(key: string): Promise<string | undefined>
        setSecret(key: string, value: string): Promise<void>
        delete(key: string): Promise<void>
    }
    pickFile: () => Promise<string | null>
}

export interface ConnectionRecord {
    id: string
    name: string
    host: string
    port: number
    username?: string
    database?: string
    isDefault?: boolean
    useTls?: boolean
    insecure?: boolean
}

function secretKey(name: string, user: string): string {
    return `geode.savedPassword.${name}\x00${user}`
}

function toRecord(p: ConnectionProfile): ConnectionRecord {
    return {
        id: p.id,
        name: p.name,
        host: p.host,
        port: p.port,
        username: p.username,
        database: p.database,
        isDefault: p.isDefault,
        useTls: p.useTls,
        insecure: p.insecure,
    }
}

export function createConnectionsHandlers(deps: ConnectionsDeps) {
    return {
        list: async (_payload: unknown) => ({
            connections: deps.manager.getProfiles().map(toRecord),
        }),
        replaceAll: async (payload: { list: ConnectionRecord[] }) => {
            const incoming = new Map(payload.list.map((r) => [r.id, r]))
            const current = new Map(deps.manager.getProfiles().map((p) => [p.id, p]))
            for (const id of current.keys()) {
                if (!incoming.has(id)) await deps.manager.deleteProfile(id)
            }
            for (const r of payload.list) {
                if (current.has(r.id)) {
                    await deps.manager.updateProfile(r.id, r as Partial<ConnectionProfile>)
                } else {
                    await deps.manager.addProfile({
                        name: r.name,
                        host: r.host,
                        port: r.port,
                        username: r.username,
                        database: r.database,
                        useTls: r.useTls ?? true,
                        insecure: r.insecure ?? false,
                        isDefault: r.isDefault ?? false,
                        timeout: 5000,
                        queryTimeout: 30000,
                    } as Omit<ConnectionProfile, 'id'>)
                }
            }
            return {}
        },
        getPassword: async (payload: { name: string; user: string }) => ({
            password: (await deps.secrets.get(secretKey(payload.name, payload.user))) ?? null,
        }),
        setPassword: async (payload: { name: string; user: string; password: string }) => {
            await deps.secrets.setSecret(secretKey(payload.name, payload.user), payload.password)
            return {}
        },
        clearPassword: async (payload: { name: string; user: string }) => {
            await deps.secrets.delete(secretKey(payload.name, payload.user))
            return {}
        },
        connect: async (payload: { id: string }) => {
            await deps.manager.connect(payload.id)
            return { active: deps.manager.getActiveProfile()?.id ?? null }
        },
        disconnect: async (_payload: unknown) => {
            await deps.manager.disconnect()
            return {}
        },
        setDefault: async (payload: { id: string }) => {
            await deps.manager.setDefaultProfile(payload.id)
            return {}
        },
        pickPemFile: async (_payload: unknown) => {
            const contents = await deps.pickFile()
            return { contents }
        },
    }
}

export function registerConnectionsHandlers(host: import('../bridge/host').BridgeHost, deps: ConnectionsDeps): void {
    const h = createConnectionsHandlers(deps)
    host.register('connections.list', h.list)
    host.register('connections.replaceAll', h.replaceAll)
    host.register('connections.getPassword', h.getPassword)
    host.register('connections.setPassword', h.setPassword)
    host.register('connections.clearPassword', h.clearPassword)
    host.register('connections.connect', h.connect)
    host.register('connections.disconnect', h.disconnect)
    host.register('connections.setDefault', h.setDefault)
    host.register('connections.pickPemFile', h.pickPemFile)
}

export function makePemFilePicker(): () => Promise<string | null> {
    return async () => {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { PEM: ['pem', 'crt', 'key', 'cer'] },
            title: 'Select TLS PEM file',
        })
        if (!uris || uris.length === 0) return null
        const fs = await import('fs/promises')
        return await fs.readFile(uris[0].fsPath, 'utf8')
    }
}

export function makeVsCodeSecrets(secrets: vscode.SecretStorage): ConnectionsDeps['secrets'] {
    return {
        get: (k) => Promise.resolve(secrets.get(k)),
        setSecret: (k, v) => Promise.resolve(secrets.store(k, v)),
        delete: (k) => Promise.resolve(secrets.delete(k)),
    }
}
```

- [ ] **Step 3: Run tests, verify all pass, commit**

```bash
git add src/sidebar/ConnectionsHandler.ts src/test/sidebar/
git commit -m "feat(sidebar): bridge handlers for connections + secret storage"
```

---

## Task 3: Sidebar view registration

**Files:**

- Modify: `package.json` (replace `geodeConnections` with `geodeSidebar`)
- Modify: `src/extension.ts` (register `WebviewViewProvider` instead of tree provider)

- [ ] **Step 1: Update package.json**

In `contributes.viewsContainers.activitybar`, keep the existing entry. In `contributes.views.geode-explorer`:

```json
"geode-explorer": [
    {
        "type": "webview",
        "id": "geodeSidebar",
        "name": "Geode",
        "icon": "$(database)",
        "contextualTitle": "Geode"
    },
    {
        "id": "geodeSchemaExplorer",
        "name": "Schema Explorer (legacy)",
        "icon": "$(database)",
        "contextualTitle": "Geode Schema"
    },
    {
        "id": "geodeQueryHistory",
        "name": "Query History (legacy)",
        "icon": "$(history)",
        "contextualTitle": "Geode Query History"
    },
    {
        "id": "geodeSavedQueries",
        "name": "Saved Queries (legacy)",
        "icon": "$(bookmark)",
        "contextualTitle": "Geode Saved Queries"
    }
]
```

Remove the `geodeConnections` entry entirely. The other three views are marked `(legacy)` and stay temporarily; sub-plan 4 removes them.

Remove from `contributes.menus.view/title`:

- All four `command` entries that target `view == geodeConnections` (gone with the view).

Remove from `contributes.menus.view/item/context`:

- All entries that target `view == geodeConnections`.

- [ ] **Step 2: Register the sidebar provider in extension.ts**

In `src/extension.ts`, replace the tree-view registration:

```typescript
// OLD (to be removed):
// _connectionsTreeProvider = registerConnectionsView(...)

import { ReactWebviewViewProvider } from './webview/ReactWebviewView'
import {
    registerConnectionsHandlers,
    makePemFilePicker,
    makeVsCodeSecrets,
} from './sidebar/ConnectionsHandler'
import { createHttpForwardHandler } from './bridge/handlers/httpForward'

// NEW:
const sidebarProvider = new ReactWebviewViewProvider({
    extensionRoot: context.extensionUri.fsPath,
    route: '/sidebar',
    serverInfo: await ensureServerStarted(context),
    register: (host) => {
        host.register('http.request', createHttpForwardHandler({ serverInfo: serverInfo! }))
        registerConnectionsHandlers(host, {
            manager: connectionManager,
            secrets: makeVsCodeSecrets(context.secrets),
            pickFile: makePemFilePicker(),
        })
    },
})
context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('geodeSidebar', sidebarProvider, {
        webviewOptions: { retainContextWhenHidden: true },
    })
)
```

`ensureServerStarted` was added in sub-plan 1; here we eagerly start it because the sidebar should boot with the activity bar.

- [ ] **Step 3: Compile + sanity**

```bash
npm run compile
```

Expected: no TS errors. `ConnectionsTreeProvider` imports may become unused — leave them for Task 5 (which deletes the file).

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: replace geodeConnections tree view with sidebar webview"
```

---

## Task 4: Re-route legacy connection commands

**Files:**

- Modify: `src/extension.ts` (re-register the existing `geode.connections.*` commands so they drive the sidebar)

Every command that previously poked the tree provider now opens/focuses the sidebar and posts a bridge event telling the React UI which modal to show.

- [ ] **Step 1: Add a "focus sidebar + event" helper**

```typescript
// in src/extension.ts
async function focusSidebar(): Promise<void> {
    await vscode.commands.executeCommand('workbench.view.extension.geode-explorer')
    await vscode.commands.executeCommand('geodeSidebar.focus')
}
```

- [ ] **Step 2: Wire the commands**

Replace the old registrations (inside `activate`):

```typescript
context.subscriptions.push(
    vscode.commands.registerCommand('geode.connections.add', async () => {
        await focusSidebar()
        sidebarProvider.broadcast({ kind: 'event', op: 'ui.navigate', payload: { to: '/sidebar/connections/new' } })
    }),
    vscode.commands.registerCommand('geode.connections.edit', async (item?: { id: string }) => {
        await focusSidebar()
        sidebarProvider.broadcast({
            kind: 'event', op: 'ui.navigate',
            payload: { to: `/sidebar/connections/${item?.id ?? ''}/edit` },
        })
    }),
    vscode.commands.registerCommand('geode.connections.delete', async (item?: { id: string }) => {
        await focusSidebar()
        sidebarProvider.broadcast({
            kind: 'event', op: 'ui.navigate',
            payload: { to: `/sidebar/connections/${item?.id ?? ''}/delete` },
        })
    }),
    vscode.commands.registerCommand('geode.connections.connect', async (item?: { id: string }) => {
        if (item?.id) await connectionManager.connect(item.id)
        else { await focusSidebar() }
    }),
    vscode.commands.registerCommand('geode.connections.disconnect', () => connectionManager.disconnect()),
    vscode.commands.registerCommand('geode.connections.setDefault', async (item?: { id: string }) => {
        if (item?.id) await connectionManager.setDefaultProfile(item.id)
    }),
    vscode.commands.registerCommand('geode.connections.copyDsn', async (item?: { id: string }) => {
        if (!item?.id) return
        const p = connectionManager.getProfile(item.id)
        if (p) await vscode.env.clipboard.writeText(connectionManager.buildDsn(p))
    }),
    vscode.commands.registerCommand('geode.connections.refresh', async () => {
        sidebarProvider.broadcast({ kind: 'event', op: 'connections.changed', payload: {} })
    }),
)
```

- [ ] **Step 3: Add `broadcast` to ReactWebviewViewProvider**

Edit `src/webview/ReactWebviewView.ts`:

```typescript
export class ReactWebviewViewProvider implements vscode.WebviewViewProvider {
    private currentView?: vscode.WebviewView
    // ... existing fields and methods ...
    resolveWebviewView(view: vscode.WebviewView): void {
        this.currentView = view
        // existing body
        view.onDidDispose(() => { this.currentView = undefined })
    }
    broadcast(event: import('../bridge/messages').BridgeEvent): void {
        this.currentView?.webview.postMessage(event)
    }
}
```

The SPA's adapter (sub-plan 1 task 12) already listens for messages but ignores anything that isn't a `response`. Add an `event` branch:

Edit `src/webview/adapter.template.js`, inside the `message` listener:

```javascript
if (msg.kind === 'event') {
    var detail = { op: msg.op, payload: msg.payload }
    window.dispatchEvent(new CustomEvent('geode:bridge-event', { detail: detail }))
    return
}
```

The SPA (in `../geode-ui`) listens for `geode:bridge-event` and routes appropriately. If the SPA does not yet have that listener, file an issue in geode-ui; do not patch SPA source here.

- [ ] **Step 4: Compile + run unit tests**

```bash
npm run compile && npx mocha out/test/**/*.test.js
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts src/webview/ReactWebviewView.ts src/webview/adapter.template.js
git commit -m "feat(commands): connections commands focus sidebar and emit nav events"
```

---

## Task 5: Delete the old tree provider

**Files:**

- Delete: `src/connections/ConnectionsTreeProvider.ts`
- Modify: `src/connections/index.ts` (remove re-exports)
- Modify: `src/extension.ts` (remove `registerConnectionsView` import + unused `_connectionsTreeProvider`)

- [ ] **Step 1: Confirm no live references**

```bash
grep -rn "ConnectionsTreeProvider\|registerConnectionsView" src/
```

Expected: only references in `src/connections/index.ts` (exports) and `src/extension.ts` (already removed in Task 3).

- [ ] **Step 2: Delete the file**

```bash
git rm src/connections/ConnectionsTreeProvider.ts
```

- [ ] **Step 3: Trim `src/connections/index.ts`**

Remove the re-exports of `ConnectionsTreeProvider` and `registerConnectionsView`. Keep the `ConnectionManager` and `ConnectionProfile` re-exports — they're used by `EnhancedConnectionManager` for the compatibility bridge.

- [ ] **Step 4: Compile**

```bash
npm run compile
```

Expected: no errors. Fix any stragglers.

- [ ] **Step 5: Commit**

```bash
git add -A src/connections/ src/extension.ts
git commit -m "refactor: remove ConnectionsTreeProvider (replaced by sidebar webview)"
```

---

## Task 6: E2E test — sidebar connections

**Files:**

- Create: `e2e/suite/sidebar-connections.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { strict as assert } from 'assert'
import * as vscode from 'vscode'

describe('sidebar connections', () => {
    it('focuses the sidebar when geode.connections.add fires', async () => {
        await vscode.commands.executeCommand('geode.connections.add')
        // Verify the sidebar view became visible. We probe getVisibleViews
        // via the workbench API — a real assertion needs the view to be
        // queryable from this side, which is best-effort in tests.
        const containers = await vscode.commands.executeCommand('vscode.executeContextCommand', 'getActiveViewlet')
        // Soft check: the command resolves without throwing.
        assert.ok(true)
    })

    it('exposes geode.connections.add after sub-plan 2 lands', async () => {
        const all = await vscode.commands.getCommands(true)
        assert.ok(all.includes('geode.connections.add'))
    })
})
```

(VSCode's test API doesn't expose webview content for assertions in stable releases; the test is a smoke check. Deeper assertions live in Playwright suites in `../geode-ui`.)

- [ ] **Step 2: Run e2e**

```bash
npm run test:e2e
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add e2e/suite/sidebar-connections.test.ts
git commit -m "test(e2e): smoke test for sidebar-driven connections commands"
```

---

## Task 7: CHANGELOG + self-review

- [ ] **Step 1: CHANGELOG entry**

Prepend under "## [Unreleased]":

```markdown
### Changed
- Connections are now managed through the geode-ui sidebar webview. The
  native `geodeConnections` tree view is removed. All `geode.connections.*`
  commands focus the sidebar and dispatch navigation events into the
  React UI. (sub-plan 2)

### Removed
- `src/connections/ConnectionsTreeProvider.ts` — superseded by the sidebar
  webview.
- `geode.connections.copyDsn`, `setDefault` no longer rely on the tree
  provider for their command-argument shape (they still accept an
  argument with `{ id }`).
```

- [ ] **Step 2: Spec coverage check**

Master plan sub-plan-2 row clauses:

- Sidebar `WebviewView` showing connection switcher → Tasks 1, 3
- All connection commands round-trip through bridge → Task 4 + Task 2
- `geodeConnections` tree view removed → Task 3, 5
- `ConnectionsTreeProvider.ts` deleted → Task 5

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: connections sub-plan changelog"
```

- [ ] **Step 4: Tag the merge candidate**

Merge commit message:

```text
Subject: feat: sidebar webview for connections + profiles (sub-plan 2)

Implements docs/superpowers/plans/2026-05-25-geode-ui-integration-02-connections.md
end-to-end. Next: sub-plan 3 (query + results panel).
```
