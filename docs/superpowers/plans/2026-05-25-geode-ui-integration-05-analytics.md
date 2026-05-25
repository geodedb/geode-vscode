# Sub-Plan 5 — Analytics Panels via geode-ui

> **For agentic workers:** REQUIRED SUB-SKILL: Use **superpowers:subagent-driven-development** (recommended) or **superpowers:executing-plans**. Sub-plans 1 and 3 must be merged.

**Goal:** Replace every remaining native analytics webview panel — graph view, graph visualization, path explorer, query plan, time series, performance metrics — with React webview panels backed by geode-ui SPA routes. Delete the `src/panels/*.ts` files (except the new `openResultsPanel.ts`) and the matching `src/webviews/*` asset directories. Move the row-to-graph extraction (`extractGraphElements`, `extractGraphData`) into the SPA, since the SPA already has equivalent logic.

**Architecture:** Each analytics command opens a `ReactWebviewPanel` on a dedicated SPA route. The shared bridge handlers (`http.request`, `query.execute`, `graph.expand`, `graph.related`) are registered per panel. Graph expansion (`buildExpandQuery`, `buildRelatedQuery`) moves into a new `src/bridge/handlers/graphOps.ts` so it stays close to the bridge layer; the SPA already knows how to render the resulting nodes/edges. Time-series and metrics commands route through `/api/v1/metrics/*` endpoints on the bundled server.

**Tech Stack:** Unchanged.

---

## Task 1: Graph ops handler

**Files:**

- Create: `src/bridge/handlers/graphOps.ts`
- Test: `src/test/bridge/graphOps.test.ts`

Bridge ops: `graph.expand`, `graph.related`. Each takes `{ nodeId, labels?, depth?, relationshipType? }` and returns `{ nodes, edges }`. Implementation re-uses `buildExpandQuery` / `buildRelatedQuery` (lifted from `src/panels/GraphVisualizationPanel.ts:1-150` before that file is deleted) and runs the result through `QueryRunner`.

- [ ] **Step 1: Lift the query builders**

Copy `buildExpandQuery` and `buildRelatedQuery` from `src/panels/GraphVisualizationPanel.ts` into the new file. They are pure string builders; preserve their bodies verbatim.

- [ ] **Step 2: Write the failing test**

Create `src/test/bridge/graphOps.test.ts`:

```typescript
import { strict as assert } from 'assert'
import { buildExpandQuery, createGraphOpsHandlers } from '../../bridge/handlers/graphOps'

describe('graph ops', () => {
    it('buildExpandQuery produces a MATCH on neighbours', () => {
        const q = buildExpandQuery('123', ['Person'], 1)
        assert.match(q, /MATCH/)
        assert.match(q, /123/)
    })

    it('expand handler runs the query and returns graph elements', async () => {
        const runner = {
            isConnected: true,
            async run(_s: string) {
                return {
                    columns: ['n', 'r', 'm'],
                    rows: [{ n: { _id: 1, _labels: ['Person'] }, r: { _id: 2, _type: 'KNOWS', _start: 1, _end: 3 }, m: { _id: 3, _labels: ['Person'] } }],
                    durationMs: 5,
                }
            },
        }
        const h = createGraphOpsHandlers({ runner })
        const out = await h.expand({ nodeId: '1', labels: ['Person'], depth: 1 })
        assert.equal(out.nodes.length, 2)
        assert.equal(out.edges.length, 1)
    })
})
```

- [ ] **Step 3: Implement**

