import { CallHandler, ExecutionContext } from '@nestjs/common'
import { Observable, lastValueFrom } from 'rxjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SERVICE_READ_MAX_IN_FLIGHT,
  SERVICE_READ_MAX_WAIT_MS,
  ServiceReadConcurrencyInterceptor,
} from './serviceReadConcurrency.interceptor'

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
    const { handler } = deferredHandler()
    for (let i = 0; i < SERVICE_READ_MAX_IN_FLIGHT; i++) {
      void lastValueFrom(interceptor.intercept(contextFor(machine), handler))
    }
    const waiting = lastValueFrom(
      interceptor.intercept(contextFor(machine), handler),
    )
    const assertion = expect(waiting).rejects.toThrow('Election data is busy')
    await vi.advanceTimersByTimeAsync(SERVICE_READ_MAX_WAIT_MS)
    await assertion
  })
})
