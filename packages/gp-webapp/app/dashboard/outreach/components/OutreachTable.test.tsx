import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { OutreachTable } from './OutreachTable'
import {
  OutreachProvider,
  Outreach,
} from 'app/dashboard/outreach/hooks/OutreachContext'
import { useP2pUxEnabled } from 'app/dashboard/components/tasks/flows/hooks/P2pUxEnabledProvider'

vi.mock(
  'app/dashboard/components/tasks/flows/hooks/P2pUxEnabledProvider',
  () => ({
    useP2pUxEnabled: vi.fn(),
  }),
)
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const mockedUseP2pUxEnabled = vi.mocked(useP2pUxEnabled)

type TableRow = Outreach & {
  p2pJob?: { status?: string }
  voterFileFilter?: { age50Plus: boolean; voterCount: number }
}

// Rows carry a filter + date so the Date/Audience/Voters cells render real
// values — any "n/a" in these rows can only come from the Status cell.
const linkedFilter = { age50Plus: true, voterCount: 1668 }

const robocallRow: TableRow = {
  id: 1,
  outreachType: 'robocall',
  status: 'pending',
  date: '2026-07-27T00:00:00.000Z',
  phoneListId: null,
  voterFileFilter: linkedFilter,
}

const p2pRow: TableRow = {
  id: 2,
  outreachType: 'text',
  status: 'pending',
  date: '2026-07-20T00:00:00.000Z',
  phoneListId: 55,
  p2pJob: { status: 'active' },
  voterFileFilter: linkedFilter,
}

const statuslessRow: TableRow = {
  id: 3,
  outreachType: 'doorKnocking',
  status: null,
  date: '2026-07-01T00:00:00.000Z',
  phoneListId: null,
  voterFileFilter: linkedFilter,
}

const STATUS_LABELS = ['Draft', 'In review', 'Scheduled', 'Sent']

const renderTable = (
  rows: TableRow[],
  props: { highlightOutreachId?: number } = {},
) =>
  render(
    <OutreachProvider initValue={rows}>
      <OutreachTable {...props} />
    </OutreachProvider>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockedUseP2pUxEnabled.mockReturnValue({
    p2pUxEnabled: true,
    proUpdatedAtDate: new Date('2026-01-01T00:00:00.000Z'),
    tcrCompliant: true,
    resetP2pUxEnabled: vi.fn(),
  })
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})

describe('OutreachTable — status column (ENG-10769)', () => {
  it('shows "In review" for a scheduled robocall instead of n/a', () => {
    renderTable([robocallRow])

    expect(screen.getByText('In review')).toBeInTheDocument()
    expect(screen.queryByText('n/a')).not.toBeInTheDocument()
  })

  it('keeps the p2p job-status mapping for rows with a phone list', () => {
    renderTable([p2pRow])

    // active p2p job displays as completed → "Sent"
    expect(screen.getByText('Sent')).toBeInTheDocument()
  })

  it('still renders n/a when the outreach has no status at all', () => {
    renderTable([statuslessRow])

    expect(screen.getByText('n/a')).toBeInTheDocument()
    STATUS_LABELS.forEach((label) => {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    })
  })

  it('renders n/a for a phone-list row whose p2p job is missing', () => {
    renderTable([{ ...p2pRow, p2pJob: undefined }])

    expect(screen.getByText('n/a')).toBeInTheDocument()
    STATUS_LABELS.forEach((label) => {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    })
  })
})

describe('OutreachTable — ?outreachId= highlight deep link (ENG-10769)', () => {
  it('strips the param, scrolls to and highlights the matching row', () => {
    renderTable([robocallRow, p2pRow], { highlightOutreachId: 1 })

    expect(router.replace).toHaveBeenCalledWith('/dashboard/outreach', {
      scroll: false,
    })
    const row = document.getElementById('outreach-row-1')
    expect(row).not.toBeNull()
    expect(row?.className).toContain('bg-primary/5')
    expect(row?.scrollIntoView).toHaveBeenCalled()
    expect(document.getElementById('outreach-row-2')?.className).not.toContain(
      'bg-primary/5',
    )
  })

  it('falls back to the plain list when the id matches no outreach', () => {
    renderTable([robocallRow], { highlightOutreachId: 999 })

    expect(router.replace).toHaveBeenCalledWith('/dashboard/outreach', {
      scroll: false,
    })
    expect(document.getElementById('outreach-row-1')?.className).not.toContain(
      'bg-primary/5',
    )
  })

  it('does not touch the URL when no highlight id arrives', () => {
    renderTable([robocallRow])

    expect(router.replace).not.toHaveBeenCalled()
  })
})
