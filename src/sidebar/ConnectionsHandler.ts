import type * as vscode from 'vscode'
import type { EnhancedConnectionManager, ConnectionProfile } from '../client/EnhancedConnectionManager'
import type { BridgeHost } from '../bridge/host'

export interface ConnectionsDeps {
    manager: EnhancedConnectionManager
    secrets: {
        get(key: string): Promise<string | undefined>
        setSecret(key: string, value: string): Promise<void>
        delete(key: string): Promise<void>
    }
    pickFile: () => Promise<string | null>
}

export interface ConnectionRecord {
    id: string
    name: string
    host: string
    port: number
    username?: string
    database?: string
    isDefault?: boolean
    useTls?: boolean
    insecure?: boolean
}

function secretKey(name: string, user: string): string {
    return `geode.savedPassword.${name}\x00${user}`
}

function toRecord(p: ConnectionProfile): ConnectionRecord {
    return {
        id: p.id,
        name: p.name,
        host: p.host,
        port: p.port,
        username: p.username,
        database: p.database,
        isDefault: p.isDefault,
        useTls: p.useTls,
        insecure: p.insecure,
    }
}

export function createConnectionsHandlers(deps: ConnectionsDeps) {
    return {
        list: async (_payload: unknown) => ({
            connections: deps.manager.getProfiles().map(toRecord),
        }),
        replaceAll: async (payload: { list: ConnectionRecord[] }) => {
            const incoming = new Map(payload.list.map((r) => [r.id, r]))
            const current = new Map(deps.manager.getProfiles().map((p) => [p.id, p]))
            for (const id of current.keys()) {
                if (!incoming.has(id)) await deps.manager.deleteProfile(id)
            }
            for (const r of payload.list) {
                if (current.has(r.id)) {
                    await deps.manager.updateProfile(r.id, r as Partial<ConnectionProfile>)
                } else {
                    await deps.manager.addProfile({
                        name: r.name,
                        host: r.host,
                        port: r.port,
                        username: r.username,
                        database: r.database,
                        useTls: r.useTls ?? true,
                        useTLS: r.useTls ?? true,
                        insecure: r.insecure ?? false,
                        isDefault: r.isDefault ?? false,
                        timeout: 5000,
                        queryTimeout: 30000,
                    } as Omit<ConnectionProfile, 'id'>)
                }
            }
            return {}
        },
        getPassword: async (payload: { name: string; user: string }) => ({
            password: (await deps.secrets.get(secretKey(payload.name, payload.user))) ?? null,
        }),
        setPassword: async (payload: { name: string; user: string; password: string }) => {
            await deps.secrets.setSecret(secretKey(payload.name, payload.user), payload.password)
            return {}
        },
        clearPassword: async (payload: { name: string; user: string }) => {
            await deps.secrets.delete(secretKey(payload.name, payload.user))
            return {}
        },
        connect: async (payload: { id: string }) => {
            await deps.manager.connect(payload.id)
            return { active: deps.manager.getActiveProfile()?.id ?? null }
        },
        disconnect: async (_payload: unknown) => {
            await deps.manager.disconnect()
            return {}
        },
        setDefault: async (payload: { id: string }) => {
            await deps.manager.setDefaultProfile(payload.id)
            return {}
        },
        pickPemFile: async (_payload: unknown) => {
            const contents = await deps.pickFile()
            return { contents }
        },
    }
}

export function registerConnectionsHandlers(host: BridgeHost, deps: ConnectionsDeps): void {
    const h = createConnectionsHandlers(deps)
    host.register('connections.list', h.list)
    host.register('connections.replaceAll', h.replaceAll)
    host.register('connections.getPassword', h.getPassword)
    host.register('connections.setPassword', h.setPassword)
    host.register('connections.clearPassword', h.clearPassword)
    host.register('connections.connect', h.connect)
    host.register('connections.disconnect', h.disconnect)
    host.register('connections.setDefault', h.setDefault)
    host.register('connections.pickPemFile', h.pickPemFile)
}

export function makePemFilePicker(): () => Promise<string | null> {
    return async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const vscodeApi: typeof vscode = require('vscode')
        const uris = await vscodeApi.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { PEM: ['pem', 'crt', 'key', 'cer'] },
            title: 'Select TLS PEM file',
        })
        if (!uris || uris.length === 0) return null
        const fs = await import('fs/promises')
        return await fs.readFile(uris[0].fsPath, 'utf8')
    }
}

export function makeVsCodeSecrets(secrets: vscode.SecretStorage): ConnectionsDeps['secrets'] {
    return {
        get: (k) => Promise.resolve(secrets.get(k)),
        setSecret: (k, v) => Promise.resolve(secrets.store(k, v)),
        delete: (k) => Promise.resolve(secrets.delete(k)),
    }
}