```typescript
// src/bridge/handlers/graphOps.ts
import { QueryRunner } from './queryExecute'

export function buildExpandQuery(nodeId: string, labels: string[], depth: number): string {
    const label = labels[0] ?? 'Node'
    return `MATCH (n:${label} {_id:'${nodeId}'})-[r*1..${Math.max(1, depth)}]-(m) RETURN n, r, m LIMIT 100`
}

export function buildRelatedQuery(nodeId: string, relationshipType?: string): string {
    const rel = relationshipType ? `:${relationshipType}` : ''
    return `MATCH (n {_id:'${nodeId}'})-[r${rel}]-(m) RETURN n, r, m LIMIT 100`
}

interface RawNode { _id?: string | number; _labels?: string[]; labels?: string[]; properties?: Record<string, unknown> }
interface RawRel { _id?: string | number; _type?: string; type?: string; _start?: string | number; _end?: string | number; properties?: Record<string, unknown> }
type Cell = RawNode | RawRel | unknown

function isNode(v: Cell): v is RawNode {
    return !!v && typeof v === 'object' && ('_labels' in v || 'labels' in v) && !('_type' in v) && !('type' in (v as any))
}
function isRel(v: Cell): v is RawRel {
    return !!v && typeof v === 'object' && ('_type' in v || ('type' in v && '_start' in v))
}

export function extractGraph(rows: Array<Record<string, Cell>>): { nodes: any[]; edges: any[] } {
    const nodes = new Map<string, any>()
    const edges: any[] = []
    for (const row of rows) {
        for (const value of Object.values(row)) {
            const stack = Array.isArray(value) ? value : [value]
            for (const item of stack) {
                if (isNode(item)) {
                    const id = String(item._id ?? (item as any).id ?? `n-${nodes.size}`)
                    if (!nodes.has(id)) nodes.set(id, { id, labels: item._labels ?? item.labels ?? [], properties: item.properties ?? item })
                }
                if (isRel(item)) {
                    edges.push({
                        id: String(item._id ?? `e-${edges.length}`),
                        source: String(item._start ?? ''),
                        target: String(item._end ?? ''),
                        type: item._type ?? item.type,
                        properties: item.properties ?? item,
                    })
                }
            }
        }
    }
    return { nodes: [...nodes.values()], edges }
}

export function createGraphOpsHandlers(deps: { runner: QueryRunner }) {
    return {
        expand: async (payload: { nodeId: string; labels?: string[]; depth?: number }) => {
            const stmt = buildExpandQuery(payload.nodeId, payload.labels ?? [], payload.depth ?? 1)
            const result = await deps.runner.run(stmt)
            return extractGraph(result.rows as any)
        },
        related: async (payload: { nodeId: string; relationshipType?: string }) => {
            const stmt = buildRelatedQuery(payload.nodeId, payload.relationshipType)
            const result = await deps.runner.run(stmt)
            return extractGraph(result.rows as any)
        },
    }
}

export function registerGraphOpsHandlers(host: import('../host').BridgeHost, deps: { runner: QueryRunner }): void {
    const h = createGraphOpsHandlers(deps)
    host.register('graph.expand', h.expand)
    host.register('graph.related', h.related)
}
```

- [ ] **Step 4: Run + commit**

```bash
npm run compile && npx mocha out/test/bridge/graphOps.test.js
git add src/bridge/handlers/graphOps.ts src/test/bridge/graphOps.test.ts
git commit -m "feat(bridge): graph.expand/related handlers"
```

---

## Task 2: Open analytics panels via shared helper

**Files:**

- Modify: `src/panels/openResultsPanel.ts` → refactor and rename to `src/panels/openAnalyticsPanel.ts`
- Or create: `src/panels/openAnalyticsPanel.ts` (new) and keep `openResultsPanel.ts` calling it.

The original `openResultsPanel` becomes a thin wrapper around a generic `openAnalyticsPanel({ route, title })` helper.

- [ ] **Step 1: Implement**

```typescript
// src/panels/openAnalyticsPanel.ts
import * as vscode from 'vscode'
import { openReactWebviewPanel, OpenedPanel } from '../webview/ReactWebviewPanel'
import { ServerBootstrap } from '../webview/html'
import { BridgeHost } from '../bridge/host'

interface PanelKey { id: string; route: string; title: string; viewColumn?: vscode.ViewColumn }
const panels = new Map<string, OpenedPanel>()

export function openAnalyticsPanel(opts: {
    key: PanelKey
    extensionRoot: string
    serverInfo: ServerBootstrap
    register: (host: BridgeHost) => void
}): OpenedPanel {
    const existing = panels.get(opts.key.id)
    if (existing) {
        existing.panel.reveal(opts.key.viewColumn ?? vscode.ViewColumn.Two, true)
        return existing
    }
    const opened = openReactWebviewPanel({
        extensionRoot: opts.extensionRoot,
        route: opts.key.route,
        title: opts.key.title,
        viewColumn: opts.key.viewColumn ?? vscode.ViewColumn.Two,
        serverInfo: opts.serverInfo,
        register: opts.register,
    })
    panels.set(opts.key.id, opened)
    opened.panel.onDidDispose(() => panels.delete(opts.key.id))
    return opened
}
```

- [ ] **Step 2: Refactor openResultsPanel to use it**

```typescript
// src/panels/openResultsPanel.ts (simplified)
import { openAnalyticsPanel } from './openAnalyticsPanel'
// ... existing types/imports ...

export function openResultsPanel(opts: { extensionRoot: string; serverInfo: ServerBootstrap; registerCommon: (host: BridgeHost) => void }) {
    return openAnalyticsPanel({
        key: { id: 'results', route: '/query/results', title: 'Geode Results' },
        extensionRoot: opts.extensionRoot,
        serverInfo: opts.serverInfo,
        register: opts.registerCommon,
    })
}
```

