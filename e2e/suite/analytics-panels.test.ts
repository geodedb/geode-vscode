import { strict as assert } from 'assert'
import * as vscode from 'vscode'

describe('analytics panels', () => {
    it('exposes all analytics commands', async () => {
        const all = await vscode.commands.getCommands(true)
        const want = [
            'geode.showGraphVisualization',
            'geode.visualizeQuery',
            'geode.showPerformanceMetrics',
            'geode.showAnalyticsDashboard',
            'geode.showQueryPlan',
            'geode.showPathExplorer',
        ]
        for (const c of want) {
            assert.ok(all.includes(c), `missing: ${c}`)
        }
    })

    it('opening the dashboard does not throw', async () => {
        await vscode.commands.executeCommand('geode.showAnalyticsDashboard')
        await new Promise((r) => setTimeout(r, 3_000))
        assert.ok(true)
    })
})
