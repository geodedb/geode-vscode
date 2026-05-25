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
