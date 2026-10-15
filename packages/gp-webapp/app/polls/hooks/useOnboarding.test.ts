import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { api } from 'helpers/test-utils/api-mocking'
import {
  personElectQuestion,
  sworninQuestion,
} from '../onboarding/components/DemoMessageText'
import { useOnboarding } from './useOnboarding'

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ id: 1, firstName: 'Ada', lastName: 'Lovelace' }],
}))
vi.mock('@shared/hooks/usePositionName', () => ({
  usePositionName: () => 'City Council Member',
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const submitWith = async (swornInDate: Date) => {
  let body: unknown
  api.mock('POST /v1/polls/initial-poll', (request) => {
    body = request.body
    return {
      status: 200,
      data: { outreachId: 7, recipientCount: 500, amountCents: 0 },
    }
  })
  const { result } = renderHook(() => useOnboarding())
  act(() => {
    result.current.setSwornInDate(swornInDate)
    result.current.setScheduledDate(new Date(2030, 0, 15))
  })
  let created: unknown
  await act(async () => {
    created = await result.current.submitOnboarding()
  })
  return { body, created, result }
}

describe('useOnboarding', () => {
  it('sends the question and the local dates, and returns the created poll', async () => {
    const { body, created } = await submitWith(new Date(2020, 5, 1))

    expect(body).toEqual({
      question: sworninQuestion,
      swornInDate: '2020-06-01',
      scheduledLocalDate: '2030-01-15',
    })
    expect(created).toEqual({
      outreachId: 7,
      recipientCount: 500,
      amountCents: 0,
    })
  })

  it('asks the newly elected question before the swearing in date', async () => {
    const { body } = await submitWith(new Date(2031, 5, 1))

    expect(body).toMatchObject({ question: personElectQuestion })
  })

  it('previews the composed text with a name where the merge tag goes', async () => {
    const { result } = await submitWith(new Date(2020, 5, 1))

    expect(result.current.demoMessageText).toBe(
      `Hi Jane, this is Ada Lovelace, City Council Member. ${sworninQuestion} Reply STOP to opt out.`,
    )
  })
})
