import { strict as assert } from 'assert'
import { createSchemaHandlers, ServerClient } from '../../sidebar/SchemaHandler'

class FakeServer implements ServerClient {
    last?: { path: string; method: string; body: string | null }
    async request(path: string, method: string, body?: string | null) {
        this.last = { path, method, body: body ?? null }
        if (path.startsWith('/api/v1/schema/refresh')) return { ok: true }
        if (path.startsWith('/api/v1/schema?')) return { labels: ['Person'], types: ['KNOWS'] }
        return {}
    }
}

describe('SchemaHandler', () => {
    it('refresh POSTs to /api/v1/schema/refresh with connection id', async () => {
        const client = new FakeServer()
        const h = createSchemaHandlers({ client, activeConnectionId: () => 'c1' })
        await h.refresh({})
        assert.equal(client.last?.method, 'POST')
        assert.match(client.last?.path ?? '', /\/api\/v1\/schema\/refresh/)
    })

    it('list returns the parsed schema payload', async () => {
        const client = new FakeServer()
        const h = createSchemaHandlers({ client, activeConnectionId: () => 'c1' })
        const out = await h.list({}) as { labels: string[] }
        assert.deepEqual(out.labels, ['Person'])
    })

    it('throws when no active connection', async () => {
        const h = createSchemaHandlers({ client: new FakeServer(), activeConnectionId: () => null })
        await assert.rejects(h.refresh({}), /no active connection/)
    })
})
