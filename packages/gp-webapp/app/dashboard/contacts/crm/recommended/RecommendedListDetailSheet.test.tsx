import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RecommendedList } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useContactsTable } from '../ContactsTableProvider'
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
    // Nothing has been sent to a list that does not exist yet.
    expect(screen.queryByText('Outreach campaign history')).toBeNull()
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
