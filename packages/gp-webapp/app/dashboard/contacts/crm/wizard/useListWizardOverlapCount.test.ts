import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import React from 'react'
import { api } from 'helpers/test-utils/api-mocking'
import { useListWizardOverlapCount } from './useListWizardOverlapCount'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))

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

// Mirrors the 600ms debounce window with slack (useListWizardCount.test.ts
// precedent).
const debounceSettle = () => new Promise((resolve) => setTimeout(resolve, 700))

describe('useListWizardOverlapCount — debounce', () => {
  it('coalesces a burst of rapid payload changes into a single request for the final value', async () => {
    const bodies: Array<Record<string, unknown>> = []
    api.mock('POST /v1/contacts/overlap-count', ({ body }) => {
      bodies.push(body as Record<string, unknown>)
      return { status: 200, data: { count: 12, fenced: false } }
    })

    const qc = newClient()
    const { rerender } = renderHook(
      ({ payload }) => useListWizardOverlapCount(payload, true),
      {
        wrapper: wrapper(qc),
        initialProps: {
          payload: { genderMale: true } as Record<string, unknown>,
        },
      },
    )

    rerender({ payload: { genderMale: true, genderFemale: true } })
    rerender({
      payload: { genderMale: true, genderFemale: true, ageUnknown: true },
    })

    await debounceSettle()

    expect(bodies).toEqual([
      { genderMale: true },
      { genderMale: true, genderFemale: true, ageUnknown: true },
    ])
  })

  it('does not fire while disabled (e.g. no saved lists / no selection)', async () => {
    const overlapRequest = vi.fn()
    api.mock('POST /v1/contacts/overlap-count', () => {
      overlapRequest()
      return { status: 200, data: { count: 1, fenced: false } }
    })

    const qc = newClient()
    renderHook(() => useListWizardOverlapCount({ genderMale: true }, false), {
      wrapper: wrapper(qc),
    })

    await debounceSettle()
    expect(overlapRequest).not.toHaveBeenCalled()
  })
})

describe('useListWizardOverlapCount — isStale', () => {
  it('flags a payload change as stale until the debounce settles', async () => {
    api.mock('POST /v1/contacts/overlap-count', {
      status: 200,
      data: { count: 7, fenced: false },
    })

    const qc = newClient()
    const { result, rerender } = renderHook(
      ({ payload }) => useListWizardOverlapCount(payload, true),
      {
        wrapper: wrapper(qc),
        initialProps: {
          payload: { genderMale: true } as Record<string, unknown>,
        },
      },
    )

    await waitFor(() => expect(result.current.isStale).toBe(false))

    rerender({ payload: { genderFemale: true } })
    expect(result.current.isStale).toBe(true)

    await waitFor(() => expect(result.current.isStale).toBe(false))
  })
})

describe('useListWizardOverlapCount — fenced', () => {
  it('surfaces the fenced flag from the overlap-count response', async () => {
    api.mock('POST /v1/contacts/overlap-count', {
      status: 200,
      data: { count: 10000, fenced: true },
    })

    const qc = newClient()
    const { result } = renderHook(
      () => useListWizardOverlapCount({ genderMale: true }, true),
      { wrapper: wrapper(qc) },
    )

    await waitFor(() => expect(result.current.count).toBe(10000))
    expect(result.current.fenced).toBe(true)
  })
})

describe('useListWizardOverlapCount — errors', () => {
  it('surfaces isError without throwing, for the strip to hide on', async () => {
    api.mock('POST /v1/contacts/overlap-count', {
      status: 500,
      data: { message: 'server exploded' },
    })

    const qc = newClient()
    const { result } = renderHook(
      () => useListWizardOverlapCount({ genderMale: true }, true),
      { wrapper: wrapper(qc) },
    )

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.count).toBeUndefined()
  })
})
