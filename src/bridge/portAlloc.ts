import * as net from 'net'

// Ask the kernel for a free localhost port by binding to port 0. The
// returned port is not reserved — anyone could grab it between this
// call and a subsequent re-bind — but it gives us a TOCTOU-tolerant
// hint that is good enough for spawning a child server. The child
// does the real binding; if it loses the race the spawn fails fast
// and the caller retries.
export function allocatePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = net.createServer()
        s.unref()
        s.on('error', reject)
        s.listen(0, '127.0.0.1', () => {
            const addr = s.address()
            s.close(() => {
                if (addr && typeof addr === 'object' && typeof addr.port === 'number') {
                    resolve(addr.port)
                } else {
                    reject(new Error('failed to read allocated port'))
                }
            })
        })
    })
}
