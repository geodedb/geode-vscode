# Geode UI Integration — Master Plan

> **For agentic workers:** This is the **master plan** that sequences six sub-plans. Each sub-plan is independently shippable. Execute them in order. Use **superpowers:subagent-driven-development** (recommended) or **superpowers:executing-plans** for each sub-plan.

**Goal:** Fully replace every UI surface in the `geode-vscode` extension with the React-based `geode-ui` SPA, bundle the `geode-ui` Go server binary so the extension is self-contained, and eliminate the dependency on a host-installed `geode` CLI.

**Architecture:**

- The VSCode extension bundles two per-platform binaries: the **geode-ui Go server** (`cmd/server` in `../geode-ui`) which serves the SPA + REST/WS API, and the **geode** graph-DB binary (sibling repo, provides LSP via `geode serve --lsp-port`). Both binaries ship inside the VSIX under `resources/bin/<platform>/`.
- The SPA is also bundled separately (as `resources/webview/`) because VSCode webviews load HTML/JS by file URI — not from the embedded `//go:embed` HTTP path. The geode-ui server still serves `/api/v1/*` and `/ws/*` over localhost; the webview hits those via a thin VSCode message-bridge transport in the extension host.
- The extension host owns lifecycle of both binaries (spawn on activation, kill on deactivate, port allocation), credentials (VSCode `SecretStorage`), and connection state. The webview never holds long-lived secrets and never opens raw network connections; every API call posts a JSON message to the host, which translates to an HTTP call on localhost.
- Tree views are **removed entirely** (`geodeConnections`, `geodeSchemaExplorer`, `geodeQueryHistory`, `geodeSavedQueries`). The sidebar uses a single `WebviewView` running the SPA on a chrome-less route (`/sidebar`). Detail screens (results, graph, query plan, metrics, admin, profiles) open as editor-area `WebviewPanel`s on routes like `/results`, `/graph`, `/admin`, etc.
- Native VSCode features that aren't UI — language registration, grammars, snippets, formatting via `vscode.languages.registerDocumentFormattingEditProvider` — stay. LSP also stays, but switches from `cp.spawn('geode', ['lsp'])` to a `vscode-ws-jsonrpc` WebSocket client connected to `ws://localhost:<port>/ws/lsp` on the bundled geode-ui server.

**Tech Stack:**

- Extension host: TypeScript, `vscode` API, `vscode-languageclient`, `vscode-ws-jsonrpc`, `child_process` (only for binary spawn), `node:net` (port probe).
- Webview: pre-built `@geodedb/ui` React SPA (no build step in this repo; pulled as static dist).
- Build: npm scripts orchestrate fetching `geode-ui` artifacts (SPA dist + server binary) and `geode` binary from their respective GitLab Generic Package registries during `npm run prepackage`. Local dev uses `file:../geode-ui` symlinks when present.
- Testing: existing Mocha test suite for extension host; Jest for SPA (lives in `../geode-ui`, not touched here); new Playwright smoke tests under `e2e/` to drive the extension via `@vscode/test-electron`.

---

## Hard Rules (apply to every sub-plan)

1. **No new top-level frameworks in `geode-vscode`.** No webpack, no React build, no babel. The SPA is a black-box dist consumed verbatim.
2. **No emoji in code, comments, or commit messages.** This repo's CONTRIBUTING.md forbids them.
3. **Every public API in the extension host that talks to a binary spawns it through one of two helpers:** `GeodeServerProcess` (geode-ui server) and `GeodeLspProcess` (geode binary for LSP). Never `cp.spawn` directly outside these.
4. **Every webview message has a typed schema.** Schemas live in `src/bridge/messages.ts` and are shared by host and webview-adapter sides.
5. **CSP stays strict.** `default-src 'none'`; only `webview.cspSource` and nonces; no `unsafe-inline` for scripts.
6. **TDD enforced.** Every behavior task pairs a failing test with the implementation. Existing tests must keep passing across every sub-plan.
7. **Frequent commits.** One conceptual change per commit. Each sub-plan ends with the extension installable (`vsce package` succeeds) and bootable.

---

## File Structure (after all 6 sub-plans land)

