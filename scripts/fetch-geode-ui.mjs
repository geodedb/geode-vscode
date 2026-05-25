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
