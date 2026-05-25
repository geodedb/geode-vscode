import type { BridgeHost } from '../bridge/host'
import type { ServerClient } from './SchemaHandler'
import type { LegacySavedQuery } from './savedQueriesMigration'

export interface SavedDeps {
    client: ServerClient
}

export function createSavedQueriesHandlers(deps: SavedDeps) {
    return {
        list: async (_p: unknown) => deps.client.request('/api/v1/saved', 'GET'),
        save: async (q: LegacySavedQuery) =>
            deps.client.request('/api/v1/saved', 'POST', JSON.stringify(q)),
        update: async (q: LegacySavedQuery) =>
            deps.client.request(`/api/v1/saved/${encodeURIComponent(q.id)}`, 'PUT', JSON.stringify(q)),
        delete: async (payload: { id: string }) =>
            deps.client.request(`/api/v1/saved/${encodeURIComponent(payload.id)}`, 'DELETE'),
        importBulk: async (payload: { items: LegacySavedQuery[] }) =>
            deps.client.request('/api/v1/saved/bulk', 'POST', JSON.stringify(payload)),
        exportAll: async (_p: unknown) => deps.client.request('/api/v1/saved/export', 'GET'),
    }
}

export function registerSavedQueriesHandlers(host: BridgeHost, deps: SavedDeps): void {
    const h = createSavedQueriesHandlers(deps)
    host.register('saved.list', h.list)
    host.register('saved.save', h.save as never)
    host.register('saved.update', h.update as never)
    host.register('saved.delete', h.delete)
    host.register('saved.import', h.importBulk)
    host.register('saved.export', h.exportAll)
}
