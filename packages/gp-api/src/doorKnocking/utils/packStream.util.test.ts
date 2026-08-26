import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PACK_STREAM_ALIGNMENT,
  PACK_STREAM_FRAME_HEADER_BYTES,
  PACK_STREAM_FRAME_KINDS,
  PACK_STREAM_MAGIC,
  PACK_STREAM_MAGIC_BYTES,
} from '@goodparty_org/contracts'
import {
  GATEWAY_IDLE_TIMEOUT_MS,
  PACK_HEARTBEAT_MS,
  streamPack,
} from './packStream.util'

const MAGIC = Buffer.from(PACK_STREAM_MAGIC, 'ascii')

const drain = (stream: Readable): Buffer => {
  const chunk = stream.read() as Buffer | null
  return chunk ?? Buffer.alloc(0)
}

type Frame = { kind: number; payload: Buffer }

const parseFrames = (bytes: Buffer): Frame[] => {
  const frames: Frame[] = []
  let offset = 0
  while (offset + PACK_STREAM_FRAME_HEADER_BYTES <= bytes.byteLength) {
    const kind = bytes.readUInt32LE(offset)
    const payloadBytes = bytes.readUInt32LE(offset + 4)
    const start = offset + PACK_STREAM_FRAME_HEADER_BYTES
    frames.push({ kind, payload: bytes.subarray(start, start + payloadBytes) })
    offset =
      start +
      Math.ceil(payloadBytes / PACK_STREAM_ALIGNMENT) * PACK_STREAM_ALIGNMENT
  }
  return frames
}

const never = () => new Promise<Buffer>(() => undefined)

describe('streamPack', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // The defect this exists to prevent: the handler used to await the whole
  // build and hand back a finished Buffer, so nothing reached the socket for
  // the duration and the gateway killed the connection with no status. If the
  // magic only appears once the build resolves, this build never resolves and
  // the read below comes back empty.
  it('writes the envelope before the build has produced anything', () => {
    const stream = streamPack({ build: never, onFailure: vi.fn() })

    expect(drain(stream)).toEqual(MAGIC)
  })

  it('keeps writing on a cadence the gateway cannot time out', async () => {
    vi.useFakeTimers()
    const stream = streamPack({ build: never, onFailure: vi.fn() })
    drain(stream)

    await vi.advanceTimersByTimeAsync(PACK_HEARTBEAT_MS * 3)

    const frames = parseFrames(drain(stream))
    expect(frames).toHaveLength(3)
    expect(
      frames.every((f) => f.kind === PACK_STREAM_FRAME_KINDS.heartbeat),
    ).toBe(true)
    // The invariant, stated rather than implied: the longest the connection
    // can be quiet is one heartbeat, and that has to stay under the ceiling.
    expect(PACK_HEARTBEAT_MS).toBeLessThan(GATEWAY_IDLE_TIMEOUT_MS)
  })

  it('delivers the pack in a final frame and ends', async () => {
    const pack = Buffer.from([1, 2, 3, 4, 5])
    const stream = streamPack({
      build: () => Promise.resolve(pack),
      onFailure: vi.fn(),
    })

    const body = Buffer.concat(await stream.toArray())

    expect(body.subarray(0, PACK_STREAM_MAGIC_BYTES)).toEqual(MAGIC)
    expect(parseFrames(body.subarray(PACK_STREAM_MAGIC_BYTES))).toEqual([
      { kind: PACK_STREAM_FRAME_KINDS.pack, payload: pack },
    ])
  })

  // Once the first byte is out the status is already 200, so this is the only
  // way a failed build can reach either the browser or an alert.
  it('reports a failed build as an error frame and a log line', async () => {
    const onFailure = vi.fn()
    const stream = streamPack({
      build: () => Promise.reject(new Error('people-db exploded')),
      onFailure,
    })

    const frames = parseFrames(
      Buffer.concat(await stream.toArray()).subarray(PACK_STREAM_MAGIC_BYTES),
    )

    expect(frames).toHaveLength(1)
    expect(frames[0]?.kind).toBe(PACK_STREAM_FRAME_KINDS.error)
    expect(frames[0]?.payload.toString('utf8')).toContain('could not be built')
    expect(onFailure).toHaveBeenCalledWith(expect.any(Error))
    // The browser is told the map failed; it is not told what people-db said.
    expect(frames[0]?.payload.toString('utf8')).not.toContain('exploded')
  })

  it('abandons the build when the client goes away', async () => {
    let signal: AbortSignal | undefined
    const onFailure = vi.fn()
    const stream = streamPack({
      build: (buildSignal) => {
        signal = buildSignal
        return new Promise<Buffer>((_, reject) => {
          buildSignal.addEventListener('abort', () =>
            reject(new Error('pack build abandoned: the client is gone')),
          )
        })
      },
      onFailure,
    })

    stream.destroy()
    await new Promise((resolve) => setImmediate(resolve))

    expect(signal?.aborted).toBe(true)
    // Nobody is waiting and nothing on our side failed, so this must not page.
    expect(onFailure).not.toHaveBeenCalled()
  })
})
