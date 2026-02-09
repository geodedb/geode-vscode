# Geode GQL VS Code Extension Makefile
# =====================================
# Single-command build and packaging

.PHONY: all build compile package install install-code install-cursor install-antigravity install-dev uninstall clean deps lint watch help test check-deps dev publish

# Configuration
EXTENSION_NAME := geode-vscode
VERSION := $(shell node -p "require('./package.json').version")
VSIX_FILE := $(EXTENSION_NAME)-$(VERSION).vsix
GEODE_BIN := $(shell command -v geode 2>/dev/null || echo "geode")

# Default target
all: build

# Install dependencies (SECURITY: use npm ci for reproducible builds, Issue #53)
deps:
	@echo "Installing dependencies..."
	npm ci

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

# Lint the source code (SECURITY: removed || true to fail on lint errors, Issues #20, #14)
lint: check-deps
	@echo "Linting source code..."
	npm run lint

# Build (compile + lint)
build: compile
	@echo "Build complete."

# Package as .vsix
package: build
	@echo "Packaging extension as $(VSIX_FILE)..."
	npm run package
	@echo "Package created: $(VSIX_FILE)"

# Install extension to VS Code, Cursor, and Antigravity
install: package
	@echo "Installing extension to all detected editors..."
	@INSTALLED=0; \
	if command -v code >/dev/null 2>&1; then \
		echo "  Installing to VS Code..."; \
		code --install-extension $(VSIX_FILE); \
		INSTALLED=$$((INSTALLED + 1)); \
	fi; \
	if command -v cursor >/dev/null 2>&1; then \
		echo "  Installing to Cursor..."; \
		cursor --install-extension $(VSIX_FILE); \
		INSTALLED=$$((INSTALLED + 1)); \
	fi; \
	if command -v antigravity >/dev/null 2>&1; then \
		echo "  Installing to Antigravity..."; \
		antigravity --install-extension $(VSIX_FILE); \
		INSTALLED=$$((INSTALLED + 1)); \
	fi; \
	if [ $$INSTALLED -eq 0 ]; then \
		echo "Error: No supported editors found (code, cursor, antigravity)"; \
		exit 1; \
	fi; \
	echo "Extension installed to $$INSTALLED editor(s). Restart to activate."

# Install to VS Code only
install-code: package
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

# Install to Antigravity
install-antigravity: package
	@echo "Installing extension to Antigravity..."
	antigravity --install-extension $(VSIX_FILE)
	@echo "Extension installed. Restart Antigravity to activate."

# Install for development (copy with dependencies)
install-dev: build
	@echo "Installing extension for development..."
	@EXTDIR="$$HOME/.vscode/extensions/$(EXTENSION_NAME)-dev"; \
	rm -rf "$$EXTDIR"; \
	mkdir -p "$$EXTDIR"; \
	cp -r package.json language-configuration.json out syntaxes snippets images README.md node_modules "$$EXTDIR/"; \
	echo "Development extension installed to $$EXTDIR"; \
	echo "Restart VS Code and select 'Geode GQL' for .gql files"

# Uninstall extension from all detected editors
uninstall:
	@echo "Uninstalling extension..."
	@if command -v code >/dev/null 2>&1; then \
		echo "  Uninstalling from VS Code..."; \
		code --uninstall-extension geodedb.$(EXTENSION_NAME) || true; \
	fi
	@if command -v cursor >/dev/null 2>&1; then \
		echo "  Uninstalling from Cursor..."; \
		cursor --uninstall-extension geodedb.$(EXTENSION_NAME) || true; \
	fi
	@if command -v antigravity >/dev/null 2>&1; then \
		echo "  Uninstalling from Antigravity..."; \
		antigravity --uninstall-extension geodedb.$(EXTENSION_NAME) || true; \
	fi
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
	@echo "  make install      Build, package, and install to all detected editors"
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
	@echo "  make install              Install to all detected editors (VS Code, Cursor, Antigravity)"
	@echo "  make install-code         Install to VS Code only"
	@echo "  make install-cursor       Install to Cursor only"
	@echo "  make install-antigravity  Install to Antigravity only"
	@echo "  make install-insiders     Install to VS Code Insiders"
	@echo "  make install-vscodium     Install to VSCodium"
	@echo "  make install-dev          Install for development (symlink)"
	@echo "  make uninstall            Uninstall from all detected editors"
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