```text
geode-vscode/
  package.json                          # commands + activation; tree views REMOVED
  scripts/
    fetch-geode-ui.mjs                  # NEW: pulls SPA dist + server binary
    fetch-geode-binary.mjs              # NEW: pulls graph-DB binary
    verify-bundled-assets.mjs           # NEW: SHA256 + smoke imports
  resources/                            # NEW: bundled-asset root
    webview/                            # SPA dist (index.html, *.js, *.woff2, ...)
    bin/
      linux-x64/    geode-ui  geode
      linux-arm64/  geode-ui  geode
      darwin-x64/   geode-ui  geode
      darwin-arm64/ geode-ui  geode
      win32-x64/    geode-ui.exe  geode.exe
  src/
    extension.ts                        # activation; orchestrates services
    bridge/                             # NEW: webview <-> host message protocol
      messages.ts                       # typed message schemas
      host.ts                           # host-side dispatcher
      adapter.ts                        # injected into webview before SPA boots
      portAlloc.ts                      # localhost free-port allocator
    server/                             # NEW: bundled-binary lifecycle
      GeodeServerProcess.ts             # spawns geode-ui Go server
      GeodeLspProcess.ts                # spawns geode for LSP
      binaryPath.ts                     # platform -> resources/bin lookup
    webview/                            # NEW: react-spa hosting infra
      ReactWebviewPanel.ts              # base class for editor-area panels
      ReactWebviewView.ts               # base class for sidebar webview
      html.ts                           # CSP + adapter <script> assembly
      route.ts                          # route enum + url builder
    connections/
      ConnectionManager.ts              # KEPT — drives bridge handlers
      (ConnectionsTreeProvider.ts REMOVED in sub-plan 2)
    client/
      EnhancedConnectionManager.ts      # KEPT, refactored to use HTTP via bridge
      GeodeClientWrapper.ts             # REMOVED in sub-plan 6 (CLI subprocess)
    panels/
      (ResultsTablePanel.ts          -> REMOVED in sub-plan 3)
      (GraphViewPanel.ts             -> REMOVED in sub-plan 5)
      (GraphVisualizationPanel.ts    -> REMOVED in sub-plan 5)
      (PathExplorerPanel.ts          -> REMOVED in sub-plan 5)
      (PerformanceMetricsPanel.ts    -> REMOVED in sub-plan 5)
      (QueryPlanPanel.ts             -> REMOVED in sub-plan 5)
      (TimeSeriesPanel.ts            -> REMOVED in sub-plan 5)
      (BaseWebviewPanel.ts           -> REMOVED in sub-plan 5, superseded by webview/ReactWebviewPanel.ts)
    views/
      (EnhancedSchemaExplorerProvider.ts -> REMOVED in sub-plan 4)
      (QueryHistoryProvider.ts           -> REMOVED in sub-plan 4)
      (SavedQueriesProvider.ts           -> REMOVED in sub-plan 4)
      sidebarView.ts                  # NEW (sub-plan 2): the single sidebar WebviewView
    sidebar/                          # NEW (sub-plan 2)
      ConnectionsHandler.ts           # bridge handler for connection ops
      SchemaHandler.ts                # bridge handler for schema ops (sub-plan 4)
      HistoryHandler.ts               # (sub-plan 4)
      SavedQueriesHandler.ts          # (sub-plan 4)
    mcp/                              # KEPT — unrelated to UI
    utils/                            # KEPT — security, nonces
    test/
      bridge/                         # NEW: protocol + host dispatcher tests
      server/                         # NEW: binary lifecycle tests
      webview/                        # NEW: html assembly + CSP tests
      sidebar/                        # NEW: handler tests (sub-plans 2-4)
  e2e/                                # NEW (sub-plan 1, expanded by each plan)
    fixtures/                         # canned API responses
    geode-ui-integration.test.ts      # extension activation smoke
    sidebar-connections.test.ts       # sub-plan 2
    query-results.test.ts             # sub-plan 3
    ...
  images/
    geode-icon.png                    # REPLACED with build/icon.png from geode-ui (sub-plan 1)
    geode-icon.svg                    # REPLACED with build/icon.svg from geode-ui
```

---

## Sub-Plan Sequence

Each sub-plan is a separate file; complete URLs are relative to this directory.

