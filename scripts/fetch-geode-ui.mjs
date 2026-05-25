#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { downloadToFile } from './lib/download.mjs'
import { x as tarExtract } from 'tar'

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
  // Restore the sentinel file so the empty directory stays tracked by git
  // when resources/webview/** is gitignored except for .gitkeep.
  await fs.writeFile(path.join(target, '.gitkeep'), '')
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
  await tarExtract({ file: tmpDest, cwd: target, strip: 0 })
  await fs.unlink(tmpDest)
  // Restore the sentinel file so the empty directory stays tracked by git
  // when resources/webview/** is gitignored except for .gitkeep.
  await fs.writeFile(path.join(target, '.gitkeep'), '')
  return { target }
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
