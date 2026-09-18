import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RecommendedList } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useContactsTable } from '../ContactsTableProvider'
import { useContactsDownload } from '../shared/useContactsDownload'
import RecommendedListDetailSheet from './RecommendedListDetailSheet'

vi.mock('../ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))
const openChannelPicker = vi.fn()
vi.mock('../shared/channelPicker/ChannelPickerProvider', () => ({
  useOpenChannelPicker: () => openChannelPicker,
}))
// Same reason ListDetailSheet.test mocks it: the cookie-poll mechanics are
// covered by useContactsDownload.test.ts, and here the confirm callback is
// invoked directly to reach the analytics branch.
vi.mock('../shared/useContactsDownload', () => ({
  useContactsDownload: vi.fn(),
}))
const downloadFromHref = vi.fn()

const RECOMMENDATION: RecommendedList = {
  variant: 'persuadeAffinity',
  intent: 'persuade',
  filter: { voterStatus: ['Super', 'Likely'], independentAffinity: true },
  count: 42468,
  copy: {
    title: 'Persuadable independent-leaning voters',
    criteriaSummary: 'Moderate to high propensity voters who lean independent.',
  },
  existingFilterId: null,
}

const DETAIL = {
  demographics: { people: 42468, avgAge: 44.6, avgIncome: 58210.4 },
  reachability: {
    sms: 26000,
    robocall: 29000,
    phoneBanking: 31000,
    doorKnocking: 42468,
    polls: 26000,
  },
  outreachHistory: [],
}

beforeEach(() => {
  testQueryClient.clear()
  api.reset()
  vi.clearAllMocks()
  vi.mocked(useContactsTable).mockReturnValue({
    canUseProFeatures: true,
    isWinContext: true,
    isWinContextReady: true,
    voterDataUnavailable: false,
  } as unknown as ReturnType<typeof useContactsTable>)
  vi.mocked(useContactsDownload).mockReturnValue({
    download: vi.fn(),
    downloadFromHref,
    isPreparing: false,
  })
})

describe('RecommendedListDetailSheet', () => {
  it('renders nothing when no recommendation is open', () => {
    render(
      <RecommendedListDetailSheet recommendation={null} onClose={vi.fn()} />,
    )

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('posts the recommendation filter and renders demographics and reachability', async () => {
    const bodies: Record<string, unknown>[] = []
    api.mock('POST /v1/contacts/list-detail', ({ body }) => {
      bodies.push(body)
      return { status: 200, data: DETAIL }
    })

    render(
      <RecommendedListDetailSheet
        recommendation={RECOMMENDATION}
        onClose={vi.fn()}
      />,
    )

    expect(
      await screen.findByRole('heading', {
        name: 'Persuadable independent-leaning voters',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Moderate to high propensity voters who lean independent.',
      ),
    ).toBeInTheDocument()
    // People, and again under door knocking (everyone has an address).
    expect(await screen.findAllByText('42,468')).toHaveLength(2)
    expect(screen.getByText('45')).toBeInTheDocument()
    expect(screen.getByText('$58,210')).toBeInTheDocument()
    expect(screen.getByText('Reachable by channel')).toBeInTheDocument()
    expect(screen.getByText('29,000')).toBeInTheDocument()
    // The same builder translation the flows persist, so the figures here
    // are the figures saving the list would show.
    expect(bodies[0]).toMatchObject({
      audienceSuperVoters: true,
      audienceLikelyVoters: true,
      independentAffinity: true,
    })
    // Every section the saved-list sheet has. Nothing has been sent to a
    // list that does not exist yet, so the history tiles and section read
    // empty rather than disappearing.
    expect(screen.getByText('Last outreach')).toBeInTheDocument()
    expect(screen.getByText('Last method')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Outreach campaign history' }),
    ).toBeInTheDocument()
    expect(screen.getByText('No outreach yet.')).toBeInTheDocument()
  })

  // The saved-list sheet's Download, backed by the variant download route
  // since there is no saved segment to name.
  it('downloads the recommendation by variant and reports the export once confirmed', async () => {
    api.mock('POST /v1/contacts/list-detail', { status: 200, data: DETAIL })
    let confirm: (() => void) | undefined
    downloadFromHref.mockImplementation((_href, _props, onConfirmed) => {
      confirm = onConfirmed
    })

    render(
      <RecommendedListDetailSheet
        recommendation={RECOMMENDATION}
        onClose={vi.fn()}
      />,
    )

    await screen.findAllByText('42,468')
    await userEvent.click(screen.getByRole('button', { name: 'Download list' }))
    expect(downloadFromHref).toHaveBeenCalledWith(
      '/api/v1/campaigns/mine/recommended-lists/persuadeAffinity/download',
      { context: 'win' },
      expect.any(Function),
    )
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.VoterData.ListExported,
      expect.anything(),
    )

    confirm?.()

    expect(trackEvent).toHaveBeenCalledWith(EVENTS.VoterData.ListExported, {
      listSize: 42468,
      surface: 'recommendedDetail',
    })
  })

  it('reads Unavailable when the aggregates fail', async () => {
    api.mock('POST /v1/contacts/list-detail', {
      status: 502,
      data: { message: 'Voter data is temporarily unavailable.' },
    })

    render(
      <RecommendedListDetailSheet
        recommendation={RECOMMENDATION}
        onClose={vi.fn()}
      />,
    )

    expect((await screen.findAllByText('Unavailable')).length).toBeGreaterThan(
      0,
    )
  })

  it('closes and opens the channel picker from the footer with the detail surface', async () => {
    api.mock('POST /v1/contacts/list-detail', { status: 200, data: DETAIL })
    const onClose = vi.fn()

    render(
      <RecommendedListDetailSheet
        recommendation={RECOMMENDATION}
        onClose={onClose}
      />,
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'Send outreach' }),
    )
    expect(onClose).toHaveBeenCalled()
    expect(openChannelPicker).toHaveBeenCalledWith({
      kind: 'recommended',
      recommendation: RECOMMENDATION,
    })
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.VoterData.SendOutreachClicked,
      { surface: 'recommendedDetail', variant: 'persuadeAffinity' },
    )
  })

  it('closes through the sheet', async () => {
    api.mock('POST /v1/contacts/list-detail', { status: 200, data: DETAIL })
    const onClose = vi.fn()

    render(
      <RecommendedListDetailSheet
        recommendation={RECOMMENDATION}
        onClose={onClose}
      />,
    )

    await userEvent.click(await screen.findByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
