import { strict as assert } from 'assert'
import { createConnectionsHandlers } from '../../sidebar/ConnectionsHandler'

class FakeSecrets {
    store = new Map<string, string>()
    async get(k: string) { return this.store.get(k) }
    async setSecret(k: string, v: string) { this.store.set(k, v) }
    async delete(k: string) { this.store.delete(k) }
}

interface FakeProfile {
    id: string
    name: string
    host: string
    port: number
    username?: string
    isDefault?: boolean
}

class FakeManager {
    profiles: FakeProfile[] = []
    activeId: string | null = null
    getProfiles() { return this.profiles }
    async addProfile(p: Omit<FakeProfile, 'id'>) {
        const id = 'id-' + (this.profiles.length + 1)
        this.profiles.push({ ...p, id })
        return id
    }
    async deleteProfile(id: string) {
        this.profiles = this.profiles.filter((p) => p.id !== id)
    }
    async updateProfile(id: string, p: Partial<FakeProfile>) {
        const idx = this.profiles.findIndex((x) => x.id === id)
        if (idx >= 0) this.profiles[idx] = { ...this.profiles[idx], ...p }
    }
    async connect(id: string) { this.activeId = id }
    async disconnect() { this.activeId = null }
    async setDefaultProfile(id: string) {
        for (const p of this.profiles) p.isDefault = p.id === id
    }
    getActiveProfile() {
        return this.activeId ? this.profiles.find((p) => p.id === this.activeId) ?? null : null
    }
}

describe('ConnectionsHandler', () => {
    it('list returns SPA-shaped records', async () => {
        const mgr = new FakeManager()
        mgr.profiles = [{ id: 'a', name: 'Local', host: '127.0.0.1', port: 3141, username: 'u', isDefault: true }]
        const h = createConnectionsHandlers({ manager: mgr as never, secrets: new FakeSecrets(), pickFile: async () => null })
        const out = await h.list({})
        assert.equal(Array.isArray(out.connections), true)
        assert.equal(out.connections[0].name, 'Local')
        assert.equal(out.connections[0].host, '127.0.0.1')
    })

    it('connect resolves and tracks active id', async () => {
        const mgr = new FakeManager()
        mgr.profiles = [{ id: 'a', name: 'Local', host: '127.0.0.1', port: 3141 }]
        const h = createConnectionsHandlers({ manager: mgr as never, secrets: new FakeSecrets(), pickFile: async () => null })
        await h.connect({ id: 'a' })
        assert.equal(mgr.activeId, 'a')
    })

    it('getPassword/setPassword/clearPassword round-trip via SecretStorage', async () => {
        const secrets = new FakeSecrets()
        const h = createConnectionsHandlers({ manager: new FakeManager() as never, secrets, pickFile: async () => null })
        await h.setPassword({ name: 'Local', user: 'admin', password: 'hunter2' })
        const got = await h.getPassword({ name: 'Local', user: 'admin' })
        assert.equal(got.password, 'hunter2')
        await h.clearPassword({ name: 'Local', user: 'admin' })
        const cleared = await h.getPassword({ name: 'Local', user: 'admin' })
        assert.equal(cleared.password, null)
    })

    it('pickPemFile returns null when user cancels', async () => {
        const h = createConnectionsHandlers({ manager: new FakeManager() as never, secrets: new FakeSecrets(), pickFile: async () => null })
        const r = await h.pickPemFile({})
        assert.equal(r.contents, null)
    })

    it('replaceAll deletes profiles missing from incoming list', async () => {
        const mgr = new FakeManager()
        mgr.profiles = [
            { id: 'a', name: 'A', host: 'h', port: 1 },
            { id: 'b', name: 'B', host: 'h', port: 1 },
        ]
        const h = createConnectionsHandlers({ manager: mgr as never, secrets: new FakeSecrets(), pickFile: async () => null })
        await h.replaceAll({ list: [{ id: 'a', name: 'A-renamed', host: '1', port: 1 }] })
        assert.equal(mgr.profiles.length, 1)
        assert.equal(mgr.profiles[0].name, 'A-renamed')
    })
})
