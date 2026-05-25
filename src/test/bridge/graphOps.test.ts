import { strict as assert } from 'assert'
import { buildExpandQuery, createGraphOpsHandlers } from '../../bridge/handlers/graphOps'
import { QueryRunner } from '../../bridge/handlers/queryExecute'

describe('graph ops', () => {
    it('buildExpandQuery produces a MATCH on neighbours', () => {
        const q = buildExpandQuery('123', ['Person'], 1)
        assert.match(q, /MATCH/)
        assert.match(q, /123/)
    })

    it('expand handler runs the query and returns graph elements', async () => {
        const runner: QueryRunner = {
            isConnected: true,
            async run(_s: string) {
                return {
                    columns: ['n', 'r', 'm'],
                    rows: [{
                        n: { _id: 1, _labels: ['Person'] },
                        r: { _id: 2, _type: 'KNOWS', _start: 1, _end: 3 },
                        m: { _id: 3, _labels: ['Person'] },
                    }],
                    durationMs: 5,
                }
            },
        }
        const h = createGraphOpsHandlers({ runner })
        const out = await h.expand({ nodeId: '1', labels: ['Person'], depth: 1 })
        assert.equal(out.nodes.length, 2)
        assert.equal(out.edges.length, 1)
    })
})
