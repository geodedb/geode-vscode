# Sub-Plan 1 — Foundation: Bundle geode-ui + Message Bridge

> **For agentic workers:** REQUIRED SUB-SKILL: Use **superpowers:subagent-driven-development** (recommended) or **superpowers:executing-plans** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the foundation for replacing the VSCode extension's UI with the `geode-ui` SPA: fetch & bundle the SPA dist and the geode-ui Go server binary, spawn the binary at activation, render the SPA inside a `WebviewPanel`, and route a single end-to-end "health" message from the SPA to the host and back.

**Architecture:** A new `bridge/` module defines a typed JSON message protocol between the webview and the extension host. A new `server/GeodeServerProcess.ts` owns the geode-ui server binary lifecycle and exposes its localhost URL. A new `webview/ReactWebviewPanel.ts` base class assembles the SPA HTML with strict CSP and injects a `window.geode` adapter before the SPA boots. A new `geode.showSpaShell` command opens the SPA in an editor-area panel — proves the wiring without disturbing any existing flow.

**Tech Stack:** TypeScript, `vscode` API, Node `child_process`, Node `net`, Node `crypto`, npm scripts using global `fetch`, existing Mocha test infra.

---

## Task 1: Bundled-asset directory + .gitignore

**Files:**

- Create: `resources/.gitkeep`
- Create: `resources/bin/.gitkeep`
- Create: `resources/webview/.gitkeep`
- Modify: `.gitignore:1-end`

- [ ] **Step 1: Add resource tree skeleton**

```bash
mkdir -p resources/bin resources/webview
touch resources/.gitkeep resources/bin/.gitkeep resources/webview/.gitkeep
```

- [ ] **Step 2: Append ignore rules**

Append to `.gitignore` so build outputs don't get checked in:

```gitignore

# Bundled assets fetched at build time
/resources/bin/**
!/resources/bin/.gitkeep
/resources/webview/**
!/resources/webview/.gitkeep
```

- [ ] **Step 3: Commit**

```bash
git add resources/ .gitignore
git commit -m "build: add resources/ tree for bundled SPA + binaries"
```

---

## Task 2: Asset fetch script (geode-ui SPA dist)

**Files:**

- Create: `scripts/fetch-geode-ui.mjs`
- Create: `scripts/lib/download.mjs`
- Create: `scripts/lib/sha256.mjs`
- Test: `scripts/__tests__/fetch-geode-ui.test.mjs`

The script must support **two modes**:

1. `--source=local --path=../geode-ui` — copies `../geode-ui/internal/ui/dist/` straight into `resources/webview/`. For developer machines with the sibling repo.
2. `--source=registry --version=<semver>` — downloads `geode-ui-<version>-spa.tar.gz` from the geode-ui GitLab Generic Package Registry and extracts it. For CI builds.

A `geode-ui.lock.json` at the repo root pins the version + sha256 so reproducible builds don't drift.

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/fetch-geode-ui.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchGeodeUi } from '../fetch-geode-ui.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.join(__dirname, 'fixtures/geode-ui-fake')

test('local mode copies dist into resources/webview', async () => {
  const tmp = await fs.mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'gv-'))
  await fs.mkdir(path.join(tmp, 'resources/webview'), { recursive: true })
  await fetchGeodeUi({
    source: 'local',
    path: fixtureRoot,
    outRoot: tmp,
  })
  const indexHtml = await fs.readFile(
    path.join(tmp, 'resources/webview/index.html'),
    'utf8'
  )
  assert.match(indexHtml, /<div id="root"><\/div>/)
})

test('rejects local mode when ../geode-ui/internal/ui/dist is missing', async () => {
  const tmp = await fs.mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'gv-'))
  await assert.rejects(
    fetchGeodeUi({ source: 'local', path: '/nonexistent', outRoot: tmp }),
    /dist not found/
  )
})
```

Add a fixture: `scripts/__tests__/fixtures/geode-ui-fake/internal/ui/dist/index.html` containing `<!doctype html><html><body><div id="root"></div></body></html>`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/__tests__/fetch-geode-ui.test.mjs`
Expected: FAIL — `Cannot find module '../fetch-geode-ui.mjs'`.

- [ ] **Step 3: Implement local-mode fetch**

Create `scripts/fetch-geode-ui.mjs`:

```javascript
#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const SPA_RELATIVE = 'internal/ui/dist'

export async function fetchGeodeUi({ source, path: srcPath, version, outRoot }) {
  if (source === 'local') {
    return fetchLocal(srcPath, outRoot)
  }
  if (source === 'registry') {
    return fetchRegistry(version, outRoot)
  }
  throw new Error(`unknown source: ${source}`)
}

async function fetchLocal(srcPath, outRoot) {
  const distDir = path.resolve(srcPath, SPA_RELATIVE)
  try {
    await fs.access(distDir)
  } catch {
    throw new Error(`dist not found at ${distDir}`)
  }
  const target = path.join(outRoot, 'resources/webview')
  await fs.rm(target, { recursive: true, force: true })
  await fs.mkdir(target, { recursive: true })
  await copyTree(distDir, target)
  return { distDir, target }
}

async function copyTree(src, dst) {
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const e of entries) {
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (e.isDirectory()) {
      await fs.mkdir(d, { recursive: true })
      await copyTree(s, d)
    } else if (e.isFile()) {
      await fs.copyFile(s, d)
    }
  }
}

async function fetchRegistry(_version, _outRoot) {
  throw new Error('registry mode not implemented in this task')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', default: 'local' },
      path: { type: 'string', default: '../geode-ui' },
      version: { type: 'string' },
    },
  })
  const outRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  fetchGeodeUi({ ...values, outRoot }).then(
    (r) => console.log(`fetched ${r.target}`),
    (e) => {
      console.error(e.message)
      process.exit(1)
    }
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/__tests__/fetch-geode-ui.test.mjs`
Expected: 2 passing tests.

- [ ] **Step 5: Add npm script and wire to prepackage**

Edit `package.json` `scripts` block — add three entries:

```json
"fetch:ui": "node scripts/fetch-geode-ui.mjs",
"fetch:ui:local": "node scripts/fetch-geode-ui.mjs --source=local --path=../geode-ui",
"prepackage": "npm run fetch:ui:local && npm run compile"
```

- [ ] **Step 6: Smoke check from a clean tree**

```bash
rm -rf resources/webview/*
npm run fetch:ui:local
ls resources/webview/ | head -5
```

Expected: at least an `index.html` and one or more `*.js` chunks.

- [ ] **Step 7: Commit**

```bash
git add scripts/fetch-geode-ui.mjs scripts/__tests__/ package.json
git commit -m "build: add fetch-geode-ui.mjs (local mode) and prepackage hook"
```

---

## Task 3: Registry mode + sha256 lock

**Files:**

- Modify: `scripts/fetch-geode-ui.mjs` (extend `fetchRegistry`)
- Create: `scripts/lib/download.mjs`
- Create: `scripts/lib/sha256.mjs`
- Create: `geode-ui.lock.json`
- Modify: `scripts/__tests__/fetch-geode-ui.test.mjs` (add registry path test)

- [ ] **Step 1: Write the failing test**

Append to `scripts/__tests__/fetch-geode-ui.test.mjs`:

```javascript
import { sha256OfStream, sha256OfBuffer } from '../lib/sha256.mjs'

test('sha256OfBuffer matches a known fixture', async () => {
  const buf = Buffer.from('hello world')
  const hex = await sha256OfBuffer(buf)
  assert.equal(hex, 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/__tests__/fetch-geode-ui.test.mjs`
Expected: FAIL — `Cannot find module '../lib/sha256.mjs'`.

- [ ] **Step 3: Implement sha256 helper**

Create `scripts/lib/sha256.mjs`:

```javascript
import crypto from 'node:crypto'

export function sha256OfBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

export function sha256OfStream(stream) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    stream.on('data', (c) => h.update(c))
    stream.on('end', () => resolve(h.digest('hex')))
    stream.on('error', reject)
  })
}
```

- [ ] **Step 4: Implement download helper**

Create `scripts/lib/download.mjs`:

```javascript
import fs from 'node:fs'
import path from 'node:path'
import { sha256OfStream } from './sha256.mjs'

// Downloads `url` to `dest`, streaming. Returns the sha256 hex of bytes
// written. Throws if HTTP status is not 200. The caller is responsible
// for comparing the returned digest against an expected value.
export async function downloadToFile(url, dest) {
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(`download ${url} -> HTTP ${res.status}`)
  }
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  const file = fs.createWriteStream(dest)
  const teeHash = sha256OfStream(res.body)
  await new Promise((resolve, reject) => {
    res.body.pipeTo(
      new WritableStream({
        write(chunk) {
          return new Promise((r, j) =>
            file.write(chunk, (err) => (err ? j(err) : r()))
          )
        },
        close() {
          file.end()
          resolve()
        },
        abort: reject,
      })
    )
  })
  return teeHash
}
```

- [ ] **Step 5: Implement registry-mode fetch in fetch-geode-ui.mjs**

Replace the `fetchRegistry` stub:

