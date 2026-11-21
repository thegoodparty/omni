import { beforeEach, describe, expect, it, vi } from 'vitest'

const { faro, LogLevel } = vi.hoisted(() => ({
  faro: { api: { pushError: vi.fn(), pushLog: vi.fn() } },
  LogLevel: { WARN: 'warn' },
}))

vi.mock('@grafana/faro-web-sdk', () => ({ faro, LogLevel }))

import {
  reportClientError,
  reportClientInterruption,
} from './reportClientError'

describe('reportClientError', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pushes the error to Faro with its attributes as string context', () => {
    const error = new Error('Connection closed')

    reportClientError(error, { step: 'priorities', attempt: 2 })

    expect(faro.api.pushError).toHaveBeenCalledWith(error, {
      context: { step: 'priorities', attempt: '2' },
    })
  })

  it('wraps a thrown non-Error so Faro still gets a message', () => {
    reportClientError('plain string')

    expect(faro.api.pushError.mock.calls[0]?.[0]).toEqual(
      new Error('plain string'),
    )
  })
})

describe('reportClientInterruption', () => {
  beforeEach(() => vi.clearAllMocks())

  // A dropped connection is a log line, never an exception: the exception
  // stream is what the front-end error alerts page on (ENG-11724).
  it('logs it at warn level and pushes no exception', () => {
    reportClientInterruption('chat stream interrupted', {
      surface: 'campaign-manager-chat',
      step: 'iterate',
    })

    expect(faro.api.pushLog).toHaveBeenCalledWith(['chat stream interrupted'], {
      level: 'warn',
      context: { surface: 'campaign-manager-chat', step: 'iterate' },
    })
    expect(faro.api.pushError).not.toHaveBeenCalled()
  })
})
