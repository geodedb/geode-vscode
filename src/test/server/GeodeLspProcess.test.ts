import { strict as assert } from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { GeodeLspProcess } from '../../server/GeodeLspProcess'

describe('GeodeLspProcess', () => {
    let tmp: string
    let fakeBin: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-'))
        const slug = `${process.platform}-${process.arch}`
        const dir = path.join(tmp, 'resources/bin', slug)
        fs.mkdirSync(dir, { recursive: true })
        const ext = process.platform === 'win32' ? '.exe' : ''
        fakeBin = path.join(dir, `geode${ext}`)
        fs.writeFileSync(
            fakeBin,
            '#!/bin/sh\necho "LSP_LISTENING port=39998"\nsleep 5\n'
        )
        fs.chmodSync(fakeBin, 0o755)
    })

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true })
    })

    it('resolves start() once LSP_LISTENING line appears', async function () {
        if (process.platform === 'win32') return this.skip()
        const proc = new GeodeLspProcess({ extensionRoot: tmp })
        const info = await proc.start()
        assert.equal(info.port, 39998)
        proc.stop()
    })

    it('rejects start() when binary exits before LSP_LISTENING', async function () {
        if (process.platform === 'win32') return this.skip()
        fs.writeFileSync(fakeBin, '#!/bin/sh\nexit 1\n')
        fs.chmodSync(fakeBin, 0o755)
        const proc = new GeodeLspProcess({ extensionRoot: tmp })
        await assert.rejects(proc.start(), /exited before LSP listening/)
    })
})
