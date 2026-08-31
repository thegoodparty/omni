import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { render } from 'helpers/test-utils/render'
import ConstituentOutreachPage from './ConstituentOutreachPage'
import type { HistoryRow } from 'app/dashboard/outreach/v2/historyStatus.util'

// Desktop history table, scoped so its "Door knocking" channel badge isn't
// confused with the (also-rendered) Door knocking channel card above it.
const desktopTable = () => screen.getAllByRole('table')[0] as HTMLElement

vi.mock('@shared/experiments/FeatureFlagsProvider', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@shared/experiments/FeatureFlagsProvider')
  >()),
  useFlagOn: () => ({ ready: true, on: true }),
}))

// The real layout is a sidebar shell that needs an OrganizationProvider this
// suite has no use for — a stub keeps the focus on the content it wraps.
vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

describe('ConstituentOutreachPage — Serve outreach history', () => {
  it('renders seeded outreach rows (channel, name, status, date)', () => {
    const outreaches: HistoryRow[] = [
      {
        id: 1,
        date: '2026-08-20',
        outreachType: 'nativeDoorKnocking',
        name: 'Elm & Cedar walk',
        status: 'in_progress',
      },
    ]

    render(<ConstituentOutreachPage outreaches={outreaches} />)

    const table = within(desktopTable())
    expect(table.getByText('Elm & Cedar walk')).toBeInTheDocument()
    expect(table.getByText('Door knocking')).toBeInTheDocument()
    expect(table.getByText('In progress')).toBeInTheDocument()
  })

  it('renders a clean empty state with no rows', () => {
    render(<ConstituentOutreachPage outreaches={[]} />)

    // The history table renders both a desktop table and a mobile card list
    // (one hidden via CSS, not removed from the DOM), so the empty message
    // appears twice.
    expect(
      screen.getAllByText(
        'No campaigns yet. Pick a channel above to create your first.',
      ),
    ).toHaveLength(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
