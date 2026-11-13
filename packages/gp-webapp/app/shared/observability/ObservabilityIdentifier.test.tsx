import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { faro, currentUser, FakeReplayInstrumentation } = vi.hoisted(() => {
  class FakeReplayInstrumentation {
    constructor(readonly options: Record<string, unknown>) {}
  }
  const added: unknown[] = []
  return {
    FakeReplayInstrumentation,
    faro: {
      api: { setUser: vi.fn() },
      pause: vi.fn(),
      instrumentations: {
        added,
        get instrumentations() {
          return [...added]
        },
        add: vi.fn((instrumentation: unknown) => added.push(instrumentation)),
      },
    },
    currentUser: { value: { id: 7, email: 'candidate@example.com' } },
  }
})

vi.mock('@grafana/faro-web-sdk', () => ({ faro }))
vi.mock('@grafana/faro-instrumentation-replay', () => ({
  ReplayInstrumentation: FakeReplayInstrumentation,
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [currentUser.value],
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ slug: 'jane-for-council' }],
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'org-jane' }),
}))

import { ObservabilityIdentifier } from './ObservabilityIdentifier'

describe('ObservabilityIdentifier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    faro.instrumentations.added.length = 0
  })

  it('identifies the user to Faro with their campaign and organization', () => {
    currentUser.value = { id: 7, email: 'candidate@example.com' }

    render(<ObservabilityIdentifier />)

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

    render(<ObservabilityIdentifier />)

    expect(faro.pause).toHaveBeenCalled()
    expect(faro.api.setUser).not.toHaveBeenCalled()
  })

  it('records a signed-in user with inputs masked and other text visible', () => {
    currentUser.value = { id: 7, email: 'candidate@example.com' }

    render(<ObservabilityIdentifier />)

    expect(faro.instrumentations.add).toHaveBeenCalledTimes(1)
    const replay = faro.instrumentations.add.mock.calls[0]?.[0]
    expect(replay).toBeInstanceOf(FakeReplayInstrumentation)
    expect(replay).toMatchObject({
      options: { maskAllInputs: true, maskTextSelector: undefined },
    })
  })

  it('adds the replay once however often the user is identified', () => {
    currentUser.value = { id: 7, email: 'candidate@example.com' }

    render(<ObservabilityIdentifier />)
    render(<ObservabilityIdentifier />)

    expect(faro.instrumentations.add).toHaveBeenCalledTimes(1)
  })

  it('does not record a test user', () => {
    currentUser.value = { id: 8, email: 'e2e-123@test.goodparty.org' }

    render(<ObservabilityIdentifier />)

    expect(faro.instrumentations.add).not.toHaveBeenCalled()
  })
})
