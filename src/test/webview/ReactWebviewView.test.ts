import { strict as assert } from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { computeViewHtml } from '../../webview/ReactWebviewView'

describe('computeViewHtml', () => {
    let tmp: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rwv-'))
        fs.mkdirSync(path.join(tmp, 'resources/webview'), { recursive: true })
        fs.writeFileSync(
            path.join(tmp, 'resources/webview/index.html'),
            '<!doctype html><html><head></head><body><div id="root"></div></body></html>'
        )
        fs.mkdirSync(path.join(tmp, 'out/webview'), { recursive: true })
        fs.writeFileSync(path.join(tmp, 'out/webview/adapter.template.js'), '/* a */')
    })

    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

    it('renders bootstrap with route /sidebar', () => {
        const html = computeViewHtml({
            extensionRoot: tmp,
            cspSource: 'vscode-webview://x',
            nonce: 'N',
            route: '/sidebar',
            themeKind: 'light',
            serverInfo: { host: '127.0.0.1', port: 1, token: 't' },
            resolveAsset: (rel: string) => `vscode-resource://${rel}`,
        })
        assert.match(html, /"route":"\/sidebar"/)
    })
})
