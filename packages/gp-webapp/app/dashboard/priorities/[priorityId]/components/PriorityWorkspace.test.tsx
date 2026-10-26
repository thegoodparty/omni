import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import {
  PRIORITY_STEP_LABELS,
  emptyPriorityStatus,
  mintProposalKey,
  PROPOSAL_SENT_MARKER,
  reportBackMessage,
  GET_ANSWERS_MESSAGE,
  type PriorityReadStatus,
  type PriorityStatus,
} from '@goodparty_org/contracts'
import { router } from 'helpers/test-utils/router-mocking'
import { render } from 'helpers/test-utils/render'
import type {
  ChatMessageDto,
  ChatStreamEvent,
} from '../../../shared/agent-chat/chatClient'
import { PriorityWorkspace } from './PriorityWorkspace'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

const CONVERSATION_ID = 'conv-1'

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  listMessages: vi.fn(),
  streamMessage: vi.fn(),
  fetchPriorityStatus: vi.fn(),
  fetchPriorityReadStatus: vi.fn(),
  citizenPanels: { ready: true, enabled: false },
  sentListener: null as
    | null
    | ((proposal: Record<string, string | number | boolean>) => void),
}))

vi.mock('app/shared/experiments/serveCitizenPanelsFlag', () => ({
  useServeCitizenPanelsFlag: () => mocks.citizenPanels,
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
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
  fetchPriorityReadStatus: mocks.fetchPriorityReadStatus,
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
      launchSource,
    }: {
      card: { kind: string; proposalKey?: string }
      detailKey?: string
      launchSource?: string
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
          data-launch-source={launchSource ?? ''}
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
  reportBackOutreachId: number | null = null,
  read: {
    initialReadStatus?: PriorityReadStatus | null
    getAnswersOnOpen?: boolean
  } = {},
) =>
  render(
    <PriorityWorkspace
      priorityId="pri-1"
      title="Fix the Maple Street flooding"
      description="Storm drains back up after every heavy rain."
      initialStatus={initialStatus}
      initialNextAction={null}
      initialCurrentStep="define"
      reportBackOutreachId={reportBackOutreachId}
      initialReadStatus={read.initialReadStatus ?? null}
      getAnswersOnOpen={read.getAnswersOnOpen ?? false}
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
  mocks.fetchPriorityReadStatus.mockResolvedValue(null)
  mocks.citizenPanels = { ready: true, enabled: false }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PriorityWorkspace', () => {
  it('links to constituent feedback under the rail with serve-citizen-panels on', async () => {
    mocks.citizenPanels = { ready: true, enabled: true }
    renderWorkspace()
    await waitFor(() => expect(mocks.createConversation).toHaveBeenCalled())
    const links = screen.getAllByRole('link', { name: 'What we heard' })
    expect(links[0]).toHaveAttribute(
      'href',
      '/dashboard/priorities/pri-1/results',
    )
  })

  it('shows no constituent feedback link with serve-citizen-panels off', async () => {
    renderWorkspace()
    await waitFor(() => expect(mocks.createConversation).toHaveBeenCalled())
    expect(
      screen.queryByRole('link', { name: 'What we heard' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the title in the conversation with serve-citizen-panels off', async () => {
    renderWorkspace()
    await waitFor(() => expect(mocks.createConversation).toHaveBeenCalled())
    expect(screen.queryByTestId('priority-desktop-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('priority-phone-bar')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Fix the Maple Street flooding',
      }),
    ).toBeInTheDocument()
  })

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
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Priorities.PriorityViewed, {
      priorityId: 'pri-1',
      currentStep: 'define',
      isNewConversation: true,
      entry: 'direct',
    })
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.AIChat.MessageSent,
      expect.anything(),
    )
  })

  it('waits for the reply to a turn left mid-stream, without starting another', async () => {
    const kickoff: ChatMessageDto = {
      id: 'u1',
      conversationId: CONVERSATION_ID,
      role: 'user',
      content:
        "Let's begin. Tell me where this stands and what we should work on first.",
      createdAt: '2026-09-01T00:00:00.000Z',
    }
    const reply: ChatMessageDto = {
      id: 'a1',
      conversationId: CONVERSATION_ID,
      role: 'assistant',
      content: 'Nothing has started on this yet.',
      createdAt: '2026-09-01T00:00:05.000Z',
      segments: [{ kind: 'text', text: 'Nothing has started on this yet.' }],
    }
    mocks.listMessages
      .mockResolvedValueOnce([kickoff])
      .mockResolvedValue([kickoff, reply])
    vi.useFakeTimers({ shouldAdvanceTime: true })

    renderWorkspace()

    expect(await screen.findByText('Thinking...')).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(
      await screen.findByText('Nothing has started on this yet.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument()
    expect(mocks.streamMessage).not.toHaveBeenCalled()
  })

  it('moves the rail while the turn is still streaming, then reconciles', async () => {
    const gate = deferred()
    const stored: PriorityStatus = {
      ...emptyPriorityStatus(),
      steps: emptyPriorityStatus().steps.map((step) =>
        step.id === 'evidence'
          ? { ...step, state: 'settled' as const, summary: 'Maple floods.' }
          : step,
      ),
    }
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
          {
            type: 'tool_result',
            toolName: 'update_priority_status',
            toolCallId: 'tc-status',
            result: {
              status: stored,
              currentStep: 'define',
              nextAction: 'Pick two blocks to walk',
            },
          },
          { type: 'done', assistantMessageId: 'a1' },
        ],
        gate.promise,
      ),
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })

    renderWorkspace()

    // Mid-turn: the rail has moved although `done` has not arrived.
    await waitFor(() =>
      expect(
        within(railRow(PRIORITY_STEP_LABELS.evidence)).getByText('Done'),
      ).toBeInTheDocument(),
    )
    expect(mocks.fetchPriorityStatus).not.toHaveBeenCalled()
    expect(screen.getByText('Pick two blocks to walk')).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(
      await screen.findByText('Done with what we know'),
    ).toBeInTheDocument()

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
    await vi.advanceTimersByTimeAsync(2_000)

    await waitFor(() =>
      expect(
        within(railRow(PRIORITY_STEP_LABELS.evidence)).getByText(
          'Needs another look',
        ),
      ).toBeInTheDocument(),
    )
  })

  // The dev plan turn: the agent asked to close three steps and open the
  // plan, the server refused, and the chat still said "Done with" each one.
  it('draws no marker and leaves the rail alone when the server refuses the move', async () => {
    const gate = deferred()
    mocks.streamMessage.mockImplementation(
      streamOf(
        [
          { type: 'text', delta: 'Let me record where this stands. ' },
          {
            type: 'tool_call',
            toolName: 'update_priority_status',
            toolCallId: 'tc-refused',
            args: {
              steps: [
                { id: 'options', state: 'settled' },
                { id: 'listen_options', state: 'settled' },
                { id: 'method', state: 'settled' },
                { id: 'plan', state: 'active' },
                { id: 'listen_problem', state: 'stale' },
              ],
              nextAction: 'Draft the plan',
            },
          },
          {
            type: 'tool_result',
            toolName: 'update_priority_status',
            toolCallId: 'tc-refused',
            result: {
              error:
                'Nothing was recorded. These did not move: Your options, ' +
                'What people back, The path, The plan, Who to hear from.',
            },
          },
          { type: 'text', delta: 'The plan waits on what residents say.' },
          { type: 'done', assistantMessageId: 'a1' },
        ],
        gate.promise,
      ),
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })

    renderWorkspace()

    await screen.findByText(/^Let me/)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(
      await screen.findByText(/The plan waits on what residents say/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^Done with/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Working on/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Back to/)).not.toBeInTheDocument()
    expect(
      within(railRow(PRIORITY_STEP_LABELS.method)).queryByText('Done'),
    ).not.toBeInTheDocument()
    gate.resolve()
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

  it('records each outreach the agent proposes as it streams in', async () => {
    mocks.streamMessage.mockImplementation(
      streamOf([
        { type: 'text', delta: 'Here is a call list. ' },
        {
          type: 'tool_call',
          toolName: 'present_outreach_proposal',
          toolCallId: 'tc-live-proposal',
          args: proposalArgs,
        },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )

    renderWorkspace()

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.Priorities.OutreachProposed,
        {
          priorityId: 'pri-1',
          round: 'one',
          sampleSize: 412,
          targetGroup: 'everyone',
          channel: 'call',
        },
      ),
    )
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

  it('launches a card that answered Get answers as expand_panel, even after a reload', async () => {
    const proposalTurn = (id: string, toolCallId: string): ChatMessageDto => ({
      id,
      conversationId: CONVERSATION_ID,
      role: 'assistant',
      content: '',
      createdAt: '2026-09-01T00:00:00.000Z',
      segments: [
        {
          kind: 'tool',
          toolName: 'present_outreach_proposal',
          toolCallId,
          payload: proposalArgs,
        },
      ],
    })
    mocks.listMessages.mockResolvedValue([
      {
        id: 'u1',
        conversationId: CONVERSATION_ID,
        role: 'user',
        content: GET_ANSWERS_MESSAGE,
        createdAt: '2026-09-01T00:00:00.000Z',
      } satisfies ChatMessageDto,
      proposalTurn('a1', 'tc-1'),
      {
        id: 'u2',
        conversationId: CONVERSATION_ID,
        role: 'user',
        content: 'Make it a call list instead.',
        createdAt: '2026-09-01T00:00:00.000Z',
      } satisfies ChatMessageDto,
      proposalTurn('a2', 'tc-2'),
    ])

    renderWorkspace()

    const cards = await screen.findAllByTestId('chat-card')
    expect(cards.map((card) => card.dataset.launchSource)).toEqual([
      'expand_panel',
      '',
    ])
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
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.AIChat.MessageSent, {
      agent: 'priority_flow',
      surface: 'priority_workspace',
      via: 'clarify',
      product: 'serve',
      priorityId: 'pri-1',
    })
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

    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderWorkspace()

    await screen.findByText(/^The co/)
    await vi.advanceTimersByTimeAsync(2_000)
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

    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderWorkspace()

    await screen.findByText(/^Two/)
    await vi.advanceTimersByTimeAsync(2_000)
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

    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderWorkspace()

    await screen.findByText(/^Pul/)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(
      await screen.findByText(/Pulling the renters on those blocks/),
    ).toBeInTheDocument()
    expect(await screen.findByText('Thinking...')).toBeInTheDocument()
    gate.resolve()
  })

  it('holds the shimmer off after a finding card until the next tool starts', async () => {
    const gate = deferred()
    const next = deferred()
    mocks.streamMessage.mockImplementation(async function* () {
      yield { type: 'text', delta: 'Here is what other cities did. ' }
      yield {
        type: 'tool_call',
        toolName: 'present_comparables',
        toolCallId: 'tc-c',
        args: {
          comparables: [
            {
              city: 'Boulder',
              state: 'CO',
              quote: 'Containers are required.',
              status: 'passed',
              source: { id: 's1', title: 'Waste Regulations' },
            },
          ],
        },
      }
      await next.promise
      yield { type: 'tool_input_start', toolName: 'present_outside_contact' }
      await gate.promise
      yield { type: 'done', assistantMessageId: 'a1' }
    })

    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderWorkspace()

    await screen.findByText(/^Here/)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(
      await screen.findByText(/Containers are required/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument()
    next.resolve()
    expect(
      await screen.findByText('Looking up who to contact...'),
    ).toBeInTheDocument()
    gate.resolve()
  })

  it('drops the shimmer as soon as a question card is up', async () => {
    const gate = deferred()
    mocks.streamMessage.mockImplementation(
      streamOf(
        [
          { type: 'text', delta: 'One thing to settle first. ' },
          { type: 'tool_input_start', toolName: 'ask_clarify_question' },
          {
            type: 'tool_call',
            toolName: 'ask_clarify_question',
            toolCallId: 'tc-q',
            args: {
              questionId: 'q1',
              question: 'Is the problem trash or garages?',
              options: [{ label: 'Trash' }, { label: 'Garages' }],
            },
          },
          { type: 'done', assistantMessageId: 'a1' },
        ],
        gate.promise,
      ),
    )

    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderWorkspace()

    await screen.findByText(/^One/)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(
      await screen.findByText('Is the problem trash or garages?'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Preparing your question...'),
    ).not.toBeInTheDocument()
    gate.resolve()
  })

  it('drops the shimmer once the turn has finished streaming', async () => {
    mocks.streamMessage.mockImplementation(
      streamOf([
        { type: 'text', delta: 'Here is where this stands. ' },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )

    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderWorkspace()

    await screen.findByText(/^Here/)
    await vi.advanceTimersByTimeAsync(2_000)
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

  describe('opened from a report back card', () => {
    const reply: ChatMessageDto = {
      id: 'a1',
      conversationId: CONVERSATION_ID,
      role: 'assistant',
      content: 'Here is where this stands.',
      createdAt: '2026-09-01T00:00:00.000Z',
      segments: [{ kind: 'text', text: 'Here is where this stands.' }],
    }

    it('opens a fresh thread on the report back, never the kickoff', async () => {
      renderWorkspace(emptyPriorityStatus(), 77)

      await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledTimes(1))
      expect(mocks.streamMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: reportBackMessage(77) }),
      )
      expect(window.location.pathname).toBe('/dashboard/priorities/pri-1')
      expect(window.location.search).toBe('')
      expect(router.replace).not.toHaveBeenCalled()
    })

    it('starts the report back once in a thread already under way, hidden', async () => {
      mocks.listMessages.mockResolvedValue([reply])
      renderWorkspace(emptyPriorityStatus(), 77)
      await screen.findByText('Here is where this stands.')

      await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledTimes(1))
      expect(mocks.streamMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: reportBackMessage(77) }),
      )
      expect(screen.queryByText(/Help me report back/)).toBeNull()
    })

    // Reopening a report back once its chat exists: dropping the param
    // must not navigate, since a navigation remounts the page mid-open.
    it('reopens a report back without navigating, and an open it outlived never shows the error', async () => {
      window.history.replaceState(
        null,
        '',
        '/dashboard/priorities/pri-1?reportBack=77',
      )
      mocks.listMessages.mockResolvedValue([
        {
          id: 'u1',
          conversationId: CONVERSATION_ID,
          role: 'user',
          content: reportBackMessage(77),
          createdAt: '2026-09-01T00:00:00.000Z',
        } satisfies ChatMessageDto,
        { ...reply, createdAt: '2026-09-01T00:00:05.000Z' },
      ])
      let failFirst: ((err: Error) => void) | undefined
      mocks.createConversation.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            failFirst = reject
          }),
      )
      // The first mount is replaced before its open settles, as a remount
      // would, and its request then fails.
      const first = renderWorkspace(emptyPriorityStatus(), 77)
      first.unmount()
      failFirst?.(new Error('superseded'))
      renderWorkspace(emptyPriorityStatus(), 77)

      await screen.findByText('Here is where this stands.')
      expect(
        screen.queryByText(/We couldn.t open this priority/),
      ).not.toBeInTheDocument()
      expect(window.location.search).toBe('')
      expect(router.replace).not.toHaveBeenCalled()
      expect(mocks.streamMessage).not.toHaveBeenCalled()
    })

    it('does not ask again for a send it already started on', async () => {
      mocks.listMessages.mockResolvedValue([
        {
          id: 'u1',
          conversationId: CONVERSATION_ID,
          role: 'user',
          content: reportBackMessage(77),
          createdAt: '2026-09-01T00:00:00.000Z',
        } satisfies ChatMessageDto,
        { ...reply, createdAt: '2026-09-01T00:00:05.000Z' },
      ])
      renderWorkspace(emptyPriorityStatus(), 77)
      await screen.findByText('Here is where this stands.')

      expect(screen.queryByText(/Help me report back/)).toBeNull()
      expect(mocks.streamMessage).not.toHaveBeenCalled()
    })
  })

  describe('the read status, behind serve-citizen-panels', () => {
    const thin: PriorityReadStatus = {
      answers: 24,
      needed: 96,
      groupsHeard: 3,
      groupsTotal: 12,
      representativeAnswers: 20,
      representativeNeeded: 96,
      good: false,
      status: 'tooEarly',
      underrepresented: ['age65plus'],
      unheard: ['age65plus'],
      checkOut: true,
    }
    // 103 answered, but the groups heard most fill only their share.
    const skewed: PriorityReadStatus = {
      answers: 103,
      needed: 96,
      groupsHeard: 9,
      groupsTotal: 12,
      representativeAnswers: 70,
      representativeNeeded: 96,
      good: false,
      status: 'notYetRepresentative',
      underrepresented: ['women', 'age65plus'],
      checkOut: true,
    }
    const good: PriorityReadStatus = {
      answers: 103,
      needed: 96,
      groupsHeard: 12,
      groupsTotal: 12,
      good: true,
      status: 'representative',
      underrepresented: [],
    }
    const reply: ChatMessageDto = {
      id: 'a1',
      conversationId: CONVERSATION_ID,
      role: 'assistant',
      content: 'Here is where this stands.',
      createdAt: '2026-09-01T00:00:00.000Z',
      segments: [{ kind: 'text', text: 'Here is where this stands.' }],
    }

    beforeEach(() => {
      mocks.citizenPanels = { ready: true, enabled: true }
      mocks.listMessages.mockResolvedValue([reply])
    })

    it('puts a short bar on the phone with the answers still needed', async () => {
      renderWorkspace(emptyPriorityStatus(), null, { initialReadStatus: thin })
      await screen.findByText('Here is where this stands.')

      const bar = screen.getByTestId('priority-phone-bar')
      expect(
        within(bar).getByRole('heading', {
          name: 'Fix the Maple Street flooding',
        }),
      ).toBeInTheDocument()
      expect(
        within(bar).getByRole('link', { name: 'Back to priorities' }),
      ).toHaveAttribute('href', '/dashboard/priorities')
      expect(
        within(bar).getByRole('button', { name: 'Where this stands' }),
      ).toBeInTheDocument()
      const status = within(bar).getByRole('link', {
        name: /Still need to hear from people 65 and over/,
      })
      expect(status).toHaveAttribute(
        'href',
        '/dashboard/priorities/pri-1/results',
      )
      expect(
        within(bar).getByRole('progressbar', {
          name: '20 of the 96 answers we need',
        }),
      ).toBeInTheDocument()
      const getAnswers = within(bar).getByRole('button', {
        name: 'Get answers',
      })
      expect(getAnswers).toBeEnabled()
      // Its own row under the line, so the line has the full width.
      expect(status).not.toContainElement(getAnswers)
    })

    it('keeps Get answers ready while a turn is in flight, and holds it once asked', async () => {
      const kickoffDone = deferred()
      const getAnswersDone = deferred()
      mocks.listMessages.mockResolvedValue([])
      mocks.streamMessage
        .mockImplementationOnce(
          streamOf(
            [
              { type: 'text', delta: 'Let me look at this.' },
              { type: 'done', assistantMessageId: 'a1' },
            ],
            kickoffDone.promise,
          ),
        )
        .mockImplementationOnce(
          streamOf(
            [
              { type: 'text', delta: 'Here is a text to ask more people.' },
              { type: 'done', assistantMessageId: 'a2' },
            ],
            getAnswersDone.promise,
          ),
        )
      renderWorkspace(emptyPriorityStatus(), null, { initialReadStatus: thin })
      await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledTimes(1))

      const buttons = () =>
        screen.getAllByRole('button', { name: 'Get answers' })
      expect(buttons()).toHaveLength(2)
      for (const button of buttons()) expect(button).toBeEnabled()

      fireEvent.click(
        within(screen.getByTestId('priority-phone-bar')).getByRole('button', {
          name: 'Get answers',
        }),
      )
      for (const button of buttons()) expect(button).toBeDisabled()
      expect(mocks.streamMessage).toHaveBeenCalledTimes(1)

      await act(async () => kickoffDone.resolve())
      await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledTimes(2))
      expect(mocks.streamMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ content: GET_ANSWERS_MESSAGE }),
      )
      for (const button of buttons()) expect(button).toBeDisabled()

      await act(async () => getAnswersDone.resolve())
      await waitFor(() => {
        for (const button of buttons()) expect(button).toBeEnabled()
      })
    })

    it('puts the title in a bar above the chat and the rail on desktop', async () => {
      renderWorkspace(emptyPriorityStatus(), null, { initialReadStatus: thin })
      await screen.findByText('Here is where this stands.')

      const bar = screen.getByTestId('priority-desktop-bar')
      expect(
        within(bar).getByRole('heading', {
          level: 1,
          name: 'Fix the Maple Street flooding',
        }),
      ).toBeInTheDocument()
      expect(
        within(bar).getByRole('link', { name: 'Back to priorities' }),
      ).toHaveAttribute('href', '/dashboard/priorities')
      const titles = screen.getAllByRole('heading', {
        name: 'Fix the Maple Street flooding',
      })
      expect(titles).toHaveLength(2)
      for (const heading of titles) {
        expect(
          heading.closest(
            '[data-testid="priority-desktop-bar"], [data-testid="priority-phone-bar"]',
          ),
        ).not.toBeNull()
      }
    })

    it('opens where this stands from the bar', async () => {
      renderWorkspace(emptyPriorityStatus(), null, { initialReadStatus: thin })
      await screen.findByText('Here is where this stands.')

      fireEvent.click(
        within(screen.getByTestId('priority-phone-bar')).getByRole('button', {
          name: 'Where this stands',
        }),
      )

      expect(
        await screen.findByRole('dialog', { name: 'Where this stands' }),
      ).toBeInTheDocument()
    })

    it('says so on the phone once there is a good read', async () => {
      renderWorkspace(emptyPriorityStatus(), null, { initialReadStatus: good })
      await screen.findByText('Here is where this stands.')

      const bar = screen.getByTestId('priority-phone-bar')
      expect(
        within(bar).getByText("You've heard from every group"),
      ).toBeInTheDocument()
      expect(
        within(bar).getByRole('link', { name: 'See what we heard' }),
      ).toHaveAttribute('href', '/dashboard/priorities/pri-1/results')
      expect(
        within(bar).queryByRole('button', { name: 'Get answers' }),
      ).not.toBeInTheDocument()
    })

    it('tops the desktop rail with the read, a quiet link, then where this stands', async () => {
      renderWorkspace(emptyPriorityStatus(), null, { initialReadStatus: thin })
      await screen.findByText('Here is where this stands.')

      const rail = screen.getByRole('complementary')
      expect(within(rail).getByText('Waiting to hear back')).toBeInTheDocument()
      expect(
        within(rail).getByText('Still need to hear from people 65 and over'),
      ).toBeInTheDocument()
      expect(
        within(rail).getByText('20 of the 96 answers we need'),
      ).toBeInTheDocument()
      expect(
        within(rail).getByRole('button', { name: 'Get answers' }),
      ).toBeInTheDocument()
      expect(
        within(rail).getByRole('link', { name: 'What we heard' }),
      ).toHaveAttribute('href', '/dashboard/priorities/pri-1/results')
      expect(
        within(rail).getByRole('heading', { name: 'Where this stands' }),
      ).toBeInTheDocument()
    })

    it('shows the good read in the desktop rail', async () => {
      renderWorkspace(emptyPriorityStatus(), null, { initialReadStatus: good })
      await screen.findByText('Here is where this stands.')

      const rail = screen.getByRole('complementary')
      expect(within(rail).getByText('Every group heard')).toBeInTheDocument()
      expect(
        within(rail).getByRole('link', { name: 'See what we heard' }),
      ).toBeInTheDocument()
      // One way to the results, not a button and a link to the same page.
      expect(
        within(rail).queryByRole('link', { name: 'What we heard' }),
      ).not.toBeInTheDocument()
    })

    it('says enough people answered, not every group, when the census was not checked', async () => {
      renderWorkspace(emptyPriorityStatus(), null, {
        initialReadStatus: { ...good, status: 'enoughAnswers' },
      })
      await screen.findByText('Here is where this stands.')

      const bar = screen.getByTestId('priority-phone-bar')
      expect(
        within(bar).getByText('Enough people have answered'),
      ).toBeInTheDocument()
      expect(
        within(bar).getByRole('link', { name: 'See what we heard' }),
      ).toBeInTheDocument()
      const rail = screen.getByRole('complementary')
      expect(
        within(rail).getByText('Enough people have answered'),
      ).toBeInTheDocument()
      expect(screen.queryByText(/every group/i)).not.toBeInTheDocument()
    })

    it('names who to hear more from once there are enough answers', async () => {
      renderWorkspace(emptyPriorityStatus(), null, {
        initialReadStatus: skewed,
      })
      await screen.findByText('Here is where this stands.')

      const bar = screen.getByTestId('priority-phone-bar')
      expect(
        within(bar).getByText(
          'Need a few more answers from women and people 65 and over',
        ),
      ).toBeInTheDocument()
      const rail = screen.getByRole('complementary')
      expect(
        within(rail).getByText('A few groups need more answers'),
      ).toBeInTheDocument()
      expect(
        within(rail).getByText(
          'Need a few more answers from women and people 65 and over',
        ),
      ).toBeInTheDocument()
      expect(
        within(rail).getByText('70 of the 96 answers we need'),
      ).toBeInTheDocument()
      expect(within(rail).queryByText(/weight/i)).not.toBeInTheDocument()
      expect(
        within(rail).getByRole('button', { name: 'Get answers' }),
      ).toBeInTheDocument()
    })

    it('asks the agent for more answers with one hidden turn', async () => {
      renderWorkspace(emptyPriorityStatus(), null, { initialReadStatus: thin })
      await screen.findByText('Here is where this stands.')

      fireEvent.click(
        within(screen.getByRole('complementary')).getByRole('button', {
          name: 'Get answers',
        }),
      )

      await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledTimes(1))
      expect(mocks.streamMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: GET_ANSWERS_MESSAGE }),
      )
      expect(screen.queryByText(/Help me get more answers/)).toBeNull()
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.Priorities.GetAnswersClicked,
        {
          priorityId: 'pri-1',
          source: 'rail',
          readStatus: 'waiting',
          groupsShort: 9,
        },
      )
      expect(
        vi
          .mocked(trackEvent)
          .mock.calls.filter(
            ([event]) => event === EVENTS.Priorities.GetAnswersClicked,
          ),
      ).toHaveLength(1)
      expect(trackEvent).not.toHaveBeenCalledWith(
        EVENTS.AIChat.MessageSent,
        expect.anything(),
      )
    })

    it('records the read the priority opened with', async () => {
      renderWorkspace(emptyPriorityStatus(), null, { initialReadStatus: thin })
      await screen.findByText('Here is where this stands.')

      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.Priorities.PriorityViewed,
        expect.objectContaining({
          readStatus: 'waiting',
          groupsHeard: 3,
          groupsTotal: 12,
        }),
      )
    })

    it('asks once when the results page sent the official here', async () => {
      renderWorkspace(emptyPriorityStatus(), null, {
        initialReadStatus: thin,
        getAnswersOnOpen: true,
      })
      await screen.findByText('Here is where this stands.')

      await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledTimes(1))
      expect(mocks.streamMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: GET_ANSWERS_MESSAGE }),
      )
      expect(window.location.search).toBe('')
      expect(router.replace).not.toHaveBeenCalled()
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.Priorities.GetAnswersClicked,
        {
          priorityId: 'pri-1',
          source: 'results_page',
          readStatus: 'waiting',
          groupsShort: 9,
        },
      )
    })

    it('does not ask again when a reload kept the results page link', async () => {
      mocks.listMessages.mockResolvedValue([
        reply,
        {
          id: 'u2',
          conversationId: CONVERSATION_ID,
          role: 'user',
          content: GET_ANSWERS_MESSAGE,
          createdAt: '2026-09-01T00:00:05.000Z',
        } satisfies ChatMessageDto,
        {
          ...reply,
          id: 'a2',
          content: 'Here is a text to ask more people.',
          segments: [
            { kind: 'text', text: 'Here is a text to ask more people.' },
          ],
          createdAt: '2026-09-01T00:00:10.000Z',
        },
      ])
      renderWorkspace(emptyPriorityStatus(), null, {
        initialReadStatus: thin,
        getAnswersOnOpen: true,
      })
      await screen.findByText('Here is a text to ask more people.')

      expect(screen.queryByText(/Help me get more answers/)).toBeNull()
      expect(mocks.streamMessage).not.toHaveBeenCalled()
      expect(trackEvent).not.toHaveBeenCalledWith(
        EVENTS.Priorities.GetAnswersClicked,
        expect.anything(),
      )
    })

    it('asks once for a double click on Get answers', async () => {
      renderWorkspace(emptyPriorityStatus(), null, { initialReadStatus: thin })
      await screen.findByText('Here is where this stands.')

      const button = within(screen.getByRole('complementary')).getByRole(
        'button',
        { name: 'Get answers' },
      )
      act(() => {
        fireEvent.click(button)
        fireEvent.click(button)
      })

      await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledTimes(1))
      await waitFor(() =>
        expect(mocks.fetchPriorityReadStatus).toHaveBeenCalled(),
      )
      expect(mocks.streamMessage).toHaveBeenCalledTimes(1)
    })

    it('asks again from the results page once the official has said more', async () => {
      mocks.listMessages.mockResolvedValue([
        {
          id: 'u1',
          conversationId: CONVERSATION_ID,
          role: 'user',
          content: GET_ANSWERS_MESSAGE,
          createdAt: '2026-09-01T00:00:00.000Z',
        } satisfies ChatMessageDto,
        { ...reply, createdAt: '2026-09-01T00:00:05.000Z' },
        {
          id: 'u2',
          conversationId: CONVERSATION_ID,
          role: 'user',
          content: 'Not now, thanks.',
          createdAt: '2026-09-02T00:00:00.000Z',
        } satisfies ChatMessageDto,
        {
          ...reply,
          id: 'a2',
          content: 'Okay.',
          segments: [{ kind: 'text', text: 'Okay.' }],
          createdAt: '2026-09-02T00:00:05.000Z',
        },
      ])
      renderWorkspace(emptyPriorityStatus(), null, {
        initialReadStatus: thin,
        getAnswersOnOpen: true,
      })
      await screen.findByText('Okay.')

      await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledTimes(1))
      expect(mocks.streamMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: GET_ANSWERS_MESSAGE }),
      )
    })

    it('re-reads the status once a turn settles', async () => {
      mocks.fetchPriorityReadStatus.mockResolvedValue(good)
      renderWorkspace(emptyPriorityStatus(), null, { initialReadStatus: thin })
      await screen.findByText('Here is where this stands.')

      fireEvent.click(
        within(screen.getByRole('complementary')).getByRole('button', {
          name: 'Get answers',
        }),
      )

      await waitFor(() =>
        expect(mocks.fetchPriorityReadStatus).toHaveBeenCalledWith('pri-1'),
      )
      expect(
        (await screen.findAllByText("You've heard from every group")).length,
      ).toBeGreaterThan(0)
    })
  })
})
