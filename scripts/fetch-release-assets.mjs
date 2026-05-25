#!/usr/bin/env node
// Fetch geode-ui and geode binaries published by goreleaser to the GitLab
// Generic Package Registry, plus build the geode-ui SPA dist from a sibling
// checkout of the geode-ui repo at a pinned tag.
//
// Intended to be called by the per-platform `package:<slug>` matrix jobs in
// .gitlab-ci.yml. Each invocation populates `resources/bin/<slug>/` with the
// per-platform binaries and (on first invocation per pipeline) populates
// `resources/webview/` with the SPA dist.
//
// Required env or CLI flags:
//   --spaVersion=<vX.Y.Z>     geode-ui release tag
//   --geodeVersion=<vX.Y.Z>   geode (graph-DB) release tag
//   --targetPlatform=<slug>   linux-x64 | linux-arm64 | darwin-x64 |
//                             darwin-arm64
//   --geodeUiSrc=<path>       path to a sibling geode-ui clone. If absent
//                             the script clones into ./build/geode-ui.
//   --skipSpa                 skip the SPA build step (use when running
//                             multiple platform jobs in sequence)
//
// Downloads are SHA256-verified against the `checksums.txt` published in the
// same package.

import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import * as cp from 'node:child_process'
import { promisify } from 'node:util'
import { downloadToFile } from './lib/download.mjs'

const runArgv = promisify(cp.execFile)

const SUPPORTED_SLUGS = new Set([
    'linux-x64',
    'linux-arm64',
    'darwin-x64',
    'darwin-arm64',
])

const UI_BIN_TARBALL = {
    'linux-x64': (v) => `geode-ui_${v}_linux_amd64.tar.gz`,
    'linux-arm64': (v) => `geode-ui_${v}_linux_arm64.tar.gz`,
    'darwin-x64': (v) => `geode-ui_${v}_darwin_amd64.tar.gz`,
    'darwin-arm64': (v) => `geode-ui_${v}_darwin_arm64.tar.gz`,
}

const GEODE_BIN_TARBALL = {
    'linux-x64': (v) => `geode_${v}_x86_64-linux-gnu.tar.gz`,
    'linux-arm64': (v) => `geode_${v}_aarch64-linux-gnu.tar.gz`,
    'darwin-x64': (v) => `geode_${v}_darwin_universal.tar.gz`,
    'darwin-arm64': (v) => `geode_${v}_darwin_universal.tar.gz`,
}

const UI_PKG_ROOT = 'https://gitlab.com/api/v4/projects/devnw%2Fcodepros%2Fgeode%2Fgeode-ui/packages/generic/geode-ui'
const GEODE_PKG_ROOT = 'https://gitlab.com/api/v4/projects/devnw%2Fcodepros%2Fgeode%2Fgeode/packages/generic/geode'

function stripV(v) {
    return v.startsWith('v') ? v.slice(1) : v
}

async function fetchChecksums(pkgRoot, version) {
    const url = `${pkgRoot}/${stripV(version)}/checksums.txt`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`checksums fetch ${url} -> ${res.status}`)
    const text = await res.text()
    const out = new Map()
    for (const line of text.split('\n')) {
        const m = /^([0-9a-f]{64})\s+(\S+)/.exec(line.trim())
        if (m) out.set(m[2], m[1])
    }
    return out
}

async function downloadVerifyExtract(pkgRoot, version, tarballName, expectedSha, destBinaryPath, binaryNameInTarball) {
    const url = `${pkgRoot}/${stripV(version)}/${tarballName}`
    const tmpDir = await fs.mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'gv-rel-'))
    const tarDest = path.join(tmpDir, tarballName)
    const digest = await downloadToFile(url, tarDest)
    if (digest !== expectedSha) {
        await fs.rm(tmpDir, { recursive: true, force: true })
        throw new Error(`sha256 mismatch for ${tarballName}: got ${digest} expected ${expectedSha}`)
    }
    await runArgv('tar', ['-xzf', tarDest, '-C', tmpDir])
    let candidate = path.join(tmpDir, binaryNameInTarball)
    try {
        await fs.access(candidate)
    } catch {
        const entries = await fs.readdir(tmpDir, { withFileTypes: true })
        const subdir = entries.find((e) => e.isDirectory())
        if (!subdir) throw new Error(`extracted ${tarballName} has no ${binaryNameInTarball}`)
        candidate = path.join(tmpDir, subdir.name, binaryNameInTarball)
        await fs.access(candidate)
    }
    await fs.mkdir(path.dirname(destBinaryPath), { recursive: true })
    await fs.copyFile(candidate, destBinaryPath)
    await fs.chmod(destBinaryPath, 0o755)
    await fs.rm(tmpDir, { recursive: true, force: true })
}

