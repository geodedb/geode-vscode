import { strict as assert } from 'assert'
import { migrateLegacyHistory, LegacyHistoryEntry } from '../../sidebar/historyMigration'

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

describe('migrateLegacyHistory', () => {
    it('posts each legacy entry to /api/v1/history and clears storage', async () => {
        const state = new FakeState()
        await state.update('geode.queryHistory', [
            { query: 'RETURN 1', timestamp: 1700000000000, duration: 10, rowCount: 1, success: true },
        ])
        const posted: LegacyHistoryEntry[] = []
        await migrateLegacyHistory({
            globalState: state as never,
            postEntry: async (e) => { posted.push(e) },
        })
        assert.equal(posted.length, 1)
        assert.equal(state.map.get('geode.queryHistory'), undefined)
    })

    it('is a no-op when the legacy key is absent', async () => {
        const state = new FakeState()
        await migrateLegacyHistory({
            globalState: state as never,
            postEntry: async () => { throw new Error('should not be called') },
        })
    })
})
