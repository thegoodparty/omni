import { Readable } from 'node:stream'
import {
  PACK_STREAM_ALIGNMENT,
  PACK_STREAM_FRAME_HEADER_BYTES,
  PACK_STREAM_FRAME_KINDS,
  PACK_STREAM_MAGIC,
} from '@goodparty_org/contracts'

// The gateway in front of gp-api drops a connection that has carried no bytes
// for this long, and it drops it without writing a status — which is what
// `statusCode: null` on a `Request completed` line means. Two pack builds died
// at exactly 119,999ms in the seven days to 2026-08-25.
export const GATEWAY_IDLE_TIMEOUT_MS = 120_000

// A pack build is a keyset scan of a whole district that emits nothing until
// the last row, so the socket was idle for the entire build. Heartbeats are
// the fix rather than a faster build, because they bound the idle gap by
// construction: however slow one batch turns out to be, the connection is
// never quiet for longer than this. Eight fit under the ceiling above.
export const PACK_HEARTBEAT_MS = 15_000

// Once the first byte is written the status line is already 200, so a build
// that fails afterwards can no longer be an HTTP error. This is what makes it
// visible instead: `door-knocking-pack-build-failed` in deploy/components/
// alerts.ts pages on it, and the message the client renders is deliberately
// generic — the underlying error goes to the log, not to the browser.
export const PACK_BUILD_FAILED_EVENT = 'DoorKnockingPackBuildFailed'

const PACK_BUILD_FAILED_MESSAGE =
  'The voter map could not be built. Please try again.'

const padded = (byteLength: number): number =>
  Math.ceil(byteLength / PACK_STREAM_ALIGNMENT) * PACK_STREAM_ALIGNMENT

const frame = (kind: number, payload: Buffer): Buffer => {
  const buffer = Buffer.alloc(
    PACK_STREAM_FRAME_HEADER_BYTES + padded(payload.byteLength),
  )
  buffer.writeUInt32LE(kind, 0)
  buffer.writeUInt32LE(payload.byteLength, 4)
  payload.copy(buffer, PACK_STREAM_FRAME_HEADER_BYTES)
  return buffer
}

type StreamPackOptions = {
  build: (signal: AbortSignal) => Promise<Buffer>
  /**
   * `elapsedMs` is how long the build ran before it threw, and it is reported
   * from here because this is the only place that knows when it started.
   *
   * It is what separates the two failures that reach this callback looking
   * identical: a district whose scan ran into the 25s people-db statement
   * timeout, and a build that fell over on its first statement. The alert on
   * this event cannot tell those apart — it counts the event — so the reader
   * has always had to open Grafana to find out which one they were looking at.
   * The `known_causes` registry entry for
   * `door-knocking-pack-build-failed` is written against this field and the
   * error code together, so that work can be done before anyone is notified.
   */
  onFailure: (error: Error, elapsedMs: number) => void
  heartbeatMs?: number
}

export const streamPack = ({
  build,
  onFailure,
  heartbeatMs = PACK_HEARTBEAT_MS,
}: StreamPackOptions): Readable => {
  // Pushes are driven by the heartbeat timer and the build below rather than
  // by consumer demand, so there is nothing to do when more data is asked for.
  const stream = new Readable({
    read: () => undefined,
  })
  const abort = new AbortController()

  // Pushed before `build` is called, not after it resolves: this is the whole
  // point of the envelope, and awaiting anything first would put the idle gap
  // straight back.
  stream.push(Buffer.from(PACK_STREAM_MAGIC, 'ascii'))

  const heartbeat = setInterval(() => {
    stream.push(frame(PACK_STREAM_FRAME_KINDS.heartbeat, Buffer.alloc(0)))
  }, heartbeatMs)
  heartbeat.unref()

  // A client that gives up (its own deadline, a closed tab) destroys this
  // stream. Without the signal the district scan behind it keeps running and
  // whatever the client does next contends with a build nobody is waiting for.
  stream.once('close', () => abort.abort())

  // Taken immediately before the build rather than at the top of this
  // function, so the number reported is the build's duration and not the
  // envelope's — the two differ by whatever the event loop was doing.
  const startedAt = Date.now()

  build(abort.signal)
    .then((pack) => {
      stream.push(frame(PACK_STREAM_FRAME_KINDS.pack, pack))
    })
    .catch((error: Error) => {
      // Nobody is listening and nothing failed on our side, so this is not a
      // page — see the abort above.
      if (abort.signal.aborted) return
      onFailure(error, Date.now() - startedAt)
      stream.push(
        frame(
          PACK_STREAM_FRAME_KINDS.error,
          Buffer.from(PACK_BUILD_FAILED_MESSAGE, 'utf8'),
        ),
      )
    })
    .finally(() => {
      clearInterval(heartbeat)
      stream.push(null)
    })

  return stream
}
