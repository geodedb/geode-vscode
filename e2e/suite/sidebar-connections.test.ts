import { strict as assert } from 'assert'
import * as vscode from 'vscode'

describe('sidebar connections', () => {
    it('exposes geode.connections.add after sub-plan 2 lands', async () => {
        const all = await vscode.commands.getCommands(true)
        assert.ok(all.includes('geode.connections.add'))
    })

    it('exposes geode.connections.refresh after sub-plan 2 lands', async () => {
        const all = await vscode.commands.getCommands(true)
        assert.ok(all.includes('geode.connections.refresh'))
    })
})
