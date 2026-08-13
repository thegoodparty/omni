import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import type { Campaign } from 'helpers/types'

const clientRequestMock = vi.fn()
const useCampaignMock = vi.fn()

vi.mock('gpApi/typed-request', () => ({
  clientRequest: (...args: unknown[]) => clientRequestMock(...args),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => useCampaignMock(),
}))

import { useDoorScript } from './useDoorScript'

const campaign = (overrides: Partial<Campaign> = {}) =>
  ({
    id: 7,
    firstName: 'Jane',
    lastName: 'Doe',
    positionName: 'City Council',
    ...overrides,
  }) as Campaign

const wrapper = function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return React.createElement(QueryClientProvider, { client }, children)
}

beforeEach(() => {
  clientRequestMock.mockReset()
  useCampaignMock.mockReset()
  useCampaignMock.mockReturnValue([campaign()])
  clientRequestMock.mockResolvedValue({ data: [] })
})

describe('useDoorScript', () => {
  it('merges the campaign positions with the custom issues', async () => {
    useCampaignMock.mockReturnValue([
      campaign({
        details: {
          customIssues: [{ title: 'Transit', position: 'Restore the bus.' }],
        },
      } as Partial<Campaign>),
    ])
    clientRequestMock.mockResolvedValue({
      data: [
        {
          id: 1,
          description: 'Fund the shelter.',
          order: 0,
          topIssue: { id: 5, name: 'Housing' },
          position: null,
        },
      ],
    })

    const { result } = renderHook(() => useDoorScript(), { wrapper })

    expect(result.current.intro).toBe(
      "Hi, I'm Jane Doe, running for City Council.",
    )
    await waitFor(() =>
      expect(result.current.issues.map((issue) => issue.title)).toEqual([
        'Housing',
        'Transit',
      ]),
    )
  })

  it('asks for the positions of the campaign in context', async () => {
    renderHook(() => useDoorScript(), { wrapper })

    await waitFor(() =>
      expect(clientRequestMock).toHaveBeenCalledWith(
        'GET /v1/campaigns/:id/positions',
        { id: '7' },
      ),
    )
  })

  // A canvasser mid-walk should not lose the whole sheet because one read for
  // talking points failed, so the intro still renders from campaign context.
  it('keeps the intro when the positions request fails', async () => {
    clientRequestMock.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useDoorScript(), { wrapper })

    await waitFor(() => expect(clientRequestMock).toHaveBeenCalled())
    expect(result.current.intro).toBe(
      "Hi, I'm Jane Doe, running for City Council.",
    )
    expect(result.current.issues).toEqual([])
  })

  it('does not fetch before the campaign is known', () => {
    useCampaignMock.mockReturnValue([undefined])

    const { result } = renderHook(() => useDoorScript(), { wrapper })

    expect(clientRequestMock).not.toHaveBeenCalled()
    expect(result.current).toEqual({ intro: '', issues: [] })
  })
})
