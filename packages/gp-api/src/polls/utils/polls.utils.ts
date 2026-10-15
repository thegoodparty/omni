import { Transform } from 'stream'

export const POLL_INDIVIDUAL_MESSAGE_NAMESPACE =
  'a0e5f0a1-2b3c-4d5e-8f70-8192a3b4c5d6' as const

export function stripLeadingNewlines(): Transform {
  let skipped = false
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (skipped) {
        cb(null, chunk)
        return
      }
      const s = chunk.toString('utf8')
      const firstNonBlank = s.search(/[^\r\n]/)
      if (firstNonBlank === -1) {
        cb()
        return
      }
      skipped = true
      cb(null, s.slice(firstNonBlank))
    },
  })
}