| Order | File | Output (what works after merging) | Blocked-by |
|-------|------|-----------------------------------|------------|
| 1 | [`2026-05-25-geode-ui-integration-01-foundation.md`](./2026-05-25-geode-ui-integration-01-foundation.md) | Extension bundles geode-ui SPA + server binary. Opening any geode command boots the server, opens a `WebviewPanel` rendering the SPA shell on `/dashboard`. Bridge routes the `health` ping end-to-end. No production wiring yet — existing tree views and panels still work alongside. | — |
| 2 | [`2026-05-25-geode-ui-integration-02-connections.md`](./2026-05-25-geode-ui-integration-02-connections.md) | The Geode activity bar now opens the sidebar `WebviewView` showing the SPA's connection switcher + profile editor. All four connection-related commands (`geode.connections.add/edit/delete/connect/disconnect/setDefault/copyDsn/refresh`) round-trip through the bridge into the React UI. `geodeConnections` tree view is removed. `ConnectionsTreeProvider.ts` is deleted. | 1 |
| 3 | [`2026-05-25-geode-ui-integration-03-query-results.md`](./2026-05-25-geode-ui-integration-03-query-results.md) | `geode.runQuery`, `runSelection`, `runFile` execute against the bundled server via `/api/v1/query` and stream results into a new React results panel. `ResultsTablePanel.ts` and its webview assets are deleted. `extractGraphData` and table-panel rendering moves into SPA-side code. | 1 |
| 4 | [`2026-05-25-geode-ui-integration-04-schema-history-saved.md`](./2026-05-25-geode-ui-integration-04-schema-history-saved.md) | Sidebar webview gains schema-explorer, query-history, and saved-queries sub-routes. The three remaining tree provider files are deleted along with the three view declarations in `package.json`. Query-history and saved-queries persistence migrates from `globalState` JSON to the bundled server's `/api/v1/history` and `/api/v1/saved` endpoints. | 2 |
| 5 | [`2026-05-25-geode-ui-integration-05-analytics.md`](./2026-05-25-geode-ui-integration-05-analytics.md) | Graph visualization, query plan, time-series, performance metrics, and path explorer panels all open as React webview panels backed by SPA routes. `panels/*.ts` and `webviews/{graph,metrics,paths,table}/*` are deleted. The `extractGraphElements` and `buildExpandQuery` helpers move to SPA-side code. | 3 |
| 6 | [`2026-05-25-geode-ui-integration-06-eliminate-cli.md`](./2026-05-25-geode-ui-integration-06-eliminate-cli.md) | LSP client switches from stdio subprocess to `ws://localhost:<port>/ws/lsp` via `vscode-ws-jsonrpc`. Every remaining `cp.spawn(geodeCmd, ...)` is removed. `geode.lsp.path`, `geode.lsp.args`, and `geode.server.*` settings are deleted from `package.json` (replaced by `geode.bundledServer.port` and `geode.bundledServer.logLevel`). Smoke tests confirm no host-installed `geode` is required. | 1, 5 |

---

## Out of Scope (do not touch in any sub-plan)

- **Grammar / syntax files** (`syntaxes/`, `snippets/`, `language-configuration.json`). These are static contributions and remain untouched.
- **`geode-ui` source code.** All SPA code lives in `../geode-ui`. We consume its build artifacts only. If a SPA bug surfaces during integration, file an issue in `geode-ui`; do **not** patch `node_modules/` or vendored copies.
- **MCP server.** `src/mcp/GeodeMCPServer.ts` keeps its current architecture; it is invoked by AI clients, not the UI.
- **CI publishing** (vsce publish, openvsx). Existing `.gitlab-ci.yml` pipelines stay; sub-plans only add the asset-fetch stage before package.
- **Backwards compatibility for stored profiles.** Workspace-state profiles written by the current `EnhancedConnectionManager` continue to load (we don't migrate the schema). The new sidebar reads the same `geode.profiles` key.

---

## Risks and mitigations

1. **Binary distribution licensing.** The bundled `geode` graph-DB binary is Apache-2.0; bundle `LICENSE` + `NOTICE` files under `resources/bin/<platform>/THIRD_PARTY_LICENSES.txt`. (Verified in `sub-plan 1`, task: "license shipping check".)
2. **VSIX size blowup.** A multi-platform bundle balloons the VSIX (estimate ~80 MiB per platform × 5 platforms = ~400 MiB if naively bundled). Mitigation: ship **per-platform VSIX** using VSCode's [target platform](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platformspecific-extensions) feature; each variant carries only its own arch's binaries. `sub-plan 1` wires `vsce package --target` invocations.
3. **Port conflicts.** The geode-ui server listens on a random free port allocated by `portAlloc.ts` (ask kernel for port 0). The webview never hardcodes a port; it always queries the host via the `serverInfo` bridge message.
4. **SPA expecting cookies / CSRF / login.** The SPA's `client.ts` resolves `baseUrl` from `window.geode.serverUrl` when present. In the VSCode webview we set this on the adapter (`window.geode = { serverUrl, isVscode: true, ... }`) and route `fetch()` through the bridge so the host can attach the JWT from `SecretStorage` instead of the SPA managing tokens. Auth in the VSCode build is **non-interactive** — the host issues a service token at server boot and re-uses it.
5. **LSP/upstream coupling.** The geode-ui server's `/ws/lsp` is a bridge to the geode binary. Both binaries must be bundled, and the host must spawn `geode serve --lsp-port=<N>` before geode-ui's bridge attaches. The `GeodeServerProcess` waits for the LSP socket to be ready before declaring readiness.

---

## Execution Handoff

This is a master plan; it is not directly executable. Execute the six sub-plans in order. After **sub-plan 1** is fully merged and the extension boots with the SPA visible, proceed to sub-plan 2, and so on.

For each sub-plan, choose one execution mode:

- **Subagent-Driven (recommended)** — dispatch a fresh subagent per task using `superpowers:subagent-driven-development`; two-stage review between tasks.
- **Inline Execution** — execute tasks in the current session using `superpowers:executing-plans` with batched checkpoints.

The master plan does not change as sub-plans land. If a sub-plan changes the global shape (e.g., the bridge protocol grows a new message family), update the **File Structure** section above in the same commit that lands the change.
