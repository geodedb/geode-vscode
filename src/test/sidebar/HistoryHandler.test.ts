import { strict as assert } from 'assert'
import { createHistoryHandlers } from '../../sidebar/HistoryHandler'
import { ServerClient } from '../../sidebar/SchemaHandler'

class FakeClient implements ServerClient {
    calls: { path: string; method: string; body: string | null }[] = []
    async request(path: string, method: string, body?: string | null) {
        this.calls.push({ path, method, body: body ?? null })
        return { ok: true }
    }
}

describe('HistoryHandler', () => {
    it('list issues GET /api/v1/history', async () => {
        const c = new FakeClient()
        const h = createHistoryHandlers({ client: c })
        await h.list({})
        assert.equal(c.calls[0].method, 'GET')
        assert.equal(c.calls[0].path, '/api/v1/history')
    })
    it('add POSTs JSON', async () => {
        const c = new FakeClient()
        const h = createHistoryHandlers({ client: c })
        await h.add({ query: 'X', timestamp: 0, success: true })
        assert.equal(c.calls[0].method, 'POST')
        assert.match(c.calls[0].body ?? '', /"query":"X"/)
    })
    it('remove DELETEs by id', async () => {
        const c = new FakeClient()
        const h = createHistoryHandlers({ client: c })
        await h.remove({ id: 'abc' })
        assert.equal(c.calls[0].method, 'DELETE')
        assert.match(c.calls[0].path, /abc/)
    })
    it('clear DELETEs the collection', async () => {
        const c = new FakeClient()
        const h = createHistoryHandlers({ client: c })
        await h.clear({})
        assert.equal(c.calls[0].path, '/api/v1/history')
        assert.equal(c.calls[0].method, 'DELETE')
    })
})
