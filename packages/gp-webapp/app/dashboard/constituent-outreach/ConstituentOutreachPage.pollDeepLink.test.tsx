import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import ConstituentOutreachPage from './ConstituentOutreachPage'

// A community issue's "Run a poll on this issue" lands here as
// `?compose=poll`. PollFlow is stubbed: the assertion is whether the page
// opens it, not what its steps do (PollFlow.test.tsx covers those).

const pollsFlag = vi.hoisted(() => ({ ready: true, enabled: true }))

vi.mock('@shared/experiments/serveSelfServePollsFlag', () => ({
  SERVE_SELF_SERVE_POLLS_FLAG_KEY: 'serve-self-serve-polls',
  useServeSelfServePollsFlag: () => pollsFlag,
}))

vi.mock('app/dashboard/outreach/v2/poll/PollFlow', () => ({
  PollFlow: ({ open }: { open: boolean }) =>
    open ? <div data-testid="poll-flow" /> : null,
}))

vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-test-org' }),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    displaySnackbar: vi.fn(),
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
  }),
}))

const arriveWith = (params: string) => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(params) as ReturnType<typeof useSearchParams>,
  )
}

afterEach(() => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams() as ReturnType<typeof useSearchParams>,
  )
  pollsFlag.ready = true
  pollsFlag.enabled = true
})

describe('ConstituentOutreachPage — ?compose=poll', () => {
  it('opens the poll flow and strips the param', async () => {
    arriveWith('compose=poll')
    render(<ConstituentOutreachPage outreaches={[]} />)

    expect(await screen.findByTestId('poll-flow')).toBeInTheDocument()
    expect(router.replace).toHaveBeenCalledWith(
      '/dashboard/constituent-outreach',
      { scroll: false },
    )
  })

  it('opens nothing when the polls flag is off', async () => {
    pollsFlag.enabled = false
    arriveWith('compose=poll')
    render(<ConstituentOutreachPage outreaches={[]} />)

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        '/dashboard/constituent-outreach',
        { scroll: false },
      ),
    )
    expect(screen.queryByTestId('poll-flow')).not.toBeInTheDocument()
  })
})
