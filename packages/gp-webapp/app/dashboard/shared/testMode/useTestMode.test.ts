import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useTestMode } from './useTestMode'

const {
  mockClientRequest,
  mockSetSelectedSlug,
  mockPush,
  mockRefresh,
  mockClearDismissed,
} = vi.hoisted(() => ({
  mockClientRequest: vi.fn(),
  mockSetSelectedSlug: vi.fn(),
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
  mockClearDismissed: vi.fn(),
}))

vi.mock('gpApi/typed-request', () => ({
  clientRequest: (...args: unknown[]) => mockClientRequest(...args),
}))
vi.mock('@shared/organization-picker', () => ({
  useSetOrganizationSlug: () => mockSetSelectedSlug,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))
vi.mock('app/dashboard/election-result/dismissal', () => ({
  clearElectionResultDismissed: () => mockClearDismissed(),
}))

const makeWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  return Wrapper
}

describe('useTestMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClientRequest.mockResolvedValue({
      data: { organizations: [], active: null },
    })
  })

  describe('create mutation', () => {
    it('invalidates all queries, switches org, and navigates to post-auth-redirect for a campaign', async () => {
      mockClientRequest.mockImplementation((route: string) => {
        if (route === 'GET /v1/test-mode')
          return Promise.resolve({ data: { organizations: [], active: null } })
        if (route === 'POST /v1/test-mode/organizations')
          return Promise.resolve({
            data: {
              organizations: [],
              active: { slug: 'test-org-abc', type: 'campaign', families: {} },
            },
          })
        return Promise.resolve({ data: null })
      })

      const { result } = renderHook(() => useTestMode(), {
        wrapper: makeWrapper(),
      })

      await act(async () => {
        result.current.createMutation.mutate({
          type: 'campaign',
          race: { zip: '12345', office: 'City Council' },
          onboarding: 'complete',
          pro: 'off',
          election: 'in_8_weeks',
          tenDlc: 'none',
        })
      })

      await waitFor(() =>
        expect(result.current.createMutation.isSuccess).toBe(true),
      )

      expect(mockSetSelectedSlug).toHaveBeenCalledWith('test-org-abc')
      expect(mockPush).toHaveBeenCalledWith('/post-auth-redirect')
    })

    it('navigates to /serve/onboarding for a not-onboarded elected office', async () => {
      mockClientRequest.mockImplementation((route: string) => {
        if (route === 'GET /v1/test-mode')
          return Promise.resolve({ data: { organizations: [], active: null } })
        if (route === 'POST /v1/test-mode/organizations')
          return Promise.resolve({
            data: {
              organizations: [],
              active: { slug: 'test-eo-xyz', type: 'campaign', families: {} },
            },
          })
        return Promise.resolve({ data: null })
      })

      const { result } = renderHook(() => useTestMode(), {
        wrapper: makeWrapper(),
      })

      await act(async () => {
        result.current.createMutation.mutate({
          type: 'elected_office',
          onboarding: 'not_started',
          term: 'active',
        })
      })

      await waitFor(() =>
        expect(result.current.createMutation.isSuccess).toBe(true),
      )

      expect(mockSetSelectedSlug).toHaveBeenCalledWith('test-eo-xyz')
      expect(mockPush).toHaveBeenCalledWith('/serve/onboarding')
    })
  })

  describe('delete mutation', () => {
    it('invalidates all queries, switches to first remaining org, and navigates to post-auth-redirect', async () => {
      // Set up initial data with two orgs
      mockClientRequest.mockImplementation((route: string) => {
        if (route === 'GET /v1/test-mode') {
          return Promise.resolve({
            data: {
              organizations: [
                {
                  slug: 'org-a',
                  name: 'Test: Org A',
                  type: 'campaign',
                  createdAt: '2024-01-01',
                },
                {
                  slug: 'org-b',
                  name: 'Test: Org B',
                  type: 'campaign',
                  createdAt: '2024-01-02',
                },
              ],
              active: null,
            },
          })
        }
        if (route === 'DELETE /v1/test-mode/organizations/:slug')
          return Promise.resolve({ data: null })
        return Promise.resolve({ data: null })
      })

      const { result } = renderHook(() => useTestMode(), {
        wrapper: makeWrapper(),
      })

      // Wait for initial query to settle
      await waitFor(() => expect(result.current.query.isSuccess).toBe(true))

      await act(async () => {
        result.current.deleteMutation.mutate('org-a')
      })

      await waitFor(() =>
        expect(result.current.deleteMutation.isSuccess).toBe(true),
      )

      // org-b is first remaining
      expect(mockSetSelectedSlug).toHaveBeenCalledWith('org-b')
      expect(mockPush).toHaveBeenCalledWith('/post-auth-redirect')
    })
  })

  describe('apply mutation', () => {
    it('invalidates all queries, clears election result dismissal, and refreshes', async () => {
      mockClientRequest.mockImplementation((route: string) => {
        if (route === 'GET /v1/test-mode')
          return Promise.resolve({ data: { organizations: [], active: null } })
        if (route === 'POST /v1/test-mode/apply')
          return Promise.resolve({ data: null })
        return Promise.resolve({ data: null })
      })

      const { result } = renderHook(() => useTestMode(), {
        wrapper: makeWrapper(),
      })

      await act(async () => {
        result.current.applyMutation.mutate({
          family: 'election',
          preset: 'passed_won',
        })
      })

      await waitFor(() =>
        expect(result.current.applyMutation.isSuccess).toBe(true),
      )

      expect(mockClearDismissed).toHaveBeenCalled()
      expect(mockRefresh).toHaveBeenCalled()
      expect(mockPush).not.toHaveBeenCalled()
    })
  })
})
