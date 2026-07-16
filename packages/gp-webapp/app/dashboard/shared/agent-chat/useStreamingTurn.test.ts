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

    expect(onError).toHaveBeenCalledWith('boom')
    expect(result.current.sending).toBe(false)
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
})
