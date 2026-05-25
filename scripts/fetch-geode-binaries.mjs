#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { downloadToFile } from './lib/download.mjs'

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

async function fetchLocal({ uiPath, geodePath, outRoot, onlyCurrentPlatform }) {
  const platforms = onlyCurrentPlatform
    ? [platformDir(process.platform, process.arch)]
    : [...SUPPORTED]

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
      uiVersion: { type: 'string' },
      geodeVersion: { type: 'string' },
      targetPlatform: { type: 'string' },
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