```javascript
import { downloadToFile } from './lib/download.mjs'
import { sha256OfBuffer } from './lib/sha256.mjs'
import zlib from 'node:zlib'
import { Readable } from 'node:stream'
import tar from 'node:tar' // NOTE: dev dependency added below

async function fetchRegistry(version, outRoot) {
  if (!version) throw new Error('registry mode requires --version')
  const lock = JSON.parse(
    await fs.readFile(path.join(outRoot, 'geode-ui.lock.json'), 'utf8')
  )
  const entry = lock.spa[version]
  if (!entry) throw new Error(`no lock entry for spa@${version}`)
  const tmpDest = path.join(outRoot, 'resources/webview/.download.tar.gz')
  const digest = await downloadToFile(entry.url, tmpDest)
  if (digest !== entry.sha256) {
    await fs.unlink(tmpDest).catch(() => {})
    throw new Error(
      `sha256 mismatch for spa@${version}: ${digest} expected ${entry.sha256}`
    )
  }
  const target = path.join(outRoot, 'resources/webview')
  await fs.rm(target, { recursive: true, force: true })
  await fs.mkdir(target, { recursive: true })
  await tar.x({ file: tmpDest, cwd: target, strip: 0 })
  await fs.unlink(tmpDest)
  return { target }
}
```

- [ ] **Step 6: Create the lock file**

Create `geode-ui.lock.json`:

```json
{
  "$comment": "Pins SPA + server binary versions for reproducible VSIX builds. CI updates this file via scripts/bump-lock.mjs (sub-plan 1, task 5).",
  "spa": {
    "PLACEHOLDER_VERSION": {
      "url": "PLACEHOLDER_URL",
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
    }
  }
}
```

(CI fills in real values via Task 5's bump script; for now this file just needs to parse.)

- [ ] **Step 7: Add `tar` dev dependency**

```bash
npm install --save-dev tar@^7
```

- [ ] **Step 8: Run tests**

Run: `node --test scripts/__tests__/`
Expected: all tests pass (3 total).

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/ scripts/fetch-geode-ui.mjs scripts/__tests__/ geode-ui.lock.json package.json package-lock.json
git commit -m "build: registry-mode fetch + sha256 verification + lock file"
```

---

## Task 4: Server-binary fetch script

**Files:**

- Create: `scripts/fetch-geode-binaries.mjs`
- Test: `scripts/__tests__/fetch-geode-binaries.test.mjs`

The script targets two binaries: `geode-ui` (the SPA-serving Go server) and `geode` (the graph-DB providing LSP). Each has per-platform variants. Local mode copies from sibling repos (`../geode-ui/server` for the geode-ui binary, `../geode/zig-out/bin/geode` for the graph-DB). Registry mode downloads from GitLab generic package URLs in `geode-ui.lock.json`.

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/fetch-geode-binaries.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { platformDir, fetchBinaries } from '../fetch-geode-binaries.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test('platformDir maps node platform/arch to resources/bin slug', () => {
  assert.equal(platformDir('linux', 'x64'), 'linux-x64')
  assert.equal(platformDir('linux', 'arm64'), 'linux-arm64')
  assert.equal(platformDir('darwin', 'arm64'), 'darwin-arm64')
  assert.equal(platformDir('darwin', 'x64'), 'darwin-x64')
  assert.equal(platformDir('win32', 'x64'), 'win32-x64')
})

test('platformDir throws on unsupported tuples', () => {
  assert.throws(() => platformDir('aix', 'mips'), /unsupported platform/)
})

test('local fetch copies geode-ui binary into platform dir', async () => {
  const tmp = await fs.mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'gv-'))
  // Fake sibling repo with a server binary at the expected path
  const fakeUi = path.join(tmp, 'fake-geode-ui')
  await fs.mkdir(fakeUi, { recursive: true })
  await fs.writeFile(path.join(fakeUi, 'server'), 'FAKE_BINARY', { mode: 0o755 })
  // Fake geode graph-db build output
  const fakeDb = path.join(tmp, 'fake-geode')
  await fs.mkdir(path.join(fakeDb, 'zig-out/bin'), { recursive: true })
  await fs.writeFile(path.join(fakeDb, 'zig-out/bin/geode'), 'FAKE_GEODE', { mode: 0o755 })

  await fetchBinaries({
    source: 'local',
    uiPath: fakeUi,
    geodePath: fakeDb,
    outRoot: tmp,
    onlyCurrentPlatform: true,
  })

  const slug = platformDir(process.platform, process.arch)
  const uiBin = process.platform === 'win32' ? 'geode-ui.exe' : 'geode-ui'
  const dbBin = process.platform === 'win32' ? 'geode.exe' : 'geode'
  const uiCopy = await fs.readFile(path.join(tmp, 'resources/bin', slug, uiBin), 'utf8')
  const dbCopy = await fs.readFile(path.join(tmp, 'resources/bin', slug, dbBin), 'utf8')
  assert.equal(uiCopy, 'FAKE_BINARY')
  assert.equal(dbCopy, 'FAKE_GEODE')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/__tests__/fetch-geode-binaries.test.mjs`
Expected: FAIL — `Cannot find module '../fetch-geode-binaries.mjs'`.

- [ ] **Step 3: Implement the script**

Create `scripts/fetch-geode-binaries.mjs`:

```javascript
#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const SUPPORTED = new Set([
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
])

export function platformDir(plat, arch) {
  const slug = `${plat}-${arch}`
  if (!SUPPORTED.has(slug)) throw new Error(`unsupported platform: ${slug}`)
  return slug
}

export function binaryName(plat, base) {
  return plat === 'win32' ? `${base}.exe` : base
}

export async function fetchBinaries(opts) {
  if (opts.source === 'local') return fetchLocal(opts)
  throw new Error('registry mode for binaries lands in task 5')
}

async function fetchLocal({ uiPath, geodePath, outRoot, onlyCurrentPlatform }) {
  const platforms = onlyCurrentPlatform
    ? [platformDir(process.platform, process.arch)]
    : [...SUPPORTED]

  // Source binaries (local mode only supports the current platform's bins;
  // cross-platform copies require registry mode).
  const ui = path.join(uiPath, 'server')
  const db = path.join(geodePath, 'zig-out/bin/geode')
  await assertFile(ui, 'geode-ui server')
  await assertFile(db, 'geode binary')

  for (const slug of platforms) {
    const [plat] = slug.split('-')
    const dir = path.join(outRoot, 'resources/bin', slug)
    await fs.mkdir(dir, { recursive: true })
    if (slug === platformDir(process.platform, process.arch)) {
      await fs.copyFile(ui, path.join(dir, binaryName(plat, 'geode-ui')))
      await fs.copyFile(db, path.join(dir, binaryName(plat, 'geode')))
      await fs.chmod(path.join(dir, binaryName(plat, 'geode-ui')), 0o755)
      await fs.chmod(path.join(dir, binaryName(plat, 'geode')), 0o755)
    }
  }
}

async function assertFile(p, label) {
  try {
    const stat = await fs.stat(p)
    if (!stat.isFile()) throw new Error()
  } catch {
    throw new Error(`${label} not found at ${p}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', default: 'local' },
      uiPath: { type: 'string', default: '../geode-ui' },
      geodePath: { type: 'string', default: '../geode' },
      onlyCurrentPlatform: { type: 'boolean', default: true },
    },
  })
  const outRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  fetchBinaries({ ...values, outRoot }).then(
    () => console.log('binaries fetched'),
    (e) => {
      console.error(e.message)
      process.exit(1)
    }
  )
}
```

- [ ] **Step 4: Run tests**

Run: `node --test scripts/__tests__/fetch-geode-binaries.test.mjs`
Expected: 3 passing tests.

- [ ] **Step 5: Wire into prepackage**

Edit `package.json` `scripts`:

```json
"fetch:bin:local": "node scripts/fetch-geode-binaries.mjs --source=local",
"prepackage": "npm run fetch:ui:local && npm run fetch:bin:local && npm run compile"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-geode-binaries.mjs scripts/__tests__/fetch-geode-binaries.test.mjs package.json
git commit -m "build: add fetch-geode-binaries.mjs (local mode)"
```

---

## Task 5: Registry mode + per-platform CI matrix

**Files:**

- Modify: `scripts/fetch-geode-binaries.mjs` (registry path)
- Modify: `geode-ui.lock.json` (add `binaries` section)
- Modify: `.gitlab-ci.yml` (add `package:linux-x64`, `package:linux-arm64`, etc. matrix jobs)

- [ ] **Step 1: Extend the lock file shape**

Edit `geode-ui.lock.json` so each binary version carries one sha256+url entry per supported platform. Use the same skeleton structure as the `spa` section, namespaced under `binaries.geode-ui.<version>.<slug>` and `binaries.geode.<version>.<slug>`. Initialise every sha256 to 64 zeros; CI overwrites them.

- [ ] **Step 2: Write the failing test**

Append to `scripts/__tests__/fetch-geode-binaries.test.mjs`:

```javascript
test('registry mode rejects sha256 mismatch', async () => {
  const tmp = await fs.mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'gv-'))
  await fs.writeFile(
    path.join(tmp, 'geode-ui.lock.json'),
    JSON.stringify({
      binaries: {
        'geode-ui': {
          '0.0.0': {
            'linux-x64': { url: 'data:text/plain,WRONG', sha256: 'a'.repeat(64) },
          },
        },
        geode: {
          '0.0.0': {
            'linux-x64': { url: 'data:text/plain,WRONG', sha256: 'a'.repeat(64) },
          },
        },
      },
    })
  )
  await assert.rejects(
    fetchBinaries({
      source: 'registry',
      uiVersion: '0.0.0',
      geodeVersion: '0.0.0',
      outRoot: tmp,
      targetPlatform: 'linux-x64',
    }),
    /sha256 mismatch/
  )
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test scripts/__tests__/fetch-geode-binaries.test.mjs`
Expected: FAIL — registry mode throws "not implemented".

- [ ] **Step 4: Implement registry mode**

Replace `fetchBinaries` registry branch in `scripts/fetch-geode-binaries.mjs`:

```javascript
import { downloadToFile } from './lib/download.mjs'

