import { strict as assert } from 'assert'
import { createSavedQueriesHandlers } from '../../sidebar/SavedQueriesHandler'
import { ServerClient } from '../../sidebar/SchemaHandler'

class FakeClient implements ServerClient {
    calls: { path: string; method: string; body: string | null }[] = []
    async request(path: string, method: string, body?: string | null) {
        this.calls.push({ path, method, body: body ?? null })
        return { ok: true }
    }
}

describe('SavedQueriesHandler', () => {
    it('list GETs /api/v1/saved', async () => {
        const c = new FakeClient()
        const h = createSavedQueriesHandlers({ client: c })
        await h.list({})
        assert.equal(c.calls[0].method, 'GET')
    })
    it('save POSTs JSON', async () => {
        const c = new FakeClient()
        const h = createSavedQueriesHandlers({ client: c })
        await h.save({ id: 'x', name: 'n', query: 'RETURN 1' })
        assert.equal(c.calls[0].method, 'POST')
        assert.match(c.calls[0].body ?? '', /"query":"RETURN 1"/)
    })
    it('update PUTs by id', async () => {
        const c = new FakeClient()
        const h = createSavedQueriesHandlers({ client: c })
        await h.update({ id: 'x', name: 'n', query: 'RETURN 2' })
        assert.match(c.calls[0].path, /\/x$/)
        assert.equal(c.calls[0].method, 'PUT')
    })
    it('delete DELETEs by id', async () => {
        const c = new FakeClient()
        const h = createSavedQueriesHandlers({ client: c })
        await h.delete({ id: 'x' })
        assert.equal(c.calls[0].method, 'DELETE')
    })
    it('importBulk POSTs to /bulk', async () => {
        const c = new FakeClient()
        const h = createSavedQueriesHandlers({ client: c })
        await h.importBulk({ items: [] })
        assert.match(c.calls[0].path, /\/bulk$/)
    })
})
