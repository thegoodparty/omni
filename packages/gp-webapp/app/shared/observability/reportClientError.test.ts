import { beforeEach, describe, expect, it, vi } from 'vitest'

const { faro } = vi.hoisted(() => ({
  faro: { api: { pushError: vi.fn() } },
}))

vi.mock('@grafana/faro-web-sdk', () => ({ faro }))

import { reportClientError } from './reportClientError'

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
