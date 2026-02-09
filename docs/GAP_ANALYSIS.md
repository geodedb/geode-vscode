# Gap Analysis

> Last updated: 2026-02-09 | Review tools: semgrep 1.150.0, trivy 0.69.0, grype 0.107.0, gitleaks 8.24.0, osv-scanner, npm audit, checkov, shellcheck

## Resolution Summary

**35 security findings:** 30 Closed, 2 Mitigated, 3 Blocked (upstream dependencies)
**2 feature gaps:** 1 Closed, 1 Blocked (requires Geode server API)

## Security Findings (Stack-Ranked by Risk Score)

| # | Issue | Severity | Risk | CWE | Status | Resolution |
|---|-------|----------|------|-----|--------|------------|
| 1 | SEC-0041 Hardcoded credentials | Critical | 80 | CWE-798 | **Closed** | Removed hardcoded admin/secret; uses session credentials |
| 2 | SEC-0015 GQL injection in MCP | Critical | 80 | CWE-89 | **Closed** | sanitizeIdentifier + escapeStringValue on all inputs |
| 3 | SEC-0042 XSS GraphViewPanel | High | 64 | CWE-79 | **Closed** | Replaced inline JSON.stringify with postMessage |
| 4 | SEC-0043 Missing CSP node explorer | High | 64 | CWE-79 | **Closed** | Added CSP with nonce; data via postMessage; DOM methods |
| 5 | SEC-0016 Password via CLI args | High | 64 | CWE-214 | **Closed** | Password via GEODE_PASSWORD env var |
| 6 | SEC-0017 GQL injection GraphViz | High | 64 | CWE-89 | **Closed** | Shared sanitizeIdentifier + escapeStringValue |
| 7 | SEC-0044 Missing nonce on scripts | High | 48 | CWE-79 | **Closed** | Added nonce to all script tags |
| 8 | SEC-0045 Settings lack machine scope | High | 48 | CWE-15 | **Closed** | Added scope: machine to host, port, autoConnect, insecure |
| 9 | SEC-0046 brace-expansion ReDoS | High | 36 | CWE-1333 | **Blocked** | Upstream dependency; no patched version available |
| 10 | SEC-0047 Math.random() nonces | Medium | 36 | CWE-330 | **Closed** | crypto.randomBytes(24).toString('base64url') |
| 11 | SEC-0048 CLI arg injection | Medium | 32 | CWE-78 | **Closed** | Query via stdin with -- separator |
| 12 | SEC-0018 innerHTML in GraphViz | Medium | 24 | CWE-79 | **Mitigated** | All inputs HTML-escaped via shared escapeHtml |
| 13 | SEC-0031 XSS QueryPlan/TimeSeries | Medium | 24 | CWE-79 | **Closed** | Data via postMessage API |
| 14 | SEC-0049 Prototype pollution | Medium | 24 | CWE-1321 | **Closed** | Recursive key filtering in safeMerge |
| 15 | SEC-0050 Import validation | Medium | 24 | CWE-502 | **Closed** | Schema validation, length bounds, field stripping |
| 16 | SEC-0051 Self-signed cert shipped | Medium | 24 | CWE-295 | **Closed** | data/ in .vscodeignore |
| 17 | SEC-0052 check-yaml --unsafe | Medium | 24 | CWE-94 | **Closed** | Removed --unsafe flag |
| 18 | SEC-0053 npm install in Makefile | Medium | 24 | CWE-1104 | **Closed** | Changed to npm ci |
| 19 | SEC-0054 No gitleaks hook | Medium | 24 | CWE-522 | **Closed** | Added gitleaks v8.24.0 pre-commit hook |
| 20 | SEC-0055 XSS PathExplorer | Medium | 24 | CWE-79 | **Closed** | Shared escapeHtml with quote escaping |
| 21 | SEC-0056 XSS PerformanceMetrics | Medium | 24 | CWE-79 | **Closed** | Shared escapeHtml with quote escaping |
| 22 | SEC-0032 Query text in globalState | Medium | 20 | CWE-922 | **Closed** | Migrated to workspaceState with data migration |
| 23 | SEC-0033 Auto-connect bypass | Medium | 20 | CWE-15 | **Closed** | scope: machine on autoConnect setting |
| 24 | SEC-0034 Insecure TLS scope | Medium | 20 | CWE-295 | **Closed** | scope: machine + security warning in description |
| 25 | SEC-0022 Gitleaks excludes source | Medium | 20 | CWE-522 | **Closed** | .gitleaks.toml does not exclude source files |
| 26 | SEC-0037 Floating CI components | Medium | 20 | CWE-1104 | **Closed** | Pinned component versions + image digests |
| 27 | SEC-0020 CI lint/test ignored | Medium | 20 | CWE-684 | **Closed** | Removed || true; CI shares build artifacts |
| 28 | SEC-0057 CSP broad unpkg.com | Low | 16 | CWE-16 | **Mitigated** | SRI integrity attrs pin exact scripts; nonce-gated |
| 29 | SEC-0040 MCP logs full args | Low | 12 | CWE-532 | **Closed** | redactSensitiveArgs before logging |
| 30 | SEC-0058 check-todos exits 0 | Low | 12 | CWE-684 | **Closed** | Fixed exit logic |
| 31 | SEC-0035 CLI option injection | Low | 12 | CWE-78 | **Closed** | Query via stdin with - argument |
| 32 | SEC-0036 Doc webview no CSP | Low | 12 | CWE-79 | **Closed** | Strict CSP; enableScripts: false |
| 33 | SEC-0038 SBOM non-blocking | Low | 12 | CWE-684 | **Closed** | allow_failure: false |
| 34 | SEC-0023 unsafe-inline styles | Low | 12 | CWE-79 | **Closed** | BaseWebviewPanel uses nonce for styles |
| 35 | SEC-0019 Insecure TLS skip | Medium | 20 | CWE-295 | **Closed** | scope: machine + console warnings |
| 36 | SEC-0039 mocha/diff dev vulns | Low | 8 | CWE-1333 | **Blocked** | Dev dependency; upstream issue |
| 37 | SEC-0021 mocha/diff/undici vulns | Low | 8 | CWE-1333 | **Blocked** | Dev dependency; upstream issue |