export async function fetchBinaries(opts) {
  if (opts.source === 'local') return fetchLocal(opts)
  if (opts.source === 'registry') return fetchFromRegistry(opts)
  throw new Error(`unknown source: ${opts.source}`)
}

async function fetchFromRegistry({ uiVersion, geodeVersion, outRoot, targetPlatform }) {
  const lock = JSON.parse(
    await fs.readFile(path.join(outRoot, 'geode-ui.lock.json'), 'utf8')
  )
  const plat = targetPlatform ?? platformDir(process.platform, process.arch)
  const [platName] = plat.split('-')

  await downloadAndVerify(
    lock.binaries['geode-ui'][uiVersion][plat],
    path.join(outRoot, 'resources/bin', plat, binaryName(platName, 'geode-ui'))
  )
  await downloadAndVerify(
    lock.binaries.geode[geodeVersion][plat],
    path.join(outRoot, 'resources/bin', plat, binaryName(platName, 'geode'))
  )
}

async function downloadAndVerify(entry, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true })
  const digest = await downloadToFile(entry.url, dest)
  if (digest !== entry.sha256) {
    await fs.unlink(dest).catch(() => {})
    throw new Error(
      `sha256 mismatch for ${dest}: got ${digest} expected ${entry.sha256}`
    )
  }
  await fs.chmod(dest, 0o755)
}
```

- [ ] **Step 5: Run tests**

Run: `node --test scripts/__tests__/`
Expected: all tests pass.

- [ ] **Step 6: Add per-platform CI matrix**

Edit `.gitlab-ci.yml` — add five `package:` jobs that pass `--target` to `vsce` and pass platform-specific `--targetPlatform` to the fetch script. Skeleton (one example; replicate for the other four):

```yaml
package:linux-x64:
  stage: package
  image: node:20
  script:
  - npm ci
  - node scripts/fetch-geode-ui.mjs --source=registry --version="${SPA_VERSION}"
  - node scripts/fetch-geode-binaries.mjs --source=registry --uiVersion="${UI_BIN_VERSION}" --geodeVersion="${DB_BIN_VERSION}" --targetPlatform=linux-x64
  - npx vsce package --target linux-x64 --out geode-vscode-${CI_COMMIT_TAG}-linux-x64.vsix
  artifacts:
    paths:
    - "*.vsix"
```

Repeat for `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`.

- [ ] **Step 7: Commit**

```bash
git add scripts/fetch-geode-binaries.mjs scripts/__tests__/ geode-ui.lock.json .gitlab-ci.yml
git commit -m "build: registry-mode binary fetch + per-platform CI matrix"
```

---

## Task 6: Port allocator

**Files:**

- Create: `src/bridge/portAlloc.ts`
- Test: `src/test/bridge/portAlloc.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/bridge/portAlloc.test.ts`:

```typescript
import { strict as assert } from 'assert'
import * as net from 'net'
import { allocatePort } from '../../bridge/portAlloc'

