import { strict as assert } from 'assert'
import { migrateLegacySavedQueries, LegacySavedQuery } from '../../sidebar/savedQueriesMigration'

class FakeState {
    map = new Map<string, unknown>()
    get<T>(key: string): T | undefined { return this.map.get(key) as T | undefined }
    keys(): readonly string[] { return Array.from(this.map.keys()) }
    update(key: string, value: unknown): Thenable<void> {
        if (value === undefined) this.map.delete(key)
        else this.map.set(key, value)
        return Promise.resolve()
    }
}

describe('migrateLegacySavedQueries', () => {
    it('bulk-posts and clears', async () => {
        const state = new FakeState()
        await state.update('geode.savedQueries', [{ id: 'a', name: 'q', query: 'RETURN 1' }])
        let received: LegacySavedQuery[] = []
        await migrateLegacySavedQueries({
            globalState: state as never,
            postBulk: async (l) => { received = l },
        })
        assert.equal(received.length, 1)
        assert.equal(state.map.get('geode.savedQueries'), undefined)
    })
    it('no-ops on empty', async () => {
        const state = new FakeState()
        await migrateLegacySavedQueries({
            globalState: state as never,
            postBulk: async () => { throw new Error('should not run') },
        })
    })
})
