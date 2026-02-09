# Geode GQL for Visual Studio Code

Full-featured GQL (Graph Query Language) and Cypher support for the Geode graph database.

## Features

### Language Support

- **Syntax Highlighting**: Full TextMate grammar for GQL and Cypher
- **Code Snippets**: 45+ snippets for common query patterns
- **Language Server**: Real-time diagnostics, hover docs, completions
- **Formatting**: Auto-format GQL documents

### Query Execution

- **Run Query**: Execute the current file (`Ctrl+Enter` / `Cmd+Enter`)
- **Run Selection**: Execute selected text (`Ctrl+Shift+Enter`)
- **Explain Query**: View query execution plan
- **Results Table**: View results in formatted table panel
- **Graph Visualization**: Automatic graph view for node/relationship results

### Graph Visualization

- **High-Performance Rendering**: WebGL-accelerated via Cytoscape.js, supports 10,000+ nodes
- **Neo4j-Style Display**: Nodes colored by label, sized by degree
- **Multiple Layouts**: Force-directed, hierarchical, circular, grid, concentric
- **Graph Exploration**:
  - Double-click to expand node neighbors
  - Right-click for context menu (expand, hide, find paths)
  - Side panel for detailed node/edge properties
  - Path finding between any two nodes
- **Interactive Features**: Search, filter, cluster, lock positions
- **Export**: Save graphs as PNG or SVG

### Connection Management

- **Multiple Profiles**: Save and manage multiple database connections
- **Secure Credentials**: Passwords stored in VS Code secure storage
- **Auto-Connect**: Optionally connect on startup
- **Connection Status**: Status bar shows current connection

### Query Management

- **Query History**: Track all executed queries with success/failure status
- **Saved Queries**: Save favorite queries with categories
- **Export/Import**: Export saved queries to JSON, import from files
- **Re-run**: Easily re-run queries from history

### Schema Explorer

- **Live Schema**: Browse node labels and relationship types from database
- **Properties**: View properties for each label/type
- **Statistics**: See node and relationship counts

### Performance Tools

- **Metrics Panel**: Real-time performance metrics dashboard
- **Query Profiling**: Track slow queries
- **Latency Histograms**: Visualize query latency distribution
- **Export Metrics**: Export metrics to JSON

### AI Integration (MCP)

- **MCP Server**: Model Context Protocol integration for AI assistants
- **8 MCP Tools**: Query, schema, counts, paths, explain, create nodes/relationships
- **AI-Assisted**: Let AI assistants interact with your database

## Installation

### Prerequisites

- **VS Code 1.75.0+**
- **Geode CLI** installed and in your PATH (required for LSP + query execution)
- **Running Geode server** for query execution and schema features

Recommended Geode install methods (OS packages or Docker):

**Option A: Install by OS (recommended)**

Linux (Debian/Ubuntu):

```bash
curl -fsSL https://apt.geodedb.com/geode.gpg | \
  sudo gpg --dearmor -o /usr/share/keyrings/geode-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/geode-archive-keyring.gpg] https://apt.geodedb.com stable main" | \
  sudo tee /etc/apt/sources.list.d/geode.list
sudo apt update
sudo apt install geode
```

macOS (Homebrew):

```bash
brew tap geodedb/geode
brew install geode
```

Windows: use WSL2, then follow the Linux steps above inside WSL.

**Option B: Docker (fastest server setup)**

```bash
docker run -d \
  -p 3141:3141 \
  -v geode-data:/var/lib/geode \
  --name geode \
  geodedb/geode:latest serve --listen 0.0.0.0:3141
```

Note: Even when running the server in Docker, the extension still needs the Geode CLI locally for the language server. Install the CLI via OS packages as shown above.

