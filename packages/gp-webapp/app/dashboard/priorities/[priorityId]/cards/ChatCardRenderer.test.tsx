import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChatCard, OutreachDetail } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { ChatCardRenderer } from './ChatCardRenderer'

const PROPOSAL_KEY = '3f2c1a90-1111-4222-8333-444455556666'

const proposalCard = (
  overrides: Partial<Extract<ChatCard, { kind: 'outreach_proposal' }>> = {},
): ChatCard => ({
  kind: 'outreach_proposal',
  proposalKey: PROPOSAL_KEY,
  audience: 'Riverside neighbors',
  count: 412,
  channel: 'phoneBanking',
  savedFilterId: 77,
  listName: 'Riverside',
  message: 'We are holding a listening session about the bridge closure.',
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
  script: 'We are holding a listening session about the bridge closure.',
  message: 'We are holding a listening session about the bridge closure.',
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

const renderCard = (card: ChatCard) =>
  render(
    <ChatCardRenderer
      card={card}
      priorityId="priority-1"
      conversationId="conversation-1"
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
  it('offers Send when the proposal key has not been sent', async () => {
    api.mock('GET /v1/outreach/by-proposal-key/:proposalKey', {
      status: 404,
      data: { message: 'Not Found' },
    })

    renderCard(proposalCard())

    expect(
      await screen.findByRole('button', { name: 'Send' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'We are holding a listening session about the bridge closure.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/412 constituents/)).toBeInTheDocument()
  })

  it('renders the live send and no Send button once the key resolves', async () => {
    api.mock('GET /v1/outreach/by-proposal-key/:proposalKey', {
      status: 200,
      data: outreachRow,
    })

    renderCard(proposalCard())

    expect(await screen.findByText(/Sent to/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Open in outreach' }),
    ).toHaveAttribute('href', '/dashboard/constituent-outreach?outreachId=501')
  })

  it('disables Send while the send is in flight', async () => {
    api.mock('GET /v1/outreach/by-proposal-key/:proposalKey', {
      status: 404,
      data: { message: 'Not Found' },
    })
    let release: (() => void) | undefined
    const inFlight = new Promise<void>((resolve) => {
      release = resolve
    })
    api.mock('PUT /v1/outreach/by-proposal-key/:proposalKey', async () => {
      await inFlight
      return { status: 200, data: outreachRow }
    })

    renderCard(proposalCard())

    const sendButton = await screen.findByRole('button', { name: 'Send' })
    await userEvent.click(sendButton)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Sending/ })).toBeDisabled()
    })

    release?.()

    // And it transitions in place to the live rendering, with no Send left.
    expect(await screen.findByText(/Sent to/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
  })

  it('keeps Send available after a failed send', async () => {
    api.mock('GET /v1/outreach/by-proposal-key/:proposalKey', {
      status: 404,
      data: { message: 'Not Found' },
    })
    api.mock('PUT /v1/outreach/by-proposal-key/:proposalKey', {
      status: 500,
      data: { message: 'boom' },
    })

    renderCard(proposalCard())

    await userEvent.click(await screen.findByRole('button', { name: 'Send' }))

    expect(await screen.findByText(/That did not send/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('offers only the deep link when deepLinkOnly is set', async () => {
    api.mock('GET /v1/outreach/by-proposal-key/:proposalKey', {
      status: 404,
      data: { message: 'Not Found' },
    })

    renderCard(proposalCard({ channel: 'social', deepLinkOnly: true }))

    const link = await screen.findByRole('link', {
      name: 'Finish in outreach',
    })
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining('/dashboard/constituent-outreach?compose=social'),
    )
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    // The message is still the point of the card, not a lost button.
    expect(
      screen.getByText(
        'We are holding a listening session about the bridge closure.',
      ),
    ).toBeInTheDocument()
  })

  it('suppresses Send on a non-phoneBanking proposal that claims it can send', async () => {
    api.mock('GET /v1/outreach/by-proposal-key/:proposalKey', {
      status: 404,
      data: { message: 'Not Found' },
    })

    // The payload is the model's raw tool args, so this shape is reachable.
    renderCard(proposalCard({ channel: 'text', deepLinkOnly: false }))

    expect(
      await screen.findByRole('link', { name: 'Finish in outreach' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
  })

  it('carries the social draft through the compose handoff', async () => {
    api.mock('GET /v1/outreach/by-proposal-key/:proposalKey', {
      status: 404,
      data: { message: 'Not Found' },
    })

    renderCard(proposalCard({ channel: 'social', deepLinkOnly: true }))

    const link = await screen.findByRole('link', {
      name: 'Finish in outreach',
    })
    const nonce = new URL(
      link.getAttribute('href') ?? '',
      'http://localhost',
    ).searchParams.get('handoff')
    expect(nonce).toBeTruthy()

    await userEvent.click(link)

    expect(
      JSON.parse(sessionStorage.getItem(`cos-handoff-${nonce}`) ?? '{}'),
    ).toEqual({
      channel: 'serve_social',
      draftText: 'We are holding a listening session about the bridge closure.',
    })
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
