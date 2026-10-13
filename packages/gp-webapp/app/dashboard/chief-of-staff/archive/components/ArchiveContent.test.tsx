import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import ArchiveContent from './ArchiveContent'
import type { DashboardCard } from '../../data/contracts'

const restoreMock = vi.fn()
const cardsByBucket: Record<string, DashboardCard[]> = {}

vi.mock('../../data/use-dashboard', () => ({
  useDashboardCards: (bucket: string) => ({
    data: cardsByBucket[bucket] ?? [],
    isPending: false,
    isError: false,
  }),
  useOnboardingCards: () => ({ data: [] }),
  useRestoreCard: () => ({ mutate: restoreMock, isPending: false }),
}))

const card = (overrides: Partial<DashboardCard>): DashboardCard => ({
  id: 'c1',
  type: 'briefing',
  title: 'Prep for the zoning vote',
  summary: 'Three items worth reading first.',
  ctaLabel: 'Prepare for the meeting',
  ctaHref: '/dashboard/briefings/2026-09-21',
  dueDate: '2026-09-21T18:00:00.000Z',
  sourceExternalId: 'ext-1',
  sourceItemId: null,
  dismissedAt: '2026-09-15T00:00:00.000Z',
  completedAt: null,
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
  ...overrides,
})

beforeEach(() => {
  restoreMock.mockReset()
  cardsByBucket.skipped = [
    card({}),
    card({
      id: 'build',
      type: 'civic_panel',
      title: "Build your citizens' panel",
      sourceExternalId: 'build:eo-1',
    }),
  ]
})

describe('<ArchiveContent>', () => {
  it('brings a set-aside build card back, and only that card', async () => {
    const user = userEvent.setup()
    render(<ArchiveContent />)
    await user.click(screen.getByRole('radio', { name: 'Skipped' }))

    const buttons = screen.getAllByRole('button', { name: 'Bring it back' })
    expect(buttons).toHaveLength(1)
    await user.click(buttons[0]!)
    expect(restoreMock).toHaveBeenCalledWith('build')
  })

  it('lists the build card beside the priority cards this week, with nothing to bring back', () => {
    cardsByBucket.this_week = [
      card({
        id: 'build',
        type: 'civic_panel',
        title: "Build your citizens' panel",
        sourceExternalId: 'build:eo-1',
        dismissedAt: null,
      }),
      card({
        id: 'p1-card',
        type: 'civic_panel',
        title: 'Affordable housing',
        sourceExternalId: 'p1',
        dismissedAt: null,
      }),
    ]
    render(<ArchiveContent />)

    expect(screen.getByText("Build your citizens' panel")).toBeInTheDocument()
    expect(screen.getByText('Affordable housing')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Bring it back' }),
    ).not.toBeInTheDocument()
  })
})
