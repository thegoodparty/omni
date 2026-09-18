import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import React from 'react'
import type { Campaign, User } from 'helpers/types'

const state = vi.hoisted(() => ({
  user: null as unknown,
  campaign: null as unknown,
}))

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [state.user],
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [state.campaign],
}))
vi.mock('./useStrategicLandscape', () => ({
  useStrategicLandscape: () => ({
    data: undefined,
    isPending: false,
    isGenerating: false,
    isError: false,
  }),
}))
// Disabled query options so the hook never issues network calls — this file
// only exercises the derivation of plan fields from user/campaign state.
vi.mock('../../components/LocalNewsSourcesSection', () => ({
  localNewsQueryOptions: () => ({
    queryKey: ['test-local-news'],
    queryFn: async () => null,
    enabled: false,
  }),
}))
vi.mock('../../components/TopVoterIssuesSection', () => ({
  voterIssuesQueryOptions: () => ({
    queryKey: ['test-voter-issues'],
    queryFn: async () => null,
    enabled: false,
  }),
}))

import { useCampaignPlanData } from './useCampaignPlanData'

const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(
    QueryClientProvider,
    {
      client: new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
    },
    children,
  )

const viewer = { firstName: 'Derek', lastName: 'Lane' } as User

const campaignOwnedByJared = {
  id: 1,
  ownerName: 'Jared Smith',
  details: {},
} as Campaign

describe('useCampaignPlanData candidateName', () => {
  beforeEach(() => {
    state.user = viewer
    state.campaign = campaignOwnedByJared
  })

  it("uses the campaign owner's name, not the viewer's (team member viewing)", () => {
    const { result } = renderHook(() => useCampaignPlanData(null), { wrapper })

    expect(result.current.plan.candidateName).toBe('Jared Smith')
  })

  it('falls back to the session user while ownerName is absent', () => {
    state.campaign = { id: 1, ownerName: null, details: {} } as Campaign

    const { result } = renderHook(() => useCampaignPlanData(null), { wrapper })

    expect(result.current.plan.candidateName).toBe('Derek Lane')
  })

  it('falls back to the session user while the campaign has not resolved', () => {
    state.campaign = null

    const { result } = renderHook(() => useCampaignPlanData(null), { wrapper })

    expect(result.current.plan.candidateName).toBe('Derek Lane')
  })
})