If you need to build Geode from source (advanced/dev only), follow the
[Geode build-from-source guide](https://geodedb.com/docs/installation/from-source/).

### Install Extension

#### Option 1: VS Code Marketplace (Recommended)

```bash
# Install via command line
code --install-extension codeprosorg.geode-vscode

# Or search in VS Code:
# 1. Open VS Code
# 2. Press Ctrl+Shift+X (Cmd+Shift+X on macOS)
# 3. Search for "Geode"
# 4. Click Install
```

#### Option 2: Manual Installation from VSIX

```bash
# Download a VSIX from releases or build one locally, then:
code --install-extension geode-vscode-<version>.vsix

# Or in VS Code: Extensions → ... → Install from VSIX
```

#### Option 3: Build and Install VSIX (From Source)

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Package as VSIX
npm run package

# Install in VS Code
code --install-extension geode-vscode-<version>.vsix
```

#### Option 4: Development Mode (F5 Debugging)

1. Open this folder in VS Code
2. Run `npm install`
3. Press `F5` to launch Extension Development Host
4. Open a `.gql` file in the new window

#### Option 5: Using Make

```bash
make install
make dev
```

## Usage

### Keyboard Shortcuts

| Action | Windows/Linux | macOS |
|--------|---------------|-------|
| Run Query | `Ctrl+Enter` | `Cmd+Enter` |
| Run Selection | `Ctrl+Shift+Enter` | `Cmd+Shift+Enter` |
| Format Document | `Shift+Alt+F` | `Shift+Option+F` |
| Save Query | `Ctrl+Shift+S` | `Cmd+Shift+S` |
| Visualize as Graph | `Ctrl+Shift+G` | `Cmd+Shift+G` |

### Commands (Command Palette)

**Query Execution:**

- `Geode: Run GQL Query` - Execute current file
- `Geode: Run Selected Query` - Execute selection
- `Geode: Explain Query Plan` - Show execution plan

**Connection:**

- `Geode: Add Connection` - Add new connection profile
- `Geode: Connect to Geode Server` - Connect to database
- `Geode: Disconnect from Server` - Disconnect

**Tools:**

- `Geode: Show Performance Metrics` - Open metrics dashboard
- `Geode: Show Graph Visualization` - Open graph visualization panel
- `Geode: Visualize Query as Graph` - Execute and visualize as graph
- `Geode: Show GQL Documentation` - Open reference panel
- `Geode: Restart Language Server` - Restart LSP

**Saved Queries:**

- `Geode: Save Query` - Save current query
- `Geode: Export All Queries` - Export to JSON
- `Geode: Import Queries` - Import from JSON

**MCP (AI Integration):**

- `Geode: List MCP Tools` - Show available MCP tools
- `Geode: Execute MCP Tool` - Run an MCP tool

### Snippets

Type these prefixes and press `Tab`:

**Basic Queries:**

| Prefix | Description |
|--------|-------------|
| `match` | Basic MATCH...RETURN |
| `matchw` | MATCH with WHERE |
| `matchr` | MATCH with relationship |
| `matchp` | Variable length path |
| `optmatch` | OPTIONAL MATCH |

**Data Modification:**

| Prefix | Description |
|--------|-------------|
| `create` | CREATE node |
| `creater` | CREATE relationship |
| `merge` | MERGE with ON CREATE/MATCH |
| `set` | UPDATE properties |
| `delete` | DETACH DELETE |
| `remove` | Remove property |

**Aggregations:**

| Prefix | Description |
|--------|-------------|
| `count` | COUNT aggregation |
| `groupby` | GROUP BY with count |
| `collect` | COLLECT into list |
| `sum` | SUM aggregation |
| `avg` | AVG aggregation |
| `minmax` | MIN and MAX |

**Advanced:**

| Prefix | Description |
|--------|-------------|
| `vdist` | Vector distance search |
| `vknn` | K-nearest neighbors |
| `shortest` | Shortest path |
| `allshortest` | All shortest paths |
| `exists` | EXISTS subquery |
| `case` | CASE expression |

**Transactions:**

| Prefix | Description |
|--------|-------------|
| `tx` | BEGIN/COMMIT block |
| `txrollback` | BEGIN/ROLLBACK block |

**Performance:**

| Prefix | Description |
|--------|-------------|
| `explain` | EXPLAIN query |
| `profile` | PROFILE query |

**Utilities:**

| Prefix | Description |
|--------|-------------|
| `page` | Pagination (SKIP/LIMIT) |
| `datetime` | Date/time functions |
| `stringfn` | String functions |
| `coalesce` | Handle nulls |
| `loadcsv` | LOAD CSV |

## Sidebar Views

The Geode sidebar (click the database icon) contains:

1. **Connections** - Manage database connections
2. **Schema Explorer** - Browse database schema
3. **Query History** - View executed queries
4. **Saved Queries** - Access saved/favorite queries

## Configuration

Settings in VS Code (`Ctrl+,`):

| Setting | Default | Description |
|---------|---------|-------------|
| `geode.lsp.enabled` | `true` | Enable language server |
| `geode.lsp.path` | `"geode"` | Path to geode executable |
| `geode.server.host` | `"localhost"` | Database server host |
| `geode.server.port` | `3141` | Database server port |
| `geode.server.autoConnect` | `false` | Auto-connect on startup |
| `geode.server.insecure` | `false` | Skip TLS verification |
| `geode.query.timeout` | `30000` | Query timeout (ms) |
| `geode.query.maxResults` | `1000` | Max results to display |
| `geode.format.keywordCase` | `"upper"` | Keyword case |
| `geode.format.indentSize` | `2` | Indent size |

## Troubleshooting

### LSP Not Starting

1. Check geode is installed:

   ```bash
   geode lsp --help
   ```

2. Check Output panel: View -> Output -> "Geode GQL"

3. Verify extension settings for `geode.lsp.path`

### No Syntax Highlighting

1. Check file extension is `.gql`, `.cypher`, `.gcypher`, or `.pgql`
2. Check bottom-right shows "GQL" or "Cypher" as language
3. Try: Command Palette -> "Change Language Mode" -> GQL

### Query Execution Fails

1. Ensure Geode server is running: `geode serve`
2. Check server connection settings
3. Add a connection profile via the Connections view
4. Check Output panel for detailed error messages

### Connection Issues

1. Verify server is running and accessible
2. Check host and port settings
3. For TLS issues, try enabling `geode.server.insecure` temporarily
4. Check firewall settings

## Development

```bash
# Install dependencies
npm install

# Watch mode (auto-recompile)
npm run watch

# In another terminal, press F5 in VS Code to debug
```

### Project Structure

```text
geode-vscode/
├── package.json                    # Extension manifest
├── tsconfig.json                   # TypeScript config
├── src/
│   ├── extension.ts                # Main extension entry
│   ├── client/
│   │   ├── GeodeClientWrapper.ts   # CLI-based database client
│   │   └── EnhancedConnectionManager.ts
│   ├── connections/
│   │   ├── ConnectionManager.ts    # Connection profile management
│   │   └── ConnectionsTreeProvider.ts
│   ├── views/
│   │   ├── SchemaExplorerProvider.ts
│   │   ├── EnhancedSchemaExplorerProvider.ts
│   │   ├── QueryHistoryProvider.ts
│   │   └── SavedQueriesProvider.ts
│   ├── panels/
│   │   ├── ResultsTablePanel.ts    # Query results display
│   │   ├── GraphViewPanel.ts       # Graph visualization
│   │   ├── PerformanceMetricsPanel.ts
│   │   └── QueryPlanPanel.ts
│   └── mcp/
│       └── GeodeMCPServer.ts       # MCP integration
├── syntaxes/
│   └── gql.tmLanguage.json         # Syntax highlighting
├── snippets/
│   └── gql.json                    # Code snippets (45+)
└── language-configuration.json
```

## Supported File Types

| Extension | Language ID |
|-----------|-------------|
| `.gql` | gql |
| `.gcypher` | gql |
| `.pgql` | gql |
| `.cypher` | cypher |

## MCP Tools for AI Assistants

The extension provides MCP (Model Context Protocol) tools for AI integration:

| Tool | Description |
|------|-------------|
| `geode_query` | Execute GQL queries |
| `geode_schema` | Get database schema |
| `geode_count_nodes` | Count nodes by label |
| `geode_count_relationships` | Count relationships by type |
| `geode_find_paths` | Find paths between nodes |
| `geode_explain` | Get query execution plan |
| `geode_create_node` | Create new nodes |
| `geode_create_relationship` | Create relationships |

## License

Apache License 2.0 - See [LICENSE](LICENSE) for details.

Copyright 2024-2026 CodePros