- [ ] **Step 3: Commit**

```bash
git add src/panels/openAnalyticsPanel.ts src/panels/openResultsPanel.ts
git commit -m "refactor(panels): extract openAnalyticsPanel helper"
```

---

## Task 3: Replace graph visualization

**Files:**

- Modify: `src/extension.ts` (`geode.showGraphVisualization`, `geode.visualizeQuery`)
- Delete: `src/panels/GraphViewPanel.ts`
- Delete: `src/panels/GraphVisualizationPanel.ts`
- Delete: `src/webviews/graph/`

- [ ] **Step 1: New `showGraphVisualization`**

```typescript
import { openAnalyticsPanel } from './panels/openAnalyticsPanel'
import { registerGraphOpsHandlers } from './bridge/handlers/graphOps'

context.subscriptions.push(
    vscode.commands.registerCommand('geode.showGraphVisualization', async () => {
        openAnalyticsPanel({
            key: { id: 'graph', route: '/graph', title: 'Geode Graph', viewColumn: vscode.ViewColumn.Two },
            extensionRoot: context.extensionUri.fsPath,
            serverInfo: serverInfo!,
            register: (host) => {
                host.register('http.request', createHttpForwardHandler({ serverInfo: serverInfo! }))
                host.register('query.execute', createQueryExecuteHandler({ runner: queryRunner }))
                registerGraphOpsHandlers(host, { runner: queryRunner })
            },
        })
    }),
    vscode.commands.registerCommand('geode.visualizeQuery', async () => {
        const editor = vscode.window.activeTextEditor
        if (!editor) return vscode.window.showWarningMessage('No active editor')
        const text = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection)
        if (!text.trim()) return
        const panel = openAnalyticsPanel({
            key: { id: 'graph', route: `/graph?from=editor`, title: 'Geode Graph' },
            extensionRoot: context.extensionUri.fsPath,
            serverInfo: serverInfo!,
            register: (host) => {
                host.register('http.request', createHttpForwardHandler({ serverInfo: serverInfo! }))
                host.register('query.execute', createQueryExecuteHandler({ runner: queryRunner }))
                registerGraphOpsHandlers(host, { runner: queryRunner })
            },
        })
        const result = await queryRunner.run(text)
        const { extractGraph } = await import('./bridge/handlers/graphOps')
        const elements = extractGraph(result.rows as any)
        panel.panel.webview.postMessage({
            kind: 'event',
            op: 'graph.load',
            payload: { statement: text, ...elements, durationMs: result.durationMs },
        })
    }),
)
```

- [ ] **Step 2: Delete old graph panels**

```bash
git rm src/panels/GraphViewPanel.ts src/panels/GraphVisualizationPanel.ts
git rm -r src/webviews/graph/
```

- [ ] **Step 3: Compile + commit**

```bash
npm run compile
git add -A
git commit -m "feat: graph visualization via geode-ui (sub-plan 5)"
```

---

## Task 4: Replace performance metrics, time series, query plan, paths

**Files:**

- Modify: `src/extension.ts` (the four command registrations)
- Delete: `src/panels/PerformanceMetricsPanel.ts`
- Delete: `src/panels/TimeSeriesPanel.ts`
- Delete: `src/panels/QueryPlanPanel.ts`
- Delete: `src/panels/PathExplorerPanel.ts`
- Delete: `src/webviews/metrics/`
- Delete: `src/webviews/paths/`
- Delete: `src/panels/BaseWebviewPanel.ts` (now unused — verify)

- [ ] **Step 1: Replace each command with a one-liner that opens the SPA route**

```typescript
const registerSimplePanel = (cmd: string, key: string, route: string, title: string) =>
    vscode.commands.registerCommand(cmd, () => {
        openAnalyticsPanel({
            key: { id: key, route, title, viewColumn: vscode.ViewColumn.Two },
            extensionRoot: context.extensionUri.fsPath,
            serverInfo: serverInfo!,
            register: (host) => {
                host.register('http.request', createHttpForwardHandler({ serverInfo: serverInfo! }))
                host.register('query.execute', createQueryExecuteHandler({ runner: queryRunner }))
            },
        })
    })

context.subscriptions.push(
    registerSimplePanel('geode.showPerformanceMetrics', 'metrics', '/dashboard', 'Geode Metrics'),
    registerSimplePanel('geode.showAnalyticsDashboard', 'dashboard', '/dashboard', 'Geode Analytics'),
    registerSimplePanel('geode.showQueryPlan', 'plan', '/query/plan', 'Query Plan'),
    registerSimplePanel('geode.showPathExplorer', 'paths', '/graph/paths', 'Path Explorer'),
)
```

