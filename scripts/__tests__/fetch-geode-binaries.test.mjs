import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { platformDir, fetchBinaries } from '../fetch-geode-binaries.mjs'

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

test('local fetch copies geode-ui binary into platform dir', async () => {
  const tmp = await fs.mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'gv-'))
  const fakeUi = path.join(tmp, 'fake-geode-ui')
  await fs.mkdir(fakeUi, { recursive: true })
  await fs.writeFile(path.join(fakeUi, 'server'), 'FAKE_BINARY', { mode: 0o755 })
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
