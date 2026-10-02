import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { useServeIssueCaptureFlag } from 'app/shared/experiments/serveIssueCaptureFlag'
import { useWinIssueCaptureFlag } from 'app/shared/experiments/winIssueCaptureFlag'
import { OutreachDetailsDrawer } from './OutreachDetailsDrawer'
import type { HistoryRow } from './historyStatus.util'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'campaign-1' }),
}))

vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))

vi.mock('app/shared/experiments/serveIssueCaptureFlag', () => ({
  useServeIssueCaptureFlag: vi.fn(),
}))

vi.mock('app/shared/experiments/winIssueCaptureFlag', () => ({
  useWinIssueCaptureFlag: vi.fn(),
}))

const OUTREACH_ID = 30

const baseDetail = {
  id: OUTREACH_ID,
  createdAt: new Date('2026-08-10T00:00:00Z'),
  updatedAt: new Date('2026-08-10T00:00:00Z'),
  campaignId: 1,
  projectId: null,
  name: 'Listening calls',
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
  textCount: null,
  billableTextCount: null,
  campaignPlanDueDate: null,
  organizationSlug: null,
  archivedAt: null,
}

const PHONE_BANKING = {
  listId: 5,
  entriesTotal: 10,
  entriesCalled: 10,
  peopleTotal: 10,
  peopleCalled: 10,
  byOutcome: {
    answered: 5,
    no_answer: 5,
    voicemail: 0,
    wrong_number: 0,
    refused: 0,
    disconnected: 0,
    hung_up: 0,
  },
  supporters: 0,
  unsure: 0,
  nonSupporters: 0,
  byFollowUp: { yes: 0, no: 0 },
}

const row = (fields: Partial<HistoryRow>): HistoryRow => ({
  id: OUTREACH_ID,
  createdAt: '2026-08-10T00:00:00Z',
  outreachType: 'nativePhoneBanking',
  name: 'Listening calls',
  status: 'completed',
  ...fields,
})

const turf = (id: number, outreachId: number) => ({
  id,
  outreachId,
  voterFileFilterId: 4,
  name: `Turf ${id}`,
  color: '#2563eb',
  geoPoly: { type: 'Polygon', coordinates: [] },
  stopCount: 3,
  doorCount: 4,
  knockedDoorCount: 4,
  peopleCount: 9,
  loggedCount: 9,
  routeSeconds: 900,
  completed: true,
  archivedAt: null,
  createdAt: new Date('2026-08-10T00:00:00Z'),
  updatedAt: new Date('2026-08-10T00:00:00Z'),
})

const setFlags = ({ serve, win }: { serve: boolean; win: boolean }) => {
  vi.mocked(useServeIssueCaptureFlag).mockReturnValue({
    ready: true,
    enabled: serve,
  })
  vi.mocked(useWinIssueCaptureFlag).mockReturnValue({
    ready: true,
    enabled: win,
  })
}

const mockPhoneDetail = () =>
  api.mock('GET /v1/outreach/:id', {
    status: 200,
    data: {
      ...baseDetail,
      outreachType: 'nativePhoneBanking' as const,
      status: 'completed' as const,
      phoneBankingListId: 5,
      phoneBanking: PHONE_BANKING,
    } as never,
  })

const link = () => screen.queryByRole('link', { name: /What we heard/ })

beforeEach(() => {
  testQueryClient.clear()
  vi.mocked(useSnackbar).mockReturnValue({
    displaySnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    successSnackbar: vi.fn(),
  })
  api.mock('GET /v1/outreach/:id/assignments', {
    status: 200,
    data: { assignees: [] },
  })
  api.mock('GET /v1/organizations/team', {
    status: 200,
    data: { members: [], pendingInvites: [] },
  })
  // The turf cards carry their own counted link; nobody has answered on
  // these turfs, so only the drawer's own link can be on screen.
  api.mock('GET /v1/constituent-feedback/efforts/:outreachId/report', {
    status: 200,
    data: {
      question: null,
      channel: 'door_knock',
      floor: 5,
      denominators: { conversations: 0, memos: 0, confirmed: 0, pending: 0 },
      run: null,
      themes: [],
      memos: [],
    },
  })
  setFlags({ serve: false, win: true })
})

