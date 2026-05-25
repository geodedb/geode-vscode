import { strict as assert } from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'

describe('query results panel', () => {
    it('exposes geode.runFile and can open a .gql fixture without throwing', async () => {
        const all = await vscode.commands.getCommands(true)
        assert.ok(all.includes('geode.runFile'), 'runFile command registered')
        // Open the fixture so the editor surfaces don't error out, but do
        // NOT executeCommand('geode.runFile') in the e2e harness: with no
        // active connection the command shows a modal warning dialog that
        // never resolves headless. Deep assertions live in ../geode-ui/e2e/.
        const fixture = vscode.Uri.file(path.resolve(__dirname, '..', 'fixtures', 'sample.gql'))
        const doc = await vscode.workspace.openTextDocument(fixture)
        await vscode.window.showTextDocument(doc)
        assert.equal(doc.languageId, 'gql')
    })
})
