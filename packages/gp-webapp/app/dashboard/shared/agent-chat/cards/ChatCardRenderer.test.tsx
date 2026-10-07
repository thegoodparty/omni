import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import type { ChatCard, OutreachDetail } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { ChatCardRenderer } from './ChatCardRenderer'

// The flows themselves are the outreach page's components and have their own
// suite (proposalFlows.test.tsx). Here only what the chip hands them.
const flows = vi.hoisted(() => ({
  mode: 'serve' as 'win' | 'serve',
  open: vi.fn(),
  textAvailable: true,
  textResolved: true,
}))
vi.mock('./proposalFlows', () => ({
  ProposalFlowsProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useProposalFlows: () => flows,
}))

afterEach(() => {
  flows.mode = 'serve'
  flows.textAvailable = true
  flows.textResolved = true
})

const PROPOSAL_KEY = '3f2c1a90-1111-4222-8333-444455556666'

const MESSAGE = 'We are holding a listening session about the bridge closure.'

type Proposal = Extract<ChatCard, { kind: 'outreach_proposal' }>

const proposalCard = (overrides: Partial<Proposal> = {}): Proposal => ({
  kind: 'outreach_proposal',
  proposalKey: PROPOSAL_KEY,
  audience: 'Riverside neighbors',
  count: 412,
  channel: 'phoneBanking',
  audienceFilters: { homeownerNo: true, precincts: ['12'] },
  listName: 'Riverside renters',
  message: MESSAGE,
  why: 'These are the households closest to the detour.',
  deepLinkOnly: false,
  ...overrides,
})

const outreachRow: OutreachDetail = {
  id: 501,
  createdAt: new Date('2026-09-01T12:00:00.000Z'),
  updatedAt: new Date('2026-09-01T12:00:00.000Z'),
  campaignId: null,
  outreachType: 'phoneBanking',
  projectId: null,
  name: 'Riverside',
  status: 'completed',
  error: null,
  audienceRequest: null,
  script: MESSAGE,
  message: MESSAGE,
  date: new Date('2026-09-02T12:00:00.000Z'),
  imageUrl: null,
  voterFileFilterId: 77,
  doorKnockingRouteId: null,
  phoneListId: null,
  identityId: null,
  didState: null,
  didNpaSubset: [],
  title: null,
  textCount: 412,
  billableTextCount: null,
  campaignPlanDueDate: null,
  organizationSlug: 'eo-riverside',
  archivedAt: null,
}

const mockNotSent = () =>
  api.mock('GET /v1/outreach/by-proposal-key/:proposalKey', {
    status: 404,
    data: { message: 'Not Found' },
  })

const renderCard = (card: ChatCard, priorityId?: string) =>
  render(
    <ChatCardRenderer
      card={card}
      {...(priorityId !== undefined && { priorityId })}
    />,
  )

describe('ChatCardRenderer', () => {
  it('renders nothing for a kind it does not know', () => {
    // A thread written by a newer build must still open.
    const { container } = renderCard({
      kind: 'something_newer',
    } as unknown as ChatCard)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('OutreachProposalCard', () => {
  it('is the audience, the count, the one channel and a button, nothing more', async () => {
    mockNotSent()

    renderCard(proposalCard())

    expect(await screen.findByText('Riverside neighbors')).toBeInTheDocument()
    expect(
      screen.getByText('Phone banking · 412 constituents'),
    ).toBeInTheDocument()
    // No channel switcher, no why, no cost note, no compose: the agent says
    // why in its message and the flow owns everything after the button.
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(
      screen.queryByText('These are the households closest to the detour.'),
    ).toBeNull()
    expect(screen.queryByText(/pay|free/i)).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it.each([
    ['text', 'Start the text'],
    ['phoneBanking', 'Start the calls'],
    ['social', 'Start the post'],
    ['doorKnocking', 'Start the walk'],
  ] as const)(
    'opens the %s flow in place, with the proposal and its priority',
    async (channel, cta) => {
      mockNotSent()
      const card = proposalCard({ channel })

      renderCard(card, 'priority-1')

      fireEvent.click(await screen.findByRole('button', { name: cta }))

      expect(flows.open).toHaveBeenCalledWith(card, 'priority-1')
    },
  )

  it('says a sampled proposal reaches some of its audience, picked at random', async () => {
    mockNotSent()

    renderCard(
      proposalCard({ channel: 'text', count: 58_520, sampleSize: 4_000 }),
    )

    expect(
      await screen.findByText('Text 4,000 of 58,520, picked at random'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Start the text' }),
    ).toBeInTheDocument()
  })

  it('reads a sample no smaller than its audience as the whole audience', async () => {
    mockNotSent()

    renderCard(proposalCard({ sampleSize: 500 }))

    expect(
      await screen.findByText('Phone banking · 412 constituents'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/picked at random/)).toBeNull()
  })

  it('says text is not available, and offers nothing, while SMS is off', async () => {
    mockNotSent()
    flows.textAvailable = false

    renderCard(proposalCard({ channel: 'text' }))

    expect(
      await screen.findByText('Texting is not available for your office yet'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('reads as sent once its key resolves, and leads to that send', async () => {
    api.mock('GET /v1/outreach/by-proposal-key/:proposalKey', {
      status: 200,
      data: outreachRow,
    })

    renderCard(proposalCard())

    const link = await screen.findByRole('link', {
      name: /Riverside neighbors/,
    })
    expect(within(link).getByText(/Sent to 412 constituents/)).toBeVisible()
    expect(link).toHaveAttribute(
      'href',
      '/dashboard/constituent-outreach?outreachId=501',
    )
  })

  it('shows one quiet line when the proposal cannot be resolved', async () => {
    api.mock('GET /v1/outreach/by-proposal-key/:proposalKey', {
      status: 500,
      data: { message: 'boom' },
    })

    renderCard(proposalCard())

    expect(await screen.findByText(/Could not load this/)).toBeInTheDocument()
  })
})

describe('OutreachProposalCard in Campaign Manager', () => {
  it('counts voters and opens the text flow', async () => {
    mockNotSent()
    flows.mode = 'win'
    const card = proposalCard({ channel: 'text' })

    renderCard(card)

    expect(await screen.findByText('SMS · 412 voters')).toBeInTheDocument()
    expect(screen.queryByText(/constituent/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start the text' }))
    expect(flows.open).toHaveBeenCalledWith(card, undefined)
  })

  it('holds the button until the text gate can run', async () => {
    mockNotSent()
    flows.mode = 'win'
    flows.textResolved = false

    renderCard(proposalCard({ channel: 'text' }))

    expect(
      await screen.findByRole('button', { name: 'Start the text' }),
    ).toBeDisabled()
  })

  it('offers no button for a channel with no Win flow here', async () => {
    mockNotSent()
    flows.mode = 'win'

    renderCard(proposalCard({ channel: 'phoneBanking' }))

    expect(
      await screen.findByText('Phone banking · 412 voters'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('reads as sent and leads to the Voter Outreach row', async () => {
    flows.mode = 'win'
    api.mock('GET /v1/outreach/by-proposal-key/:proposalKey', {
      status: 200,
      data: { ...outreachRow, outreachType: 'p2p', campaignId: 9 },
    })

    renderCard(proposalCard({ channel: 'text' }))

    const link = await screen.findByRole('link', {
      name: /Riverside neighbors/,
    })
    expect(within(link).getByText(/Sent to 412 voters/)).toBeVisible()
    expect(link).toHaveAttribute('href', '/dashboard/outreach?outreachId=501')
  })
})
