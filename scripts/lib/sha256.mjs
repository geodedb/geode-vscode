import crypto from 'node:crypto'

export function sha256OfBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

export function sha256OfStream(stream) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    stream.on('data', (c) => h.update(c))
    stream.on('end', () => resolve(h.digest('hex')))
    stream.on('error', reject)
  })
}
