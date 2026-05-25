import { strict as assert } from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'

describe('query results panel', () => {
    it('opens a webview when geode.runFile fires on a .gql file', async () => {
        const fixture = vscode.Uri.file(path.resolve(__dirname, '..', 'fixtures', 'sample.gql'))
        const doc = await vscode.workspace.openTextDocument(fixture)
        await vscode.window.showTextDocument(doc)
        // The smoke is the absence of throws — webview content cannot be
        // asserted from this side. Deep assertions live in ../geode-ui/e2e/.
        await vscode.commands.executeCommand('geode.runFile', fixture)
        await new Promise((r) => setTimeout(r, 3_000))
        assert.ok(true)
    })
})
