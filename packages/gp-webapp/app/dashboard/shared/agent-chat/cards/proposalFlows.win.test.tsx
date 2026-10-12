import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChatCard } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { TcrCompliance } from 'helpers/types'
import { ProposalFlowsProvider, useProposalFlows } from './proposalFlows'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn(), successSnackbar: vi.fn() }),
}))

// The Win flow is the outreach page's own component with its own suite
// (SmsFlow.test.tsx). Here only what the provider hands it.
const smsFlow = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}))
vi.mock('app/dashboard/outreach/v2/sms/SmsFlow', () => ({
  SERVE_SMS_SURFACE: { isServe: true },
  SmsFlow: (props: Record<string, unknown>) => {
    smsFlow.props = props
    return <div data-testid="sms-flow" />
  },
}))

const phoneBankingFlow = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}))
vi.mock('app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow', () => ({
  SERVE_PHONE_BANKING_SURFACE: { isServe: true },
  PhoneBankingFlow: (props: Record<string, unknown>) => {
    phoneBankingFlow.props = props
    return <div data-testid="phone-banking-flow" />
  },
}))

const socialFlow = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}))
vi.mock('app/dashboard/outreach/v2/social/SocialFlow', () => ({
  SERVE_SOCIAL_SURFACE: { isServe: true },
  SocialFlow: (props: Record<string, unknown>) => {
    socialFlow.props = props
    return <div data-testid="social-flow" />
  },
}))

// Off, so a Win card that still opened its flow did not read it.
vi.mock('@shared/experiments/serveSmsFlag', () => ({
  useServeSmsFlag: () => ({ ready: true, enabled: false }),
}))

vi.mock('app/dashboard/shared/membership/ProPitchDialog', () => ({
  ProPitchDialog: ({
    open,
    source,
    channel,
  }: {
    open: boolean
    source: string
    channel: string
  }) =>
    open ? (
      <div data-testid="pro-pitch">
        {source}:{channel}
      </div>
    ) : null,
}))

const campaign = vi.hoisted(() => ({ current: { id: 9, isPro: false } }))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [campaign.current, vi.fn()],
}))

const tcr = vi.hoisted(() => ({ current: null as TcrCompliance | null }))
vi.mock(
  'app/dashboard/profile/texting-compliance/util/tcrCompliance.util',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('app/dashboard/profile/texting-compliance/util/tcrCompliance.util')
    >()),
    getTcrCompliance: async () => tcr.current,
  }),
)

const APPROVED: TcrCompliance = {
  id: 'tcr-1',
  ein: '84-3917265',
  postalAddress: '1 Main St, Austin, TX 78634',
  committeeName: 'Friends of Jane',
  candidateName: 'Jane Doe',
  websiteDomain: '',
  filingUrl: 'https://example.org/filing',
  phone: '15551234567',
  email: 'jane@example.org',
  status: 'approved',
  createdAt: new Date(),
  updatedAt: new Date(),
  campaignId: 9,
}

type Proposal = Extract<ChatCard, { kind: 'outreach_proposal' }>

const PROPOSAL_KEY = '6f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7'
const MESSAGE = 'Early voting opens Saturday at the library.'

const card: Proposal = {
  kind: 'outreach_proposal',
  proposalKey: PROPOSAL_KEY,
  audience: 'Likely voters in Ward 3',
  count: 58_520,
  sampleSize: 4_000,
  channel: 'text',
  audienceFilters: { homeownerNo: true },
  listName: 'Ward 3 likely voters',
  message: MESSAGE,
  deepLinkOnly: false,
}

const Opener = ({ proposal }: { proposal: Proposal }) => {
  const flows = useProposalFlows()
  return (
    <button
      type="button"
      disabled={!flows?.textResolved}
      onClick={() => flows?.open(proposal)}
    >
      Start the text
    </button>
  )
}

const openCard = async (proposal: Proposal = card) => {
  render(
    <ProposalFlowsProvider mode="win">
      <Opener proposal={proposal} />
    </ProposalFlowsProvider>,
  )
  const button = await screen.findByRole('button', { name: 'Start the text' })
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
}

