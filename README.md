# Geode GQL for Visual Studio Code

Full-featured GQL (Graph Query Language) and Cypher support for the Geode graph database.

## Features

### Language Support
- **Syntax Highlighting**: Full TextMate grammar for GQL and Cypher
- **Code Snippets**: 25+ snippets for common query patterns
- **Language Server**: Real-time diagnostics, hover docs, completions

### Query Execution
- **Run Query**: Execute the current file (`Ctrl+Enter` / `Cmd+Enter`)
- **Run Selection**: Execute selected text (`Ctrl+Shift+Enter`)
- **Explain Query**: View query execution plan

### Editor Integration
- **Status Bar**: Connection status and LSP indicator
- **Documentation Panel**: Built-in GQL reference
- **Context Menus**: Right-click to run queries

## Installation

### Prerequisites

1. **Geode** must be installed and in your PATH:
   ```bash
   git clone https://gitlab.com/devnw/codepros/geode/geode.git
   cd geode && make build
   export PATH="$PWD/zig-out/bin:$PATH"
   ```

### Install Extension

#### Option 1: Build and Install VSIX (Recommended for Testing)

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Package as VSIX
npm run package

# Install in VS Code
code --install-extension geode-gql-1.0.0.vsix
```

#### Option 2: Development Mode (F5 Debugging)

1. Open this folder in VS Code
2. Run `npm install`
3. Press `F5` to launch Extension Development Host
4. Open a `.gql` file in the new window

#### Option 3: Using Make

```bash
# Quick install
make install

# Or install for development
make dev
```

## Usage

### Keyboard Shortcuts

| Action | Windows/Linux | macOS |
|--------|---------------|-------|
| Run Query | `Ctrl+Enter` | `Cmd+Enter` |
| Run Selection | `Ctrl+Shift+Enter` | `Cmd+Shift+Enter` |
| Format Document | `Shift+Alt+F` | `Shift+Option+F` |

### Commands (Command Palette)

- `Geode: Run GQL Query` - Execute current file
- `Geode: Run Selected Query` - Execute selection
- `Geode: Explain Query Plan` - Show execution plan
- `Geode: Connect to Geode Server` - Connect to database
- `Geode: Show GQL Documentation` - Open reference panel
- `Geode: Restart Language Server` - Restart LSP

### Snippets

Type these prefixes and press `Tab`:

| Prefix | Description |
|--------|-------------|
| `match` | Basic MATCH...RETURN |
| `matchw` | MATCH with WHERE |
| `matchr` | MATCH with relationship |
| `create` | CREATE node |
| `merge` | MERGE with ON CREATE/MATCH |
| `set` | UPDATE properties |
| `delete` | DETACH DELETE |
| `vdist` | Vector distance search |
| `vknn` | K-nearest neighbors |
| `groupby` | GROUP BY aggregation |
| `case` | CASE expression |
| `shortest` | Shortest path |

## Configuration

Settings in VS Code (`Ctrl+,`):

| Setting | Default | Description |
|---------|---------|-------------|
| `geode.lsp.enabled` | `true` | Enable language server |
| `geode.lsp.path` | `"geode"` | Path to geode executable |
| `geode.server.host` | `"localhost"` | Database server host |
| `geode.server.port` | `3141` | Database server port |
| `geode.server.autoConnect` | `false` | Auto-connect on startup |
| `geode.query.timeout` | `30000` | Query timeout (ms) |
| `geode.format.keywordCase` | `"upper"` | Keyword case (upper/lower/preserve) |

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
3. Try `Geode: Connect to Geode Server` command

## Development

```bash
# Install dependencies
npm install

# Watch mode (auto-recompile)
npm run watch

# In another terminal, press F5 in VS Code to debug
```

### Project Structure

```
geode-vscode/
├── package.json            # Extension manifest
├── tsconfig.json           # TypeScript config
├── src/
│   └── extension.ts        # Main extension code
├── syntaxes/
│   └── gql.tmLanguage.json # Syntax highlighting
├── snippets/
│   └── gql.json            # Code snippets
├── images/                 # Icons
└── language-configuration.json
```

## Supported File Types

| Extension | Language ID |
|-----------|-------------|
| `.gql` | gql |
| `.gcypher` | gql |
| `.pgql` | gql |
| `.cypher` | cypher |

## License

Apache License 2.0 - See [LICENSE](LICENSE) for details.

Copyright 2024-2025 CodePros
