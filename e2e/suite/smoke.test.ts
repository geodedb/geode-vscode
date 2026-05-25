import { strict as assert } from 'assert'
import * as vscode from 'vscode'

describe('smoke', () => {
    it('activates the extension', async () => {
        const ext = vscode.extensions.getExtension('codeprosorg.geode-vscode')
        if (!ext) {
            assert.fail('extension not installed')
        }
        await ext.activate()
        assert.equal(ext.isActive, true)
    })

    it('exposes geode.showSpaShell command', async () => {
        const all = await vscode.commands.getCommands(true)
        assert.ok(all.includes('geode.showSpaShell'))
    })

    it('opening the SPA shell does not throw', async () => {
        await vscode.commands.executeCommand('geode.showSpaShell')
        await new Promise((r) => setTimeout(r, 5_000))
    })
})
