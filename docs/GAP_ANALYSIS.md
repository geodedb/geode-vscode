# Security Gap Analysis

**Project:** geode-vscode (VS Code Extension for Geode Graph Database)
**Review Date:** 2026-01-30
**Reviewer:** Automated Security Review Agent (Adversarial Review Pass)
**Git Commit:** ea8a948
**Last Updated:** 2026-01-30
**Remediation Status:** ALL FINDINGS RESOLVED ✅

## Summary

| Severity | Original Count | Resolved | Remaining |
|----------|----------------|----------|-----------|
| Critical | 2 | 2 | 0 |
| High | 5 | 5 | 0 |
| Medium | 7 | 7 | 0 |
| Low | 2 | 2 | 0 |
| **Total** | **16** | **16** | **0** |

## Adversarial Security Review - COMPLETED ✅

**Review Completed:** 2026-01-30
**Tests:** 242 passing, 14 pending
**Compilation:** No errors

### Review Scope
- Application code (TypeScript/JavaScript)
- Webview security (CSP, XSS, message handling)
- Child process spawning (binary validation, workspace trust)
- GQL/Cypher injection prevention
- CI/CD pipeline configuration
- Dependency vulnerabilities
- Secrets/credential handling

### Key Security Controls Verified
1. **Workspace Trust Integration** - Untrusted workspaces cannot execute arbitrary binaries
2. **Binary Path Validation** - Shell metacharacters, path traversal, and direct shell execution blocked
3. **GQL Injection Prevention** - All user inputs sanitized via sanitizeIdentifier/escapeStringValue
4. **Password Security** - All passwords passed via GEODE_PASSWORD environment variable
5. **XSS Prevention** - escapeHtml() applied to all dynamic content in webviews
6. **CSP Hardening** - Nonce-based script-src and style-src in all webview panels
7. **Supply Chain Protection** - SRI hashes on all CDN scripts
8. **Prototype Pollution Prevention** - safeMerge() filters dangerous keys

### Dependencies Status
- `npm audit`: 2 low severity in mocha (dev dependency only) - acceptable
- All production dependencies clean

### Informational Notes (No Action Required)
1. **MCP Server Query Tool** - Allows arbitrary GQL by design for AI assistant access; database access control handles this
2. **SavedQueriesProvider Import** - Uses explicit property picking which prevents prototype pollution; considers adding type validation as enhancement

---

## Recently Resolved Findings (Adversarial Review - 2026-01-30)

