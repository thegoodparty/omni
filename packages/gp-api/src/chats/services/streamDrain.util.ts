export interface DrainableStream {
  once?: (event: string, cb: () => void) => void
  off?: (event: string, cb: () => void) => void
}

export type DrainOutcome = 'drained' | 'stalled'

// Awaits a backpressured SSE socket, but can never hang: resolves 'drained' on
// the socket's 'drain', on a terminal socket event ('close'/'error'), or on
// abort; and resolves 'stalled' after `timeoutMs` when none of those fire, so a
// connected-but-non-draining client (an idle or backgrounded tab) can't wedge
// the response until the request timeout. On 'stalled' the caller should stop
// awaiting drain for the rest of the stream and write through — the turn is
// already persisted server-side, and buffered chunks reach the client whenever
// it resumes reading.
export const waitForDrain = (
  stream: DrainableStream,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<DrainOutcome> =>
  new Promise<DrainOutcome>((resolve) => {
    if (typeof stream.once !== 'function' || signal.aborted) {
      resolve('drained')
      return
    }
    // Holder so cleanup can clear the timer without a reassigned `let` (the
    // timer, its callback, and cleanup form a cycle).
    const timer: { id?: ReturnType<typeof setTimeout> } = {}
    const cleanup = () => {
      if (timer.id) clearTimeout(timer.id)
      stream.off?.('drain', onDrain)
      stream.off?.('close', onTerminal)
      stream.off?.('error', onTerminal)
      signal.removeEventListener('abort', onTerminal)
    }
    const onDrain = () => {
      cleanup()
      resolve('drained')
    }
    const onTerminal = () => {
      cleanup()
      resolve('drained')
    }
    stream.once('drain', onDrain)
    stream.once('close', onTerminal)
    stream.once('error', onTerminal)
    signal.addEventListener('abort', onTerminal, { once: true })
    timer.id = setTimeout(() => {
      cleanup()
      resolve('stalled')
    }, timeoutMs)
  })
