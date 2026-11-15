import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useIssueCaptureFlag } from 'app/shared/experiments/issueCaptureFlag'
import { useWinSmsPreviewEditFlag } from 'app/shared/experiments/winSmsPreviewEditFlag'
import { OutreachDetailsDrawer } from './OutreachDetailsDrawer'
import type { HistoryRow } from './historyStatus.util'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'campaign-1' }),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    displaySnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    successSnackbar: vi.fn(),
  }),
}))

vi.mock('app/shared/experiments/winSmsPreviewEditFlag', () => ({
  useWinSmsPreviewEditFlag: vi.fn(),
}))

vi.mock('app/shared/experiments/issueCaptureFlag', () => ({
  useIssueCaptureFlag: vi.fn(),
}))

const setFlag = (enabled: boolean, issueCapture = true) => {
  vi.mocked(useWinSmsPreviewEditFlag).mockReturnValue({ ready: true, enabled })
  vi.mocked(useIssueCaptureFlag).mockReturnValue({
    ready: true,
    enabled: issueCapture,
  })
}

const winRow = (fields: Partial<HistoryRow> = {}): HistoryRow => ({
  id: 88,
  createdAt: '2026-10-04T00:00:00Z',
  outreachType: 'p2p',
  name: 'Early voting reminder',
  status: 'completed',
  textCount: 300,
  ...fields,
})

const winDetail = {
  id: 88,
  createdAt: new Date('2026-10-04T00:00:00Z'),
  updatedAt: new Date('2026-10-04T00:00:00Z'),
  campaignId: 1,
  outreachType: 'p2p' as const,
  projectId: null,
  name: 'Early voting reminder',
  status: 'completed' as const,
  error: null,
  audienceRequest: null,
  script: null,
  message: null,
  date: null,
  imageUrl: null,
  voterFileFilterId: null,
  doorKnockingRouteId: null,
  phoneListId: null,
  identityId: null,
  didState: null,
  didNpaSubset: [],
  title: null,
  textCount: 300,
  billableTextCount: null,
  campaignPlanDueDate: null,
  organizationSlug: null,
  archivedAt: null,
}

const reply = (overrides: Record<string, unknown> = {}) => ({
  id: 'reply-1',
  personId: '11111111-1111-4111-8111-111111111111',
  firstName: 'Dana',
  lastName: 'Whitfield',
  city: 'Northside',
  state: 'CO',
  phone: '+13035550101',
  content: 'Where is my polling place?',
  receivedAt: '2026-10-05T15:00:00.000Z',
  isOptOut: false,
  ...overrides,
})

const mockWinDrawer = (
  replies: { total: number; replies: ReturnType<typeof reply>[] } = {
    total: 1,
    replies: [reply()],
  },
) => {
  api.mock('GET /v1/outreach/:id', { status: 200, data: winDetail })
  api.mock('GET /v1/outreach/:id/results', {
    status: 200,
    data: { contacts: 300, responded: 12, optedOut: 2 },
  })
  api.mock('GET /v1/outreach/:id/replies', { status: 200, data: replies })
}

const renderWinDrawer = (row: HistoryRow = winRow()) =>
  render(<OutreachDetailsDrawer row={row} onOpenChange={vi.fn()} />)

describe('Win text drawer — Responses', () => {
  beforeEach(() => setFlag(true))

  it('lists replies in voter wording with a Download link to the export', async () => {
    mockWinDrawer({
      total: 1,
      replies: [reply({ firstName: null, lastName: null })],
    })

    renderWinDrawer()

    expect(await screen.findByText('Responses')).toBeInTheDocument()
    expect(await screen.findByText('Voter')).toBeInTheDocument()
    expect(screen.getByText('Where is my polling place?')).toBeInTheDocument()
    expect(screen.queryByText('Constituent')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/constituent-feedback\/efforts\/88\/export$/),
    )
  })

  it('leaves Download out while issue capture is off, since the export would 404', async () => {
    setFlag(true, false)
    mockWinDrawer()

    renderWinDrawer()

    expect(
      await screen.findByText('Where is my polling place?'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Download' }),
    ).not.toBeInTheDocument()
  })

  it('says voters in the empty state', async () => {
    mockWinDrawer({ total: 0, replies: [] })

    renderWinDrawer()

    expect(
      await screen.findByText(
        'No responses yet. They appear here as voters reply.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Download' }),
    ).not.toBeInTheDocument()
  })

  it('hides the section, and never reads the replies, while the flag is off', async () => {
    setFlag(false)
    mockWinDrawer()
    api.mock('GET /v1/outreach/:id/replies', () => {
      throw new Error('replies read with the flag off')
    })

    renderWinDrawer()

    expect(
      await screen.findByText(/Based on 300 SMS contacts/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Responses')).not.toBeInTheDocument()
  })

  it('shows nothing for a Win text that has not been sent', async () => {
    mockWinDrawer()

    renderWinDrawer(winRow({ status: 'pending' }))

    expect(
      (await screen.findAllByText('Early voting reminder')).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText('Responses')).not.toBeInTheDocument()
  })
})
