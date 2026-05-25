import type * as vscode from 'vscode'

export interface LegacyHistoryEntry {
    query: string
    timestamp: number
    duration?: number
    rowCount?: number
    connectionName?: string
    success: boolean
    error?: string
}

export interface MigrationDeps {
    globalState: vscode.Memento
    postEntry: (e: LegacyHistoryEntry) => Promise<void>
}

export async function migrateLegacyHistory(deps: MigrationDeps): Promise<void> {
    const entries = deps.globalState.get<LegacyHistoryEntry[]>('geode.queryHistory')
    if (!Array.isArray(entries) || entries.length === 0) return
    for (const e of entries) {
        try { await deps.postEntry(e) }
        catch { /* best-effort migration */ }
    }
    await deps.globalState.update('geode.queryHistory', undefined)
}
