export interface ServerBootstrap {
    host: string
    port: number
    token: string
}

export interface WebviewHtmlInputs {
    cspSource: string
    nonce: string
    adapterScript: string
    spaIndexHtml: string
    resolveAsset: (relativePath: string) => string
    route: string
    themeKind: 'light' | 'dark' | 'high-contrast' | 'high-contrast-light'
    serverInfo: ServerBootstrap
}

// Builds the HTML payload that goes into a VSCode webview, given the
// SPA's index.html as the template. The template has been built by
// webpack with hashed asset URLs (relative paths). We rewrite each
// asset href/src to a webview-safe URI via resolveAsset, prepend our
// adapter <script>, and embed a strict CSP.
export function buildWebviewHtml(inputs: WebviewHtmlInputs): string {
    const { cspSource, nonce, adapterScript, spaIndexHtml, resolveAsset, route, themeKind, serverInfo } = inputs

    const ASSET_RE = /(href|src)="([^"]+\.(?:js|css|woff2?|ttf|svg|png|map))"/g
    const rewritten = spaIndexHtml.replace(ASSET_RE, (_m, attr, rel) => {
        if (/^https?:|^\/\//.test(rel)) return `${attr}="${rel}"`
        return `${attr}="${resolveAsset(rel)}"`
    })

    const themeClass = `vscode-${themeKind}`
    const bootstrapJson = JSON.stringify({ serverInfo, route })

    const headInjection =
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
        `script-src 'nonce-${nonce}' ${cspSource}; ` +
        `style-src ${cspSource} 'unsafe-inline'; ` +
        `connect-src ${cspSource}; ` +
        `img-src ${cspSource} https: data:; ` +
        `font-src ${cspSource} data:;">` +
        `<script type="application/json" id="geode-bootstrap">${escapeJsonForHtml(bootstrapJson)}</script>` +
        `<script nonce="${nonce}">${adapterScript}</script>`

    const withCsp = rewritten.replace(/<head>/i, `<head>${headInjection}`)
    const withTheme = withCsp.replace(/<html\b/i, `<html class="${themeClass}"`)
    return withTheme.replace(
        /<script\b([^>]*\bsrc="[^"]+")/g,
        `<script nonce="${nonce}"$1`
    )
}

function escapeJsonForHtml(s: string): string {
    return s.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

import * as fs from 'fs'
import * as path from 'path'

export function loadAdapterScript(extensionRoot: string): string {
    return fs.readFileSync(
        path.join(extensionRoot, 'out', 'webview', 'adapter.template.js'),
        'utf8'
    )
}
