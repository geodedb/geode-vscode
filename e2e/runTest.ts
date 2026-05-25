import * as path from 'path'
import { runTests } from '@vscode/test-electron'

async function main(): Promise<void> {
    // __dirname when compiled is .../out/e2e/, so the extension root is two
    // levels up. Resolving with a single '..' would point at .../out/ and
    // VSCode would scan it as a bag of nested extensions (every subdir
    // probed for a package.json) instead of loading the real manifest.
    const extensionDevelopmentPath = path.resolve(__dirname, '..', '..')
    const extensionTestsPath = path.resolve(__dirname, 'suite/index')
    try {
        await runTests({ extensionDevelopmentPath, extensionTestsPath })
    } catch (err) {
        console.error('e2e failed:', err)
        process.exit(1)
    }
}

main()