describe('OutreachDetailsDrawer: what we heard', () => {
  // A finished list is the one whose summary has run, and the drawer is the
  // only way back to a list once it is done.
  it('links a completed phone banking list to its report', async () => {
    mockPhoneDetail()
    render(<OutreachDetailsDrawer row={row({})} onOpenChange={vi.fn()} />)

    const action = await screen.findByRole('link', { name: /What we heard/ })
    expect(action).toHaveAttribute(
      'href',
      `/dashboard/issue-capture/${OUTREACH_ID}`,
    )
    expect(action).toHaveTextContent('Notes from conversations with voters.')
  })

  it('speaks to an official about constituents on the Serve flag', async () => {
    setFlags({ serve: true, win: false })
    mockPhoneDetail()
    render(
      <OutreachDetailsDrawer row={row({})} onOpenChange={vi.fn()} isServe />,
    )

    const action = await screen.findByRole('link', { name: /What we heard/ })
    expect(action).toHaveTextContent(
      'Notes from conversations with constituents.',
    )
    expect(action.textContent).not.toMatch(/voter/i)
  })

  it('offers nothing on a text', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: {
        ...baseDetail,
        outreachType: 'text' as const,
        status: 'completed' as const,
      } as never,
    })
    render(
      <OutreachDetailsDrawer
        row={row({ outreachType: 'text', name: 'Election day reminder' })}
        onOpenChange={vi.fn()}
      />,
    )

    await screen.findByRole('heading', { name: 'Election day reminder' })
    expect(link()).toBeNull()
  })

  it('offers nothing while the product’s capture is off', async () => {
    setFlags({ serve: true, win: false })
    mockPhoneDetail()
    render(<OutreachDetailsDrawer row={row({})} onOpenChange={vi.fn()} />)

    await screen.findByText('Based on 10 phone banking contacts')
    expect(link()).toBeNull()
  })

  it('links a one-turf door knocking campaign to its turf’s report', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: {
        ...baseDetail,
        outreachType: 'nativeDoorKnocking' as const,
        status: 'completed' as const,
        doorKnockingRouteId: 7,
      } as never,
    })
    api.mock('GET /v1/door-knocking/campaigns/:anchorId', {
      status: 200,
      data: [turf(12, OUTREACH_ID)] as never,
    })
    render(
      <OutreachDetailsDrawer
        row={row({ outreachType: 'nativeDoorKnocking' })}
        onOpenChange={vi.fn()}
      />,
    )

    expect(
      await screen.findByRole('link', { name: /What we heard/ }),
    ).toHaveAttribute('href', `/dashboard/issue-capture/${OUTREACH_ID}`)
  })

  // A report is per turf, and the row's id names only the anchor's, so a
  // campaign-wide link would show one turf under the whole campaign's name.
  // Each turf card carries its own link instead.
  it('leaves a several-turf campaign’s reports to its turf cards', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: {
        ...baseDetail,
        outreachType: 'nativeDoorKnocking' as const,
        status: 'completed' as const,
        doorKnockingRouteId: 7,
      } as never,
    })
    api.mock('GET /v1/door-knocking/campaigns/:anchorId', {
      status: 200,
      data: [turf(12, OUTREACH_ID), turf(13, 31)] as never,
    })
    render(
      <OutreachDetailsDrawer
        row={row({ outreachType: 'nativeDoorKnocking', turfCount: 2 })}
        onOpenChange={vi.fn()}
      />,
    )

    await screen.findByText('Turf 13')
    await waitFor(() => expect(link()).toBeNull())
  })
})
