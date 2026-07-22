import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { OutreachPage } from './OutreachPage'
import type { Campaign } from 'helpers/types'

vi.mock('../../shared/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock('./OutreachHeader', () => ({ OutreachHeader: () => null }))
vi.mock('./FreeTextsBanner', () => ({ default: () => null }))
vi.mock('./OutreachComposeDeepLink', () => ({
  OutreachComposeDeepLink: () => null,
}))
vi.mock('app/dashboard/outreach/components/OutreachTable', () => ({
  OutreachTable: () => null,
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))
vi.mock('./OutreachCreateCards', () => ({
  default: ({ preselectedListId }: { preselectedListId?: number }) => (
    <div
      data-testid="create-cards"
      data-preselected-list-id={preselectedListId ?? ''}
    />
  ),
}))

const campaign = { id: 1 } as Campaign

// ENG-10762 (Bugbot follow-up): OutreachComposeDeepLink's consume-once
// router.replace strips ?listId from the address bar, which re-triggers a
// server render of this force-dynamic route without the param — so
// page.tsx re-issues `preselectedListId` as undefined on that second pass.
// OutreachPage must capture the first defined value into client state so
// OutreachCreateCards (and the flow it opens) still gets it.
describe('OutreachPage — captured preselectedListId survives the post-strip RSC refresh', () => {
  it('keeps the captured id once the prop reverts to undefined', () => {
    const { rerender } = render(
      <OutreachPage
        pathname="/dashboard/outreach"
        campaign={campaign}
        preselectedListId={42}
      />,
    )

    expect(screen.getByTestId('create-cards')).toHaveAttribute(
      'data-preselected-list-id',
      '42',
    )

    rerender(
      <OutreachPage
        pathname="/dashboard/outreach"
        campaign={campaign}
        preselectedListId={undefined}
      />,
    )

    expect(screen.getByTestId('create-cards')).toHaveAttribute(
      'data-preselected-list-id',
      '42',
    )
  })

  it('updates the capture when a different defined id arrives later', () => {
    const { rerender } = render(
      <OutreachPage
        pathname="/dashboard/outreach"
        campaign={campaign}
        preselectedListId={42}
      />,
    )

    rerender(
      <OutreachPage
        pathname="/dashboard/outreach"
        campaign={campaign}
        preselectedListId={99}
      />,
    )

    expect(screen.getByTestId('create-cards')).toHaveAttribute(
      'data-preselected-list-id',
      '99',
    )
  })

  it('renders with no preselected list id when the prop is never provided', () => {
    render(<OutreachPage pathname="/dashboard/outreach" campaign={campaign} />)

    expect(screen.getByTestId('create-cards')).toHaveAttribute(
      'data-preselected-list-id',
      '',
    )
  })
})
