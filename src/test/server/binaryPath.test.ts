import { strict as assert } from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { resolveBundledBinary, BundledBinary } from '../../server/binaryPath'

describe('resolveBundledBinary', () => {
    let tmp: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-'))
    })

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true })
    })

    it('returns the platform-specific path under extension/resources/bin', () => {
        const slug = `${process.platform}-${process.arch}`
        const dir = path.join(tmp, 'resources/bin', slug)
        fs.mkdirSync(dir, { recursive: true })
        const ext = process.platform === 'win32' ? '.exe' : ''
        const binPath = path.join(dir, `geode-ui${ext}`)
        fs.writeFileSync(binPath, 'FAKE')
        fs.chmodSync(binPath, 0o755)
        const got = resolveBundledBinary(tmp, BundledBinary.GeodeUiServer)
        assert.equal(got, binPath)
    })

    it('throws when the binary is missing', () => {
        assert.throws(
            () => resolveBundledBinary(tmp, BundledBinary.GeodeUiServer),
            /bundled binary not found/
        )
    })
})
