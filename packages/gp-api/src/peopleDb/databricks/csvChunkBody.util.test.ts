import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readCsvChunkBody } from './csvChunkBody.util'
import { PeopleDbxUnavailableError } from './peopleDbxStatement.client'

// How undici surfaces a socket that died before the response arrived.
const socketClosed = () =>
  Object.assign(new TypeError('fetch failed'), {
    cause: new Error('other side closed'),
  })

// And how it surfaces one that died with the response already streaming, which
// is the longer window: the body is megabytes and the handshake is not.
const bodyTerminated = () =>
  Object.assign(new TypeError('terminated'), {
    cause: new Error('other side closed'),
  })

const ok = (body: string) => ({
  ok: true,
  status: 200,
  arrayBuffer: () => Promise.resolve(Buffer.from(body)),
})

const status = (code: number) => ({ ok: false, status: code })

const makeLogger = () => ({
  warn: vi.fn<(obj: object, msg: string) => void>(),
})

describe('readCsvChunkBody', () => {
  let logger: ReturnType<typeof makeLogger>

  beforeEach(() => {
    // The backoff is real time the caller spends waiting, so it is faked here
    // rather than slept through: three attempts against a throttle is seconds
    // of a suite that otherwise runs in milliseconds.
    vi.useFakeTimers()
    logger = makeLogger()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // Drives the backoff timers while the read is in flight. The rejection is
  // claimed up front because a promise that settles while the timers run and
  // is only awaited afterwards counts as unhandled.
  const read = async (link = 'c0') => {
    const pending = readCsvChunkBody(link, logger)
    void pending.catch(() => undefined)
    await vi.runAllTimersAsync()
    return pending
  }

  it('returns the body without retrying when the fetch is clean', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok('rows'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(read()).resolves.toEqual(Buffer.from('rows'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('retries a socket that closed before the response', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(socketClosed())
      .mockResolvedValue(ok('rows'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(read()).resolves.toEqual(Buffer.from('rows'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // The regression this file exists for. A body that dies mid-stream throws
  // out of arrayBuffer() rather than out of fetch(), so a retry wrapped around
  // the request alone leaves the longer failure window uncovered entirely.
  it('retries a body that dies mid-stream', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.reject(bodyTerminated()),
      })
      .mockResolvedValue(ok('rows'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(read()).resolves.toEqual(Buffer.from('rows'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('says so in the log when a retry is what saved the read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(socketClosed()).mockResolvedValue(ok('r')),
    )

    await read()

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 2 }),
      expect.stringContaining('recovered'),
    )
  })

  it.each([500, 502, 503, 429])('retries a %d', async (code) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(status(code))
      .mockResolvedValue(ok('rows'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(read()).resolves.toEqual(Buffer.from('rows'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // The presigned expiry is an answer, not a blip. Asking again only makes the
  // caller wait longer for the same 403.
  it.each([400, 403, 404])('does not retry a %d', async (code) => {
    const fetchMock = vi.fn().mockResolvedValue(status(code))
    vi.stubGlobal('fetch', fetchMock)

    await expect(read()).rejects.toThrow(PeopleDbxUnavailableError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives up bounded rather than retrying forever', async () => {
    const fetchMock = vi.fn().mockRejectedValue(socketClosed())
    vi.stubGlobal('fetch', fetchMock)

    await expect(read()).rejects.toThrow(PeopleDbxUnavailableError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  // "fetch failed" on its own names nothing, and the cause underneath it is
  // what made the prod incident readable. Both the paging alert (which reads
  // the message) and anyone opening the log line (which reads `cause`) need to
  // still be able to see it.
  it('keeps the cause of a transport failure, in the message and on the error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(socketClosed()))

    const err = await read().catch((caught: unknown) => caught)

    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('other side closed')
    expect((err as Error).cause).toBeInstanceOf(TypeError)
  })

  it('names the status when the host answered with one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(status(403)))

    await expect(read()).rejects.toThrow(/403/)
  })
})
