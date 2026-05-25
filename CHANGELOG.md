# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Foundation for embedded geode-ui management UI: extension now bundles the
  geode-ui SPA and the geode-ui Go server binary. A new `geode.showSpaShell`
  command opens the SPA inside a webview panel. (sub-plan 1)

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

### Removed
- src/connections/ConnectionsTreeProvider.ts - superseded by the sidebar
  webview.
- src/panels/ResultsTablePanel.ts
- src/webviews/table/*

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
