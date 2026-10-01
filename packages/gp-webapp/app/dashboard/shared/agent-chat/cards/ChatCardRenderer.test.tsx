import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import type { ChatCard, OutreachDetail } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { ChatCardRenderer } from './ChatCardRenderer'

const smsFlag = vi.hoisted(() => ({ ready: false, enabled: false }))
vi.mock('@shared/experiments/serveSmsFlag', () => ({
  useServeSmsFlag: () => smsFlag,
}))

afterEach(() => {
  smsFlag.ready = false
  smsFlag.enabled = false
})

const PROPOSAL_KEY = '3f2c1a90-1111-4222-8333-444455556666'

const MESSAGE = 'We are holding a listening session about the bridge closure.'

type Proposal = Extract<ChatCard, { kind: 'outreach_proposal' }>

const proposalCard = (overrides: Partial<Proposal> = {}): ChatCard => ({
  kind: 'outreach_proposal',
  proposalKey: PROPOSAL_KEY,
  audience: 'Riverside neighbors',
  count: 412,
  channel: 'phoneBanking',
  savedFilterId: 77,
  listName: 'Riverside',
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

const chip = () => screen.findByRole('link', { name: /Riverside neighbors/ })

const handoffOf = (link: HTMLElement) => {
  const url = new URL(link.getAttribute('href') ?? '', 'http://localhost')
  const nonce = url.searchParams.get('handoff')
  return {
    url,
    stored: () =>
      JSON.parse(sessionStorage.getItem(`cos-handoff-${nonce}`) ?? 'null'),
  }
}

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
  it('is one chip naming the audience, channel and reach, with nothing to send here', async () => {
    mockNotSent()

    renderCard(proposalCard())

    const link = await chip()
    expect(
      within(link).getByText('Phone banking · 412 constituents'),
    ).toBeInTheDocument()
    // The send belongs to the phone banking flow, not to the chat.
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each(['phoneBanking', 'text'] as const)(
    'opens the %s flow with the list and the message carried in',
    async (channel) => {
      mockNotSent()

      renderCard(proposalCard({ channel }))

      const link = await chip()
      const { url, stored } = handoffOf(link)
      expect(url.pathname).toBe('/dashboard/constituent-outreach')
      expect(url.searchParams.get('compose')).toBe(channel)
      // The message rides storage, never the link.
      expect(link.getAttribute('href')).not.toContain('bridge')

      fireEvent.click(link)

      // The key rides through to the flow's create, so the send is linked
      // to the proposal and a second completion returns the first.
      expect(stored()).toEqual({
        channel,
        message: MESSAGE,
        savedFilterId: 77,
        name: 'Riverside',
        proposalKey: PROPOSAL_KEY,
      })
    },
  )

  it('names the send after the audience when the list has no name', async () => {
    mockNotSent()

    renderCard(proposalCard({ listName: null }))

    const link = await chip()
    fireEvent.click(link)

    expect(handoffOf(link).stored()).toMatchObject({
      name: 'Riverside neighbors',
    })
  })

  it('carries the priority it was proposed under', async () => {
    mockNotSent()

    renderCard(proposalCard(), 'priority-1')

    const link = await chip()
    fireEvent.click(link)

    expect(handoffOf(link).stored()).toMatchObject({
      proposalKey: PROPOSAL_KEY,
      priorityId: 'priority-1',
    })
  })

  it('says text is not available, and links nowhere, while SMS is off', async () => {
    mockNotSent()
    smsFlag.ready = true
    smsFlag.enabled = false

    renderCard(proposalCard({ channel: 'text' }))

    expect(
      await screen.findByText('Texting is not available for your office yet'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('opens the social flow with the draft and the proposal link', async () => {
    mockNotSent()

    renderCard(proposalCard({ channel: 'social', deepLinkOnly: true }))

    const link = await chip()
    // A post has no recipients, so the chip quotes no reach.
    expect(within(link).getByText('Social media')).toBeInTheDocument()
    const { url, stored } = handoffOf(link)
    expect(url.searchParams.get('compose')).toBe('social')

    fireEvent.click(link)

    expect(stored()).toEqual({
      channel: 'social',
      message: MESSAGE,
      savedFilterId: 77,
      name: 'Riverside',
      proposalKey: PROPOSAL_KEY,
    })
  })

  // The proposal contract is gaining door knocking; the card routes it the
  // moment a payload carries it.
  it('opens the door knocking create flow on the saved list', async () => {
    mockNotSent()

    renderCard(
      proposalCard({
        channel: 'doorKnocking' as Proposal['channel'],
        deepLinkOnly: true,
      }),
    )

    const link = await chip()
    const url = new URL(link.getAttribute('href') ?? '', 'http://localhost')
    expect(url.pathname).toBe('/dashboard/door-knocking')
    expect(url.searchParams.get('create')).toBe('1')
    expect(url.searchParams.get('listId')).toBe('77')
  })

  it('reads as sent once its key resolves, and opens that send instead', async () => {
    api.mock('GET /v1/outreach/by-proposal-key/:proposalKey', {
      status: 200,
      data: outreachRow,
    })

    renderCard(proposalCard())

    const link = await chip()
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
