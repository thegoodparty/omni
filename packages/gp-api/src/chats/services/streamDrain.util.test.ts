import { EventEmitter } from 'events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type DrainableStream, waitForDrain } from './streamDrain.util'

const asStream = (e: EventEmitter): DrainableStream =>
  e as unknown as DrainableStream

describe('waitForDrain', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("resolves 'drained' when the stream emits drain", async () => {
    const stream = new EventEmitter()
    const ac = new AbortController()
    const p = waitForDrain(asStream(stream), ac.signal, 10_000)
    stream.emit('drain')
    await expect(p).resolves.toBe('drained')
  })

  it("resolves 'drained' on a terminal close event", async () => {
    const stream = new EventEmitter()
    const ac = new AbortController()
    const p = waitForDrain(asStream(stream), ac.signal, 10_000)
    stream.emit('close')
    await expect(p).resolves.toBe('drained')
  })

  it("resolves 'drained' on a terminal error event", async () => {
    const stream = new EventEmitter()
    const ac = new AbortController()
    const p = waitForDrain(asStream(stream), ac.signal, 10_000)
    // EventEmitter throws on an unhandled 'error'; the util registers a handler,
    // so emitting it must resolve the wait rather than crash.
    stream.emit('error')
    await expect(p).resolves.toBe('drained')
  })

  it("resolves 'drained' when the abort signal fires", async () => {
    const stream = new EventEmitter()
    const ac = new AbortController()
    const p = waitForDrain(asStream(stream), ac.signal, 10_000)
    ac.abort()
    await expect(p).resolves.toBe('drained')
  })

  it('resolves immediately when the signal is already aborted', async () => {
    const stream = new EventEmitter()
    const ac = new AbortController()
    ac.abort()
    await expect(
      waitForDrain(asStream(stream), ac.signal, 10_000),
    ).resolves.toBe('drained')
  })

  it("resolves 'stalled' after timeoutMs when the socket never drains", async () => {
    vi.useFakeTimers()
    const stream = new EventEmitter()
    const ac = new AbortController()
    const p = waitForDrain(asStream(stream), ac.signal, 15_000)
    await vi.advanceTimersByTimeAsync(15_001)
    // A connected-but-non-draining client (idle/backgrounded tab) must not
    // wedge the response until the request timeout — it reports 'stalled' so
    // the caller can stop respecting backpressure.
    await expect(p).resolves.toBe('stalled')
  })

  it('clears the stall timer once drained (no late resolution / leak)', async () => {
    vi.useFakeTimers()
    const stream = new EventEmitter()
    const ac = new AbortController()
    const p = waitForDrain(asStream(stream), ac.signal, 15_000)
    stream.emit('drain')
    await expect(p).resolves.toBe('drained')
    // Advancing past the timeout must not throw or change the settled value.
    await vi.advanceTimersByTimeAsync(20_000)
  })
})
