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

  // A 401 is a session the tab no longer has, and the request layer already
  // sends the user to sign in: reporting it made each dead session file a "new
  // front-end error" alert (ENG-11674).
  it('does not report a 401 as a client error', () => {
    reportClientError(
      {
        message: '[GET] "/api/v1/onboarding/voter-issues": 401',
        response: { status: 401 },
      },
      { context: 'onboarding.voterIssues.fetch' },
    )

    expect(faro.api.pushError).not.toHaveBeenCalled()
  })
})