Replace the existing call sites for `PerformanceMetricsPanel.createOrShow`, `registerQueryPlanPanel`, `registerTimeSeriesPanel`.

- [ ] **Step 2: Delete the panels**

```bash
git rm src/panels/PerformanceMetricsPanel.ts src/panels/TimeSeriesPanel.ts src/panels/QueryPlanPanel.ts src/panels/PathExplorerPanel.ts
git rm -r src/webviews/metrics src/webviews/paths
```

Verify `BaseWebviewPanel.ts` has no remaining importers:

```bash
grep -rn "BaseWebviewPanel" src/
```

If empty, delete it too:

```bash
git rm src/panels/BaseWebviewPanel.ts
```

- [ ] **Step 3: Trim `src/webviews/shared/` if no longer referenced**

```bash
grep -rn "webviews/shared" src/
```

If empty, `git rm -r src/webviews/shared/`. If still referenced, leave it.

- [ ] **Step 4: Compile + commit**

```bash
npm run compile
git add -A
git commit -m "feat: analytics panels via geode-ui (sub-plan 5)"
```

---

## Task 5: Strip extractGraphData / extractGraphElements from extension.ts

**Files:**

- Modify: `src/extension.ts` (delete the two helper functions and their importers)

These functions are now in `src/bridge/handlers/graphOps.ts:extractGraph`. The extension host no longer uses them — graph rows go directly into the SPA via `graph.load` event, and the SPA already has its own row-to-element extractor.

- [ ] **Step 1: Delete**

Remove `extractGraphData`, `extractGraphElements`, `processGraphItem`, and the `GraphData`/`GraphNode`/`GraphEdge` imports from `src/extension.ts`.

- [ ] **Step 2: Compile + commit**

```bash
npm run compile
git add src/extension.ts
git commit -m "refactor: extract graph helpers, delete in-host extractors"
```

---

## Task 6: E2E + CHANGELOG

**Files:**

- Create: `e2e/suite/analytics-panels.test.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: E2E smoke**

```typescript
import { strict as assert } from 'assert'
import * as vscode from 'vscode'

describe('analytics panels', () => {
    it('exposes all analytics commands', async () => {
        const all = await vscode.commands.getCommands(true)
        ;[
            'geode.showGraphVisualization',
            'geode.visualizeQuery',
            'geode.showPerformanceMetrics',
            'geode.showAnalyticsDashboard',
            'geode.showQueryPlan',
            'geode.showPathExplorer',
        ].forEach((c) => assert.ok(all.includes(c), `missing: ${c}`))
    })

    it('opening the dashboard does not throw', async () => {
        await vscode.commands.executeCommand('geode.showAnalyticsDashboard')
        await new Promise((r) => setTimeout(r, 3_000))
        assert.ok(true)
    })
})
```

- [ ] **Step 2: CHANGELOG**

```markdown
### Changed
- All analytics surfaces (graph visualization, query plan, time series,
  performance metrics, path explorer) now open as React webview panels
  backed by geode-ui SPA routes. Native panel implementations are
  removed. (sub-plan 5)

### Removed
- `src/panels/GraphViewPanel.ts`
- `src/panels/GraphVisualizationPanel.ts`
- `src/panels/PathExplorerPanel.ts`
- `src/panels/PerformanceMetricsPanel.ts`
- `src/panels/QueryPlanPanel.ts`
- `src/panels/TimeSeriesPanel.ts`
- `src/panels/BaseWebviewPanel.ts`
- `src/webviews/graph/`, `src/webviews/metrics/`, `src/webviews/paths/`, `src/webviews/shared/` (when unreferenced).
- In-extension `extractGraphData` / `extractGraphElements` helpers (logic moved to `src/bridge/handlers/graphOps.ts`).
```

- [ ] **Step 3: Commit + merge candidate tag**

```bash
git add e2e/suite/analytics-panels.test.ts CHANGELOG.md
git commit -m "test+docs: analytics sub-plan"
```

Merge commit:

```text
Subject: feat: analytics panels via geode-ui (sub-plan 5)

Implements docs/superpowers/plans/2026-05-25-geode-ui-integration-05-analytics.md
end-to-end. Next: sub-plan 6 (eliminate CLI).
```
