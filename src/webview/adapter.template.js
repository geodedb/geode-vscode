// Adapter -- runs in the webview before the SPA bundle. Polyfills
// window.geode and intercepts window.fetch so SPA-side HTTP calls
// are forwarded to the extension host via a vscode message bridge.
//
// This file MUST NOT use ES module syntax (import/export). It is
// concatenated into a <script nonce=...> tag and evaluated inline.
(function () {
    'use strict'

    var vscode = acquireVsCodeApi()
    var bootstrapEl = document.getElementById('geode-bootstrap')
    var bootstrap = JSON.parse(bootstrapEl.textContent || '{}')

    var pending = Object.create(null)
    var nextId = 1

    function postRequest(op, payload) {
        return new Promise(function (resolve, reject) {
            var id = 'w' + nextId++
            pending[id] = { resolve: resolve, reject: reject }
            vscode.postMessage({ kind: 'request', id: id, op: op, payload: payload })
        })
    }

    window.addEventListener('message', function (event) {
        var msg = event.data
        if (!msg) return
        if (msg.kind === 'response') {
            var entry = pending[msg.id]
            if (!entry) return
            delete pending[msg.id]
            if (msg.ok) {
                entry.resolve(msg.result)
            } else {
                var err = new Error((msg.error && msg.error.message) || 'bridge error')
                err.code = msg.error && msg.error.code
                entry.reject(err)
            }
        }
    })

    var info = bootstrap.serverInfo || {}
    window.geode = {
        isVscode: true,
        isElectron: false,
        serverUrl: 'http://' + info.host + ':' + info.port,
        token: info.token || null,
        getStoredConnections: function () { return postRequest('connections.list', {}) },
        storeConnections: function (list) { return postRequest('connections.replaceAll', { list: list }) },
        getStoredPassword: function (name, user) { return postRequest('connections.getPassword', { name: name, user: user }) },
        storeSavedPassword: function (name, user, pw) { return postRequest('connections.setPassword', { name: name, user: user, password: pw }) },
        clearStoredPassword: function (name, user) { return postRequest('connections.clearPassword', { name: name, user: user }) },
        pickPemFile: function () { return postRequest('connections.pickPemFile', {}) },
        openUnlockWindow: function () { return Promise.resolve(null) },
        getSavedPasswordBiometricPref: function () { return Promise.resolve(false) },
        setSavedPasswordBiometricPref: function () { return Promise.resolve(false) },
    }

    var nativeFetch = window.fetch
    window.fetch = function (input, init) {
        try {
            var url = typeof input === 'string' ? input : input && input.url
            if (typeof url === 'string' && url.startsWith(window.geode.serverUrl)) {
                return postRequest('http.request', {
                    url: url,
                    method: (init && init.method) || 'GET',
                    headers: serializeHeaders(init && init.headers),
                    body: serializeBody(init && init.body),
                }).then(function (resp) {
                    return new Response(resp.body, {
                        status: resp.status,
                        statusText: resp.statusText,
                        headers: resp.headers,
                    })
                })
            }
        } catch (e) { /* fall through to native */ }
        return nativeFetch.call(this, input, init)
    }

    function serializeHeaders(h) {
        if (!h) return {}
        if (h instanceof Headers) {
            var out = {}
            h.forEach(function (v, k) { out[k] = v })
            return out
        }
        return h
    }

    function serializeBody(b) {
        if (!b) return null
        if (typeof b === 'string') return { kind: 'text', value: b }
        return { kind: 'text', value: String(b) }
    }
})()
