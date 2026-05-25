# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.3] - 2026-05-25

### Fixed

- `shopt -s nullglob` (bash-only) replaced with `find -maxdepth 1`
  in the publish-marketplace and publish-openvsx jobs so they run
  under alpine's busybox `sh`. The v1.3.2 publish jobs both failed
  with `eval: line 24X: shopt: not found` after the per-platform
  matrix succeeded.
- `.vscodeignore` now excludes `e2e/**`, `out/{e2e,test}/**`,
  `coverage/**`, `build/**` (the sibling-repo clone), and
  `.geode_admin_password`. Reduces VSIX bloat and prevents shipping
  test fixtures.

## [1.3.2] - 2026-05-25

### Fixed

- Default `SPA_VERSION` and `GEODE_VERSION` CI variables baked into
  `.gitlab-ci.yml` so the `package:<slug>` matrix has values for the
  upstream releases to bundle. Previously the variables had to be set
  externally in project settings, and v1.3.1's matrix jobs all
  failed with `--spaVersion is required`.

## [1.3.1] - 2026-05-25

### Fixed

- Branch CI no longer runs `npm run package` (which requires sibling
  repos or registry creds not present in the build environment).
- Per-platform `package:<slug>` matrix now fetches goreleaser-emitted
  binaries from the GitLab Generic Package Registry with SHA256
  verification against the published `checksums.txt`.
- `package:win32-x64` removed from the matrix until upstream geode
  publishes a Windows binary.
- Publish jobs (`publish-marketplace`, `publish-openvsx`,
  `publish-gitlab`) now loop over every per-platform VSIX instead of
  picking the first one with `ls *.vsix | head -1`.

### Added

- `scripts/fetch-release-assets.mjs` - builds the geode-ui SPA from a
  pinned tag and fetches verified per-platform binaries.
- Enterprise-grade pre-commit hook suite: shellcheck, executable-bit
  consistency, BOM rejection, submodule ban, package.json + lock-file
  JSON validation, e2e TypeScript compile, CI build simulation on
  push, npm audit on production deps, and a static check that fails
  push if `.gitlab-ci.yml` reintroduces the branch-build packaging
  regression.

## [1.3.0] - 2026-05-25

### Added

- Foundation for embedded geode-ui management UI: extension now bundles the
  geode-ui SPA and the geode-ui Go server binary. A new `geode.showSpaShell`
  command opens the SPA inside a webview panel. (sub-plan 1)
- Settings: `geode.bundledServer.startupTimeoutMs`,
  `geode.bundledServer.logLevel`.
- `src/server/GeodeLspProcess.ts` spawns the bundled graph-DB binary
  for LSP upstream.
- `src/lsp/wsTransport.ts` adapts WebSocket to the LanguageClient
  StreamInfo contract.

### Changed

- Build now requires `npm run prepackage` before `vsce package`. The
  prepackage step copies SPA assets from `../geode-ui` (local mode) or
  downloads them from the GitLab registry (CI mode).
- Connections are now managed through the geode-ui sidebar webview. The
  native geodeConnections tree view is removed. All geode.connections.*
  commands focus the sidebar and dispatch navigation events into the
  React UI. (sub-plan 2)
- Query execution now routes through the bundled geode-ui server and
  surfaces results in a React webview panel. The native ResultsTablePanel
  is removed. (sub-plan 3)
- Schema explorer, query history, and saved queries now live in the
  geode-ui sidebar webview. Tree views removed. Persistence migrated
  from workspaceState/globalState to the bundled server's REST API.
  (sub-plan 4)
- All analytics surfaces (graph visualization, query plan, time series,
  performance metrics, path explorer) now open as React webview panels
  backed by geode-ui SPA routes. Native panel implementations are
  removed. (sub-plan 5)
- LSP runs over WebSocket against the bundled geode-ui server. The
  host system no longer needs the `geode` binary on PATH or in any
  configured location. (sub-plan 6)

### Removed

- src/connections/ConnectionsTreeProvider.ts - superseded by the sidebar
  webview.