| Rank | Issue | Severity | Risk Score | GitLab Issue | Status |
|------|-------|----------|------------|--------------|--------|
| 1 | Arbitrary Binary Execution via Workspace Settings | **Critical** | 80/100 | [#29](https://gitlab.com/devnw/codepros/geode/geode-vscode/-/issues/29) | ✅ **RESOLVED** |
| 2 | Password Exposure via CLI Args in GraphVisualizationPanel | **High** | 48/100 | [#30](https://gitlab.com/devnw/codepros/geode/geode-vscode/-/issues/30) | ✅ **RESOLVED** |

---

### 1. Arbitrary Binary Execution via Workspace Settings (Critical) - Issue #29 ✅ RESOLVED

**File:** `src/extension.ts`
**Lines:** 248-312 (security validation functions), 318-401 (refactored LSP startup)
**Also:** `src/client/GeodeClientWrapper.ts` lines 140-197 (binary path validation)
**Also:** `package.json` lines 623-634 (machine scope settings)

**Impact:** 5/5 | **Likelihood:** 4/5 | **Risk Score:** 80/100

**Fix Applied:**
1. **Machine Scope Settings:** Added `"scope": "machine"` to `geode.lsp.path` and `geode.lsp.args` in package.json to prevent workspace-level overrides
2. **Binary Path Validation:** Added `isValidBinaryPath()` function that rejects:
   - Shell metacharacters (`;`, `&`, `|`, `` ` ``, `$`)
   - Path traversal attempts (`..`)
   - Direct shell execution (`sh`, `bash`, `cmd`, etc.)
   - Non-geode script files (`.sh`, `.bat`, `.cmd`, `.ps1` that aren't named `geode.*`)
3. **Workspace Trust Integration:** Added `isBinaryPathTrusted()` that:
   - Returns true if workspace is trusted
   - Returns false for binaries within untrusted workspace folders
   - Shows modal warning with options to use system binary or cancel
4. **Refactored LSP Startup:** Split `startLanguageServer()` into:
   - Security validation in `startLanguageServer()`
   - Core logic in `startLanguageServerWithPath()`

**Verification:**
- 5 new security tests in `src/test/security.test.ts` covering binary path validation
- TypeScript compilation passes
- All 242 tests pass

---

### 2. Password Exposure via CLI Args in GraphVisualizationPanel (High) - Issue #30 ✅ RESOLVED

**File:** `src/panels/GraphVisualizationPanel.ts`
**Lines:** 2295-2310, 2347-2362 (both functions fixed)

**Impact:** 4/5 | **Likelihood:** 3/5 | **Risk Score:** 48/100

**Fix Applied:**
Changed both `queryToDot()` and `queryToJson()` to pass password via `GEODE_PASSWORD` environment variable instead of `-P` CLI argument:

```typescript
// BEFORE (vulnerable):
if (password) {
    args.push('-P', password);
}
const proc = cp.spawn(geodeBinary, args, { timeout: 60000 });

// AFTER (secure):
const spawnEnv: NodeJS.ProcessEnv = { ...process.env };
if (password) {
    spawnEnv['GEODE_PASSWORD'] = password;
}
const proc = cp.spawn(geodeBinary, args, { timeout: 60000, env: spawnEnv });
```

**Verification:**
- 5 new security tests in `src/test/security.test.ts` covering password handling
- Updated existing tests in `src/test/geodeClientWrapper.test.ts` to test secure pattern
- TypeScript compilation passes
- All 242 tests pass

---

## Resolved Findings (Recent)

| Rank | Issue | Severity | Risk Score | GitLab Issue | Status |
|------|-------|----------|------------|--------------|--------|
| 1 | GQL Injection in PathExplorerPanel | High | 48/100 | #24 | **RESOLVED** |
| 2 | GQL Injection in EnhancedSchemaExplorerProvider | High | 48/100 | #25 | **RESOLVED** |
| 3 | XSS and Missing CSP in EnhancedSchemaExplorerProvider | Medium | 36/100 | #26 | **RESOLVED** |
| 4 | Supply Chain Risk - CDN Scripts Without SRI | Medium | 32/100 | #27 | **RESOLVED** |
| 5 | Prototype Pollution in EnhancedConnectionManager | Medium | 24/100 | #28 | **RESOLVED** |

## Remediation Summary - All Resolved (14)

| # | Finding | Status | Fix Applied |
|---|---------|--------|-------------|
| 1 | GQL Injection in MCP Server (#15) | **RESOLVED** | Added input validation utilities (sanitizeIdentifier, escapeStringValue, sanitizeNumber) and applied to all query methods |
| 2 | Password Exposure via CLI (#16, #30) | **RESOLVED** | Changed to pass password via GEODE_PASSWORD environment variable instead of CLI args in ALL files (GeodeClientWrapper, ConnectionManager, extension.ts, GraphVisualizationPanel queryToDot/queryToJson) |
| 3 | GQL Injection in Graph Viz (#17) | **RESOLVED** | Added sanitization utilities and applied to buildExpandQuery/buildRelatedQuery |
| 4 | Insecure TLS Default (#19) | **RESOLVED** | Changed default to `insecure: false`, added warnIfInsecure() with user confirmation for non-localhost |
| 5 | Gitleaks Config (#22) | **RESOLVED** | Removed overly broad exclusions, added specific allowlist rules for false positives |
| 6 | CI Test/Lint Failures (#20) | **RESOLVED** | Removed `|| true` from lint and test jobs in .gitlab-ci.yml |
| 7 | XSS via innerHTML (#18) | **RESOLVED** | Applied escapeHtml() and escapeJsString() to all user data in tooltip and detail panels |
| 8 | Vulnerable Dependencies (#21) | **RESOLVED** | Ran npm audit fix (undici moderate fixed; mocha low-severity in dev deps remaining) |
| 9 | CSP unsafe-inline Styles (#23) | **RESOLVED** | Changed all webview panels to use nonce-based styles instead of 'unsafe-inline' |
| 10 | GQL Injection in PathExplorerPanel (#24) | **RESOLVED** | Added sanitizeIdentifier(), escapeStringValue(), sanitizeDepth() and applied to _generateQuery() |
| 11 | GQL Injection in EnhancedSchemaExplorerProvider (#25) | **RESOLVED** | Added sanitizeIdentifier() and applied to all GQL query commands |
| 12 | XSS/CSP in EnhancedSchemaExplorerProvider (#26) | **RESOLVED** | Added escapeHtml(), generateNonce() and CSP meta tags to HTML generators |
| 13 | Supply Chain Risk - CDN Scripts (#27) | **RESOLVED** | Added SRI integrity hashes to all external CDN scripts |
| 14 | Prototype Pollution (#28) | **RESOLVED** | Added safeMerge() function to filter __proto__/constructor/prototype keys |

## Recently Resolved Findings (5)

### 1. GQL Injection in PathExplorerPanel (High) - Issue #24 ✅ RESOLVED

**File:** `src/panels/PathExplorerPanel.ts`
**Lines:** 326-348 → Fixed at lines 1-60 (utilities), 377-413 (query generation)
**Impact:** 4/5 | **Likelihood:** 3/5 | **Risk Score:** 48/100

**Fix Applied:**
- Added `sanitizeIdentifier()` function to validate GQL identifiers against alphanumeric pattern
- Added `escapeStringValue()` function to escape single quotes and backslashes
- Added `sanitizeDepth()` function with bounds checking (1-20)
- Applied sanitization to `_generateQuery()` method for all user inputs

**Verification:**
- 24 security tests added in `src/test/security.test.ts`
- TypeScript compilation passes
- All 230 tests pass

---

### 2. GQL Injection in EnhancedSchemaExplorerProvider (High) - Issue #25 ✅ RESOLVED

**File:** `src/views/EnhancedSchemaExplorerProvider.ts`
**Lines:** 232, 268, 303 → Fixed at lines 17-44, 292, 330, 372

**Fix Applied:**
- Added `sanitizeIdentifier()` function with validation and error throwing
- Applied to `showLabelDetails` command (line 292)
- Applied to `showRelationshipDetails` command (line 330)
- Applied to `copyLabelQuery` command (line 372)

**Verification:**
- Invalid identifiers now throw descriptive errors
- Injection attempts are blocked before query execution

---

### 3. XSS and Missing CSP in EnhancedSchemaExplorerProvider (Medium) - Issue #26 ✅ RESOLVED

**File:** `src/views/EnhancedSchemaExplorerProvider.ts`
**Lines:** 335-392 → Fixed at lines 46-70, 381-425, 427-475

**Fix Applied:**
- Added `escapeHtml()` function to escape HTML special characters
- Added `generateNonce()` function for CSP
- Added CSP meta tag with nonce-based style-src and script-src 'none'
- Applied escapeHtml() to all interpolated values in:
  - `generateLabelDetailsHtml()` - labelName, sample data
  - `generateRelationshipDetailsHtml()` - relType, source/target labels, properties

**Verification:**
- XSS payloads are properly escaped
- CSP prevents inline script execution

---

### 4. Supply Chain Risk - CDN Scripts Without SRI (Medium) - Issue #27 ✅ RESOLVED

**File:** `src/panels/GraphVisualizationPanel.ts`
**Lines:** 1089-1093 → Fixed with integrity attributes

**Fix Applied:**
Added Subresource Integrity (SRI) hashes to all CDN scripts:
```html
<script integrity="sha384-J7Q85oZE4GJ/e7+n2aOQsLXfDwwfnA8S2nZAL5BpFsfpCF84zQD7LroZ/dMnLgex" crossorigin="anonymous" ...>
<script integrity="sha384-2IH3T69EIKYC4c+RXZifZRvaH5SRUdacJW7j6HtE5rQbvLhKKdawxq6vpIzJ7j9M" crossorigin="anonymous" ...>
<script integrity="sha384-u69h9ebXeSjlg6q/rb1zKTRAGu/h8deCl0409xpS/QJctMKnc4M9Fzkm01VOQdeF" crossorigin="anonymous" ...>
<script integrity="sha384-CUkVnmwscI7lsYn26xHp4BmwwUaqCgfQlIkPoERUBcg8k0xFypHQjzlS8RuYuooO" crossorigin="anonymous" ...>
```

**Verification:**
- SRI hashes calculated via `openssl dgst -sha384`
- Security tests verify hash format

---

### 5. Prototype Pollution in EnhancedConnectionManager (Medium) - Issue #28 ✅ RESOLVED

**File:** `src/client/EnhancedConnectionManager.ts`
**Line:** 110 → Fixed at lines 9-30, 137

**Fix Applied:**
- Added `safeMerge()` function that filters dangerous keys (`__proto__`, `constructor`, `prototype`)
- Replaced `Object.assign(profile, updates)` with `safeMerge(profile, updates)`

**Verification:**
- Security tests verify __proto__ pollution is blocked
- Security tests verify constructor pollution is blocked
- Security tests verify prototype pollution is blocked

## Previously Resolved Findings (9)

| Rank | Severity | Finding | Status | Fix Details |
|------|----------|---------|--------|-------------|
| 1 | Critical | GQL Injection in MCP Server | RESOLVED | src/mcp/GeodeMCPServer.ts: Added sanitizeIdentifier(), escapeStringValue(), sanitizeNumber() utilities and applied to countNodes, countRelationships, findPaths, createNode, createRelationship methods |
| 2 | High | Password Exposure via CLI Args | **RESOLVED** | All files now use GEODE_PASSWORD env var: GeodeClientWrapper.ts, ConnectionManager.ts, extension.ts, GraphVisualizationPanel.ts (queryToDot, queryToJson) |
| 3 | High | GQL Injection in Graph Viz | RESOLVED | src/panels/GraphVisualizationPanel.ts: Added sanitization utilities, applied to buildExpandQuery and buildRelatedQuery functions |
| 4 | Medium | Insecure TLS Default | RESOLVED | src/connections/ConnectionManager.ts: Default changed to insecure:false; added warnIfInsecure() with modal confirmation for non-localhost connections |
| 5 | Medium | Gitleaks Excludes Source Files | RESOLVED | .gitleaks.toml: Removed .ts/.js exclusions, added targeted allowlist rules for VS Code API patterns and test credentials |
| 6 | Medium | CI Ignores Test/Lint Failures | RESOLVED | .gitlab-ci.yml: Removed `|| true` from lint (line 66) and test (line 78) jobs |
| 7 | Medium | Potential XSS via innerHTML | RESOLVED | src/panels/GraphVisualizationPanel.ts: Added escapeHtml() calls to showTooltip(), escapeJsString() for onclick handlers with node IDs |
| 8 | Low | Vulnerable Dependencies | RESOLVED | package.json: npm audit fix applied; undici moderate vulnerability fixed; 2 low-severity in mocha (dev dependency) acceptable |
| 9 | Low | CSP Allows unsafe-inline Styles | RESOLVED | GraphVisualizationPanel.ts, TimeSeriesPanel.ts, QueryPlanPanel.ts, BaseWebviewPanel.ts: Changed to nonce-based styles |

## Detailed Fix Documentation

### 1. GQL Injection Prevention (Critical/High)

**Files Modified:**
- `src/mcp/GeodeMCPServer.ts`
- `src/panels/GraphVisualizationPanel.ts`

**Approach:** Input validation and sanitization
- `sanitizeIdentifier()`: Validates GQL identifiers (labels, types, property names) against alphanumeric pattern
- `escapeStringValue()`: Escapes string values for safe interpolation (single quotes, backslashes)
- `sanitizeNumber()`: Validates numeric inputs with bounds checking

**Methods Fixed in MCP Server:**
- `countNodes()` - label sanitization
- `countRelationships()` - type sanitization
- `findPaths()` - all inputs sanitized
- `createNode()` - label and property names sanitized
- `createRelationship()` - all identifiers and values sanitized

**Methods Fixed in Graph Visualization:**
- `buildExpandQuery()` - nodeId escaped, labels sanitized, depth bounded
- `buildRelatedQuery()` - nodeId escaped, relationshipType sanitized

### 2. Password Security (High)

**Files Modified:**
- `src/client/GeodeClientWrapper.ts`
- `src/connections/ConnectionManager.ts`
- `src/client/EnhancedConnectionManager.ts`
- `src/extension.ts`
- `src/test/connections.test.ts`

**Approach:** Environment variable instead of CLI argument
- Password passed via `GEODE_PASSWORD` environment variable
- `buildPasswordEnvironment()` helper added
- `buildConnectionArgsWithPassword()` deprecated (no longer includes password)
- Not visible in `ps aux` or `/proc/*/cmdline`

### 3. TLS Security (Medium)

**Files Modified:**
- `src/connections/ConnectionManager.ts`
- `src/client/EnhancedConnectionManager.ts`

**Approach:** Secure by default with explicit user opt-in
- Default profile now has `insecure: false`
- `warnIfInsecure()` function shows:
  - Informational message for localhost
  - Modal confirmation dialog for non-localhost (requires "Connect Anyway" click)

### 4. XSS Prevention (Medium/Low)

**Files Modified:**
- `src/panels/GraphVisualizationPanel.ts`

**Approach:** Consistent HTML escaping
- `escapeHtml()` applied to all dynamic content in tooltips and detail panels
- `escapeJsString()` added for onclick handler values
- Node IDs and property values properly escaped before innerHTML assignment

### 5. CSP Hardening (Low)

**Files Modified:**
- `src/panels/GraphVisualizationPanel.ts`
- `src/panels/TimeSeriesPanel.ts`
- `src/panels/QueryPlanPanel.ts`
- `src/panels/BaseWebviewPanel.ts`

**Approach:** Nonce-based styles
- Changed `style-src 'unsafe-inline'` to `style-src 'nonce-${nonce}'`
- Added `nonce="${nonce}"` attribute to all `<style>` tags

### 6. CI/CD and Configuration (Medium)

**Files Modified:**
- `.gitlab-ci.yml`
- `.gitleaks.toml`

**CI Pipeline:** Removed `|| true` from lint and test jobs to enforce quality gates

**Gitleaks:**
- Removed overly broad path exclusions
- Added specific allowlist rules for VS Code API patterns and test fixtures

## Security Posture Assessment (Post-Remediation)

### Strengths (All Items Complete)

1. **Secure Credential Storage**: Passwords use VS Code SecretStorage API
2. **Password Transmission**: Now via environment variable, not CLI args
3. **Input Validation**: Comprehensive sanitization in ALL panels (MCP Server, GraphVisualization, PathExplorer, SchemaExplorer)
4. **TLS by Default**: Secure connections with explicit user opt-in for insecure mode
5. **CI Security Scanning**: GitLab CI includes SAST, dependency scanning, and gitleaks
6. **CSP in ALL Webviews**: Nonce-based script-src AND style-src in all panels
7. **XSS Prevention**: Consistent HTML escaping in ALL webview panels
8. **CI Quality Gates**: Tests and linting enforced (no silent failures)
9. **Secret Scanning**: Gitleaks now scans source files effectively
10. **Supply Chain Security**: All CDN scripts have SRI integrity hashes
11. **Prototype Pollution Protection**: Safe merge function filters dangerous keys

### Weaknesses (None - All Resolved ✅)

All security issues have been remediated including the latest adversarial review findings:

**Adversarial Review Findings (2026-01-30):**
- ✅ **Arbitrary Binary Execution via Workspace Settings (#29)** - Fixed with machine scope settings, binary path validation, and workspace trust integration
- ✅ **Password Exposure in GraphVisualizationPanel (#30)** - Fixed: queryToDot/queryToJson now use GEODE_PASSWORD env var

**Previously Resolved:**
- ✅ GQL Injection in PathExplorerPanel (#24)
- ✅ GQL Injection in EnhancedSchemaExplorerProvider (#25)
- ✅ XSS in EnhancedSchemaExplorerProvider (#26)
- ✅ CDN scripts without SRI (#27)
- ✅ Prototype Pollution (#28)

### Remaining Considerations

1. **Mocha Dev Dependency**: 2 low-severity vulnerabilities remain (dev-only, acceptable risk)
2. **Parameterized Queries**: Consider implementing native parameterization support in Geode client for defense in depth
3. **Security Documentation**: Consider adding SECURITY.md and contributor security guidelines

## Verification

All fixes verified:
- TypeScript compilation: `npm run compile` - PASS
- Test suite: `npm run test` - 242 passing, 14 pending
- Security tests: 34 tests in `src/test/security.test.ts` covering:
  - GQL identifier sanitization
  - String value escaping
  - Depth parameter bounds
  - XSS prevention
  - Prototype pollution prevention
  - SRI hash validation
  - CSP nonce verification
  - Binary path validation (5 tests for workspace trust mitigation)
  - Password security (5 tests for env var pattern)

---

## Adversarial Review Summary (2026-01-30)

**Review Type:** Full adversarial security code review
**Scope:** Application code, CI/CD, configuration, dependencies
**Findings:** 2 new vulnerabilities discovered and remediated

### Top 10 Findings (Stack-Ranked by Risk Score) - ALL RESOLVED ✅

| Rank | Finding | Severity | Risk Score | Issue | Status |
|------|---------|----------|------------|-------|--------|
| 1 | Arbitrary Binary Execution via Workspace Settings | Critical | 80/100 | #29 | ✅ RESOLVED |
| 2 | Password Exposure via CLI Args (GraphVisualizationPanel) | High | 48/100 | #30 | ✅ RESOLVED |
| 3 | GQL Injection in PathExplorerPanel | High | 48/100 | #24 | ✅ RESOLVED |
| 4 | GQL Injection in EnhancedSchemaExplorerProvider | High | 48/100 | #25 | ✅ RESOLVED |
| 5 | GQL Injection in MCP Server | Critical | 45/100 | #15 | ✅ RESOLVED |
| 6 | GQL Injection in Graph Viz | High | 48/100 | #17 | ✅ RESOLVED |
| 7 | XSS and Missing CSP in EnhancedSchemaExplorerProvider | Medium | 36/100 | #26 | ✅ RESOLVED |
| 8 | Supply Chain Risk - CDN Scripts Without SRI | Medium | 32/100 | #27 | ✅ RESOLVED |
| 9 | Insecure TLS Default | Medium | 30/100 | #19 | ✅ RESOLVED |
| 10 | Prototype Pollution in EnhancedConnectionManager | Medium | 24/100 | #28 | ✅ RESOLVED |

---

## Verification Summary

**All 16 findings have been remediated and verified:**
- TypeScript compilation: `npm run compile` - PASS
- Test suite: `npm run test` - 242 passing, 14 pending
- Security tests: 34 tests in `src/test/security.test.ts` covering:
  - GQL identifier sanitization
  - String value escaping
  - Depth parameter bounds
  - XSS prevention
  - Prototype pollution prevention
  - SRI hash validation
  - CSP nonce verification
  - Binary path validation (5 new tests)
  - Password security (5 new tests)

---

*This analysis was generated by an automated adversarial security review. All 16 findings have been remediated and verified.*
