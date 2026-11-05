import { CallHandler, ExecutionContext } from '@nestjs/common'
import { Observable, lastValueFrom } from 'rxjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EVENT_LOOP_LAG_SHED_MS, recentEventLoopLagMs } from './eventLoopLag'
import {
  SERVICE_READ_MAX_IN_FLIGHT,
  SERVICE_READ_MAX_WAIT_MS,
  ServiceReadConcurrencyInterceptor,
} from './serviceReadConcurrency.interceptor'

vi.mock('./eventLoopLag', () => ({
  EVENT_LOOP_LAG_SHED_MS: 500,
  recentEventLoopLagMs: vi.fn(() => 0),
}))

const contextFor = (req: object) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext

const machine = { serviceReader: {} }

function deferredHandler() {
  let finish: () => void = () => undefined
  const gate = new Promise<void>((resolve) => (finish = resolve))
  const started = vi.fn()
  const handler: CallHandler = {
    handle: () => {
      started()
      return new Observable<string>((sub) => {
        void gate.then(() => {
          sub.next('ok')
          sub.complete()
        })
      })
    },
  }
  return { handler, finish, started }
}

describe('ServiceReadConcurrencyInterceptor', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(recentEventLoopLagMs).mockReturnValue(0)
  })

  it('refuses machine reads while the event loop lags, and still serves humans', async () => {
    vi.mocked(recentEventLoopLagMs).mockReturnValue(EVENT_LOOP_LAG_SHED_MS + 1)
    const interceptor = new ServiceReadConcurrencyInterceptor()
    const { handler, finish, started } = deferredHandler()
    await expect(
      lastValueFrom(interceptor.intercept(contextFor(machine), handler)),
    ).rejects.toThrow('Election data is busy')
    await expect(
      lastValueFrom(
        interceptor.intercept(contextFor({ m2mToken: {} }), handler),
      ),
    ).rejects.toThrow('Election data is busy')
    const human = lastValueFrom(interceptor.intercept(contextFor({}), handler))
    finish()
    await human
    expect(started).toHaveBeenCalledTimes(1)
  })

  it('serves machine reads while the event loop is healthy', async () => {
    const interceptor = new ServiceReadConcurrencyInterceptor()
    const { handler, finish } = deferredHandler()
    const run = lastValueFrom(
      interceptor.intercept(contextFor(machine), handler),
    )
    finish()
    await expect(run).resolves.toBe('ok')
  })

  it('does not gate human callers', async () => {
    const interceptor = new ServiceReadConcurrencyInterceptor()
    const { handler, finish, started } = deferredHandler()
    const runs = Array.from({ length: SERVICE_READ_MAX_IN_FLIGHT + 5 }, () =>
      lastValueFrom(interceptor.intercept(contextFor({}), handler)),
    )
    expect(started).toHaveBeenCalledTimes(SERVICE_READ_MAX_IN_FLIGHT + 5)
    finish()
    await Promise.all(runs)
  })

  it('holds machine reads over the cap until a slot frees', async () => {
    const interceptor = new ServiceReadConcurrencyInterceptor()
    const { handler, finish, started } = deferredHandler()
    const runs = Array.from({ length: SERVICE_READ_MAX_IN_FLIGHT + 5 }, () =>
      lastValueFrom(interceptor.intercept(contextFor(machine), handler)),
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toHaveBeenCalledTimes(SERVICE_READ_MAX_IN_FLIGHT)
    finish()
    await expect(Promise.all(runs)).resolves.toHaveLength(
      SERVICE_READ_MAX_IN_FLIGHT + 5,
    )
    expect(started).toHaveBeenCalledTimes(SERVICE_READ_MAX_IN_FLIGHT + 5)
  })

  it('refuses a machine read that waits past the cap', async () => {
    vi.useFakeTimers()
    const interceptor = new ServiceReadConcurrencyInterceptor()
    const { handler, finish } = deferredHandler()
    const held = Array.from({ length: SERVICE_READ_MAX_IN_FLIGHT }, () =>
      lastValueFrom(interceptor.intercept(contextFor(machine), handler)),
    )
    const waiting = lastValueFrom(
      interceptor.intercept(contextFor(machine), handler),
    )
    const assertion = expect(waiting).rejects.toThrow('Election data is busy')
    await vi.advanceTimersByTimeAsync(SERVICE_READ_MAX_WAIT_MS)
    await assertion
    finish()
    await Promise.all(held)
  })

  it('shares one budget across interceptor instances', async () => {
    const { handler, finish, started } = deferredHandler()
    const held = Array.from({ length: SERVICE_READ_MAX_IN_FLIGHT }, () =>
      lastValueFrom(
        new ServiceReadConcurrencyInterceptor().intercept(
          contextFor(machine),
          handler,
        ),
      ),
    )
    const extra = lastValueFrom(
      new ServiceReadConcurrencyInterceptor().intercept(
        contextFor(machine),
        handler,
      ),
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toHaveBeenCalledTimes(SERVICE_READ_MAX_IN_FLIGHT)
    finish()
    await Promise.all([...held, extra])
    expect(started).toHaveBeenCalledTimes(SERVICE_READ_MAX_IN_FLIGHT + 1)
  })
})
