import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import {
  PRIORITY_STEP_LABELS,
  emptyPriorityStatus,
  mintProposalKey,
  PROPOSAL_SENT_MARKER,
  type PriorityStatus,
} from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import type {
  ChatMessageDto,
  ChatStreamEvent,
} from '../../../shared/agent-chat/chatClient'
import { PriorityWorkspace } from './PriorityWorkspace'

const CONVERSATION_ID = 'conv-1'

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  listMessages: vi.fn(),
  streamMessage: vi.fn(),
  fetchPriorityStatus: vi.fn(),
  sentListener: null as
    | null
    | ((proposal: Record<string, string | number | boolean>) => void),
}))

vi.mock('../data/chat-api', () => ({
  priorityFlowChatApi: {
    createConversation: mocks.createConversation,
    listMessages: mocks.listMessages,
    streamMessage: mocks.streamMessage,
  },
}))

vi.mock('../data/priority-api', () => ({
  fetchPriorityStatus: mocks.fetchPriorityStatus,
}))

vi.mock('../../../shared/dictation/useDictationAppend', () => ({
  useDictationAppend: () => ({
    supported: false,
    active: false,
    start: vi.fn(),
    stop: vi.fn(),
    toggle: vi.fn(),
    error: null,
  }),
}))

// The card components are another surface's concern; this asserts only that a
// card tool call reaches the renderer, and with which key. The outside contact
// is the exception, rendered for real, because where its detail opens is this
// surface's concern.
vi.mock('../../../shared/agent-chat/cards/ChatCardRenderer', async () => {
  const { OutsideContactCard } = await vi.importActual<
    typeof import('../../../shared/agent-chat/cards/OutsideContactCard')
  >('../../../shared/agent-chat/cards/OutsideContactCard')
  return {
    ChatCardRenderer: ({
      card,
      detailKey,
    }: {
      card: { kind: string; proposalKey?: string }
      detailKey?: string
    }) =>
      card.kind === 'outside_contact' ? (
        <OutsideContactCard
          card={card as Parameters<typeof OutsideContactCard>[0]['card']}
          {...(detailKey !== undefined && { detailKey })}
        />
      ) : (
        <div
          data-testid="chat-card"
          data-kind={card.kind}
          data-proposal-key={card.proposalKey ?? ''}
        />
      ),
  }
})

// The outreach flows are the outreach page's components; mounting them here
// is covered in proposalFlows.test.tsx.
vi.mock('../../../shared/agent-chat/cards/proposalFlows', () => ({
  ProposalFlowsProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useProposalFlows: () => null,
  useOnProposalSent: (
    listener: (proposal: Record<string, string | number | boolean>) => void,
  ) => {
    mocks.sentListener = listener
  },
}))

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve = (): void => undefined
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const streamOf = (
  events: ChatStreamEvent[],
  gate?: Promise<void>,
): (() => AsyncGenerator<ChatStreamEvent>) =>
  async function* () {
    for (const event of events) {
      if (event.type === 'done' && gate) await gate
      yield event
    }
  }

const proposalArgs = {
  audience: 'Households on the Maple Street route',
  count: 412,
  channel: 'phoneBanking',
  message: 'Calling about the repaving schedule.',
  why: 'They are the ones the closure affects.',
}

const renderWorkspace = (
  initialStatus: PriorityStatus = emptyPriorityStatus(),
) =>
  render(
    <PriorityWorkspace
      priorityId="pri-1"
      title="Fix the Maple Street flooding"
      description="Storm drains back up after every heavy rain."
      initialStatus={initialStatus}
      initialNextAction={null}
    />,
  )

const railRow = (label: string): HTMLElement =>
  screen.getAllByRole('button', { name: new RegExp(label, 'i') })[0]!

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createConversation.mockResolvedValue({
    conversationId: CONVERSATION_ID,
  })
  mocks.listMessages.mockResolvedValue([])
  mocks.streamMessage.mockImplementation(streamOf([]))
  mocks.fetchPriorityStatus.mockResolvedValue(null)
})

