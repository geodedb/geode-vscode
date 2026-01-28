/**
 * Test runner for running Mocha tests outside of VS Code extension host
 */

import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

async function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'bdd',
        color: true,
        timeout: 30000
    });

    const testsRoot = path.resolve(__dirname);

    try {
        // Find all test files
        const files = await glob('**/*.test.js', { cwd: testsRoot });

        // Add files to the test suite
        files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

        // Run the mocha test
        return new Promise<void>((resolve, reject) => {
            mocha.run((failures: number) => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    resolve();
                }
            });
        });
    } catch (err) {
        console.error('Failed to run tests:', err);
        throw err;
    }
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
