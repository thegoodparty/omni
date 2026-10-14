import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChatCard } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
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
  audience: "Your citizens' panel and residents across the district",
  count: 18_400,
  channel: 'text',
  audienceFilters: { hasCellPhone: true, notContactedRecently: true },
  listName: 'Flooding check',
  message: MESSAGE,
  deepLinkOnly: false,
  stepId: 'define',
  side: 'main',
  sampleSize: 84,
  panelSampleSize: 42,
  civicPanelAsk: true,
}

const Opener = ({ proposal }: { proposal: Proposal }) => {
  const flows = useProposalFlows()
  return (
    <button
      type="button"
      disabled={!flows?.textResolved}
      onClick={() => flows?.open(proposal, 'priority-1')}
    >
      Start the text
    </button>
  )
}

const openCard = async (proposal: Proposal) => {
  render(
    <ProposalFlowsProvider>
      <Opener proposal={proposal} />
    </ProposalFlowsProvider>,
  )
  const button = await screen.findByRole('button', { name: 'Start the text' })
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
  await screen.findByTestId('sms-flow')
}

describe("a priority's text card to the panel and new residents", () => {
  beforeEach(() => {
    smsFlow.props = null
  })

  it('opens the Serve text flow on one list holding both draws, the join ask on', async () => {
    await openCard(panelAndFresh)

    const props = smsFlow.props
    expect(props?.surface).toEqual({ isServe: true })
    expect(props?.initialAsksToJoinCivicPanel).toBe(true)
    expect(props?.proposedAudience).toMatchObject({
      name: 'Flooding check',
      filters: { hasCellPhone: true, notContactedRecently: true },
      sample: { size: 84, panelSize: 42, seedKey: PROPOSAL_KEY },
    })
  })

  it('leaves the join ask off for a text that did not ask for it', async () => {
    await openCard({
      ...panelAndFresh,
      panelSampleSize: undefined,
      civicPanelAsk: undefined,
    })

    expect(smsFlow.props?.initialAsksToJoinCivicPanel).toBe(false)
    expect(smsFlow.props?.proposedAudience).toMatchObject({
      sample: { size: 84, seedKey: PROPOSAL_KEY },
    })
    expect(
      (smsFlow.props?.proposedAudience as { sample?: object }).sample,
    ).not.toHaveProperty('panelSize')
  })
})

describe("the Chief of Staff's civic panel invite", () => {
  beforeEach(() => {
    smsFlow.props = null
  })

  // The card's purpose rides into the flow, so it opens past the picker on
  // the build purpose, with the draw of the district's cell phones seeded.
  it('opens the text flow on the build purpose, the join ask on and the draw seeded', async () => {
    await openCard({
      kind: 'outreach_proposal',
      proposalKey: PROPOSAL_KEY,
      audience: 'Residents with a cell phone',
      count: 12_000,
      channel: 'text',
      audienceFilters: { hasCellPhone: true },
      listName: 'Civic panel invite',
      message: MESSAGE,
      deepLinkOnly: false,
      sampleSize: 3334,
      civicPanelAsk: true,
      purpose: 'build_citizens_panel',
    })

    const props = smsFlow.props
    expect(props?.initialPurpose).toBe('build_citizens_panel')
    expect(props?.initialAsksToJoinCivicPanel).toBe(true)
    expect(props?.initialScript).toBe(MESSAGE)
    expect(props?.proposedAudience).toMatchObject({
      name: 'Civic panel invite',
      filters: { hasCellPhone: true },
      sample: { size: 3334, seedKey: PROPOSAL_KEY },
    })
  })

  it('opens any other text on the picker as before', async () => {
    await openCard({ ...panelAndFresh, purpose: undefined })

    expect(smsFlow.props).not.toHaveProperty('initialPurpose')
  })
})

describe('a report back card', () => {
  beforeEach(() => {
    smsFlow.props = null
  })

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

    const props = smsFlow.props
    expect(props?.initialPurpose).toBe('report_back')
    expect(props?.reportBackForOutreachId).toBe(77)
    expect(props?.initialAsksToJoinCivicPanel).toBe(false)
    expect(props?.proposedAudience).toMatchObject({
      name: 'Flooding report back',
      filters: {},
      sample: {
        size: 236,
        seedKey: PROPOSAL_KEY,
        recipientsOfOutreachId: 77,
      },
    })
    // Linked through the send it answers, never as another ask on the
    // priority.
    expect(props?.proposalLink).toEqual({ proposalKey: PROPOSAL_KEY })
  })
})
