import { Writable } from 'node:stream'
import type { FastifyReply } from 'fastify'

export type NullSink = {
  reply: FastifyReply
  bytes: () => number
  rows: () => number
  finished: Promise<void>
}

export const createNullSink = (): NullSink => {
  let byteCount = 0
  let rowCount = 0

  const raw = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      byteCount += buf.length
      for (const b of buf) if (b === 0x0a) rowCount += 1
      cb()
    },
  }) as Writable & Record<string, unknown>

  // streamPeopleCsv treats res.raw as a Node ServerResponse: give it the
  // header/flush/status surface it pokes so the COPY stream can pipe into it.
  raw.setHeader = () => raw
  raw.flushHeaders = () => undefined
  raw.headersSent = false
  raw.statusCode = 200

  const finished = new Promise<void>((resolve) => {
    raw.once('finish', () => resolve())
    raw.once('close', () => resolve())
  })

  return {
    reply: { raw } as unknown as FastifyReply,
    bytes: () => byteCount,
    rows: () => rowCount,
    finished,
  }
}
