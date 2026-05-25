#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

async function main() {
    const sources = [
        { repo: '../geode-ui', name: 'geode-ui' },
        { repo: '../geode', name: 'geode' },
    ]
    const lines = []
    for (const s of sources) {
        const license = await readOptional(path.join(root, s.repo, 'LICENSE'))
        const notice = await readOptional(path.join(root, s.repo, 'NOTICE'))
        if (license || notice) {
            lines.push(`# ${s.name}`)
            if (notice) lines.push(notice.trim(), '')
            if (license) lines.push(license.trim(), '')
        }
    }
    if (lines.length === 0) {
        console.error('no bundled licenses found; aborting')
        process.exit(1)
    }
    const out = path.join(root, 'resources/THIRD_PARTY_LICENSES.txt')
    await fs.writeFile(out, lines.join('\n'))
    console.log(`wrote ${out}`)
}

async function readOptional(p) {
    try { return await fs.readFile(p, 'utf8') } catch { return null }
}

main().catch((e) => { console.error(e); process.exit(1) })
