import type { BridgeHost } from '../bridge/host'

export interface ServerClient {
    request(path: string, method: string, body?: string | null): Promise<unknown>
}

export interface SchemaDeps {
    client: ServerClient
    activeConnectionId: () => string | null
}

export function createSchemaHandlers(deps: SchemaDeps) {
    function assertConn(): string {
        const id = deps.activeConnectionId()
        if (!id) throw new Error('no active connection')
        return id
    }
    return {
        refresh: async (_p: unknown) => {
            const id = assertConn()
            return await deps.client.request(`/api/v1/schema/refresh?connection=${id}`, 'POST')
        },
        list: async (_p: unknown) => {
            const id = assertConn()
            return await deps.client.request(`/api/v1/schema?connection=${id}`, 'GET')
        },
        getNode: async (payload: { label: string }) => {
            const id = assertConn()
            return await deps.client.request(
                `/api/v1/schema/node?connection=${id}&label=${encodeURIComponent(payload.label)}`,
                'GET'
            )
        },
        getRelationship: async (payload: { type: string }) => {
            const id = assertConn()
            return await deps.client.request(
                `/api/v1/schema/relationship?connection=${id}&type=${encodeURIComponent(payload.type)}`,
                'GET'
            )
        },
    }
}

export function registerSchemaHandlers(host: BridgeHost, deps: SchemaDeps): void {
    const h = createSchemaHandlers(deps)
    host.register('schema.refresh', h.refresh)
    host.register('schema.list', h.list)
    host.register('schema.getNode', h.getNode)
    host.register('schema.getRelationship', h.getRelationship)
}
