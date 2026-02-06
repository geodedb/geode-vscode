# Gap Analysis

## Gaps

### GAP-0012: Performance Tools

- **GitLab issue:** #12
- **Category:** Performance
- **Severity:** Medium
- **Requirement source:** README.md: Features -> Performance Tools
- **Current state (evidence):**
  - `src/panels/PerformanceMetricsPanel.ts`: The `_fetchMetrics` method, which is responsible for getting the performance data, currently only generates random sample data. The comment `// In production, this would fetch from the Geode server` confirms that the implementation is a placeholder.
- **Why this is a gap:** The core functionality of the performance tools feature is not implemented; it's a mock-up.
- **Impact/Risk:** The entire "Performance Tools" feature is non-functional and misleading to users.
- **Recommended fix:** Implement the logic in `_fetchMetrics` to connect to the Geode server and fetch real performance data. This will likely require new commands or APIs in the Geode client.
- **Acceptance criteria:** The performance metrics dashboard displays actual, real-time data from the connected Geode server.

### GAP-0014: Testing and CI/CD

- **GitLab issue:** #14
- **Category:** CI/CD
- **Severity:** High
- **Requirement source:** `.gitlab-ci.yml`
- **Current state (evidence):**
  - In `.gitlab-ci.yml`, the `lint` and `test` jobs use `|| true` in their `script` sections.
- **Why this is a gap:** This configuration allows the CI/CD pipeline to succeed even if linting fails or tests do not pass, defeating the purpose of these checks.
- **Impact/Risk:** Code with linting errors or failing tests can be merged and released, leading to bugs and regressions. The safety net provided by the test suite is effectively disabled in the CI/CD pipeline.
- **Recommended fix:** Remove `|| true` from the `script` sections of the `lint` and `test` jobs in `.gitlab-ci.yml`.
- **Acceptance criteria:** The CI pipeline fails if `npm run lint` or `npm run test` returns a non-zero exit code.
