import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// Downloads `url` to `dest`, streaming. Returns the sha256 hex of bytes
// written. Throws if HTTP status is not 200. The caller is responsible
// for comparing the returned digest against an expected value.
export async function downloadToFile(url, dest) {
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(`download ${url} -> HTTP ${res.status}`)
  }
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  const file = fs.createWriteStream(dest)
  const h = crypto.createHash('sha256')
  await new Promise((resolve, reject) => {
    res.body.pipeTo(
      new WritableStream({
        write(chunk) {
          h.update(chunk)
          return new Promise((r, j) =>
            file.write(chunk, (err) => (err ? j(err) : r()))
          )
        },
        close() {
          file.end()
          resolve()
        },
        abort: reject,
      })
    )
  })
  return h.digest('hex')
}
