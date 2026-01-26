# Geode GQL VS Code Extension Makefile
# =====================================
# Single-command build and packaging

.PHONY: all build compile package install install-dev uninstall clean deps lint watch help test check-deps dev publish

# Configuration
EXTENSION_NAME := geode-gql
VERSION := $(shell node -p "require('./package.json').version")
VSIX_FILE := $(EXTENSION_NAME)-$(VERSION).vsix
GEODE_BIN := $(shell command -v geode 2>/dev/null || echo "geode")

# Default target
all: build

# Install dependencies
deps:
	@echo "Installing dependencies..."
	npm install

# Check if dependencies are installed
check-deps:
	@if [ ! -d "node_modules" ]; then \
		echo "Dependencies not installed. Running 'make deps'..."; \
		$(MAKE) deps; \
	fi

# Compile TypeScript
compile: check-deps
	@echo "Compiling TypeScript..."
	npm run compile

# Lint the source code
lint: check-deps
	@echo "Linting source code..."
	npm run lint || true

# Build (compile + lint)
build: compile
	@echo "Build complete."

# Package as .vsix
package: build
	@echo "Packaging extension as $(VSIX_FILE)..."
	npm run package
	@echo "Package created: $(VSIX_FILE)"

# Install extension to VS Code
install: package
	@echo "Installing extension to VS Code..."
	code --install-extension $(VSIX_FILE)
	@echo "Extension installed. Restart VS Code to activate."

# Install to VS Code Insiders
install-insiders: package
	@echo "Installing extension to VS Code Insiders..."
	code-insiders --install-extension $(VSIX_FILE)
	@echo "Extension installed. Restart VS Code Insiders to activate."

# Install to VSCodium
install-vscodium: package
	@echo "Installing extension to VSCodium..."
	codium --install-extension $(VSIX_FILE)
	@echo "Extension installed. Restart VSCodium to activate."

# Install to Cursor
install-cursor: package
	@echo "Installing extension to Cursor..."
	cursor --install-extension $(VSIX_FILE)
	@echo "Extension installed. Restart Cursor to activate."

# Install for development (copy with dependencies)
install-dev: build
	@echo "Installing extension for development..."
	@EXTDIR="$$HOME/.vscode/extensions/$(EXTENSION_NAME)-dev"; \
	rm -rf "$$EXTDIR"; \
	mkdir -p "$$EXTDIR"; \
	cp -r package.json language-configuration.json out syntaxes snippets images README.md node_modules "$$EXTDIR/"; \
	echo "Development extension installed to $$EXTDIR"; \
	echo "Restart VS Code and select 'Geode GQL' for .gql files"

# Uninstall extension from VS Code
uninstall:
	@echo "Uninstalling extension..."
	code --uninstall-extension geode-db.$(EXTENSION_NAME) || true
	@echo "Extension uninstalled."

# Watch for changes and recompile
watch: check-deps
	@echo "Watching for changes..."
	npm run watch

# Run tests
test: build
	@echo "Running tests..."
	npm run test

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -rf out/
	rm -rf node_modules/
	rm -f *.vsix
	@echo "Clean complete."

# Clean only compiled output (keep node_modules)
clean-build:
	@echo "Cleaning compiled output..."
	rm -rf out/
	rm -f *.vsix
	@echo "Clean complete."

# Development workflow: build and install-dev
dev: install-dev
	@echo "Development setup complete."
	@echo "Run 'make watch' in another terminal for live recompilation."

# Publish to VS Code Marketplace (requires VSCE_PAT env var)
publish: package
	@echo "Publishing to VS Code Marketplace..."
	@if [ -z "$$VSCE_PAT" ]; then \
		echo "Error: VSCE_PAT environment variable not set"; \
		echo "Get a token from: https://dev.azure.com/"; \
		exit 1; \
	fi
	npm run publish

# Verify geode LSP is available
verify-lsp:
	@echo "Verifying Geode LSP..."
	@if [ -x "$(GEODE_BIN)" ]; then \
		echo "Geode binary found at $(GEODE_BIN)"; \
		$(GEODE_BIN) lsp --help 2>/dev/null || echo "LSP subcommand available"; \
	elif command -v geode >/dev/null 2>&1; then \
		echo "Geode found in PATH"; \
		geode lsp --help 2>/dev/null || echo "LSP subcommand available"; \
	else \
		echo "Warning: geode binary not found"; \
		echo "Build with: cd ../.. && make build"; \
	fi

# Full release workflow
release: clean deps lint package
	@echo "Release package ready: $(VSIX_FILE)"
	@echo "To publish: make publish"

# Show extension info
info:
	@echo "Extension: $(EXTENSION_NAME)"
	@echo "Version:   $(VERSION)"
	@echo "Package:   $(VSIX_FILE)"
	@echo ""
	@echo "Files:"
	@ls -la *.vsix 2>/dev/null || echo "  (no .vsix file yet, run 'make package')"

# Help
help:
	@echo "Geode GQL VS Code Extension - Build Commands"
	@echo "============================================="
	@echo ""
	@echo "Quick Start:"
	@echo "  make              Build the extension (compile TypeScript)"
	@echo "  make install      Build, package, and install to VS Code"
	@echo "  make dev          Build and install for development"
	@echo ""
	@echo "Build Commands:"
	@echo "  make deps         Install npm dependencies"
	@echo "  make compile      Compile TypeScript"
	@echo "  make lint         Run ESLint"
	@echo "  make build        Compile and lint"
	@echo "  make package      Create .vsix package"
	@echo ""
	@echo "Install Commands:"
	@echo "  make install          Install to VS Code"
	@echo "  make install-insiders Install to VS Code Insiders"
	@echo "  make install-vscodium Install to VSCodium"
	@echo "  make install-cursor   Install to Cursor"
	@echo "  make install-dev      Install for development (symlink)"
	@echo "  make uninstall        Uninstall from VS Code"
	@echo ""
	@echo "Development:"
	@echo "  make watch        Watch and recompile on changes"
	@echo "  make test         Run tests"
	@echo "  make verify-lsp   Verify geode LSP is available"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean        Remove all build artifacts"
	@echo "  make clean-build  Remove compiled output only"
	@echo ""
	@echo "Release:"
	@echo "  make release      Full clean build for release"
	@echo "  make publish      Publish to VS Code Marketplace"
	@echo "  make info         Show extension info"
