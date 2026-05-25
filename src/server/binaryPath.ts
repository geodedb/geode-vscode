import * as fs from 'fs'
import * as path from 'path'

export enum BundledBinary {
    GeodeUiServer = 'geode-ui',
    GeodeGraphDb = 'geode',
}

const SUPPORTED_PLATFORMS = new Set([
    'linux-x64', 'linux-arm64',
    'darwin-x64', 'darwin-arm64',
    'win32-x64',
])

export interface ResolveOpts {
    platform?: NodeJS.Platform
    arch?: NodeJS.Architecture
}

// Resolves the absolute path of a bundled binary inside the extension.
// extensionRoot is the directory that contains the `resources/` tree.
// Throws if the file is missing or the platform is unsupported.
export function resolveBundledBinary(
    extensionRoot: string,
    binary: BundledBinary,
    opts: ResolveOpts = {}
): string {
    const platform = opts.platform ?? process.platform
    const arch = opts.arch ?? process.arch
    const slug = `${platform}-${arch}`
    if (!SUPPORTED_PLATFORMS.has(slug)) {
        throw new Error(`unsupported platform: ${slug}`)
    }
    const ext = platform === 'win32' ? '.exe' : ''
    const candidate = path.join(extensionRoot, 'resources', 'bin', slug, `${binary}${ext}`)
    if (!fs.existsSync(candidate)) {
        throw new Error(`bundled binary not found: ${candidate}`)
    }
    return candidate
}
