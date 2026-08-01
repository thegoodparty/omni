import { describe, it, expect } from 'vitest'
import { Readable } from 'node:stream'
import { createNullSink } from './nullSink'

describe('createNullSink', () => {
  it('counts bytes and newline rows piped into reply.raw', async () => {
    const sink = createNullSink()
    const source = Readable.from(['abc\n', 'de\n'])
    source.pipe(sink.reply.raw as unknown as NodeJS.WritableStream)
    await sink.finished
    expect(sink.bytes()).toBe(7)
    expect(sink.rows()).toBe(2)
  })

  it('exposes the ServerResponse-ish surface streamPeopleCsv touches', () => {
    const sink = createNullSink()
    const raw = sink.reply.raw
    expect(typeof raw.setHeader).toBe('function')
    expect(raw.headersSent).toBe(false)
    expect(typeof raw.flushHeaders).toBe('function')
    expect(raw.destroyed).toBe(false)
  })
})
