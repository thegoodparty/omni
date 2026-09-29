import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChatCard, OutreachDetail } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { ChatCardRenderer } from './ChatCardRenderer'

// The card reads the selected org to key its saved-list read, and the hook
// throws outside the dashboard provider.
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-riverside' }),
}))

const PROPOSAL_KEY = '3f2c1a90-1111-4222-8333-444455556666'

const MESSAGE = 'We are holding a listening session about the bridge closure.'

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

// Two saved lists and a per-list reach that differs by channel, which is what
// makes "the count follows the selection" observable in both directions.
const REACH: Record<string, { sms: number; phoneBanking: number }> = {
  '77': { sms: 400, phoneBanking: 412 },
  '88': { sms: 95, phoneBanking: 120 },
}

const mockAudience = () => {
  api.mock('GET /v1/voters/voter-file/filters', {
    status: 200,
    data: [
      { id: 77, name: 'Riverside' },
      { id: 88, name: 'Northside' },
    ],
  })
  api.mock('GET /v1/contacts/list-detail', ({ query }) => {
    const reach = REACH[String(query.segment)] ?? { sms: 0, phoneBanking: 0 }
    return {
      status: 200,
      data: {
        demographics: { people: 500, avgAge: null, avgIncome: null },
        reachability: {
          sms: reach.sms,
          robocall: null,
          phoneBanking: reach.phoneBanking,
          doorKnocking: null,
          polls: reach.sms,
        },
        outreachHistory: [],
      },
    }
  })
}

const mockNotSent = () =>
  api.mock('GET /v1/outreach/by-proposal-key/:proposalKey', {
    status: 404,
    data: { message: 'Not Found' },
  })

const renderCard = (card: ChatCard) =>
  render(
    <ChatCardRenderer
      card={card}
      priorityId="priority-1"
      conversationId="conversation-1"
    />,
  )

