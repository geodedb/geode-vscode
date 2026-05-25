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
