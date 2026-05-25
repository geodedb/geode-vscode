import type * as vscode from 'vscode'

export interface LegacySavedQuery {
    id: string
    name: string
    query: string
    description?: string
    tags?: string[]
    createdAt?: number
    updatedAt?: number
}

export interface SavedMigrationDeps {
    globalState: vscode.Memento
    postBulk: (list: LegacySavedQuery[]) => Promise<void>
}

export async function migrateLegacySavedQueries(deps: SavedMigrationDeps): Promise<void> {
    const list = deps.globalState.get<LegacySavedQuery[]>('geode.savedQueries')
    if (!Array.isArray(list) || list.length === 0) return
    try { await deps.postBulk(list) }
    catch { /* best-effort */ }
    await deps.globalState.update('geode.savedQueries', undefined)
}
