import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChatCard } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { trackEvent } from 'helpers/analyticsHelper'
import type { OutreachLaunchSource } from 'app/dashboard/outreach/util/outreachAnalytics'
import { ProposalFlowsProvider, useProposalFlows } from './proposalFlows'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn(), successSnackbar: vi.fn() }),
}))

// The Serve flow is the outreach page's own component with its own suite
// (SmsFlow.serveSurface.test.tsx). Here only what the provider hands it.
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

vi.mock('@shared/experiments/serveSmsFlag', () => ({
  useServeSmsFlag: () => ({ ready: true, enabled: true }),
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-riverside' }),
}))

type Proposal = Extract<ChatCard, { kind: 'outreach_proposal' }>

const PROPOSAL_KEY = '6f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7'
const MESSAGE =
  'this is Bryan, your City Council Member. Is flooding on your block the problem to fix first?'

const panelAndFresh: Proposal = {
  kind: 'outreach_proposal',
  proposalKey: PROPOSAL_KEY,
  audience: 'Your civic panel and residents across the district',
  count: 18_400,
  channel: 'text',
  audienceFilters: { hasCellPhone: true, notContactedRecently: true },
  listName: 'Flooding check',
  message: MESSAGE,
  deepLinkOnly: false,
  stepId: 'define',
  side: 'main',
  sampleSize: 84,
  civicPanelAsk: true,
}

const Opener = ({
  proposal,
  launchSource,
}: {
  proposal: Proposal
  launchSource?: OutreachLaunchSource
}) => {
  const flows = useProposalFlows()
  return (
    <button
      type="button"
      disabled={!flows?.textResolved}
      onClick={() => flows?.open(proposal, 'priority-1', launchSource)}
    >
      Start the text
    </button>
  )
}

const openCard = async (
  proposal: Proposal,
  launchSource?: OutreachLaunchSource,
) => {
  render(
    <ProposalFlowsProvider>
      <Opener proposal={proposal} {...(launchSource && { launchSource })} />
    </ProposalFlowsProvider>,
  )
  const button = await screen.findByRole('button', { name: 'Start the text' })
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
  await screen.findByTestId('sms-flow')
}

// Every list the card saves, as the server would return them.
let saved: Record<string, unknown>[] = []
beforeEach(() => {
  vi.mocked(trackEvent).mockClear()
  saved = []
  smsFlow.props = null
  window.localStorage.clear()
  api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
    saved.push(body)
    return { status: 200, data: { id: 500 + saved.length, name: 'List' } }
  })
  api.mock('GET /v1/voters/voter-file/filters', () => ({
    status: 200,
    data: saved.map((_, i) => ({ id: 501 + i, name: 'List' })),
  }))
})

describe("a priority's text card that asks the civic panel", () => {
  // The card settled who gets it, so the list is saved before the flow
  // opens, and the flow opens on the message with that list picked.
  it('saves one sampled list and opens on the message, the join ask on', async () => {
    await openCard(panelAndFresh)

    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      name: 'Flooding check',
      hasCellPhone: true,
      sample: { size: 84, seedKey: PROPOSAL_KEY },
    })
    const props = smsFlow.props
    expect(props?.surface).toEqual({ isServe: true })
    expect(props?.preselectedListId).toBe(501)
    expect(props).not.toHaveProperty('proposedAudience')
    expect(smsFlow.props?.audienceSettled).toBe(true)
    expect(smsFlow.props).not.toHaveProperty('audienceSummary')
    expect(props?.initialAsksToJoinCivicPanel).toBe(true)
    expect(props?.initialScript).toBe(MESSAGE)
  })

  it('leaves the join ask off for a text that did not ask for it', async () => {
    await openCard({
      ...panelAndFresh,
      civicPanelAsk: undefined,
    })

    expect(smsFlow.props?.initialAsksToJoinCivicPanel).toBe(false)
    expect(saved[0]).toMatchObject({
      sample: { size: 84, seedKey: PROPOSAL_KEY },
    })
    expect(saved[0]?.sample).not.toHaveProperty('panelSize')
    expect(smsFlow.props?.audienceSettled).toBe(true)
    expect(smsFlow.props).not.toHaveProperty('audienceSummary')
  })
})

describe('a priority card kept to the parts of the district not reached yet', () => {
  it('saves the list with the area', async () => {
    await openCard({ ...panelAndFresh, areaTarget: 'unreached' })

    expect(saved[0]).toMatchObject({ unreachedAreaOfPriorityId: 'priority-1' })
  })
})

describe("a priority card's launch source", () => {
  it('is priorities by default', async () => {
    await openCard(panelAndFresh)

    expect(smsFlow.props?.launchSource).toBe('priorities')
    expect(smsFlow.props?.proposalLink).not.toHaveProperty('launchSource')
  })

  it('is expand_panel for a card that answered Get answers', async () => {
    await openCard(panelAndFresh, 'expand_panel')

    expect(smsFlow.props?.launchSource).toBe('expand_panel')
  })
})

describe('a text card', () => {
  it('opens without a purpose', async () => {
    await openCard({ ...panelAndFresh, purpose: undefined })

    expect(smsFlow.props).not.toHaveProperty('initialPurpose')
  })
})

describe('a round 2 card', () => {
  it('saves the pool whole and hands the flow its size', async () => {
    const { sampleSize: _sample, ...whole } = panelAndFresh
    await openCard({ ...whole, roundTwoSize: 300 })

    expect(saved[0]).not.toHaveProperty('sample')
    expect(smsFlow.props?.roundTwoSize).toBe(300)
  })
})

describe('a report back card', () => {
  const reportBack: Proposal = {
    kind: 'outreach_proposal',
    proposalKey: PROPOSAL_KEY,
    audience: 'Everyone you texted about Flooding on Maple on October 5',
    count: 236,
    channel: 'text',
    listName: 'Flooding report back',
    message:
      'this is Bryan, your City Council Member. Thanks for answering. Most of you named the drains, so I will ask for them to be cleared first.',
    deepLinkOnly: false,
    reportBackForOutreachId: 77,
  }

  it('saves one list of the people that send reached, as a report back', async () => {
    await openCard(reportBack)

    expect(saved[0]).toMatchObject({
      name: 'Flooding report back',
      sample: {
        size: 236,
        seedKey: PROPOSAL_KEY,
        recipientsOfOutreachId: 77,
      },
    })
    const props = smsFlow.props
    expect(props?.initialPurpose).toBe('report_back')
    expect(props?.reportBackForOutreachId).toBe(77)
    expect(props?.initialAsksToJoinCivicPanel).toBe(false)
    expect(smsFlow.props?.audienceSettled).toBe(true)
    expect(smsFlow.props).not.toHaveProperty('audienceSummary')
    // Linked through the send it answers, never as another ask on the
    // priority.
    expect(props?.proposalLink).toEqual({ proposalKey: PROPOSAL_KEY })
  })

  // Even after a reload: a fresh provider finds the list by the card's key.
  it('reuses the list it saved when the card is opened again', async () => {
    await openCard(reportBack)
    cleanup()
    await openCard(reportBack)

    expect(saved).toHaveLength(1)
    expect(smsFlow.props?.preselectedListId).toBe(501)
  })
})