async function buildSpaFromSource(spaVersion, outRoot, geodeUiSrc) {
    const root = geodeUiSrc ?? path.join(outRoot, 'build', 'geode-ui')
    if (!fsSync.existsSync(path.join(root, '.git'))) {
        await runArgv('git', [
            'clone',
            '--depth=1',
            '--branch', spaVersion,
            'https://gitlab.com/devnw/codepros/geode/geode-ui.git',
            root,
        ])
    }
    await runArgv('npm', ['ci'], { cwd: root, env: { ...process.env, EMBEDDED_BUILD: '1' } })
    await runArgv('npm', ['run', 'build'], { cwd: root, env: { ...process.env, EMBEDDED_BUILD: '1' } })
    const dist = path.join(root, 'internal', 'ui', 'dist')
    await fs.access(dist)
    const target = path.join(outRoot, 'resources/webview')
    await fs.rm(target, { recursive: true, force: true })
    await fs.mkdir(target, { recursive: true })
    await copyTree(dist, target)
    await fs.writeFile(path.join(target, '.gitkeep'), '')
    return target
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

async function main() {
    const { values } = parseArgs({
        options: {
            spaVersion: { type: 'string' },
            geodeVersion: { type: 'string' },
            targetPlatform: { type: 'string' },
            geodeUiSrc: { type: 'string' },
            skipSpa: { type: 'boolean', default: false },
        },
    })
    const { spaVersion, geodeVersion, targetPlatform, geodeUiSrc, skipSpa } = values
    if (!spaVersion) throw new Error('--spaVersion is required')
    if (!geodeVersion) throw new Error('--geodeVersion is required')
    if (!targetPlatform) throw new Error('--targetPlatform is required')
    if (!SUPPORTED_SLUGS.has(targetPlatform)) {
        throw new Error(`unsupported target platform: ${targetPlatform}`)
    }

    const outRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

    if (!skipSpa) {
        console.log(`Building SPA from geode-ui@${spaVersion}...`)
        const t = await buildSpaFromSource(spaVersion, outRoot, geodeUiSrc)
        console.log(`SPA built into ${t}`)
    }

    const uiChecksums = await fetchChecksums(UI_PKG_ROOT, spaVersion)
    const geodeChecksums = await fetchChecksums(GEODE_PKG_ROOT, geodeVersion)

    const uiTarball = UI_BIN_TARBALL[targetPlatform](stripV(spaVersion))
    const geodeTarball = GEODE_BIN_TARBALL[targetPlatform](stripV(geodeVersion))
    const uiSha = uiChecksums.get(uiTarball)
    const geodeSha = geodeChecksums.get(geodeTarball)
    if (!uiSha) throw new Error(`no checksum for ${uiTarball} in geode-ui@${spaVersion}`)
    if (!geodeSha) throw new Error(`no checksum for ${geodeTarball} in geode@${geodeVersion}`)

    const slugDir = path.join(outRoot, 'resources/bin', targetPlatform)
    console.log(`Fetching geode-ui binary for ${targetPlatform}...`)
    await downloadVerifyExtract(
        UI_PKG_ROOT,
        spaVersion,
        uiTarball,
        uiSha,
        path.join(slugDir, 'geode-ui'),
        'geode-ui',
    )
    console.log(`Fetching geode binary for ${targetPlatform}...`)
    await downloadVerifyExtract(
        GEODE_PKG_ROOT,
        geodeVersion,
        geodeTarball,
        geodeSha,
        path.join(slugDir, 'geode'),
        'geode',
    )
    await fs.writeFile(path.join(outRoot, 'resources/bin/.gitkeep'), '')
    console.log(`Populated ${slugDir}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e.message ?? e)
        process.exit(1)
    })
}

export { main, downloadVerifyExtract, buildSpaFromSource, fetchChecksums }