describe('PriorityWorkspace', () => {
  it('opens the conversation anchored on the priority and takes the first turn', async () => {
    renderWorkspace()
    await waitFor(() => expect(mocks.createConversation).toHaveBeenCalled())
    expect(mocks.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'priority',
        resourceId: 'pri-1',
      }),
    )
    await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalled())
  })

  it('moves the rail while the turn is still streaming, then reconciles', async () => {
    const gate = deferred()
    mocks.streamMessage.mockImplementation(
      streamOf(
        [
          { type: 'text', delta: 'Looking at the drainage report now. ' },
          {
            type: 'tool_call',
            toolName: 'update_priority_status',
            toolCallId: 'tc-status',
            args: {
              steps: [
                { id: 'evidence', state: 'settled', summary: 'Maple floods.' },
              ],
              nextAction: 'Pick two blocks to walk',
            },
          },
          { type: 'done', assistantMessageId: 'a1' },
        ],
        gate.promise,
      ),
    )

    renderWorkspace()

    // Mid-turn: the rail has moved although `done` has not arrived.
    await waitFor(() =>
      expect(
        within(railRow(PRIORITY_STEP_LABELS.evidence)).getByText('Done'),
      ).toBeInTheDocument(),
    )
    expect(mocks.fetchPriorityStatus).not.toHaveBeenCalled()
    expect(screen.getByText('Pick two blocks to walk')).toBeInTheDocument()

    // The turn settles and the rail is reconciled against what was stored.
    const persisted: PriorityStatus = {
      ...emptyPriorityStatus(),
      steps: emptyPriorityStatus().steps.map((step) =>
        step.id === 'evidence'
          ? { ...step, state: 'stale' as const, caveat: 'Report disagrees.' }
          : step,
      ),
    }
    mocks.fetchPriorityStatus.mockResolvedValue({
      status: persisted,
      nextAction: null,
    })
    // The turn's persisted row, so the engine's commit poll finds it and the
    // turn settles instead of waiting out its window.
    mocks.listMessages.mockResolvedValue([
      {
        id: 'a1',
        conversationId: CONVERSATION_ID,
        role: 'assistant',
        content: 'Looking at the drainage report now.',
        createdAt: '2026-09-01T00:00:00.000Z',
        segments: [
          { kind: 'text', text: 'Looking at the drainage report now.' },
        ],
      } satisfies ChatMessageDto,
    ])
    gate.resolve()

    await waitFor(() =>
      expect(
        within(railRow(PRIORITY_STEP_LABELS.evidence)).getByText(
          'Needs another look',
        ),
      ).toBeInTheDocument(),
    )
  })

  it('leaves a marker in the conversation, saying so when a step goes backwards', async () => {
    const settled: PriorityStatus = {
      ...emptyPriorityStatus(),
      steps: emptyPriorityStatus().steps.map((step) =>
        step.id === 'options' ? { ...step, state: 'settled' as const } : step,
      ),
    }
    const turn: ChatMessageDto = {
      id: 'a1',
      conversationId: CONVERSATION_ID,
      role: 'assistant',
      content: '',
      createdAt: '2026-09-01T00:00:00.000Z',
      segments: [
        { kind: 'text', text: 'That changes the picture.' },
        {
          kind: 'tool',
          toolName: 'update_priority_status',
          toolCallId: 'tc-status',
          payload: {
            steps: [
              { id: 'define', state: 'settled' },
              { id: 'options', state: 'active' },
            ],
            nextAction: '',
          },
        },
      ],
    }
    // The replay starts from an empty status, so `options` has to be settled
    // by an earlier call for the later move to read as backwards.
    const earlier: ChatMessageDto = {
      ...turn,
      id: 'a0',
      segments: [
        {
          kind: 'tool',
          toolName: 'update_priority_status',
          toolCallId: 'tc-earlier',
          payload: { steps: [{ id: 'options', state: 'settled' }] },
        },
      ],
    }
    mocks.listMessages.mockResolvedValue([earlier, turn])
    mocks.fetchPriorityStatus.mockResolvedValue({
      status: settled,
      nextAction: null,
    })

    renderWorkspace()

    expect(await screen.findByText('Done with the problem')).toBeInTheDocument()
    expect(screen.getByText('Back to your options')).toBeInTheDocument()
  })

  it('renders a card tool call through ChatCardRenderer with a derived proposalKey', async () => {
    mocks.listMessages.mockResolvedValue([
      {
        id: 'a1',
        conversationId: CONVERSATION_ID,
        role: 'assistant',
        content: '',
        createdAt: '2026-09-01T00:00:00.000Z',
        segments: [
          { kind: 'text', text: 'Here is a call list you can send.' },
          {
            kind: 'tool',
            toolName: 'present_outreach_proposal',
            toolCallId: 'tc-proposal',
            payload: proposalArgs,
          },
        ],
      } satisfies ChatMessageDto,
    ])

    renderWorkspace()

    const card = await screen.findByTestId('chat-card')
    expect(card).toHaveAttribute('data-kind', 'outreach_proposal')
    expect(card).toHaveAttribute(
      'data-proposal-key',
      mintProposalKey(CONVERSATION_ID, 'tc-proposal'),
    )
  })

  it('opens a card in a sheet over the page, leaving the rail, and the X closes it', async () => {
    mocks.listMessages.mockResolvedValue([
      {
        id: 'a1',
        conversationId: CONVERSATION_ID,
        role: 'assistant',
        content: '',
        createdAt: '2026-09-01T00:00:00.000Z',
        segments: [
          { kind: 'text', text: 'He runs the permit desk.' },
          {
            kind: 'tool',
            toolName: 'present_outside_contact',
            toolCallId: 'tc-contact',
            payload: {
              name: 'Mark Matheny',
              role: 'Director, Development Services Department',
              why: 'He signs off on the drainage permits.',
              askFor: 'The stormwater review',
              script: 'Calling about the Maple Street drains.',
              phone: '(828) 555-0100',
            },
          },
        ],
      } satisfies ChatMessageDto,
    ])

    renderWorkspace()

    const chip = await screen.findByRole('button', { name: /Mark Matheny/ })
    const rail = screen.getByRole('complementary')
    expect(
      screen.queryByText('Calling about the Maple Street drains.'),
    ).toBeNull()

    chip.focus()
    fireEvent.click(chip)

    const sheet = await screen.findByRole('dialog')
    expect(
      within(sheet).getByText('Calling about the Maple Street drains.'),
    ).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: /Call/ })).toHaveAttribute(
      'href',
      'tel:8285550100',
    )
    expect(
      within(rail).getByText(PRIORITY_STEP_LABELS.evidence),
    ).toBeInTheDocument()
    expect(chip).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      screen.queryByText('Calling about the Maple Street drains.'),
    ).toBeNull()
    await waitFor(() => expect(chip).toHaveFocus())
  })

  it('renders a clarify question, and answering it sends an ordinary turn', async () => {
    mocks.listMessages.mockResolvedValue([
      {
        id: 'a1',
        conversationId: CONVERSATION_ID,
        role: 'assistant',
        content: '',
        createdAt: '2026-09-01T00:00:00.000Z',
        segments: [
          { kind: 'text', text: 'One thing before we go on.' },
          {
            kind: 'tool',
            toolName: 'ask_clarify_question',
            toolCallId: 'tc-clarify',
            payload: {
              questionId: 'q1',
              question: 'Which blocks do you want repaired first?',
              options: [
                { label: 'The two by the school' },
                { label: 'Maple Ave end to end' },
              ],
            },
          },
        ],
      } satisfies ChatMessageDto,
    ])

    // Hold the answer's turn open, so the bubble it pushes is still on screen
    // when the assertion runs rather than replaced by the commit poll.
    const gate = deferred()
    mocks.streamMessage.mockImplementation(
      streamOf([{ type: 'done', assistantMessageId: 'a2' }], gate.promise),
    )

    renderWorkspace()

    expect(
      await screen.findByText('Which blocks do you want repaired first?'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByText('The two by the school'))

    await waitFor(() =>
      expect(mocks.streamMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: CONVERSATION_ID,
          content: 'The two by the school',
        }),
      ),
    )
    // A normal turn, so the answer reads back as the official's own message
    // alongside the option they picked, not as a hidden send.
    await waitFor(() =>
      expect(screen.getAllByText('The two by the school')).toHaveLength(2),
    )
    gate.resolve()
  })

  it('reloads an answered clarify question with its choice checked', async () => {
    mocks.listMessages.mockResolvedValue([
      {
        id: 'a1',
        conversationId: CONVERSATION_ID,
        role: 'assistant',
        content: '',
        createdAt: '2026-09-01T00:00:00.000Z',
        segments: [
          {
            kind: 'tool',
            toolName: 'ask_clarify_question',
            toolCallId: 'tc-clarify',
            payload: {
              questionId: 'q1',
              question: 'Which blocks do you want repaired first?',
              options: [{ label: 'The two by the school' }],
            },
          },
        ],
      } satisfies ChatMessageDto,
      {
        id: 'u1',
        conversationId: CONVERSATION_ID,
        role: 'user',
        content: 'The two by the school',
        createdAt: '2026-09-01T00:01:00.000Z',
      } satisfies ChatMessageDto,
    ])

    renderWorkspace()

    expect(
      await screen.findByText('Which blocks do you want repaired first?'),
    ).toBeInTheDocument()
    const choice = screen.getByRole('radio', { name: 'The two by the school' })
    expect(choice).toBeChecked()
    expect(choice).toBeDisabled()
    // Answered, so there is nothing left to write in.
    expect(screen.queryByText('Or write your own...')).not.toBeInTheDocument()
  })

  it('reloads a multi-select answer with the chosen set checked', async () => {
    mocks.listMessages.mockResolvedValue([
      {
        id: 'a1',
        conversationId: CONVERSATION_ID,
        role: 'assistant',
        content: '',
        createdAt: '2026-09-01T00:00:00.000Z',
        segments: [
          {
            kind: 'tool',
            toolName: 'ask_clarify_question',
            toolCallId: 'tc-clarify',
            payload: {
              questionId: 'q1',
              question: 'Which of these hold up for you?',
              multiSelect: true,
              options: [
                { label: 'Curbside pilot in select neighborhoods' },
                { label: 'Do nothing' },
                { label: 'Expand drop-off sites' },
              ],
            },
          },
        ],
      } satisfies ChatMessageDto,
      {
        id: 'u1',
        conversationId: CONVERSATION_ID,
        role: 'user',
        content:
          'Curbside pilot in select neighborhoods and Expand drop-off sites',
        createdAt: '2026-09-01T00:01:00.000Z',
      } satisfies ChatMessageDto,
    ])

    renderWorkspace()

    expect(
      await screen.findByText('Which of these hold up for you?'),
    ).toBeInTheDocument()
    const box = (name: string): HTMLElement =>
      screen.getByRole('checkbox', { name })
    expect(box('Curbside pilot in select neighborhoods')).toBeChecked()
    expect(box('Do nothing')).not.toBeChecked()
    expect(box('Expand drop-off sites')).toBeChecked()
    expect(box('Do nothing')).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Use these' }),
    ).not.toBeInTheDocument()
  })

  it('reloads a written-in answer as what the official said', async () => {
    mocks.listMessages.mockResolvedValue([
      {
        id: 'a1',
        conversationId: CONVERSATION_ID,
        role: 'assistant',
        content: '',
        createdAt: '2026-09-01T00:00:00.000Z',
        segments: [
          {
            kind: 'tool',
            toolName: 'ask_clarify_question',
            toolCallId: 'tc-clarify',
            payload: {
              questionId: 'q1',
              question: 'Which blocks do you want repaired first?',
              options: [{ label: 'The two by the school' }],
            },
          },
        ],
      } satisfies ChatMessageDto,
      {
        id: 'u1',
        conversationId: CONVERSATION_ID,
        role: 'user',
        content: 'Whichever the engineer says is most urgent',
        createdAt: '2026-09-01T00:01:00.000Z',
      } satisfies ChatMessageDto,
    ])

    renderWorkspace()

    expect(
      await screen.findByText('Which blocks do you want repaired first?'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'The two by the school' }),
    ).not.toBeChecked()
    expect(screen.queryByText('Or write your own...')).not.toBeInTheDocument()
  })

  it('names the card it is writing once text is already on screen', async () => {
    const gate = deferred()
    mocks.streamMessage.mockImplementation(
      streamOf(
        [
          { type: 'text', delta: 'The county runs this. ' },
          { type: 'tool_input_start', toolName: 'present_outside_contact' },
          { type: 'done', assistantMessageId: 'a1' },
        ],
        gate.promise,
      ),
    )

    renderWorkspace()

    expect(await screen.findByText(/The county runs this/)).toBeInTheDocument()
    expect(
      await screen.findByText('Looking up who to contact...'),
    ).toBeInTheDocument()
    gate.resolve()
  })

  it('names the question it is preparing once text is on screen', async () => {
    const gate = deferred()
    mocks.streamMessage.mockImplementation(
      streamOf(
        [
          { type: 'text', delta: 'Two ways to read this. ' },
          { type: 'tool_input_start', toolName: 'ask_clarify_question' },
          { type: 'done', assistantMessageId: 'a1' },
        ],
        gate.promise,
      ),
    )

    renderWorkspace()

    expect(await screen.findByText(/Two ways to read this/)).toBeInTheDocument()
    expect(
      await screen.findByText('Preparing your question...'),
    ).toBeInTheDocument()
    gate.resolve()
  })

  it('keeps showing work between tool calls once text is on screen', async () => {
    const gate = deferred()
    mocks.streamMessage.mockImplementation(
      streamOf(
        [
          { type: 'text', delta: 'Pulling the renters on those blocks. ' },
          { type: 'tool_call', toolName: 'count_contacts', args: {} },
          { type: 'tool_result', toolName: 'count_contacts', result: {} },
          { type: 'done', assistantMessageId: 'a1' },
        ],
        gate.promise,
      ),
    )

    renderWorkspace()

    expect(
      await screen.findByText(/Pulling the renters on those blocks/),
    ).toBeInTheDocument()
    expect(await screen.findByText('Thinking...')).toBeInTheDocument()
    gate.resolve()
  })

  it('drops the shimmer once the turn has finished streaming', async () => {
    mocks.streamMessage.mockImplementation(
      streamOf([
        { type: 'text', delta: 'Here is where this stands. ' },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )

    renderWorkspace()

    expect(
      await screen.findByText(/Here is where this stands/),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText('Thinking...')).not.toBeInTheDocument(),
    )
  })

  it('shows how other places handled it on the ordinance comparables card', async () => {
    mocks.listMessages.mockResolvedValue([
      {
        id: 'a1',
        conversationId: CONVERSATION_ID,
        role: 'assistant',
        content: '',
        createdAt: '2026-09-01T00:00:00.000Z',
        segments: [
          { kind: 'text', text: 'Here is what other cities did.' },
          {
            kind: 'tool',
            toolName: 'present_comparables',
            payload: {
              comparables: [
                {
                  city: 'Boulder',
                  state: 'CO',
                  quote: 'Bear-resistant containers are required citywide.',
                  status: 'passed',
                  source: {
                    id: 's1',
                    title: 'Bear Protection Ordinance',
                    url: 'https://bouldercolorado.gov/bears',
                    publisher: 'City of Boulder',
                  },
                },
              ],
            },
          },
        ],
      } satisfies ChatMessageDto,
    ])

    renderWorkspace()

    expect(await screen.findByText(/Boulder/)).toBeInTheDocument()
    expect(
      screen.getByText(/Bear-resistant containers are required citywide/),
    ).toBeInTheDocument()
  })

  it('shows an ordinary tool as a quiet pill rather than a card', async () => {
    mocks.listMessages.mockResolvedValue([
      {
        id: 'a1',
        conversationId: CONVERSATION_ID,
        role: 'assistant',
        content: '',
        createdAt: '2026-09-01T00:00:00.000Z',
        segments: [
          { kind: 'tool', toolName: 'count_contacts', payload: {} },
          { kind: 'text', text: 'About four hundred households.' },
        ],
      } satisfies ChatMessageDto,
    ])

    renderWorkspace()

    expect(await screen.findByText('Counting constituents')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-card')).not.toBeInTheDocument()
  })

  // The check already moved on the server; the rail catches up and the agent
  // hears about it once, without the official seeing a message they never
  // typed.
  it('refetches the rail and tells the agent once when a card’s outreach is sent', async () => {
    const proposalKey = mintProposalKey(CONVERSATION_ID, 'tc-proposal')
    mocks.listMessages.mockResolvedValue([
      {
        id: 'a1',
        conversationId: CONVERSATION_ID,
        role: 'assistant',
        content: 'Here is the check.',
        createdAt: '2026-09-01T00:00:00.000Z',
        segments: [{ kind: 'text', text: 'Here is the check.' }],
      } satisfies ChatMessageDto,
    ])
    renderWorkspace()
    await screen.findByText('Here is the check.')
    mocks.fetchPriorityStatus.mockClear()

    const proposal = { ...proposalArgs, proposalKey, deepLinkOnly: false }
    act(() => mocks.sentListener?.(proposal))
    act(() => mocks.sentListener?.(proposal))

    await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledTimes(1))
    expect(mocks.streamMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        content: expect.stringMatching(
          new RegExp(
            `^\\${PROPOSAL_SENT_MARKER.slice(0, -1)}\\].*412 people.*${proposalKey}$`,
          ),
        ),
      }),
    )
    expect(mocks.fetchPriorityStatus).toHaveBeenCalledWith('pri-1')
    expect(screen.queryByText(new RegExp(proposalKey))).toBeNull()
  })
})
