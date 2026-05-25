import { strict as assert } from 'assert'
import * as vscode from 'vscode'

describe('no host geode binary', () => {
    it('activates and starts LSP without a host-installed geode', async () => {
        const ext = vscode.extensions.getExtension('codeprosorg.geode-vscode')
        assert.ok(ext)
        await ext.activate()
        await new Promise((r) => setTimeout(r, 12_000))
        assert.equal(ext.isActive, true)
    })
})