const messageBox = () => screen.getByRole('textbox', { name: 'Message' })

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
  it('offers Send and an editable message when the key has not been sent', async () => {
    mockNotSent()
    mockAudience()

    renderCard(proposalCard())

    expect(
      await screen.findByRole('button', { name: 'Send' }),
    ).toBeInTheDocument()
    expect(messageBox()).toHaveValue(MESSAGE)
    expect(screen.getByText(/412 constituents/)).toBeInTheDocument()
  })

  it('renders the live send and no Send button once the key resolves', async () => {
    api.mock('GET /v1/outreach/by-proposal-key/:proposalKey', {
      status: 200,
      data: outreachRow,
    })
    mockAudience()

    renderCard(proposalCard())

    expect(await screen.findByText(/Sent to/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Open in outreach' }),
    ).toHaveAttribute('href', '/dashboard/constituent-outreach?outreachId=501')
  })

  it('disables Send while the send is in flight', async () => {
    mockNotSent()
    mockAudience()
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
    mockNotSent()
    mockAudience()
    api.mock('PUT /v1/outreach/by-proposal-key/:proposalKey', {
      status: 500,
      data: { message: 'boom' },
    })

    renderCard(proposalCard())

    await userEvent.click(await screen.findByRole('button', { name: 'Send' }))

    expect(await screen.findByText(/That did not send/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('sends the edited message, under the same proposal key', async () => {
    mockNotSent()
    mockAudience()
    const bodies: Record<string, unknown>[] = []
    const keys: string[] = []
    api.mock(
      'PUT /v1/outreach/by-proposal-key/:proposalKey',
      ({ body, params }) => {
        bodies.push(body as unknown as Record<string, unknown>)
        keys.push(params.proposalKey)
        return { status: 200, data: outreachRow }
      },
    )

    renderCard(proposalCard())

    await screen.findByRole('button', { name: 'Send' })
    const user = userEvent.setup()
    await user.clear(messageBox())
    await user.type(messageBox(), 'Come to the bridge meeting on Tuesday.')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({
      message: 'Come to the bridge meeting on Tuesday.',
      channel: 'phoneBanking',
      savedFilterId: 77,
    })
    // The edits do not move the key: it names this proposal, and editing is
    // what the official chose to send under it.
    expect(keys).toEqual([PROPOSAL_KEY])
  })

  it('sends the priority it was proposed under', async () => {
    mockNotSent()
    mockAudience()
    const bodies: Record<string, unknown>[] = []
    api.mock('PUT /v1/outreach/by-proposal-key/:proposalKey', ({ body }) => {
      bodies.push(body as unknown as Record<string, unknown>)
      return { status: 200, data: outreachRow }
    })

    renderCard(proposalCard())

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Send' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ priorityId: 'priority-1' })
  })

  // Chief of Staff proposes outreach outside any priority.
  it('sends no priority when it has none', async () => {
    mockNotSent()
    mockAudience()
    const bodies: Record<string, unknown>[] = []
    api.mock('PUT /v1/outreach/by-proposal-key/:proposalKey', ({ body }) => {
      bodies.push(body as unknown as Record<string, unknown>)
      return { status: 200, data: outreachRow }
    })

    render(
      <ChatCardRenderer
        card={proposalCard()}
        conversationId="conversation-1"
      />,
    )

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Send' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).not.toHaveProperty('priorityId')
  })

  it('follows the picked list with its own count, and sends that list', async () => {
    mockNotSent()
    mockAudience()
    const bodies: Record<string, unknown>[] = []
    api.mock('PUT /v1/outreach/by-proposal-key/:proposalKey', ({ body }) => {
      bodies.push(body as unknown as Record<string, unknown>)
      return { status: 200, data: outreachRow }
    })

    renderCard(proposalCard())

    const user = userEvent.setup()
    await screen.findByRole('button', { name: 'Send' })
    expect(screen.getByText(/412 constituents/)).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'List' }))
    await user.click(await screen.findByRole('option', { name: 'Northside' }))

    expect(await screen.findByText(/120 constituents/)).toBeInTheDocument()
    expect(screen.queryByText(/412 constituents/)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({
      savedFilterId: 88,
      listName: 'Northside',
      count: 120,
    })
  })

  // The server sizes the send from `count`, so until the picked list has
  // been counted there is no honest number to send — and the agent's, measured
  // against a different list, is exactly the wrong one.
  const mockLists = () =>
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [
        { id: 77, name: 'Riverside' },
        { id: 88, name: 'Northside' },
      ],
    })

  const reachFor = (sms: number, phoneBanking: number) => ({
    status: 200 as const,
    data: {
      demographics: { people: 500, avgAge: null, avgIncome: null },
      reachability: {
        sms,
        robocall: null,
        phoneBanking,
        doorKnocking: null,
        polls: sms,
      },
      outreachHistory: [],
    },
  })

  it('holds Send while a newly picked list is still being counted', async () => {
    mockNotSent()
    mockLists()
    let release: (() => void) | undefined
    const counted = new Promise<void>((resolve) => {
      release = resolve
    })
    api.mock('GET /v1/contacts/list-detail', async ({ query }) => {
      if (String(query.segment) === '88') await counted
      return String(query.segment) === '88'
        ? reachFor(95, 120)
        : reachFor(400, 412)
    })

    renderCard(proposalCard())
    const user = userEvent.setup()
    await screen.findByRole('button', { name: 'Send' })

    await user.click(screen.getByRole('combobox', { name: 'List' }))
    await user.click(await screen.findByRole('option', { name: 'Northside' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled(),
    )

    release?.()
    expect(await screen.findByText(/120 constituents/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('holds Send when the newly picked list cannot be counted', async () => {
    mockNotSent()
    mockLists()
    api.mock('GET /v1/contacts/list-detail', ({ query }) =>
      String(query.segment) === '88'
        ? { status: 500, data: { message: 'down' } }
        : reachFor(400, 412),
    )
    const bodies: Record<string, unknown>[] = []
    api.mock('PUT /v1/outreach/by-proposal-key/:proposalKey', ({ body }) => {
      bodies.push(body as unknown as Record<string, unknown>)
      return { status: 200, data: outreachRow }
    })

    renderCard(proposalCard())
    const user = userEvent.setup()
    await screen.findByRole('button', { name: 'Send' })

    await user.click(screen.getByRole('combobox', { name: 'List' }))
    await user.click(await screen.findByRole('option', { name: 'Northside' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled(),
    )
    expect(bodies).toHaveLength(0)
  })

  it('switches to the deep link when the channel becomes SMS', async () => {
    mockNotSent()
    mockAudience()

    renderCard(proposalCard())

    const user = userEvent.setup()
    await screen.findByRole('button', { name: 'Send' })
    await user.click(screen.getByRole('radio', { name: 'SMS' }))

    const link = await screen.findByRole('link', {
      name: 'Finish in outreach',
    })
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining('/dashboard/constituent-outreach?compose=text'),
    )
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    expect(await screen.findByText(/You will pay for this text/)).toBeVisible()
  })

  it('switches to the deep link when the channel becomes social', async () => {
    mockNotSent()
    mockAudience()

    renderCard(proposalCard())

    const user = userEvent.setup()
    await screen.findByRole('button', { name: 'Send' })
    await user.click(screen.getByRole('radio', { name: 'Social media' }))

    expect(
      await screen.findByRole('link', { name: 'Finish in outreach' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    // A post has no recipients, so there is no list to pick and none to count.
    expect(screen.queryByRole('combobox', { name: 'List' })).toBeNull()
    expect(screen.queryByText(/constituents/)).toBeNull()
  })

  it('prices SMS as an estimate and the other two as free', async () => {
    mockNotSent()
    mockAudience()

    renderCard(proposalCard())

    const user = userEvent.setup()
    await screen.findByRole('button', { name: 'Send' })
    expect(screen.getByText(/Free\. You make the calls\./)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'SMS' }))
    // 400 cell phones on the agent's list at the rate the flows already read.
    expect(await screen.findByText(/Estimated cost \$14\.00/)).toBeVisible()

    await user.click(screen.getByRole('radio', { name: 'Social media' }))
    expect(
      await screen.findByText(/Free\. You post it yourself\./),
    ).toBeVisible()
  })

  it('offers only the deep link when deepLinkOnly is set', async () => {
    mockNotSent()
    mockAudience()

    renderCard(proposalCard({ channel: 'social', deepLinkOnly: true }))

    const link = await screen.findByRole('link', {
      name: 'Finish in outreach',
    })
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining('/dashboard/constituent-outreach?compose=social'),
    )
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    // The message is still the point of the card, and still editable.
    expect(messageBox()).toHaveValue(MESSAGE)
  })

  it('suppresses Send on a non-phoneBanking proposal that claims it can send', async () => {
    mockNotSent()
    mockAudience()

    // The payload is the model's raw tool args, so this shape is reachable.
    renderCard(proposalCard({ channel: 'text', deepLinkOnly: false }))

    expect(
      await screen.findByRole('link', { name: 'Finish in outreach' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
  })

  it('carries the social draft through the compose handoff', async () => {
    mockNotSent()
    mockAudience()

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
      draftText: MESSAGE,
    })
  })

  it('shows one quiet line when the proposal cannot be resolved', async () => {
    api.mock('GET /v1/outreach/by-proposal-key/:proposalKey', {
      status: 500,
      data: { message: 'boom' },
    })
    mockAudience()

    renderCard(proposalCard())

    expect(await screen.findByText(/Could not load this/)).toBeInTheDocument()
  })

  it('says so plainly when the office has no saved lists', async () => {
    mockNotSent()
    api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })

    renderCard(proposalCard({ savedFilterId: null, listName: null }))

    expect(await screen.findByText(/No saved lists yet/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'List' })).toBeNull()
  })
})