describe('allocatePort', () => {
    it('returns a port number above 1024 that is actually bindable', async () => {
        const port = await allocatePort()
        assert.ok(port > 1024, `expected high port, got ${port}`)
        await new Promise<void>((resolve, reject) => {
            const s = net.createServer()
            s.once('error', reject)
            s.listen(port, '127.0.0.1', () => {
                s.close(() => resolve())
            })
        })
    })

    it('returns different ports on repeated calls', async () => {
        const a = await allocatePort()
        const b = await allocatePort()
        assert.ok(a !== b, `expected distinct ports, got ${a} twice`)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile && npx mocha out/test/bridge/portAlloc.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement allocator**

Create `src/bridge/portAlloc.ts`:

```typescript
import * as net from 'net'

// Ask the kernel for a free localhost port by binding to port 0. The
// returned port is not reserved — anyone could grab it between this
// call and a subsequent re-bind — but it gives us a TOCTOU-tolerant
// hint that is good enough for spawning a child server. The child
// does the real binding; if it loses the race the spawn fails fast
// and the caller retries.
export function allocatePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = net.createServer()
        s.unref()
        s.on('error', reject)
        s.listen(0, '127.0.0.1', () => {
            const addr = s.address()
            s.close(() => {
                if (addr && typeof addr === 'object' && typeof addr.port === 'number') {
                    resolve(addr.port)
                } else {
                    reject(new Error('failed to read allocated port'))
                }
            })
        })
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run compile && npx mocha out/test/bridge/portAlloc.test.js`
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/portAlloc.ts src/test/bridge/portAlloc.test.ts
git commit -m "feat(bridge): add localhost port allocator"
```

---

## Task 7: Binary path resolver

**Files:**

- Create: `src/server/binaryPath.ts`
- Test: `src/test/server/binaryPath.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/server/binaryPath.test.ts`:

```typescript
import { strict as assert } from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { resolveBundledBinary, BundledBinary } from '../../server/binaryPath'

describe('resolveBundledBinary', () => {
    let tmp: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-'))
    })

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true })
    })

    it('returns the platform-specific path under extension/resources/bin', () => {
        const slug = `${process.platform}-${process.arch}`
        const dir = path.join(tmp, 'resources/bin', slug)
        fs.mkdirSync(dir, { recursive: true })
        const ext = process.platform === 'win32' ? '.exe' : ''
        const binPath = path.join(dir, `geode-ui${ext}`)
        fs.writeFileSync(binPath, 'FAKE')
        fs.chmodSync(binPath, 0o755)
        const got = resolveBundledBinary(tmp, BundledBinary.GeodeUiServer)
        assert.equal(got, binPath)
    })

    it('throws when the binary is missing', () => {
        assert.throws(
            () => resolveBundledBinary(tmp, BundledBinary.GeodeUiServer),
            /bundled binary not found/
        )
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile && npx mocha out/test/server/binaryPath.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement resolver**

Create `src/server/binaryPath.ts`:

```typescript
import * as fs from 'fs'
import * as path from 'path'

export enum BundledBinary {
    GeodeUiServer = 'geode-ui',
    GeodeGraphDb = 'geode',
}

const SUPPORTED_PLATFORMS = new Set([
    'linux-x64', 'linux-arm64',
    'darwin-x64', 'darwin-arm64',
    'win32-x64',
])

export interface ResolveOpts {
    platform?: NodeJS.Platform
    arch?: NodeJS.Architecture
}

// Resolves the absolute path of a bundled binary inside the extension.
// extensionRoot is the directory that contains the `resources/` tree.
// Throws if the file is missing or the platform is unsupported.
export function resolveBundledBinary(
    extensionRoot: string,
    binary: BundledBinary,
    opts: ResolveOpts = {}
): string {
    const platform = opts.platform ?? process.platform
    const arch = opts.arch ?? process.arch
    const slug = `${platform}-${arch}`
    if (!SUPPORTED_PLATFORMS.has(slug)) {
        throw new Error(`unsupported platform: ${slug}`)
    }
    const ext = platform === 'win32' ? '.exe' : ''
    const candidate = path.join(extensionRoot, 'resources', 'bin', slug, `${binary}${ext}`)
    if (!fs.existsSync(candidate)) {
        throw new Error(`bundled binary not found: ${candidate}`)
    }
    return candidate
}
```

- [ ] **Step 4: Run tests**

Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/binaryPath.ts src/test/server/binaryPath.test.ts
git commit -m "feat(server): add bundled-binary path resolver"
```

---

## Task 8: GeodeServerProcess (spawn + readiness)

**Files:**

- Create: `src/server/GeodeServerProcess.ts`
- Test: `src/test/server/GeodeServerProcess.test.ts`

The server is spawned with `--http-addr=127.0.0.1:<port>`, `--lsp-enabled=false` (LSP attaches in sub-plan 6), and `--issuer-mode=ephemeral`. It writes a single line `LISTENING addr=<host>:<port>` on stdout once the HTTP listener is up; the wrapper waits for that line (or a 10 s timeout) before resolving `start()`.

- [ ] **Step 1: Write the failing test**

Create `src/test/server/GeodeServerProcess.test.ts`:

```typescript
import { strict as assert } from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { GeodeServerProcess } from '../../server/GeodeServerProcess'

describe('GeodeServerProcess', () => {
    let tmp: string
    let fakeBin: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsp-'))
        const slug = `${process.platform}-${process.arch}`
        const dir = path.join(tmp, 'resources/bin', slug)
        fs.mkdirSync(dir, { recursive: true })
        const ext = process.platform === 'win32' ? '.exe' : ''
        fakeBin = path.join(dir, `geode-ui${ext}`)
        // A shell fake that prints LISTENING then sleeps. Cross-platform
        // tests need a script/PowerShell variant; for the first cut we
        // assume POSIX.
        fs.writeFileSync(
            fakeBin,
            '#!/bin/sh\necho "LISTENING addr=127.0.0.1:39999"\nsleep 5\n'
        )
        fs.chmodSync(fakeBin, 0o755)
    })

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true })
    })

    it('resolves start() once LISTENING line appears', async function () {
        if (process.platform === 'win32') return this.skip()
        const proc = new GeodeServerProcess({ extensionRoot: tmp })
        const info = await proc.start()
        assert.equal(info.host, '127.0.0.1')
        assert.equal(info.port, 39999)
        proc.stop()
    })

    it('rejects start() when binary exits before LISTENING', async function () {
        if (process.platform === 'win32') return this.skip()
        fs.writeFileSync(fakeBin, '#!/bin/sh\nexit 1\n')
        fs.chmodSync(fakeBin, 0o755)
        const proc = new GeodeServerProcess({ extensionRoot: tmp })
        await assert.rejects(proc.start(), /exited before listening/)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile && npx mocha out/test/server/GeodeServerProcess.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the process wrapper**

Create `src/server/GeodeServerProcess.ts`:

```typescript
import * as cp from 'child_process'
import * as readline from 'readline'
import { BundledBinary, resolveBundledBinary } from './binaryPath'

export interface ServerInfo {
    host: string
    port: number
}

export interface ServerOpts {
    extensionRoot: string
    port?: number
    startupTimeoutMs?: number
    onLog?: (line: string) => void
}

// Spawns the bundled geode-ui Go server and waits for it to log a
// LISTENING line. Owners must call stop() on disposal.
export class GeodeServerProcess {
    private child?: cp.ChildProcess
    private info?: ServerInfo
    private exited = false

    constructor(private opts: ServerOpts) {}

    async start(): Promise<ServerInfo> {
        if (this.info) return this.info
        const bin = resolveBundledBinary(this.opts.extensionRoot, BundledBinary.GeodeUiServer)
        const args = [
            '--http-addr', `127.0.0.1:${this.opts.port ?? 0}`,
            '--lsp-enabled=false',
            '--issuer-mode=ephemeral',
            '--log-format=text',
        ]
        this.child = cp.spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
        this.child.on('exit', () => { this.exited = true })

        const stderrRl = readline.createInterface({ input: this.child.stderr! })
        if (this.opts.onLog) stderrRl.on('line', this.opts.onLog)

        const stdoutRl = readline.createInterface({ input: this.child.stdout! })
        const timeoutMs = this.opts.startupTimeoutMs ?? 10_000
        this.info = await new Promise<ServerInfo>((resolve, reject) => {
            const timer = setTimeout(() => {
                stdoutRl.close()
                reject(new Error(`server did not log LISTENING within ${timeoutMs} ms`))
            }, timeoutMs)
            const onExit = () => {
                clearTimeout(timer)
                stdoutRl.close()
                reject(new Error('server exited before listening'))
            }
            this.child!.once('exit', onExit)
            stdoutRl.on('line', (line) => {
                const m = /^LISTENING\s+addr=([^:\s]+):(\d+)/.exec(line)
                if (m) {
                    clearTimeout(timer)
                    this.child!.removeListener('exit', onExit)
                    resolve({ host: m[1], port: Number(m[2]) })
                }
            })
        })
        return this.info
    }

    stop(): void {
        if (this.child && !this.exited) {
            this.child.kill('SIGTERM')
        }
    }

    getInfo(): ServerInfo | undefined {
        return this.info
    }
}
```

- [ ] **Step 4: Run tests**

Expected: 2 passing tests on POSIX (Windows tests skip in this task; Windows readiness handling is wired in sub-plan 6).

- [ ] **Step 5: Commit**

```bash
git add src/server/ src/test/server/
git commit -m "feat(server): spawn geode-ui server and wait for LISTENING"
```

---

## Task 9: Bridge message protocol

**Files:**

- Create: `src/bridge/messages.ts`
- Test: `src/test/bridge/messages.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/bridge/messages.test.ts`:

```typescript
import { strict as assert } from 'assert'
import { encodeRequest, decodeMessage, BridgeRequest, BridgeResponse } from '../../bridge/messages'

describe('bridge messages', () => {
    it('encodeRequest produces a well-formed envelope', () => {
        const req: BridgeRequest = { id: 'r1', op: 'health.ping', payload: {} }
        const env = encodeRequest(req)
        assert.equal(env.kind, 'request')
        assert.equal(env.id, 'r1')
        assert.equal(env.op, 'health.ping')
    })

    it('decodeMessage round-trips a response envelope', () => {
        const original: BridgeResponse = {
            kind: 'response',
            id: 'r1',
            ok: true,
            result: { status: 'ok' },
        }
        const decoded = decodeMessage(JSON.parse(JSON.stringify(original)))
        assert.equal(decoded.kind, 'response')
        assert.equal(decoded.id, 'r1')
        assert.equal((decoded as BridgeResponse).ok, true)
    })

    it('decodeMessage rejects malformed input', () => {
        assert.throws(() => decodeMessage(null), /malformed/)
        assert.throws(() => decodeMessage({ kind: 'unknown' }), /malformed/)
        assert.throws(() => decodeMessage({ kind: 'request' }), /malformed/)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile && npx mocha out/test/bridge/messages.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the protocol**

Create `src/bridge/messages.ts`:

```typescript
// Bridge protocol — every message that crosses the webview boundary
// is one of these. The op field is namespaced ("scope.verb"). Adding
// a new op requires:
//   - adding a constant to BridgeOps
//   - registering a handler in src/bridge/host.ts
//   - documenting the request/response payload here

export interface BridgeRequest {
    kind?: 'request'
    id: string
    op: string
    payload: unknown
}

export interface BridgeResponse {
    kind: 'response'
    id: string
    ok: boolean
    result?: unknown
    error?: { code: string; message: string; details?: unknown }
}

export interface BridgeEvent {
    kind: 'event'
    op: string
    payload: unknown
}

export type BridgeMessage = BridgeRequest | BridgeResponse | BridgeEvent

export const BridgeOps = {
    Health: { Ping: 'health.ping' },
    Server: { Info: 'server.info' },
} as const

export function encodeRequest(req: BridgeRequest): BridgeRequest & { kind: 'request' } {
    return { ...req, kind: 'request' }
}

export function decodeMessage(raw: unknown): BridgeMessage {
    if (raw === null || typeof raw !== 'object') {
        throw new Error('malformed bridge message (not an object)')
    }
    const obj = raw as Record<string, unknown>
    if (obj.kind === 'request') {
        if (typeof obj.id !== 'string' || typeof obj.op !== 'string') {
            throw new Error('malformed request envelope')
        }
        return { kind: 'request', id: obj.id, op: obj.op, payload: obj.payload }
    }
    if (obj.kind === 'response') {
        if (typeof obj.id !== 'string' || typeof obj.ok !== 'boolean') {
            throw new Error('malformed response envelope')
        }
        return obj as unknown as BridgeResponse
    }
    if (obj.kind === 'event') {
        if (typeof obj.op !== 'string') {
            throw new Error('malformed event envelope')
        }
        return obj as unknown as BridgeEvent
    }
    throw new Error(`malformed bridge message (unknown kind: ${String(obj.kind)})`)
}
```

- [ ] **Step 4: Run tests**

Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/messages.ts src/test/bridge/messages.test.ts
git commit -m "feat(bridge): typed message protocol with envelope decoding"
```

---

## Task 10: Bridge host dispatcher

**Files:**

- Create: `src/bridge/host.ts`
- Test: `src/test/bridge/host.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/bridge/host.test.ts`:

```typescript
import { strict as assert } from 'assert'
import { BridgeHost } from '../../bridge/host'
import { BridgeRequest, BridgeResponse } from '../../bridge/messages'

describe('BridgeHost', () => {
    it('dispatches a registered handler and posts a response', async () => {
        const posted: any[] = []
        const host = new BridgeHost({ postMessage: (m) => { posted.push(m); return Promise.resolve(true) } })
        host.register('echo.upper', async (payload: { text: string }) => ({
            upper: payload.text.toUpperCase(),
        }))
        const req: BridgeRequest = { id: 'a1', op: 'echo.upper', payload: { text: 'hi' } }
        await host.handle(req)
        assert.equal(posted.length, 1)
        const res = posted[0] as BridgeResponse
        assert.equal(res.kind, 'response')
        assert.equal(res.id, 'a1')
        assert.equal(res.ok, true)
        assert.deepEqual(res.result, { upper: 'HI' })
    })

    it('returns ok=false with code=NOT_FOUND for unknown ops', async () => {
        const posted: any[] = []
        const host = new BridgeHost({ postMessage: (m) => { posted.push(m); return Promise.resolve(true) } })
        await host.handle({ id: 'b1', op: 'no.such.op', payload: {} })
        const res = posted[0] as BridgeResponse
        assert.equal(res.ok, false)
        assert.equal(res.error?.code, 'NOT_FOUND')
    })

    it('catches handler throws and returns code=HANDLER_ERROR', async () => {
        const posted: any[] = []
        const host = new BridgeHost({ postMessage: (m) => { posted.push(m); return Promise.resolve(true) } })
        host.register('boom', async () => { throw new Error('kaboom') })
        await host.handle({ id: 'c1', op: 'boom', payload: {} })
        const res = posted[0] as BridgeResponse
        assert.equal(res.ok, false)
        assert.equal(res.error?.code, 'HANDLER_ERROR')
        assert.match(res.error?.message ?? '', /kaboom/)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile && npx mocha out/test/bridge/host.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the dispatcher**

Create `src/bridge/host.ts`:

```typescript
import { BridgeRequest, BridgeResponse, BridgeMessage } from './messages'

export type BridgeHandler<P = unknown, R = unknown> = (
    payload: P
) => Promise<R> | R

export interface PostTarget {
    postMessage(msg: BridgeMessage): Thenable<boolean>
}

// Receives decoded request envelopes and posts response envelopes.
// Owners register one handler per op and pass every inbound message
// to handle(). The PostTarget is anything with a postMessage method —
// typically a vscode.Webview, but the contract is intentionally thin
// so the dispatcher is unit-testable without spinning up vscode.
export class BridgeHost {
    private handlers = new Map<string, BridgeHandler>()

    constructor(private target: PostTarget) {}

    register<P, R>(op: string, handler: BridgeHandler<P, R>): void {
        this.handlers.set(op, handler as BridgeHandler)
    }

    async handle(req: BridgeRequest): Promise<void> {
        const handler = this.handlers.get(req.op)
        if (!handler) {
            await this.respond(req.id, {
                ok: false,
                error: { code: 'NOT_FOUND', message: `no handler for op ${req.op}` },
            })
            return
        }
        try {
            const result = await handler(req.payload)
            await this.respond(req.id, { ok: true, result })
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            await this.respond(req.id, {
                ok: false,
                error: { code: 'HANDLER_ERROR', message },
            })
        }
    }

    private respond(id: string, body: Pick<BridgeResponse, 'ok' | 'result' | 'error'>): Thenable<boolean> {
        const msg: BridgeResponse = { kind: 'response', id, ...body }
        return this.target.postMessage(msg)
    }
}
```

- [ ] **Step 4: Run tests**

Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/host.ts src/test/bridge/host.test.ts
git commit -m "feat(bridge): BridgeHost dispatcher + error envelope"
```

---

## Task 11: HTML assembly + adapter injection

**Files:**

- Create: `src/webview/html.ts`
- Create: `src/webview/adapter.template.js`
- Test: `src/test/webview/html.test.ts`

The adapter is a tiny script injected **before** the SPA boots; it polyfills `window.geode` and `window.fetch` so the SPA thinks it is running inside Electron. Every `fetch()` call the SPA makes is intercepted and rewritten as a bridge `http.request` message. The host translates that into a real localhost call against the geode-ui server.

The HTML loader rewrites the `<script src="...">` and `<link href="...">` paths from the SPA's `index.html` (webpack content-hashed relative paths) to webview URIs.

- [ ] **Step 1: Write the failing test**

Create `src/test/webview/html.test.ts`:

```typescript
import { strict as assert } from 'assert'
import { buildWebviewHtml } from '../../webview/html'

describe('buildWebviewHtml', () => {
    const baseInputs = {
        cspSource: 'vscode-webview://abc',
        nonce: 'NONCE123',
        adapterScript: '/* adapter */',
        spaIndexHtml: `<!doctype html><html><head><link href="main.css" rel="stylesheet"><script defer src="main.abc.js"></script></head><body><div id="root"></div></body></html>`,
        resolveAsset: (rel: string) => `https://webview/${rel}`,
        route: '/dashboard',
        themeKind: 'dark' as const,
        serverInfo: { host: '127.0.0.1', port: 12345, token: 'jwt-xxx' },
    }

    it('embeds the adapter as the first executable script', () => {
        const html = buildWebviewHtml(baseInputs)
        const adapterIdx = html.indexOf('/* adapter */')
        const spaIdx = html.indexOf('main.abc.js')
        assert.ok(adapterIdx > 0, 'adapter present')
        assert.ok(adapterIdx < spaIdx, 'adapter before SPA bundle')
    })

    it('rewrites relative asset URLs through resolveAsset', () => {
        const html = buildWebviewHtml(baseInputs)
        assert.match(html, /href="https:\/\/webview\/main\.css"/)
        assert.match(html, /src="https:\/\/webview\/main\.abc\.js"/)
    })

    it('sets a strict CSP that allows only nonce-tagged scripts', () => {
        const html = buildWebviewHtml(baseInputs)
        assert.match(html, /Content-Security-Policy/)
        assert.match(html, /'nonce-NONCE123'/)
        assert.match(html, /default-src 'none'/)
    })

    it('serializes serverInfo into a JSON island', () => {
        const html = buildWebviewHtml(baseInputs)
        assert.match(html, /id="geode-bootstrap"/)
        assert.match(html, /"port":12345/)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile && npx mocha out/test/webview/html.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the HTML assembler**

Create `src/webview/html.ts`:

```typescript
export interface ServerBootstrap {
    host: string
    port: number
    token: string
}

export interface WebviewHtmlInputs {
    cspSource: string
    nonce: string
    adapterScript: string
    spaIndexHtml: string
    resolveAsset: (relativePath: string) => string
    route: string
    themeKind: 'light' | 'dark' | 'high-contrast' | 'high-contrast-light'
    serverInfo: ServerBootstrap
}

// Builds the HTML payload that goes into a VSCode webview, given the
// SPA's index.html as the template. The template has been built by
// webpack with hashed asset URLs (relative paths). We rewrite each
// asset href/src to a webview-safe URI via resolveAsset, prepend our
// adapter <script>, and embed a strict CSP.
export function buildWebviewHtml(inputs: WebviewHtmlInputs): string {
    const { cspSource, nonce, adapterScript, spaIndexHtml, resolveAsset, route, themeKind, serverInfo } = inputs

    // Rewrite relative asset URLs in the SPA template. The SPA bundle
    // emits link/script tags with relative hashed paths (e.g.
    // `main.abc.js`). We translate each to a webview URI. This is
    // intentionally a string-replace pass instead of an HTML parser
    // dependency — the SPA's output is webpack-generated and stable.
    const ASSET_RE = /(href|src)="([^"]+\.(?:js|css|woff2?|ttf|svg|png|map))"/g
    const rewritten = spaIndexHtml.replace(ASSET_RE, (_m, attr, rel) => {
        if (/^https?:|^\/\//.test(rel)) return `${attr}="${rel}"`
        return `${attr}="${resolveAsset(rel)}"`
    })

    const themeClass = `vscode-${themeKind}`
    const bootstrapJson = JSON.stringify({ serverInfo, route })

    // Insert the adapter <script> + bootstrap JSON island into <head>.
    // The CSP allows only nonce-tagged scripts. The SPA's own
    // <script> tags do not carry a nonce yet; we add one to every
    // rewritten src= tag below by post-processing.
    const headInjection =
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
        `script-src 'nonce-${nonce}' ${cspSource}; ` +
        `style-src ${cspSource} 'unsafe-inline'; ` +
        `connect-src ${cspSource}; ` +
        `img-src ${cspSource} https: data:; ` +
        `font-src ${cspSource} data:;">` +
        `<script type="application/json" id="geode-bootstrap">${escapeJsonForHtml(bootstrapJson)}</script>` +
        `<script nonce="${nonce}">${adapterScript}</script>`

    const withCsp = rewritten.replace(/<head>/i, `<head>${headInjection}`)
    const withTheme = withCsp.replace(/<html\b/i, `<html class="${themeClass}"`)
    // Tag the SPA scripts with our nonce so the CSP accepts them.
    return withTheme.replace(
        /<script\b([^>]*\bsrc="[^"]+")/g,
        `<script nonce="${nonce}"$1`
    )
}

function escapeJsonForHtml(s: string): string {
    return s.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}
```

- [ ] **Step 4: Run tests**

Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/webview/html.ts src/test/webview/html.test.ts
git commit -m "feat(webview): HTML assembler with CSP and adapter injection"
```

---

## Task 12: Webview adapter (browser-side polyfill)

**Files:**

- Create: `src/webview/adapter.template.js`
- Modify: `src/webview/html.ts` (load the adapter from disk)
- Test: `src/test/webview/adapter.test.ts`

This file is concatenated verbatim into the webview HTML before the SPA boots. It runs in the webview, **not** the extension host — so it cannot use VSCode APIs except `acquireVsCodeApi()`.

- [ ] **Step 1: Write the failing test**

Create `src/test/webview/adapter.test.ts`:

```typescript
import { strict as assert } from 'assert'
import * as fs from 'fs'
import * as path from 'path'

describe('adapter.template.js', () => {
    const adapterSrc = fs.readFileSync(
        path.join(__dirname, '../../webview/adapter.template.js'),
        'utf8'
    )

    it('reads bootstrap JSON from geode-bootstrap element', () => {
        assert.match(adapterSrc, /geode-bootstrap/)
    })

    it('sets window.geode with serverUrl from bootstrap', () => {
        assert.match(adapterSrc, /window\.geode/)
        assert.match(adapterSrc, /serverUrl/)
    })

    it('replaces window.fetch with a bridge-forwarder', () => {
        assert.match(adapterSrc, /window\.fetch\s*=/)
    })

    it('uses acquireVsCodeApi for postMessage', () => {
        assert.match(adapterSrc, /acquireVsCodeApi/)
    })

    it('does not import any module (must be inline-evaluable)', () => {
        assert.doesNotMatch(adapterSrc, /^import\s/m)
        assert.doesNotMatch(adapterSrc, /^export\s/m)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile && npx mocha out/test/webview/adapter.test.js`
Expected: FAIL — file not found.

- [ ] **Step 3: Write the adapter**

Create `src/webview/adapter.template.js`:

```javascript
// Adapter — runs in the webview before the SPA bundle. Polyfills
// window.geode and intercepts window.fetch so SPA-side HTTP calls
// are forwarded to the extension host via a vscode message bridge.
//
// This file MUST NOT use ES module syntax (import/export). It is
// concatenated into a <script nonce=...> tag and evaluated inline.
(function () {
    'use strict'

    var vscode = acquireVsCodeApi()
    var bootstrapEl = document.getElementById('geode-bootstrap')
    var bootstrap = JSON.parse(bootstrapEl.textContent || '{}')

    // Promise registry for in-flight bridge requests.
    var pending = Object.create(null)
    var nextId = 1

    function postRequest(op, payload) {
        return new Promise(function (resolve, reject) {
            var id = 'w' + nextId++
            pending[id] = { resolve: resolve, reject: reject }
            vscode.postMessage({ kind: 'request', id: id, op: op, payload: payload })
        })
    }

    window.addEventListener('message', function (event) {
        var msg = event.data
        if (!msg || msg.kind !== 'response') return
        var entry = pending[msg.id]
        if (!entry) return
        delete pending[msg.id]
        if (msg.ok) {
            entry.resolve(msg.result)
        } else {
            var err = new Error((msg.error && msg.error.message) || 'bridge error')
            err.code = msg.error && msg.error.code
            entry.reject(err)
        }
    })

    // SPA reads window.geode.serverUrl in src/api/client.ts:resolveBaseUrl.
    // We give it a URL string the SPA can treat as same-origin; the actual
    // fetch is intercepted below and forwarded over the bridge.
    var info = bootstrap.serverInfo || {}
    window.geode = {
        isVscode: true,
        isElectron: false,
        serverUrl: 'http://' + info.host + ':' + info.port,
        token: info.token || null,
        // SPA-facing IPC stubs. Each returns a Promise that resolves
        // through the bridge. The sub-plans that need each operation
        // wire the host-side handler.
        getStoredConnections: function () { return postRequest('connections.list', {}) },
        storeConnections: function (list) { return postRequest('connections.replaceAll', { list: list }) },
        getStoredPassword: function (name, user) { return postRequest('connections.getPassword', { name: name, user: user }) },
        storeSavedPassword: function (name, user, pw) { return postRequest('connections.setPassword', { name: name, user: user, password: pw }) },
        clearStoredPassword: function (name, user) { return postRequest('connections.clearPassword', { name: name, user: user }) },
        pickPemFile: function () { return postRequest('connections.pickPemFile', {}) },
        openUnlockWindow: function () { return Promise.resolve(null) },
        getSavedPasswordBiometricPref: function () { return Promise.resolve(false) },
        setSavedPasswordBiometricPref: function () { return Promise.resolve(false) },
    }

    // Intercept fetch. All SPA-side HTTP calls are translated into
    // bridge requests so the host attaches the bearer token from
    // SecretStorage and rewrites baseUrl onto localhost.
    var nativeFetch = window.fetch
    window.fetch = function (input, init) {
        try {
            var url = typeof input === 'string' ? input : input && input.url
            if (typeof url === 'string' && url.startsWith(window.geode.serverUrl)) {
                return postRequest('http.request', {
                    url: url,
                    method: (init && init.method) || 'GET',
                    headers: serializeHeaders(init && init.headers),
                    body: serializeBody(init && init.body),
                }).then(function (resp) {
                    return new Response(resp.body, {
                        status: resp.status,
                        statusText: resp.statusText,
                        headers: resp.headers,
                    })
                })
            }
        } catch (e) { /* fall through to native */ }
        return nativeFetch.call(this, input, init)
    }

    function serializeHeaders(h) {
        if (!h) return {}
        if (h instanceof Headers) {
            var out = {}
            h.forEach(function (v, k) { out[k] = v })
            return out
        }
        return h
    }

    function serializeBody(b) {
        if (!b) return null
        if (typeof b === 'string') return { kind: 'text', value: b }
        return { kind: 'text', value: String(b) }
    }
})()
```

- [ ] **Step 4: Load the adapter from disk in html.ts**

Add to `src/webview/html.ts`:

```typescript
import * as fs from 'fs'
import * as path from 'path'

export function loadAdapterScript(extensionRoot: string): string {
    return fs.readFileSync(
        path.join(extensionRoot, 'out', 'webview', 'adapter.template.js'),
        'utf8'
    )
}
```

Note: `tsc` does not copy `.js` files — add a `prebuild:webview` step:

Edit `package.json` `scripts`:

```json
"prebuild:webview": "mkdir -p out/webview && cp src/webview/adapter.template.js out/webview/",
"compile": "npm run prebuild:webview && tsc -p ./",
```

- [ ] **Step 5: Run tests**

Expected: all 5 adapter tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/webview/adapter.template.js src/webview/html.ts src/test/webview/adapter.test.ts package.json
git commit -m "feat(webview): browser-side adapter polyfills window.geode + fetch"
```

---

## Task 13: ReactWebviewPanel base class

**Files:**

- Create: `src/webview/ReactWebviewPanel.ts`
- Test: `src/test/webview/ReactWebviewPanel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/webview/ReactWebviewPanel.test.ts`:

```typescript
import { strict as assert } from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { computePanelHtml } from '../../webview/ReactWebviewPanel'

describe('computePanelHtml', () => {
    let tmp: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rwp-'))
        const webviewDir = path.join(tmp, 'resources/webview')
        fs.mkdirSync(webviewDir, { recursive: true })
        fs.writeFileSync(
            path.join(webviewDir, 'index.html'),
            `<!doctype html><html><head></head><body><div id="root"></div></body></html>`
        )
        fs.mkdirSync(path.join(tmp, 'out/webview'), { recursive: true })
        fs.writeFileSync(
            path.join(tmp, 'out/webview/adapter.template.js'),
            '/* adapter */'
        )
    })

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true })
    })

    it('returns HTML containing the adapter and bootstrap JSON', () => {
        const html = computePanelHtml({
            extensionRoot: tmp,
            cspSource: 'vscode-webview://x',
            nonce: 'N',
            route: '/dashboard',
            themeKind: 'dark',
            serverInfo: { host: '127.0.0.1', port: 4242, token: 't' },
            resolveAsset: (rel) => `vscode-resource://${rel}`,
        })
        assert.match(html, /adapter/)
        assert.match(html, /"port":4242/)
        assert.match(html, /"route":"\/dashboard"/)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile && npx mocha out/test/webview/ReactWebviewPanel.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the panel class**

Create `src/webview/ReactWebviewPanel.ts`:

```typescript
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { buildWebviewHtml, loadAdapterScript, ServerBootstrap, WebviewHtmlInputs } from './html'
import { BridgeHost } from '../bridge/host'
import { decodeMessage, BridgeRequest } from '../bridge/messages'
import { getNonce } from '../utils/security'

export interface PanelOpts {
    extensionRoot: string
    route: string
    title: string
    viewColumn?: vscode.ViewColumn
    serverInfo: ServerBootstrap
    register: (host: BridgeHost) => void
}

// Pure helper extracted so it is unit-testable without a real vscode
// Webview. Production code calls openReactWebviewPanel, which invokes
// this and hands the result to webview.html.
export function computePanelHtml(inputs: Omit<WebviewHtmlInputs, 'spaIndexHtml' | 'adapterScript'> & {
    extensionRoot: string
}): string {
    const spaIndex = fs.readFileSync(
        path.join(inputs.extensionRoot, 'resources/webview/index.html'),
        'utf8'
    )
    const adapter = loadAdapterScript(inputs.extensionRoot)
    return buildWebviewHtml({
        ...inputs,
        spaIndexHtml: spaIndex,
        adapterScript: adapter,
    })
}

function themeKindString(k: vscode.ColorThemeKind): 'light' | 'dark' | 'high-contrast' | 'high-contrast-light' {
    switch (k) {
        case vscode.ColorThemeKind.Dark: return 'dark'
        case vscode.ColorThemeKind.HighContrast: return 'high-contrast'
        case vscode.ColorThemeKind.HighContrastLight: return 'high-contrast-light'
        default: return 'light'
    }
}

export interface OpenedPanel {
    panel: vscode.WebviewPanel
    host: BridgeHost
    dispose: () => void
}

export function openReactWebviewPanel(opts: PanelOpts): OpenedPanel {
    const panel = vscode.window.createWebviewPanel(
        'geode.react',
        opts.title,
        opts.viewColumn ?? vscode.ViewColumn.Two,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(vscode.Uri.file(opts.extensionRoot), 'resources', 'webview'),
                vscode.Uri.joinPath(vscode.Uri.file(opts.extensionRoot), 'out', 'webview'),
            ],
        }
    )

    const host = new BridgeHost(panel.webview)
    opts.register(host)

    const refresh = () => {
        const nonce = getNonce()
        const resolveAsset = (rel: string) => {
            const uri = vscode.Uri.joinPath(
                vscode.Uri.file(opts.extensionRoot),
                'resources/webview',
                rel
            )
            return panel.webview.asWebviewUri(uri).toString()
        }
        panel.webview.html = computePanelHtml({
            extensionRoot: opts.extensionRoot,
            cspSource: panel.webview.cspSource,
            nonce,
            route: opts.route,
            themeKind: themeKindString(vscode.window.activeColorTheme.kind),
            serverInfo: opts.serverInfo,
            resolveAsset,
        })
    }
    refresh()

    const disposables: vscode.Disposable[] = []
    disposables.push(panel.webview.onDidReceiveMessage((raw) => {
        try {
            const msg = decodeMessage(raw)
            if (msg.kind === 'request') {
                void host.handle(msg as BridgeRequest)
            }
        } catch (err) {
            console.warn('[geode] malformed webview message:', err)
        }
    }))
    disposables.push(vscode.window.onDidChangeActiveColorTheme(refresh))
    disposables.push(panel.onDidDispose(() => {
        for (const d of disposables) d.dispose()
    }))

    return {
        panel,
        host,
        dispose: () => panel.dispose(),
    }
}
```

- [ ] **Step 4: Run tests**

Expected: ReactWebviewPanel test passes (1 test); existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/webview/ReactWebviewPanel.ts src/test/webview/
git commit -m "feat(webview): ReactWebviewPanel base class"
```

---

## Task 14: HTTP forwarding handler

**Files:**

- Create: `src/bridge/handlers/httpForward.ts`
- Test: `src/test/bridge/httpForward.test.ts`

The `http.request` op forwards a webview-issued HTTP call to localhost. The host attaches the JWT it received from the geode-ui server at boot. This is the **single seam** the SPA uses to talk to its backend.

- [ ] **Step 1: Write the failing test**

Create `src/test/bridge/httpForward.test.ts`:

```typescript
import { strict as assert } from 'assert'
import * as http from 'http'
import { createHttpForwardHandler } from '../../bridge/handlers/httpForward'

describe('createHttpForwardHandler', () => {
    let server: http.Server
    let port: number

    beforeEach(async () => {
        server = http.createServer((req, res) => {
            let body = ''
            req.on('data', (c) => (body += c))
            req.on('end', () => {
                res.writeHead(200, { 'content-type': 'application/json' })
                res.end(JSON.stringify({
                    received: { method: req.method, url: req.url, auth: req.headers.authorization, body },
                }))
            })
        })
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
        port = (server.address() as any).port
    })

    afterEach(() => server.close())

    it('forwards a GET with the host-supplied bearer token', async () => {
        const handler = createHttpForwardHandler({
            serverInfo: { host: '127.0.0.1', port, token: 't0p_s3cr3t' },
        })
        const result = await handler({
            url: `http://127.0.0.1:${port}/api/v1/whoami`,
            method: 'GET',
            headers: {},
            body: null,
        })
        assert.equal(result.status, 200)
        const decoded = JSON.parse(result.body as string)
        assert.equal(decoded.received.method, 'GET')
        assert.equal(decoded.received.auth, 'Bearer t0p_s3cr3t')
    })

    it('rejects URLs outside the bundled server origin', async () => {
        const handler = createHttpForwardHandler({
            serverInfo: { host: '127.0.0.1', port, token: 'x' },
        })
        await assert.rejects(
            handler({ url: 'https://evil.example/x', method: 'GET', headers: {}, body: null }),
            /url not on bundled server/
        )
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile && npx mocha out/test/bridge/httpForward.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

Create `src/bridge/handlers/httpForward.ts`:

```typescript
import * as http from 'http'
import { ServerBootstrap } from '../../webview/html'

export interface HttpRequestPayload {
    url: string
    method: string
    headers: Record<string, string>
    body: { kind: 'text'; value: string } | null
}

export interface HttpResponsePayload {
    status: number
    statusText: string
    headers: Record<string, string>
    body: string
}

export function createHttpForwardHandler(opts: { serverInfo: ServerBootstrap }) {
    const origin = `http://${opts.serverInfo.host}:${opts.serverInfo.port}`
    return async function (payload: HttpRequestPayload): Promise<HttpResponsePayload> {
        if (!payload.url.startsWith(origin)) {
            throw new Error(`url not on bundled server origin: ${payload.url}`)
        }
        const u = new URL(payload.url)
        const headers: Record<string, string> = { ...payload.headers }
        if (opts.serverInfo.token) {
            headers['authorization'] = `Bearer ${opts.serverInfo.token}`
        }
        return await new Promise((resolve, reject) => {
            const req = http.request(
                {
                    method: payload.method,
                    host: u.hostname,
                    port: Number(u.port),
                    path: u.pathname + u.search,
                    headers,
                },
                (res) => {
                    const chunks: Buffer[] = []
                    res.on('data', (c) => chunks.push(c))
                    res.on('end', () => {
                        const body = Buffer.concat(chunks).toString('utf8')
                        const outHeaders: Record<string, string> = {}
                        for (const [k, v] of Object.entries(res.headers)) {
                            if (typeof v === 'string') outHeaders[k] = v
                            else if (Array.isArray(v)) outHeaders[k] = v.join(', ')
                        }
                        resolve({
                            status: res.statusCode ?? 0,
                            statusText: res.statusMessage ?? '',
                            headers: outHeaders,
                            body,
                        })
                    })
                }
            )
            req.on('error', reject)
            if (payload.body && payload.body.kind === 'text') req.write(payload.body.value)
            req.end()
        })
    }
}
```

- [ ] **Step 4: Run tests**

Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/handlers/httpForward.ts src/test/bridge/httpForward.test.ts
git commit -m "feat(bridge): http.request handler forwards to bundled server"
```

---

## Task 15: Health-ping handler + wiring

**Files:**

- Create: `src/bridge/handlers/health.ts`
- Test: `src/test/bridge/health.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/bridge/health.test.ts`:

```typescript
import { strict as assert } from 'assert'
import { healthPingHandler } from '../../bridge/handlers/health'

describe('healthPingHandler', () => {
    it('returns server info and timestamp', async () => {
        const result = await healthPingHandler({ serverInfo: { host: '127.0.0.1', port: 1234, token: 't' } })({})
        assert.equal(result.host, '127.0.0.1')
        assert.equal(result.port, 1234)
        assert.equal(typeof result.timestamp, 'number')
        assert.ok(Math.abs(Date.now() - result.timestamp) < 1000)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile && npx mocha out/test/bridge/health.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

Create `src/bridge/handlers/health.ts`:

```typescript
import { ServerBootstrap } from '../../webview/html'

export function healthPingHandler(deps: { serverInfo: ServerBootstrap }) {
    return async function (_payload: unknown) {
        return {
            host: deps.serverInfo.host,
            port: deps.serverInfo.port,
            timestamp: Date.now(),
        }
    }
}
```

- [ ] **Step 4: Run tests**

Expected: 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/handlers/health.ts src/test/bridge/health.test.ts
git commit -m "feat(bridge): health.ping handler"
```

---

## Task 16: Activation wiring + showSpaShell command

**Files:**

- Modify: `src/extension.ts:1-end` (add new imports and activation hooks)
- Modify: `package.json` (add `geode.showSpaShell` command + contribution)

- [ ] **Step 1: Add the command to package.json**

In `package.json` `contributes.commands`, append:

```json
{
    "command": "geode.showSpaShell",
    "title": "Show Geode UI (SPA Shell)",
    "category": "Geode",
    "icon": "$(window)"
}
```

- [ ] **Step 2: Wire the server lifecycle into activation**

Edit `src/extension.ts` — add imports near the top:

```typescript
import { GeodeServerProcess } from './server/GeodeServerProcess'
import { openReactWebviewPanel } from './webview/ReactWebviewPanel'
import { createHttpForwardHandler } from './bridge/handlers/httpForward'
import { healthPingHandler } from './bridge/handlers/health'
```

Add module-scoped lifecycle vars next to the existing ones:

```typescript
let serverProcess: GeodeServerProcess | undefined
let serverInfo: { host: string; port: number; token: string } | undefined

async function ensureServerStarted(context: vscode.ExtensionContext): Promise<{ host: string; port: number; token: string }> {
    if (serverInfo) return serverInfo
    serverProcess = new GeodeServerProcess({
        extensionRoot: context.extensionUri.fsPath,
        onLog: (line) => outputChannel.appendLine(`[geode-ui] ${line}`),
    })
    const info = await serverProcess.start()
    serverInfo = { host: info.host, port: info.port, token: '' }
    return serverInfo
}
```

Inside `activate`, after the existing initializations, register the command:

```typescript
context.subscriptions.push(
    vscode.commands.registerCommand('geode.showSpaShell', async () => {
        const info = await ensureServerStarted(context)
        openReactWebviewPanel({
            extensionRoot: context.extensionUri.fsPath,
            route: '/dashboard',
            title: 'Geode',
            serverInfo: info,
            register: (host) => {
                host.register('http.request', createHttpForwardHandler({ serverInfo: info }))
                host.register('health.ping', healthPingHandler({ serverInfo: info }))
            },
        })
    })
)
```

Update `deactivate`:

```typescript
export function deactivate(): Thenable<void> | undefined {
    serverProcess?.stop()
    if (!client) return undefined
    return client.stop()
}
```

- [ ] **Step 3: Compile**

Run: `npm run compile`
Expected: no errors. If there are unused imports, remove them.

- [ ] **Step 4: Manual smoke check (cannot be a unit test)**

```bash
npm run prepackage     # populates resources/{webview,bin}
# Press F5 in VSCode to launch the extension development host
# In the dev host: run command "Geode: Show Geode UI (SPA Shell)"
# Expected: a webview opens, the dashboard renders, the output channel
# shows "[geode-ui] LISTENING addr=..."
```

If the SPA fails to load with a CSP violation, copy the violation message from the DevTools console (Help > Toggle Developer Tools) into the next commit message.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: wire geode-ui SPA shell into showSpaShell command"
```

---

## Task 17: E2E smoke test

**Files:**

- Create: `e2e/runTest.ts`
- Create: `e2e/suite/index.ts`
- Create: `e2e/suite/smoke.test.ts`
- Create: `e2e/tsconfig.json`
- Modify: root `package.json` (add `test:e2e` script)

- [ ] **Step 1: Add @vscode/test-electron**

```bash
npm install --save-dev @vscode/test-electron @types/mocha
```

- [ ] **Step 2: Create e2e harness**

Create `e2e/runTest.ts`:

```typescript
import * as path from 'path'
import { runTests } from '@vscode/test-electron'

async function main(): Promise<void> {
    const extensionDevelopmentPath = path.resolve(__dirname, '..')
    const extensionTestsPath = path.resolve(__dirname, 'suite/index')
    try {
        await runTests({ extensionDevelopmentPath, extensionTestsPath })
    } catch (err) {
        console.error('e2e failed:', err)
        process.exit(1)
    }
}

main()
```

Create `e2e/suite/index.ts`:

```typescript
import * as path from 'path'
import Mocha from 'mocha'
import { glob } from 'glob'

export async function run(): Promise<void> {
    const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 60_000 })
    const testsRoot = path.resolve(__dirname)
    const files = await glob('**/*.test.js', { cwd: testsRoot })
    for (const f of files) mocha.addFile(path.resolve(testsRoot, f))
    await new Promise<void>((resolve, reject) => {
        mocha.run((failures) => {
            failures ? reject(new Error(`${failures} test(s) failed`)) : resolve()
        })
    })
}
```

Create `e2e/suite/smoke.test.ts`:

```typescript
import { strict as assert } from 'assert'
import * as vscode from 'vscode'

describe('smoke', () => {
    it('activates the extension', async () => {
        const ext = vscode.extensions.getExtension('codeprosorg.geode-vscode')
        assert.ok(ext, 'extension installed')
        await ext.activate()
        assert.equal(ext.isActive, true)
    })

    it('exposes geode.showSpaShell command', async () => {
        const all = await vscode.commands.getCommands(true)
        assert.ok(all.includes('geode.showSpaShell'))
    })

    it('opening the SPA shell does not throw', async () => {
        await vscode.commands.executeCommand('geode.showSpaShell')
        // Give the server time to spawn + webview to load.
        await new Promise((r) => setTimeout(r, 5_000))
    })
})
```

Create `e2e/tsconfig.json`:

```json
{
    "extends": "../tsconfig.json",
    "compilerOptions": {
        "outDir": "../out/e2e",
        "rootDir": "."
    },
    "include": ["**/*.ts"]
}
```

- [ ] **Step 3: Wire scripts**

Edit root `package.json` `scripts`:

```json
"compile:e2e": "tsc -p e2e/",
"test:e2e": "npm run prepackage && npm run compile:e2e && node out/e2e/runTest.js"
```

- [ ] **Step 4: Run e2e**

Run: `npm run test:e2e`
Expected: 3 passing tests. (Requires `xvfb-run` on Linux CI; locally, runs against a real VSCode instance downloaded by test-electron.)

- [ ] **Step 5: Commit**

```bash
git add e2e/ package.json package-lock.json
git commit -m "test(e2e): smoke test for activation and SPA shell command"
```

---

## Task 18: License + NOTICE shipping

**Files:**

- Create: `scripts/collect-bundled-licenses.mjs`
- Modify: `package.json` (`prepackage` runs the collector)

The geode-ui server binary and the geode binary are Apache-2.0 licensed; their NOTICE files must ship next to the binaries in the VSIX.

- [ ] **Step 1: Implement the collector**

Create `scripts/collect-bundled-licenses.mjs`:

```javascript
#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

async function main() {
    const sources = [
        { repo: '../geode-ui', name: 'geode-ui' },
        { repo: '../geode', name: 'geode' },
    ]
    const lines = []
    for (const s of sources) {
        const license = await readOptional(path.join(root, s.repo, 'LICENSE'))
        const notice = await readOptional(path.join(root, s.repo, 'NOTICE'))
        if (license || notice) {
            lines.push(`# ${s.name}`)
            if (notice) lines.push(notice.trim(), '')
            if (license) lines.push(license.trim(), '')
        }
    }
    if (lines.length === 0) {
        console.error('no bundled licenses found; aborting')
        process.exit(1)
    }
    const out = path.join(root, 'resources/THIRD_PARTY_LICENSES.txt')
    await fs.writeFile(out, lines.join('\n'))
    console.log(`wrote ${out}`)
}

async function readOptional(p) {
    try { return await fs.readFile(p, 'utf8') } catch { return null }
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Wire it into prepackage**

Edit `package.json`:

```json
"prepackage": "npm run fetch:ui:local && npm run fetch:bin:local && node scripts/collect-bundled-licenses.mjs && npm run compile"
```

- [ ] **Step 3: Verify**

```bash
npm run prepackage
test -s resources/THIRD_PARTY_LICENSES.txt && echo OK
```

- [ ] **Step 4: Commit**

```bash
git add scripts/collect-bundled-licenses.mjs package.json
git commit -m "build: collect bundled binary licenses into VSIX"
```

---

## Task 19: README + CHANGELOG

**Files:**

- Modify: `README.md` (new "Bundled Components" section)
- Modify: `CHANGELOG.md` (release note for foundation work)

- [ ] **Step 1: Add CHANGELOG entry**

Prepend a new section under "## [Unreleased]":

```markdown
### Added
- Foundation for embedded geode-ui management UI: extension now bundles the
  geode-ui SPA and the geode-ui Go server binary. A new `geode.showSpaShell`
  command opens the SPA inside a webview panel. (sub-plan 1)

### Changed
- Build now requires `npm run prepackage` before `vsce package`. The
  prepackage step copies SPA assets from `../geode-ui` (local mode) or
  downloads them from the GitLab registry (CI mode).
```

- [ ] **Step 2: Add README section**

Insert before the "Development" section:

```markdown
## Bundled Components

The VSIX bundles two binaries (per-platform variants under `resources/bin/<platform>/`):

- **geode-ui** — Go server that hosts the React management UI and proxies API requests.
- **geode** — Geode graph-DB binary (provides LSP and query execution; used by sub-plan 6 and later).

Licenses for both are collected into `resources/THIRD_PARTY_LICENSES.txt` at build time.

Build matrix (per platform): `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`. CI uses `vsce package --target <platform>` to produce one VSIX per platform.
```

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: foundation sub-plan changelog and bundled-components section"
```

---

## Task 20: Self-review

- [ ] **Step 1: Spec coverage**

Walk through the master plan's sub-plan-1 row and verify each clause is implemented:

- "Extension bundles geode-ui SPA + server binary." → Tasks 2-5
- "Opening any geode command boots the server" → Task 16 (`ensureServerStarted`)
- "Opens a WebviewPanel rendering the SPA shell on /dashboard" → Task 16 (`showSpaShell`)
- "Bridge routes the `health` ping end-to-end" → Tasks 9-10, 15-16 (`health.ping` handler registered in `showSpaShell`)
- "No production wiring yet — existing tree views still work" → confirmed: no edits to `connections/`, `views/`, `panels/` in this sub-plan.

If any clause is missing, add a follow-up task before commit.

- [ ] **Step 2: Run the full test suite**

```bash
npm run compile
npx mocha out/test/**/*.test.js
node --test scripts/__tests__/
npm run test:e2e
```

Expected: all green.

- [ ] **Step 3: Verify VSIX builds**

```bash
npx vsce package --skip-license
ls *.vsix
```

Expected: VSIX is produced. Size will be large (~80 MiB on a single-platform local build) — this is expected; per-platform sub-VSIXes from CI carry only one platform's binaries.

- [ ] **Step 4: Tag the merge candidate**

When the branch is ready to merge to main, the merge commit message MUST reference this plan:

```text
Subject: feat: foundation for geode-ui integration (sub-plan 1)

Implements docs/superpowers/plans/2026-05-25-geode-ui-integration-01-foundation.md
end-to-end. Next: sub-plan 2 (connections + profiles sidebar).
```
