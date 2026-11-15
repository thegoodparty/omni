import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { snoozeElectionResult } from 'app/dashboard/election-result/dismissal'
import {
  useElectionResultChat,
  type ElectionResultChat,
} from './useElectionResultChat'

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: 'Sarah' }],
}))
vi.mock('@shared/hooks/usePositionName', () => ({
  usePositionName: () => 'Maplewood City Council',
}))
vi.mock('@shared/hooks/useIsImpersonating', () => ({
  useIsImpersonating: () => false,
}))
vi.mock('app/onboarding/shared/ajaxActions', () => ({
  updateCampaign: vi.fn(),
}))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn() }),
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ id: 9, details: { electionDate: '2026-11-03' } }],
}))
vi.mock('helpers/dateHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/dateHelper')>()),
  weeksTill: () => ({ weeks: -1, days: 6 }),
}))

const renders: ElectionResultChat[] = []
const Probe = (): null => {
  renders.push(useElectionResultChat())
  return null
}

describe('useElectionResultChat on a client mount', () => {
  beforeEach(() => {
    renders.length = 0
    window.localStorage.clear()
  })

  // Home remounts on every client navigation with the plan already cached, so
  // a question that only turns on after mount lets the plan's task show first.
  it('is pending from the first render', () => {
    render(<Probe />)

    expect(renders[0]?.pending).toBe(true)
  })

  it('never asks a campaign that snoozed it', () => {
    snoozeElectionResult(9)
    render(<Probe />)

    expect(renders.map((r) => r.pending)).not.toContain(true)
  })

  it('stops asking once snoozed here', () => {
    render(<Probe />)

    act(() => renders.at(-1)?.snooze())

    expect(renders.at(-1)?.pending).toBe(false)
  })
})
