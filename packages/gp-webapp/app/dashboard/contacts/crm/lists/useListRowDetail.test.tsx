import { describe, it, expect, vi } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useListRowDetail } from './useListRowDetail'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'campaign-1' }),
}))

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
)

const detailResponse = {
  demographics: {
    people: 250,
    avgAge: 44,
    avgIncome: 60000,
  },
  reachability: {
    sms: 100,
    robocall: 100,
    phoneBanking: 100,
    doorKnocking: 100,
    polls: 100,
  },
  outreachHistory: [],
}

describe('useListRowDetail', () => {
  it('fires no request when disabled', async () => {
    const onRequest = vi.fn()
    api.mock('GET /v1/contacts/list-detail', () => {
      onRequest()
      return { status: 200, data: detailResponse }
    })

    const { result } = renderHook(() => useListRowDetail(42, false), {
      wrapper,
    })

    await waitFor(() => expect(result.current.isGated).toBe(true))
    expect(onRequest).not.toHaveBeenCalled()
    expect(result.current.peopleCount).toBeUndefined()
  })

  it('fires the request when enabled', async () => {
    const onRequest = vi.fn()
    api.mock('GET /v1/contacts/list-detail', () => {
      onRequest()
      return { status: 200, data: detailResponse }
    })

    const { result } = renderHook(() => useListRowDetail(43, true), {
      wrapper,
    })

    await waitFor(() => expect(result.current.peopleCount).toBe(250))
    expect(onRequest).toHaveBeenCalledTimes(1)
    expect(result.current.isGated).toBe(false)
  })
})
