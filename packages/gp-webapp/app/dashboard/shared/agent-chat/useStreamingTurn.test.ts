import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ChatStreamEvent } from './chatClient'
import { useStreamingTurn } from './useStreamingTurn'

async function* streamOf(
  events: ChatStreamEvent[],
): AsyncGenerator<ChatStreamEvent> {
  for (const event of events) yield event
}

async function* throwingStream(): AsyncGenerator<ChatStreamEvent> {
  throw new Error('network down')
}

describe('useStreamingTurn', () => {
  it('reports a streamed error event via onError and clears sending', async () => {
    const onError = vi.fn()
    const api = {
      streamMessage: () =>
        streamOf([
          {
            type: 'error',
            code: 'internal',
            message: 'boom',
            retryable: false,
          },
        ]),
      listMessages: vi.fn().mockResolvedValue([]),
    }

    const { result } = renderHook(() =>
      useStreamingTurn(api, { toolLabel: () => null, onError }),
    )

    await act(async () => {
      await result.current.send('c1', 'hello')
    })

    expect(onError).toHaveBeenCalledWith('boom', false)
    expect(result.current.sending).toBe(false)
  })

  it('does not reload history after a streamed error (keeps the optimistic turn)', async () => {
    const listMessages = vi.fn().mockResolvedValue([])
    const api = {
      streamMessage: () =>
        streamOf([
          {
            type: 'error',
            code: 'internal',
            message: 'boom',
            retryable: false,
          },
        ]),
      listMessages,
    }

    const { result } = renderHook(() =>
      useStreamingTurn(api, { toolLabel: () => null, onError: vi.fn() }),
    )

    await act(async () => {
      await result.current.send('c1', 'hello')
    })

    expect(listMessages).not.toHaveBeenCalled()
    // The optimistic user message survives (no history swap reverted it).
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]?.content).toBe('hello')
  })

  it('reports a thrown stream via onError and clears sending', async () => {
    const onError = vi.fn()
    const api = {
      streamMessage: () => throwingStream(),
      listMessages: vi.fn().mockResolvedValue([]),
    }

    const { result } = renderHook(() =>
      useStreamingTurn(api, { toolLabel: () => null, onError }),
    )

    await act(async () => {
      await result.current.send('c1', 'hello')
    })

    expect(onError).toHaveBeenCalledWith(
      'Something went wrong. Please try again.',
      true,
    )
    expect(result.current.sending).toBe(false)
  })

  it('ignores a second send while one is already in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    async function* gatedStream(): AsyncGenerator<ChatStreamEvent> {
      await gate
    }
    const streamMessage = vi.fn(() => gatedStream())
    const api = { streamMessage, listMessages: vi.fn().mockResolvedValue([]) }

    const { result } = renderHook(() =>
      useStreamingTurn(api, { toolLabel: () => null }),
    )

    await act(async () => {
      const first = result.current.send('c1', 'first')
      const second = result.current.send('c1', 'second')
      release()
      await Promise.all([first, second])
    })

    // The second call is dropped by the in-flight guard.
    expect(streamMessage).toHaveBeenCalledTimes(1)
    expect(result.current.sending).toBe(false)
  })

  it('reports a listMessages rejection via onError and clears sending', async () => {
    const onError = vi.fn()
    const api = {
      streamMessage: () => streamOf([]),
      listMessages: vi.fn().mockRejectedValue(new Error('history load failed')),
    }

    const { result } = renderHook(() =>
      useStreamingTurn(api, { toolLabel: () => null, onError }),
    )

    await act(async () => {
      await result.current.send('c1', 'hello')
    })

    expect(onError).toHaveBeenCalledWith(
      'Something went wrong. Please try again.',
      true,
    )
    expect(result.current.sending).toBe(false)
    expect(result.current.liveSegments).toEqual([])
  })

  it('does not send an empty or whitespace-only message', async () => {
    const streamMessage = vi.fn()
    const api = { streamMessage, listMessages: vi.fn().mockResolvedValue([]) }

    const { result } = renderHook(() =>
      useStreamingTurn(api, { toolLabel: () => null }),
    )

    await act(async () => {
      await result.current.send('c1', '   ')
    })

    expect(streamMessage).not.toHaveBeenCalled()
  })

  it('swaps in the transcript when a done-less stream persists late (no local partial)', async () => {
    vi.useFakeTimers()
    try {
      const start = Date.now()
      const persisted = {
        id: 'srv-1',
        conversationId: 'c1',
        role: 'assistant' as const,
        content: 'Here is your first draft — the full turn',
        createdAt: new Date().toISOString(),
      }
      // The server is still generating when the stream dies: the finished turn
      // only appears in the transcript 30s after the stream ended.
      const listMessages = vi.fn(async () =>
        Date.now() - start >= 30_000 ? [persisted] : [],
      )
      const api = {
        streamMessage: () =>
          streamOf([{ type: 'text' as const, delta: 'Here is your first' }]),
        listMessages,
      }

      const { result } = renderHook(() =>
        useStreamingTurn(api, { toolLabel: () => null }),
      )

      let sendPromise!: Promise<void>
      act(() => {
        sendPromise = result.current.send('c1', 'draft it')
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200_000)
        await sendPromise
      })

      expect(result.current.messages.some((m) => m.id === 'srv-1')).toBe(true)
      expect(
        result.current.messages.some((m) => m.id.startsWith('local-')),
      ).toBe(false)
      expect(result.current.sending).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps polling for late persistence after a real idle-watchdog stall', async () => {
    // Regression: the idle watchdog self-aborts the dead stream, so the commit
    // poll must reconcile on THAT abort (a stall) while still bailing on an
    // external abort (unmount/supersede). A prior version guarded the poll on
    // the raw abort signal, so a genuine stall skipped the poll and froze the
    // local partial mid-sentence until refresh.
    vi.useFakeTimers()
    try {
      const start = Date.now()
      const persisted = {
        id: 'srv-stall',
        conversationId: 'c1',
        role: 'assistant' as const,
        content: 'The finished draft — persisted long after the stall',
        createdAt: new Date().toISOString(),
      }
      // The turn persists 90s after send — well past the 60s idle watchdog, so
      // recovery only finds it if it keeps polling AFTER the stall abort.
      const listMessages = vi.fn(async () =>
        Date.now() - start >= 90_000 ? [persisted] : [],
      )
      const api = {
        // Emit a lead-in then hang forever (never ends, never `done`): the
        // client never sees end-of-stream, so the idle watchdog fires.
        streamMessage: () =>
          (async function* (): AsyncGenerator<ChatStreamEvent> {
            yield { type: 'text', delta: 'The finished' }
            await new Promise<void>(() => undefined)
          })(),
        listMessages,
      }

      const { result } = renderHook(() =>
        useStreamingTurn(api, { toolLabel: () => null }),
      )

      let sendPromise!: Promise<void>
      act(() => {
        sendPromise = result.current.send('c1', 'draft it')
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200_000)
        await sendPromise
      })

      // The poll ran past the stall abort and swapped in the persisted turn.
      expect(result.current.messages.some((m) => m.id === 'srv-stall')).toBe(
        true,
      )
      expect(
        result.current.messages.some((m) => m.id.startsWith('local-')),
      ).toBe(false)
      expect(result.current.sending).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('supersedes a settling turn when a second send arrives during the commit poll', async () => {
    // The in-flight guard drops a second send only while the first is actively
    // streaming. Once the first turn's stream is done and it is merely settling
    // (reconciling persisted history), a follow-up must SUPERSEDE it — abort the
    // poll and start a new turn — not be dropped.
    vi.useFakeTimers()
    try {
      const streamMessage = vi
        .fn()
        .mockImplementationOnce(
          async function* (): AsyncGenerator<ChatStreamEvent> {
            yield { type: 'text', delta: 'first' }
            yield { type: 'done', assistantMessageId: 'a1' }
          },
        )
        .mockImplementationOnce(
          async function* (): AsyncGenerator<ChatStreamEvent> {
            yield { type: 'text', delta: 'second' }
            yield { type: 'done', assistantMessageId: 'a2' }
          },
        )
      // The turn never persists, so the first send sits in the commit poll
      // (settling) instead of finishing — exactly when a follow-up should win.
      const listMessages = vi.fn().mockResolvedValue([])
      const api = { streamMessage, listMessages }
      const { result } = renderHook(() =>
        useStreamingTurn(api, { toolLabel: () => null }),
      )

      let first!: Promise<void>
      act(() => {
        first = result.current.send('c1', 'first')
      })
      // Drain the stream + reveal so the turn drops `sending` and enters the
      // poll — settlingRef is now true while sendingRef stays set.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(streamMessage).toHaveBeenCalledTimes(1)
      expect(result.current.sending).toBe(false)

      // A second send now supersedes the settling turn rather than being dropped.
      let second!: Promise<void>
      act(() => {
        second = result.current.send('c1', 'second')
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000)
        await Promise.all([first, second])
      })

      expect(streamMessage).toHaveBeenCalledTimes(2)
      expect(streamMessage.mock.calls[1]?.[0]?.content).toBe('second')
      expect(result.current.sending).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('defers onTurnSuccess on a stall until the poll proves the server finished', async () => {
    // The success handoff (e.g. a deferred create's onChatCreated) can swap the
    // host surface and unmount the body. On a stall the server may still be
    // generating, so firing it then would unmount mid-generation. It must wait
    // for the doneless commit poll to find the turn (server provably done), then
    // fire exactly once.
    vi.useFakeTimers()
    try {
      const onTurnSuccess = vi.fn()
      const start = Date.now()
      const persisted = {
        id: 'srv-stall2',
        conversationId: 'c1',
        role: 'assistant' as const,
        content: 'The turn the server finished after the client gave up.',
        createdAt: new Date().toISOString(),
      }
      const listMessages = vi.fn(async () =>
        Date.now() - start >= 90_000 ? [persisted] : [],
      )
      const api = {
        // Lead-in then hang forever — the idle watchdog stalls the dead stream.
        streamMessage: () =>
          (async function* (): AsyncGenerator<ChatStreamEvent> {
            yield { type: 'text', delta: 'Working on it' }
            await new Promise<void>(() => undefined)
          })(),
        listMessages,
      }

      const { result } = renderHook(() =>
        useStreamingTurn(api, { toolLabel: () => null, onTurnSuccess }),
      )

      let sendPromise!: Promise<void>
      act(() => {
        sendPromise = result.current.send('c1', 'draft it')
      })
      // Past the 60s idle watchdog but before the turn persists (90s): the
      // stall is detected and the poll is running, but the handoff must wait.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(70_000)
      })
      expect(onTurnSuccess).not.toHaveBeenCalled()

      // Past persistence — the poll finds the turn, so the handoff fires once.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(130_000)
        await sendPromise
      })
      expect(onTurnSuccess).toHaveBeenCalledTimes(1)
      expect(result.current.messages.some((m) => m.id === 'srv-stall2')).toBe(
        true,
      )
      expect(result.current.sending).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
