export interface QueryRow { [k: string]: unknown }
export interface QueryResult {
    columns: string[]
    rows: QueryRow[]
    durationMs: number
}

export interface QueryRunner {
    isConnected: boolean
    run(statement: string): Promise<QueryResult>
}

export function createQueryExecuteHandler(deps: { runner: QueryRunner }) {
    return async function (payload: { statement: string }): Promise<QueryResult> {
        if (!deps.runner.isConnected) {
            throw new Error('not connected: open the sidebar and connect to a profile first')
        }
        return await deps.runner.run(payload.statement)
    }
}