- src/panels/ResultsTablePanel.ts
- src/webviews/table/*
- src/views/EnhancedSchemaExplorerProvider.ts
- src/views/SchemaExplorerProvider.ts
- src/views/QueryHistoryProvider.ts
- src/views/SavedQueriesProvider.ts
- geodeSchemaExplorer, geodeQueryHistory, geodeSavedQueries view declarations
- src/panels/GraphViewPanel.ts
- src/panels/GraphVisualizationPanel.ts
- src/panels/PathExplorerPanel.ts
- src/panels/PerformanceMetricsPanel.ts
- src/panels/QueryPlanPanel.ts
- src/panels/TimeSeriesPanel.ts
- src/panels/BaseWebviewPanel.ts
- src/webviews/graph/, src/webviews/metrics/, src/webviews/paths/, src/webviews/shared/
- In-extension extractGraphData / extractGraphElements helpers (logic moved to src/bridge/handlers/graphOps.ts)
- Settings: `geode.lsp.path`, `geode.lsp.args`, `geode.server.host`,
  `geode.server.port`, `geode.server.autoConnect`, `geode.server.insecure`.
- Helpers: `resolveGeodeBinary`, `findInPath`, `isBinaryPathTrusted`,
  `runGeodeQuery`, `runGeodeQueryWithProfile`, `connectServer`,
  `disconnectServer`.

## [1.2.3] - 2026-02-09

### Changed
- Updated README installation guidance to prefer OS/Docker installs and clarify extension installation options.

## [1.2.0] - 2026-01-28

### Changed
- **Package renamed** from `geode-gql` to `geode-vscode` (extension ID: `geodedb.geode-vscode`)
- **Publisher** changed to `geodedb`
- Added pre-commit hooks for code quality and version verification

### Added

#### High-Performance Graph Visualization
- **GraphVisualizationPanel**: New WebGL-accelerated graph visualization using Cytoscape.js
- **Large Graph Support**: Efficiently handles 10,000+ nodes with level-of-detail rendering
- **Multiple Layouts**: Force-directed, hierarchical (dagre), circular, grid, concentric, breadth-first
- **Graph Exploration**:
  - Double-click nodes to expand neighbors
  - Right-click context menu with expand options (1-hop, 2-hop)
  - Path finding between nodes with visual highlighting
  - Node detail side panel with properties and actions
  - Query related data for selected nodes
- **Neo4j-Style Rendering**: Nodes colored by label, sized by degree
- **Interactive Features**:
  - Search/filter nodes by ID, label, or property
  - Toggle node labels and physics simulation
  - Lock node positions
  - Hide nodes/edges
  - Clustering for large graphs
- **Export Options**: PNG and SVG export
- **Keyboard Shortcut**: `Ctrl+Shift+G` / `Cmd+Shift+G` to visualize query as graph

#### New Commands
- `Geode: Show Graph Visualization` - Open the graph visualization panel
- `Geode: Visualize Query as Graph` - Execute query and show results as graph

### Changed
- Graph data now uses JSON format (preferred) instead of DOT for better structured data handling
- Results with graph data (nodes/relationships) automatically show graph view option

## [1.1.0] - 2026-01-27

### Added

#### Core Architecture
- **CLI-Based Client**: Rewrote `GeodeClientWrapper` to use the `geode` CLI instead of native Node.js QUIC library, eliminating GLIBC compatibility issues across different Linux distributions
- **Enhanced Connection Manager**: New `EnhancedConnectionManager` with secure credential storage using VS Code SecretStorage API
- **Results Table Panel**: Query results now display in a formatted table panel with column headers and export options
- **Graph Visualization**: Automatic graph view panel for queries returning nodes and relationships

#### Query Management
- **Query History View**: New sidebar view tracking all executed queries with success/failure status, timing, and row counts
- **Saved Queries View**: Save favorite queries with names, descriptions, and category organization
- **Export/Import**: Export saved queries to JSON files, import queries from JSON
- **Re-run Queries**: One-click re-run of queries from history

#### Schema Explorer
- **Live Schema**: Enhanced `EnhancedSchemaExplorerProvider` fetches live data from connected database
- **Property Inspection**: View properties for each node label and relationship type
- **Statistics Display**: See counts for nodes and relationships

#### Performance Tools
- **Metrics Panel**: Integrated `PerformanceMetricsPanel` with real-time statistics dashboard
- **Query Profiling**: Track slow queries with timing and row count information
- **Latency Histograms**: Visualize query latency distribution
- **Export Metrics**: Export performance metrics to JSON for analysis

#### AI Integration (MCP)
- **MCP Server**: New `GeodeMCPServer` providing Model Context Protocol integration for AI assistants
- **8 MCP Tools**:
  - `geode_query` - Execute GQL queries
  - `geode_schema` - Get database schema
  - `geode_count_nodes` - Count nodes by label
  - `geode_count_relationships` - Count relationships by type
  - `geode_find_paths` - Find paths between nodes
  - `geode_explain` - Get query execution plan
  - `geode_create_node` - Create new nodes
  - `geode_create_relationship` - Create relationships
- **MCP Commands**: `Geode: List MCP Tools` and `Geode: Execute MCP Tool`

#### Enhanced Snippets (45+ total)
New snippets added:
- Transaction blocks (`tx`, `txrollback`)
- Query profiling (`profile`)
- Aggregation functions (`collect`, `sum`, `avg`, `minmax`)
- Subquery patterns (`exists`, `countq`)
- Path finding (`allshortest`)
- Pattern comprehension (`listcomp`)
- Batch operations (`foreach`)
- Procedure calls (`call`)
- Data import (`loadcsv`)
- Graph management (`creategraph`, `usegraph`, `dropgraph`)
- Date/time functions (`datetime`)
- String functions (`stringfn`)
- Null handling (`coalesce`)
- Pagination (`page`)
- Label management (`addlabel`, `removelabel`)

#### New Commands
- `Geode: Show Performance Metrics` - Open performance dashboard
- `Geode: Save Query` - Save current query (Ctrl+Shift+S)
- `Geode: Export All Queries` - Export saved queries
- `Geode: Import Queries` - Import queries from JSON
- `Geode: List MCP Tools` - Show available MCP tools
- `Geode: Execute MCP Tool` - Run an MCP tool interactively

### Changed
- **DSN Format**: Uses `quic://` scheme per the official Geode DSN specification (QUIC transport with TLS 1.3)
- **Connection Profiles**: Enhanced with additional fields for full compatibility
- **Package Dependencies**: Removed `@geodedb/client` native dependency to avoid GLIBC issues

### Fixed
- GLIBC 2.33 compatibility issues with native QUIC library on older Linux distributions
- Type compatibility between old and new ConnectionProfile interfaces
- Connection command registration (`geode.connections.add` not found error)
- Graph data extraction from query results for visualization

## [1.0.0] - 2025-01-03

### Added
- Initial release
- GQL and Cypher syntax highlighting via TextMate grammar
- Language Server Protocol (LSP) integration with `geode lsp`
- Basic query execution with results display
- Connection management with profiles
- Schema explorer tree view
- Code snippets (25 snippets) for common GQL patterns
- Query plan visualization panel
- Graph view panel for node/relationship visualization
- Results table panel
- Performance metrics panel (basic)
- Time series panel
- Path explorer panel
- Status bar integration showing connection status
- Keyboard shortcuts for query execution and formatting
- Context menus for query files

### Supported File Types
- `.gql` - GQL (Graph Query Language) files
- `.gcypher` - GQL/Cypher hybrid files
- `.pgql` - Property Graph Query Language files
- `.cypher` - Cypher query files

---

## Migration Guide

### Upgrading from 1.0.0 to 1.1.0

1. **No Action Required for Native Dependencies**: The extension no longer uses native QUIC libraries. If you previously had issues with GLIBC compatibility, these are now resolved.

2. **New Sidebar Views**: Two new views are automatically added to the Geode sidebar:
   - **Query History** - Tracks all executed queries
   - **Saved Queries** - Manage favorite queries

3. **New Keyboard Shortcut**: `Ctrl+Shift+S` / `Cmd+Shift+S` now saves the current query to your Saved Queries.

4. **MCP Integration**: If you use AI assistants that support the Model Context Protocol, the extension now provides tools for database interaction. Use `Geode: List MCP Tools` to see available tools.

5. **Configuration Compatibility**: All existing configuration options remain compatible. No changes required.
