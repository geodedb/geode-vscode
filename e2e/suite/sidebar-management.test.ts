import { strict as assert } from 'assert'
import * as vscode from 'vscode'

describe('sidebar management surfaces', () => {
    it('refreshSchema/historyClear/savedSave commands exist', async () => {
        const all = await vscode.commands.getCommands(true)
        const want = ['geode.refreshSchema', 'geode.history.clear', 'geode.savedQueries.save']
        for (const c of want) {
            assert.ok(all.includes(c), `missing command: ${c}`)
        }
    })
})
