import { strict as assert } from 'assert'
import { createQueryExecuteHandler, QueryRunner, QueryResult } from '../../bridge/handlers/queryExecute'

class FakeRunner implements QueryRunner {
    isConnected = true
    async run(_stmt: string): Promise<QueryResult> {
        return { columns: ['n'], rows: [{ n: 1 }, { n: 2 }], durationMs: 12 }
    }
}

describe('queryExecute handler', () => {
    it('returns rows and duration', async () => {
        const h = createQueryExecuteHandler({ runner: new FakeRunner() })
        const out = await h({ statement: 'RETURN n' })
        assert.deepEqual(out.columns, ['n'])
        assert.equal(out.rows.length, 2)
        assert.ok(out.durationMs >= 0)
    })

    it('throws when not connected', async () => {
        const r = new FakeRunner()
        r.isConnected = false
        const h = createQueryExecuteHandler({ runner: r })
        await assert.rejects(h({ statement: 'RETURN 1' }), /not connected/)
    })
})
