import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import type { DashboardCard } from '../data/contracts'
import NotificationsInbox from './NotificationsInbox'

const organizationMock = vi.fn()
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => organizationMock(),
}))

const cardsMock = vi.fn()
const dismissMock = vi.fn()
vi.mock('../data/use-dashboard', () => ({
  useDashboardCards: (bucket: string) => cardsMock(bucket),
  useDismissCard: () => ({ mutate: dismissMock }),
}))

const card = (over: Partial<DashboardCard> = {}): DashboardCard =>
  ({
    id: 'card_1',
    type: 'briefing',
    title: 'Prepare for the Planning Commission meeting',
    summary: 'Three agenda items touch the housing overlay.',
    ctaLabel: 'Prepare for the meeting',
    ctaHref: '/dashboard/briefings/card_1',
    dueDate: '2026-09-18T16:00:00.000Z',
    sourceExternalId: 'ext_1',
    sourceItemId: null,
    dismissedAt: null,
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    ...over,
  }) as DashboardCard

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'))
  organizationMock.mockReturnValue({
    slug: 'eo-teton',
    electedOfficeId: 'office_1',
  })
  cardsMock.mockReturnValue({ data: [card()] })
  dismissMock.mockReset()
})

describe('<NotificationsInbox>', () => {
  // The bell rides in the shell chrome, which Win renders too, and the cards
  // endpoint is scoped to an elected office. A Win user must not even mount
  // the data hooks, let alone call it.
  it('renders nothing without an elected office', () => {
    organizationMock.mockReturnValue({ slug: 'win-org' })
    const { container } = render(<NotificationsInbox />)

    expect(container).toBeEmptyDOMElement()
    expect(cardsMock).not.toHaveBeenCalled()
  })

  it('counts the unread items on the bell', () => {
    cardsMock.mockReturnValue({ data: [card(), card({ id: 'card_2' })] })
    render(<NotificationsInbox />)

    expect(
      screen.getByRole('button', { name: 'Notifications, 2 new' }),
    ).toBeInTheDocument()
  })

  it('opens a row at the destination its own card names', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<NotificationsInbox />)

    await user.click(screen.getByRole('button', { name: /Notifications/ }))

    const row = await screen.findByRole('link', {
      name: /Prepare for the Planning Commission meeting/,
    })
    expect(row).toHaveAttribute('href', '/dashboard/briefings/card_1')
  })

  it('labels each source so a row reads as what it is', async () => {
    cardsMock.mockReturnValue({
      data: [card({ type: 'agenda_item', title: 'Rezoning of 12 Elm' })],
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<NotificationsInbox />)

    await user.click(screen.getByRole('button', { name: /Notifications/ }))
    expect(await screen.findByText('Legislation')).toBeInTheDocument()
  })

  it('dismisses a row without following its link', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<NotificationsInbox />)

    await user.click(screen.getByRole('button', { name: /Notifications/ }))
    await user.click(await screen.findByRole('button', { name: /^Dismiss/ }))

    expect(dismissMock).toHaveBeenCalledWith('card_1')
  })

  // Dismissing is what put a row in the archive, so offering to dismiss it
  // again is a control with nothing to do.
  it('offers no dismiss in the archive', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<NotificationsInbox />)

    await user.click(screen.getByRole('button', { name: /Notifications/ }))
    await user.click(
      await screen.findByRole('button', { name: 'View archive' }),
    )

    expect(
      screen.queryByRole('button', { name: /^Dismiss/ }),
    ).not.toBeInTheDocument()
    expect(cardsMock).toHaveBeenCalledWith('skipped')
  })
})
