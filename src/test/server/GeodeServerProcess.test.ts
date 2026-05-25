import { strict as assert } from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { GeodeServerProcess } from '../../server/GeodeServerProcess'

describe('GeodeServerProcess', () => {
    let tmp: string
    let fakeBin: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsp-'))
        const slug = `${process.platform}-${process.arch}`
        const dir = path.join(tmp, 'resources/bin', slug)
        fs.mkdirSync(dir, { recursive: true })
        const ext = process.platform === 'win32' ? '.exe' : ''
        fakeBin = path.join(dir, `geode-ui${ext}`)
        fs.writeFileSync(
            fakeBin,
            '#!/bin/sh\necho "LISTENING addr=127.0.0.1:39999"\nsleep 5\n'
        )
        fs.chmodSync(fakeBin, 0o755)
    })

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true })
    })

    it('resolves start() once LISTENING line appears', async function () {
        if (process.platform === 'win32') return this.skip()
        const proc = new GeodeServerProcess({ extensionRoot: tmp })
        const info = await proc.start()
        assert.equal(info.host, '127.0.0.1')
        assert.equal(info.port, 39999)
        proc.stop()
    })

    it('rejects start() when binary exits before LISTENING', async function () {
        if (process.platform === 'win32') return this.skip()
        fs.writeFileSync(fakeBin, '#!/bin/sh\nexit 1\n')
        fs.chmodSync(fakeBin, 0o755)
        const proc = new GeodeServerProcess({ extensionRoot: tmp })
        await assert.rejects(proc.start(), /exited before listening/)
    })
})
