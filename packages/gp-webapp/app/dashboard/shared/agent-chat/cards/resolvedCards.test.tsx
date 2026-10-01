import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChatCard, OutreachDetail, Person } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { toChatCard } from './toChatCard'
import { ChatCardRenderer } from './ChatCardRenderer'

const renderCard = (card: ChatCard) => render(<ChatCardRenderer card={card} />)

const openChip = async (name: RegExp) => {
  await userEvent.click(await screen.findByRole('button', { name }))
  return within(await screen.findByRole('dialog'))
}

const outreachDetail = (id: number, name: string): OutreachDetail => ({
  id,
  createdAt: new Date('2026-09-01T12:00:00.000Z'),
  updatedAt: new Date('2026-09-01T12:00:00.000Z'),
  campaignId: null,
  outreachType: 'text',
  projectId: null,
  name,
  status: 'completed',
  error: null,
  audienceRequest: null,
  script: null,
  message: 'Thanks for coming out.',
  date: new Date('2026-09-02T12:00:00.000Z'),
  imageUrl: null,
  voterFileFilterId: null,
  doorKnockingRouteId: null,
  phoneListId: null,
  identityId: null,
  didState: null,
  didNpaSubset: [],
  title: null,
  textCount: 310,
  billableTextCount: 310,
  campaignPlanDueDate: null,
  organizationSlug: 'eo-riverside',
  archivedAt: null,
})

const person = (id: string, firstName: string): Person => ({
  id,
  lalVoterId: `LAL-${id}`,
  firstName,
  middleName: null,
  lastName: 'Okafor',
  nameSuffix: null,
  age: 54,
  state: 'OH',
  address: {
    line1: '14 Mill St',
    line2: null,
    city: 'Riverside',
    state: 'OH',
    zip: '45431',
    zipPlus4: null,
    latitude: null,
    longitude: null,
  },
  cellPhone: null,
  landline: null,
  gender: null,
  registeredVoter: 'Yes',
  estimatedIncomeAmount: null,
  voterStatus: null,
  maritalStatus: null,
  hasChildrenUnder18: null,
  veteranStatus: null,
  homeowner: null,
  businessOwner: null,
  levelOfEducation: null,
  ethnicityGroup: null,
  language: null,
})

describe('PastOutreachCard', () => {
  it('renders a row per send that resolves, and links each one', async () => {
    api.mock('GET /v1/outreach/serve/:id', ({ params }) => ({
      status: 200,
      data: outreachDetail(Number(params.id), `Send ${params.id}`),
    }))
    api.mock('GET /v1/outreach/serve/:id/results', {
      status: 200,
      data: { contacts: 310, responded: 22, optedOut: 1 },
    })

    renderCard({
      kind: 'past_outreach',
      outreachIds: [11, 12],
      note: 'Both of these reached the same block.',
    })

    // One chip per send, each opening that send in outreach history. No
    // panel here: history already owns what a send looks like afterwards.
    const first = await screen.findByRole('link', { name: /Send 11/ })
    expect(first).toHaveAttribute(
      'href',
      '/dashboard/constituent-outreach?outreachId=11',
    )
    expect(screen.getByRole('link', { name: /Send 12/ })).toBeInTheDocument()
    expect(
      await within(first).findByText(
        'SMS · 310 constituents · 22 responses · Sep 2',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Both of these reached the same block.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders nothing when every id fails to resolve', async () => {
    api.mock('GET /v1/outreach/serve/:id', {
      status: 404,
      data: { message: 'Not Found' },
    })

    const { container } = renderCard({
      kind: 'past_outreach',
      outreachIds: [11],
      note: 'Both of these reached the same block.',
    })

    await screen.findByTestId('chat-card-loading')
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})

describe('ConstituentsCard', () => {
  it('renders a row per contact that resolves, and links each one', async () => {
    api.mock('GET /v1/contacts/:id', ({ params }) => ({
      status: 200,
      data: person(params.id, params.id === 'p1' ? 'Ada' : 'Ben'),
    }))

    renderCard({
      kind: 'constituents',
      contactIds: ['p1', 'p2'],
      note: 'Both chair neighborhood groups on the west side.',
    })

    const chip = await screen.findByRole('button', { name: /2 constituents/ })
    // Stacked initials, one per person, before anything is opened.
    expect(within(chip).getByText('AO')).toBeInTheDocument()
    expect(within(chip).getByText('BO')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Ada Okafor/ })).toBeNull()

    const panel = await openChip(/2 constituents/)
    // Each row opens the contacts page's own person panel for that id.
    expect(panel.getByRole('link', { name: /Ada Okafor/ })).toHaveAttribute(
      'href',
      '/dashboard/contacts/p1',
    )
    expect(panel.getByRole('link', { name: /Ben Okafor/ })).toBeInTheDocument()
    expect(
      panel.getByText('Both chair neighborhood groups on the west side.'),
    ).toBeInTheDocument()
  })

  it.each(['present_constituents', 'present_contacts'])(
    'renders from a %s tool call, so a thread written before the rename still shows the card',
    async (toolName) => {
      api.mock('GET /v1/contacts/:id', ({ params }) => ({
        status: 200,
        data: person(params.id, 'Ada'),
      }))

      const card = toChatCard({
        toolName,
        args: { contactIds: ['p1'], note: 'She chairs the west side group.' },
        toolCallId: 'toolu_01xyz',
        conversationId: 'conversation-1',
      })
      expect(card?.kind).toBe('constituents')
      if (!card) throw new Error('expected a card')
      renderCard(card)

      const panel = await openChip(/1 constituent/)
      expect(panel.getByRole('link', { name: /Ada Okafor/ })).toHaveAttribute(
        'href',
        '/dashboard/contacts/p1',
      )
    },
  )

  it('renders nothing when every contact fails to resolve', async () => {
    api.mock('GET /v1/contacts/:id', {
      status: 404,
      data: { message: 'Not Found' },
    })

    const { container } = renderCard({
      kind: 'constituents',
      contactIds: ['p1'],
      note: 'Both chair neighborhood groups on the west side.',
    })

    await screen.findByTestId('chat-card-loading')
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
