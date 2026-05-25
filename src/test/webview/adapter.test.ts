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
