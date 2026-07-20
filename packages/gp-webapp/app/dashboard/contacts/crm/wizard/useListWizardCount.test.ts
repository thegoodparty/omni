import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import React from 'react'
import { api } from 'helpers/test-utils/api-mocking'
import { useListWizardCount } from './useListWizardCount'

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

// Mirrors the debounce window (600ms) with slack, same pattern as
// ContactTypeahead.test.tsx's debounceSettle helper.
const debounceSettle = () => new Promise((resolve) => setTimeout(resolve, 700))

describe('useListWizardCount — debounce', () => {
  it('coalesces a burst of rapid payload changes into a single request for the final value', async () => {
    const bodies: Array<Record<string, unknown>> = []
    api.mock('POST /v1/contacts/count', ({ body }) => {
      bodies.push(body as Record<string, unknown>)
      return { status: 200, data: { count: 42 } }
    })

    const qc = newClient()
    // The initial payload fires immediately (mirrors FiltersSheet's identical
    // useState(payload) seed — no artificial delay on first mount). The two
    // rapid rerenders that follow, within the same debounce window, must
    // coalesce into exactly one more request for the final value.
    const { rerender } = renderHook(
      ({ payload }) => useListWizardCount(payload, true),
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

  it('does not fire while disabled', async () => {
    const countRequest = vi.fn()
    api.mock('POST /v1/contacts/count', () => {
      countRequest()
      return { status: 200, data: { count: 1 } }
    })

    const qc = newClient()
    renderHook(() => useListWizardCount({ genderMale: true }, false), {
      wrapper: wrapper(qc),
    })

    await debounceSettle()
    expect(countRequest).not.toHaveBeenCalled()
  })
})

describe('useListWizardCount — stale response sequencing', () => {
  it('never renders a slower response for a superseded payload over a fresher one', async () => {
    let releaseSlow!: () => void
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })
    api.mock('POST /v1/contacts/count', async ({ body }) => {
      const payload = body as Record<string, unknown>
      if (payload.genderMale) {
        await slowGate
        return { status: 200, data: { count: 999 } }
      }
      return { status: 200, data: { count: 5 } }
    })

    const qc = newClient()
    const { result, rerender } = renderHook(
      ({ payload }) => useListWizardCount(payload, true),
      {
        wrapper: wrapper(qc),
        initialProps: {
          payload: { genderMale: true } as Record<string, unknown>,
        },
      },
    )

    await debounceSettle()

    // Supersede before the slow response resolves.
    rerender({ payload: { genderFemale: true } })
    await debounceSettle()

    await waitFor(() => expect(result.current.count).toBe(5))

    releaseSlow()
    await debounceSettle()

    // The slow, superseded response must not overwrite the current total.
    expect(result.current.count).toBe(5)
  })
})

describe('useListWizardCount — cap-error mapping', () => {
  beforeEach(() => {
    api.reset()
  })

  it('maps a 400 from the count endpoint to friendly cap guidance, not a crash', async () => {
    api.mock('POST /v1/contacts/count', {
      status: 400,
      data: {
        message:
          'This filter resolves too many people to apply directly — narrow the activity conditions or support status selection.',
      },
    })

    const qc = newClient()
    const { result } = renderHook(
      () => useListWizardCount({ activityConditions: [] }, true),
      { wrapper: wrapper(qc) },
    )

    await waitFor(() => expect(result.current.isCapError).toBe(true))
    expect(result.current.errorMessage).toMatch(/too many people/i)
    expect(result.current.count).toBeUndefined()
  })

  it('does not mark a non-cap error as a cap error', async () => {
    api.mock('POST /v1/contacts/count', {
      status: 500,
      data: { message: 'server exploded' },
    })

    const qc = newClient()
    const { result } = renderHook(
      () => useListWizardCount({ genderMale: true }, true),
      { wrapper: wrapper(qc) },
    )

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.isCapError).toBe(false)
    expect(result.current.errorMessage).toBeUndefined()
  })
})
