import type { BridgeHost } from '../bridge/host'
import type { ServerClient } from './SchemaHandler'
import type { LegacyHistoryEntry } from './historyMigration'

export interface HistoryDeps {
    client: ServerClient
}

export function createHistoryHandlers(deps: HistoryDeps) {
    return {
        list: async (_p: unknown) => deps.client.request('/api/v1/history', 'GET'),
        add: async (e: LegacyHistoryEntry) =>
            deps.client.request('/api/v1/history', 'POST', JSON.stringify(e)),
        remove: async (payload: { id: string }) =>
            deps.client.request(`/api/v1/history/${encodeURIComponent(payload.id)}`, 'DELETE'),
        clear: async (_p: unknown) => deps.client.request('/api/v1/history', 'DELETE'),
    }
}

export function registerHistoryHandlers(host: BridgeHost, deps: HistoryDeps): void {
    const h = createHistoryHandlers(deps)
    host.register('history.list', h.list)
    host.register('history.add', h.add as never)
    host.register('history.remove', h.remove)
    host.register('history.clear', h.clear)
}
