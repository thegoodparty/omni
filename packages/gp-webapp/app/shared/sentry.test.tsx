import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { faro, currentUser } = vi.hoisted(() => ({
  faro: {
    api: { pushError: vi.fn(), setUser: vi.fn() },
    pause: vi.fn(),
  },
  currentUser: { value: { id: 7, email: 'candidate@example.com' } },
}))

vi.mock('@grafana/faro-web-sdk', () => ({ faro }))
vi.mock('./hooks/useUser', () => ({ useUser: () => [currentUser.value] }))
vi.mock('./hooks/useCampaign', () => ({
  useCampaign: () => [{ slug: 'jane-for-council' }],
}))
vi.mock('./organization-picker', () => ({
  useOrganization: () => ({ slug: 'org-jane' }),
}))

import { reportErrorToSentry, SentryIdentifier } from './sentry'

describe('reportErrorToSentry', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pushes the error to Faro with its attributes as string context', () => {
    const error = new Error('Connection closed')

    reportErrorToSentry(error, { step: 'priorities', attempt: 2 })

    expect(faro.api.pushError).toHaveBeenCalledWith(error, {
      context: { step: 'priorities', attempt: '2' },
    })
  })

  it('wraps a thrown non-Error so Faro still gets a message', () => {
    reportErrorToSentry('plain string')

    expect(faro.api.pushError.mock.calls[0]?.[0]).toEqual(
      new Error('plain string'),
    )
  })
})

describe('SentryIdentifier', () => {
  beforeEach(() => vi.clearAllMocks())

  it('identifies the user to Faro with their campaign and organization', () => {
    currentUser.value = { id: 7, email: 'candidate@example.com' }

    render(<SentryIdentifier />)

    expect(faro.api.setUser).toHaveBeenCalledWith({
      id: '7',
      email: 'candidate@example.com',
      attributes: {
        campaignSlug: 'jane-for-council',
        organizationSlug: 'org-jane',
      },
    })
    expect(faro.pause).not.toHaveBeenCalled()
  })

  it('stops Faro for a test user instead of identifying them', () => {
    currentUser.value = { id: 8, email: 'e2e-123@test.goodparty.org' }

    render(<SentryIdentifier />)

    expect(faro.pause).toHaveBeenCalled()
    expect(faro.api.setUser).not.toHaveBeenCalled()
  })
})
