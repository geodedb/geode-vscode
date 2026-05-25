import { strict as assert } from 'assert'

describe('LSP WS URL building', () => {
    it('attaches access_token when provided', () => {
        const u = new URL('ws://127.0.0.1:9000/ws/lsp')
        u.searchParams.set('access_token', 'abc')
        assert.equal(u.toString(), 'ws://127.0.0.1:9000/ws/lsp?access_token=abc')
    })
})
