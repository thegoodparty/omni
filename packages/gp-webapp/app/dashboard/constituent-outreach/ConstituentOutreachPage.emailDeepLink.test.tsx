import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import ConstituentOutreachPage from './ConstituentOutreachPage'

// The import's "Back to your email" lands here as `?compose=email`.
// EmailFlow is stubbed: the assertion is that the page opens it as a
// return from the import (EmailFlow.test.tsx covers what that restores).

vi.mock('@shared/experiments/serveEmailOutreachFlag', () => ({
  useServeEmailOutreachFlag: () => ({ ready: true, enabled: true }),
}))

vi.mock('app/dashboard/outreach/v2/email/EmailFlow', () => ({
  EmailFlow: ({
    open,
    resumeImport,
  }: {
    open: boolean
    resumeImport?: boolean
  }) =>
    open ? (
      <div data-testid="email-flow">{resumeImport ? 'resumed' : 'fresh'}</div>
    ) : null,
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

afterEach(() => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams() as ReturnType<typeof useSearchParams>,
  )
})

describe('ConstituentOutreachPage — ?compose=email', () => {
  it('opens the email flow back from the import and strips the param', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('compose=email') as ReturnType<
        typeof useSearchParams
      >,
    )
    render(<ConstituentOutreachPage outreaches={[]} />)

    expect(await screen.findByTestId('email-flow')).toHaveTextContent('resumed')
    expect(router.replace).toHaveBeenCalledWith(
      '/dashboard/constituent-outreach',
      { scroll: false },
    )
  })
})
