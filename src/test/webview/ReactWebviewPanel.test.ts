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
