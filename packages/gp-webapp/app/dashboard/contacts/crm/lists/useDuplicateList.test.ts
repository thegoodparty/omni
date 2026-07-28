import type { ReactNode } from 'react'
import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from 'helpers/test-utils/api-mocking'
import { clientRequest } from 'gpApi/typed-request'
import { useContactsTable } from '../ContactsTableProvider'
import type { SegmentResponse } from '../shared/contacts-types'
import { useDuplicateList } from './useDuplicateList'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))
vi.mock('../ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
  }),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const mockedUseContactsTable = vi.mocked(useContactsTable)
const selectList = vi.fn()

const newClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

const wrapper = (qc: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children)
  }

// Mounts an active observer on the exact same ['custom-segments', orgSlug]
// key useDuplicateList invalidates, so invalidateQueries' default
// refetchType: 'active' actually has something to await — mirroring
// ContactsTableProvider's always-mounted customSegmentsQuery in the real app
// (without this, invalidateQueries would see no active query and resolve
// immediately regardless of the network, masking the ordering bug).
const useHarness = (segment: SegmentResponse) => {
  useQuery({
    queryKey: ['custom-segments', 'test-org'],
    queryFn: () =>
      clientRequest('GET /v1/voters/voter-file/filters', {}).then(
        (res) => res.data,
      ),
  })
  const mutation = useDuplicateList()
  return { mutation, mutate: () => mutation.mutate(segment) }
}

const segment: SegmentResponse = {
  id: 42,
  name: 'Doorknocking campaign',
  firstUsedForOutreachAt: null,
}

describe('useDuplicateList — navigation must not wait on the index refetch (ENG-10777)', () => {
  beforeEach(() => {
    selectList.mockClear()
    mockedUseContactsTable.mockReturnValue({
      selectList,
      isWinContext: true,
      isWinContextReady: true,
    } as unknown as ReturnType<typeof useContactsTable>)
  })

  it('calls selectList with the new id promptly, before a slow custom-segments refetch resolves', async () => {
    let postCalled = false
    api.mock('POST /v1/voters/voter-file/filter', () => {
      postCalled = true
      return {
        status: 200,
        data: { id: 999, name: 'Doorknocking campaign (copy)' },
      }
    })

    let resolveSegmentsFetch: (() => void) | undefined
    const segmentsFetchGate = new Promise<void>((resolve) => {
      resolveSegmentsFetch = resolve
    })
    api.mock('GET /v1/voters/voter-file/filters', async () => {
      await segmentsFetchGate
      return { status: 200, data: [segment] }
    })

    const qc = newClient()
    const { result } = renderHook(() => useHarness(segment), {
      wrapper: wrapper(qc),
    })

    act(() => {
      result.current.mutate()
    })

    // The duplicate POST (the copy is created server-side) resolves well
    // before the slow custom-segments GET the invalidation kicked off — the
    // prod shape of the bug: a slow list-index round trip after a fast
    // create.
    await waitFor(() => expect(postCalled).toBe(true))

    // selectList must fire as soon as the copy exists, independent of the
    // (possibly slow) index refetch — react-query's mutation state machine
    // awaits the whole onSuccess callback before dispatching "success"
    // (query-core mutation.js: `await this.options.onSuccess?.(...)`
    // precedes `dispatch({ type: "success" })`), so an `await
    // invalidateQueries(...)` placed before `selectList(...)` inside
    // onSuccess leaves both the navigation AND the mutation's own
    // `isPending` (the button's loading/disabled prop in both
    // ListCard.tsx and ListDetailSheet.tsx) hostage to that refetch.
    await waitFor(() => expect(selectList).toHaveBeenCalledWith(999))
    expect(result.current.mutation.isPending).toBe(false)

    resolveSegmentsFetch?.()
  })
})
