import { strict as assert } from 'assert'
import { pushResults } from '../../panels/openResultsPanel'
import type { OpenedPanel } from '../../webview/ReactWebviewPanel'

describe('pushResults', () => {
    it('posts a query.results event envelope', async () => {
        const posted: unknown[] = []
        const panel = {
            panel: { webview: { postMessage: (m: unknown) => { posted.push(m); return Promise.resolve(true) } } },
        } as unknown as OpenedPanel
        pushResults(panel, 'q1', 'RETURN 1', { columns: ['x'], rows: [{ x: 1 }], durationMs: 1 })
        await new Promise((r) => setTimeout(r, 1))
        assert.equal(posted.length, 1)
        const event = posted[0] as { kind: string; op: string; payload: { queryId: string } }
        assert.equal(event.kind, 'event')
        assert.equal(event.op, 'query.results')
        assert.equal(event.payload.queryId, 'q1')
    })
})