describe('a Campaign Manager text card', () => {
  beforeEach(() => {
    smsFlow.props = null
    campaign.current = { id: 9, isPro: false }
    tcr.current = null
    vi.mocked(trackEvent).mockClear()
    vi.mocked(router.push!).mockClear()
  })

  it('takes a free campaign straight to the Pro pitch instead of the flow', async () => {
    await openCard()

    expect(await screen.findByTestId('pro-pitch')).toHaveTextContent(
      'campaign_manager:sms',
    )
    expect(router.push).not.toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.LockedItemClicked,
      { type: 'text' },
    )
    expect(screen.queryByTestId('sms-flow')).toBeNull()
  })

  it('holds a Pro campaign whose texting registration is not approved', async () => {
    campaign.current = { id: 9, isPro: true }
    tcr.current = { ...APPROVED, status: 'pending' }

    await openCard()

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.P2PCompliance.ComplianceModalViewed,
      { source: 'campaign_manager' },
    )
    expect(screen.queryByTestId('sms-flow')).toBeNull()
    expect(router.push).not.toHaveBeenCalled()
  })

  it("opens Win's text flow, filled in, for a verified Pro campaign", async () => {
    campaign.current = { id: 9, isPro: true }
    tcr.current = APPROVED

    await openCard()

    expect(await screen.findByTestId('sms-flow')).toBeInTheDocument()
    const props = smsFlow.props
    expect(props?.surface).toBeUndefined()
    expect(props?.initialScript).toBe(MESSAGE)
    expect(props?.source).toBe('campaign_manager')
    expect(props?.tcrCompliance).toEqual(APPROVED)
    expect(props?.proposalLink).toEqual({ proposalKey: PROPOSAL_KEY })
    expect(props?.proposedAudience).toMatchObject({
      name: 'Ward 3 likely voters',
      sample: { size: 4_000, seedKey: PROPOSAL_KEY },
    })
  })

  it('closes the flow when a refused create turns out to be a sent card', async () => {
    campaign.current = { id: 9, isPro: true }
    tcr.current = APPROVED
    api.mock('GET /v1/outreach/by-proposal-key/:proposalKey', {
      status: 200,
      data: {
        id: 501,
        createdAt: new Date(),
        updatedAt: new Date(),
        campaignId: 9,
        outreachType: 'p2p',
        projectId: null,
        name: 'Ward 3',
        status: 'completed',
        error: null,
        audienceRequest: null,
        script: MESSAGE,
        message: MESSAGE,
        date: null,
        imageUrl: null,
        voterFileFilterId: 77,
        doorKnockingRouteId: null,
        phoneListId: null,
        identityId: null,
        didState: null,
        didNpaSubset: [],
        title: null,
        textCount: 4_000,
        billableTextCount: null,
        campaignPlanDueDate: null,
        organizationSlug: 'campaign-9',
        archivedAt: null,
      },
    })

    await openCard()
    await screen.findByTestId('sms-flow')
    const failed = smsFlow.props?.onProposalCreateFailed as () => Promise<void>
    await act(() => failed())

    await waitFor(() => expect(screen.queryByTestId('sms-flow')).toBeNull())
  })
})

describe('a Campaign Manager card for another channel', () => {
  beforeEach(() => {
    phoneBankingFlow.props = null
    socialFlow.props = null
    campaign.current = { id: 9, isPro: false }
    tcr.current = null
    vi.mocked(trackEvent).mockClear()
    vi.mocked(router.push!).mockClear()
  })

  const calls: Proposal = { ...card, channel: 'phoneBanking' }
  const walk: Proposal = { ...card, channel: 'doorKnocking', savedFilterId: 77 }
  const post: Proposal = { ...card, channel: 'social' }

  it.each([
    ['phone banking', calls, 'phone-bank', 'phoneBanking'],
    ['door knocking', walk, 'door', 'doorKnocking'],
  ])(
    'takes a free campaign to the %s Pro pitch',
    async (_, proposal, pitch, type) => {
      await openCard(proposal)

      expect(await screen.findByTestId('pro-pitch')).toHaveTextContent(
        `campaign_manager:${pitch}`,
      )
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.ProUpgrade.Compliance.LockedItemClicked,
        { type },
      )
      expect(screen.queryByTestId('phone-banking-flow')).toBeNull()
      expect(router.push).not.toHaveBeenCalled()
    },
  )

  it("opens Win's phone banking flow with the card's key alone", async () => {
    campaign.current = { id: 9, isPro: true }

    await openCard(calls)

    expect(await screen.findByTestId('phone-banking-flow')).toBeInTheDocument()
    const props = phoneBankingFlow.props
    expect(props?.surface).toBeUndefined()
    expect(props?.initialScript).toBe(MESSAGE)
    expect(props?.initialName).toBe('Ward 3 likely voters')
    expect(props?.source).toBe('campaign_manager')
    expect(props?.proposalLink).toEqual({ proposalKey: PROPOSAL_KEY })
  })

  it("opens Win's social flow for a free campaign, since a post is free", async () => {
    await openCard(post)

    expect(await screen.findByTestId('social-flow')).toBeInTheDocument()
    const props = socialFlow.props
    expect(props?.surface).toBeUndefined()
    expect(props?.prefill).toEqual({
      draftText: MESSAGE,
      proposalLink: { proposalKey: PROPOSAL_KEY },
    })
    expect(props?.source).toBe('campaign_manager')
    expect(screen.queryByTestId('pro-pitch')).toBeNull()
  })

  it("starts Win's door knocking on the card's list and key", async () => {
    campaign.current = { id: 9, isPro: true }

    await openCard(walk)

    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1))
    const url = new URL(
      vi.mocked(router.push!).mock.calls[0]?.[0] as string,
      'https://app.test',
    )
    expect(url.pathname).toBe('/dashboard/door-knocking')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      create: '1',
      listId: '77',
      proposalKey: PROPOSAL_KEY,
    })
  })
})