**Scoring:** Risk = Impact (1-5) x Likelihood (1-5) x 4. Max = 100.

## Blocked Items Detail

### SEC-0046: brace-expansion ReDoS

- **GitLab issue:** [#46](https://gitlab.com/devnw/codepros/geode/geode-vscode/-/issues/46)
- **Blocker:** `@isaacs/brace-expansion@5.0.0` is a transitive dependency. No patched version available upstream. Advisory: GHSA-7h2j-956f-4vf2.
- **Mitigation:** Dev dependency only; not shipped in .vsix. Monitor for upstream fix.

### SEC-0039 / SEC-0021: mocha/diff/undici dev vulnerabilities

- **GitLab issues:** [#39](https://gitlab.com/devnw/codepros/geode/geode-vscode/-/issues/39), [#21](https://gitlab.com/devnw/codepros/geode/geode-vscode/-/issues/21)
- **Blocker:** Transitive dev dependencies via mocha test framework. Not shipped in .vsix.
- **Mitigation:** Dev-only impact; monitor for upstream fixes.

## Feature Gaps

### GAP-0012: Performance Tools

- **GitLab issue:** #12
- **Status:** **Blocked**
- **Blocker:** Requires Geode server metrics API that does not yet exist. The `_fetchMetrics` method generates sample data because there is no server endpoint to query.
- **Acceptance criteria:** Implement when Geode server exposes performance metrics API.

### GAP-0014: Testing and CI/CD

- **GitLab issue:** #14
- **Status:** **Closed**
- **Resolution:** Removed `|| true` from Makefile lint target. CI pipeline now shares build artifacts (out/, node_modules/) from build stage to lint and test stages, eliminating redundant `npm ci` and compile steps.

## Key Implementation Details

### Shared Security Utilities (`src/utils/security.ts`)

Consolidated 17+ duplicate implementations into a single module:
- `escapeHtml()` — null-safe, all 5 HTML chars including quotes
- `getNonce()` — crypto.randomBytes instead of Math.random
- `sanitizeIdentifier()` — GQL identifier validation (dual mode: strict/lenient)
- `escapeStringValue()` — GQL string escaping (dual mode: throw/truncate)
- `isValidBinaryPath()` — binary path validation
- `formatError()` — consistent error formatting
- Constants: `DEFAULT_PORT`, `CONNECTION_TIMEOUT_MS`, `QUERY_TIMEOUT_MS`

### Data Flow Security Pattern

All webview panels now use the postMessage API for data passing instead of inline JSON.stringify, preventing XSS via script context breakout.

### CSP Architecture

- BaseWebviewPanel: `script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'nonce-${nonce}'`
- GraphVisualizationPanel: `script-src 'nonce-${nonce}' https://unpkg.com` (with SRI)
- Documentation panel: `default-src 'none'; style-src 'unsafe-inline'` (scripts disabled)

## Automated Scan Summary

| Tool | Version | Findings | Notes |
|------|---------|----------|-------|
| semgrep | 1.150.0 | 7 | 2 path traversal, 2 child_process, 3 postMessage origin |
| trivy (fs) | 0.69.0 | 0 | No known CVEs in deps |
| trivy (config) | 0.69.0 | 0 | No IaC misconfigs |
| grype | 0.107.0 | 0 | Clean SBOM scan |
| gitleaks | 8.24.0 | 20 | Mostly test patterns; no real secrets |
| trufflehog | - | 0 | Clean |
| osv-scanner | - | 1 | GHSA-7h2j-956f-4vf2 (brace-expansion) |
| npm audit | - | 1 high | @isaacs/brace-expansion ReDoS |
| checkov | - | 0 | All passed |
| shellcheck | - | 0 | Clean |
