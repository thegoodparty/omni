import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import type {
  DoorKnockingTurf,
  FeedbackReportResponse,
} from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { useIssueCaptureFlag } from 'app/shared/experiments/issueCaptureFlag'
import { TurfSummaryRow } from './TurfSummaryRow'

vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'campaign-1' }),
}))

vi.mock('app/shared/experiments/issueCaptureFlag', () => ({
  useIssueCaptureFlag: vi.fn(),
}))

const OUTREACH_ID = 30

const TURF: DoorKnockingTurf = {
  id: 12,
  outreachId: OUTREACH_ID,
  voterFileFilterId: 4,
  name: 'Elm St & 5th',
  color: '#2563eb',
  geoPoly: { type: 'Polygon', coordinates: [] },
  stopCount: 3,
  doorCount: 4,
  knockedDoorCount: 3,
  peopleCount: 9,
  loggedCount: 6,
  routeSeconds: 900,
  completed: false,
  archivedAt: null,
  createdAt: new Date('2026-08-10T00:00:00Z'),
  updatedAt: new Date('2026-08-10T00:00:00Z'),
}

const REPORT: FeedbackReportResponse = {
  question: null,
  channel: 'door_knock',
  floor: 5,
  denominators: { conversations: 12, memos: 8, confirmed: 6, pending: 2 },
  run: null,
  themes: [],
  memos: [],
}

let reportReads: string[] = []

const mockReport = (data: FeedbackReportResponse) =>
  api.mock(
    'GET /v1/constituent-feedback/efforts/:outreachId/report',
    ({ params }) => {
      reportReads.push(params.outreachId)
      return { status: 200, data }
    },
  )

const setFlag = (enabled: boolean) => {
  vi.mocked(useIssueCaptureFlag).mockReturnValue({ ready: true, enabled })
}

const renderRow = (isServe = false) =>
  render(<TurfSummaryRow isServe={isServe} turf={TURF} action={null} />)

beforeEach(() => {
  testQueryClient.clear()
  reportReads = []
  vi.mocked(useSnackbar).mockReturnValue({
    displaySnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    successSnackbar: vi.fn(),
  })
  api.mock('GET /v1/organizations/team', {
    status: 200,
    data: { members: [], pendingInvites: [] },
  })
  setFlag(true)
})

describe('TurfSummaryRow: what we heard', () => {
  it('links the turf to its report with what was heard on it', async () => {
    mockReport(REPORT)
    renderRow()

    const link = await screen.findByRole('link', { name: /What we heard/ })
    expect(link).toHaveAttribute('href', `/issue-capture/${OUTREACH_ID}`)
    expect(link).toHaveTextContent('12 conversations · 8 notes')
    expect(reportReads).toEqual([String(OUTREACH_ID)])
  })

  it('links a Serve turf too', async () => {
    setFlag(true)
    mockReport(REPORT)
    renderRow(true)

    expect(
      await screen.findByRole('link', { name: /What we heard/ }),
    ).toBeInTheDocument()
  })

  it('shows nothing, and asks for nothing, when the flag is off', async () => {
    setFlag(false)
    mockReport(REPORT)
    renderRow(false)

    await screen.findByText('Elm St & 5th')
    expect(screen.queryByRole('link', { name: /What we heard/ })).toBeNull()
    expect(reportReads).toEqual([])
  })

  it('shows nothing until somebody has answered', async () => {
    mockReport({
      ...REPORT,
      denominators: { conversations: 0, memos: 0, confirmed: 0, pending: 0 },
    })
    renderRow()

    await waitFor(() => expect(reportReads).toHaveLength(1))
    expect(screen.queryByRole('link', { name: /What we heard/ })).toBeNull()
  })

  it('reads one of each in the singular', async () => {
    mockReport({
      ...REPORT,
      denominators: { conversations: 1, memos: 1, confirmed: 1, pending: 0 },
    })
    renderRow()

    expect(
      await screen.findByRole('link', { name: /What we heard/ }),
    ).toHaveTextContent('1 conversation · 1 note')
  })
})
