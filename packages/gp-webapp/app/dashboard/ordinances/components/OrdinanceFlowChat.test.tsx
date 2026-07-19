import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, waitFor } from '@testing-library/react'
import type {
  ChatMessageDto,
  ChatStreamEvent,
} from '../../shared/agent-chat/chatClient'
import type {
  Ordinance,
  OrdinanceAuthorityFinding,
  OrdinanceCurrentLawSummary,
  OrdinanceLegislativeHistory,
  OrdinancePresentComparables,
} from '@goodparty_org/contracts'
import OrdinanceFlowChat from './OrdinanceFlowChat'

const ordinance: Ordinance = {
  id: 'ord-1',
  slug: 'public-safety-cameras',
  electedOfficeId: 'eo-1',
  status: 'in_progress',
  seedType: 'issue',
  issueSlug: 'public-safety-cameras',
  sourceLink: null,
  goalText: 'Expand public safety cameras with guardrails',
  existingLaw: null,
  clarify: null,
  clarifyAnswers: null,
  authority: null,
  comparables: null,
  draftTitle: null,
  draftBody: null,
  draftSources: null,
  qualityReport: null,
  qualityRunStatus: 'idle',
  research: null,
  scratchpad: null,
  lastViewedStep: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

const source = {
  id: 'or-rs-181a',
  title: 'Or. Rev. Stat. § 181A.250',
  publisher: 'Oregon Revised Statutes',
}

const authorityPayload = {
  status: 'pass',
  headline: 'Pass. The council has authority to act.',
  explanation: 'Local control sits inside the council powers.',
  source,
} satisfies OrdinanceAuthorityFinding

const currentLawPayload = {
  chapterLabel: 'Chapter 12, Public Safety Surveillance',
  does: [{ title: 'Police may install cameras in public rights-of-way' }],
  gaps: [{ title: 'No retention limit on footage' }],
} satisfies OrdinanceCurrentLawSummary

const historyPayload = {
  entries: [
    {
      year: 1998,
      label: 'Chapter 12 created',
      summary: 'Council authorizes the first downtown camera pilot.',
    },
  ],
} satisfies OrdinanceLegislativeHistory

const comparablesPayload = {
  intro: 'I pulled the closest comparable camera ordinances.',
  comparables: [
    {
      city: 'Edgewater',
      state: 'Oregon',
      quote:
        'New cameras shall be sited based on published crime-density data.',
      status: 'passed',
      source,
    },
  ],
  takeaway: 'Guardrails held up.',
} satisfies OrdinancePresentComparables

const assistantTurn = (
  id: string,
  segments: ChatMessageDto['segments'],
): ChatMessageDto => ({
  id,
  conversationId: 'conv-1',
  role: 'assistant',
  content: '',
  createdAt: '2026-07-01T00:00:01.000Z',
  segments,
})

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  listMessages: vi.fn(),
  streamMessage: vi.fn(),
  fetchOrdinanceBySlug: vi.fn(),
}))

vi.mock('../data/chat-api', () => ({
  ordinanceFlowChatApi: {
    createConversation: mocks.createConversation,
    listMessages: mocks.listMessages,
    streamMessage: mocks.streamMessage,
  },
}))

vi.mock('../data/ordinances-api', () => ({
  fetchOrdinanceBySlug: mocks.fetchOrdinanceBySlug,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchOrdinanceBySlug.mockResolvedValue(ordinance)
  mocks.createConversation.mockResolvedValue({ conversationId: 'conv-1' })
})

describe('OrdinanceFlowChat step widgets (persisted segments)', () => {
  it('kicks off the draft step with a drafting instruction, not a question request', async () => {
    mocks.listMessages.mockResolvedValue([])
    render(<OrdinanceFlowChat slug="public-safety-cameras" step="draft" />)
    await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalled())
    const kickoff = (
      mocks.streamMessage.mock.calls[0]?.[0] as { content: string } | undefined
    )?.content
    expect(kickoff).toMatch(/draft/i)
    expect(kickoff).not.toMatch(/clarifying question/i)
  })

  it.each(['intro', 'authority', 'current_law', 'comparables', 'review'])(
    'kicks off the %s step without a clarify-question opener',
    async (step) => {
      mocks.listMessages.mockResolvedValue([])
      render(<OrdinanceFlowChat slug="public-safety-cameras" step={step} />)
      await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalled())
      const kickoff = (
        mocks.streamMessage.mock.calls[0]?.[0] as
          | { content: string }
          | undefined
      )?.content
      expect(kickoff).not.toMatch(/clarifying question/i)
    },
  )

  it('kicks off the clarify step by inviting the first question', async () => {
    mocks.listMessages.mockResolvedValue([])
    render(<OrdinanceFlowChat slug="public-safety-cameras" step="clarify" />)
    await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalled())
    const kickoff = (
      mocks.streamMessage.mock.calls[0]?.[0] as { content: string } | undefined
    )?.content
    expect(kickoff).toMatch(/clarifying question/i)
  })

  it('renders the authority verdict card from a persisted tool segment', async () => {
    mocks.listMessages.mockResolvedValue([
      assistantTurn('m1', [
        { kind: 'text', text: 'Quick legal sanity check.' },
        {
          kind: 'tool',
          toolName: 'present_authority_finding',
          payload: authorityPayload,
        },
      ]),
    ])
    render(<OrdinanceFlowChat slug="public-safety-cameras" step="authority" />)
    expect(
      await screen.findByText('Pass. The council has authority to act.'),
    ).toBeVisible()
    expect(
      screen.getByText('Local control sits inside the council powers.'),
    ).toBeVisible()
    expect(screen.getByText('Quick legal sanity check.')).toBeVisible()
  })

  it('renders both current-law widgets from one turn in call order', async () => {
    mocks.listMessages.mockResolvedValue([
      assistantTurn('m1', [
        {
          kind: 'tool',
          toolName: 'present_current_law_summary',
          payload: currentLawPayload,
        },
        {
          kind: 'tool',
          toolName: 'present_legislative_history',
          payload: historyPayload,
        },
      ]),
    ])
    render(
      <OrdinanceFlowChat slug="public-safety-cameras" step="current_law" />,
    )
    const summaryTitle = await screen.findByText('What it does today')
    expect(summaryTitle).toBeVisible()
    expect(screen.getByText('No retention limit on footage')).toBeVisible()
    const historyHeading = screen.getByText('Intent and history')
    expect(historyHeading).toBeVisible()
    expect(screen.getByText('Chapter 12 created')).toBeVisible()
    expect(
      summaryTitle.compareDocumentPosition(historyHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('renders the comparables cards with intro and takeaway', async () => {
    mocks.listMessages.mockResolvedValue([
      assistantTurn('m1', [
        {
          kind: 'tool',
          toolName: 'present_comparables',
          payload: comparablesPayload,
        },
      ]),
    ])
    render(
      <OrdinanceFlowChat slug="public-safety-cameras" step="comparables" />,
    )
    expect(
      await screen.findByText(
        'I pulled the closest comparable camera ordinances.',
      ),
    ).toBeVisible()
    expect(screen.getByText(/Edgewater, Oregon/)).toBeVisible()
    expect(screen.getByText('Guardrails held up.')).toBeVisible()
  })

  it('silently drops a widget whose payload fails to parse', async () => {
    mocks.listMessages.mockResolvedValue([
      assistantTurn('m1', [
        { kind: 'text', text: 'Here is the verdict.' },
        {
          kind: 'tool',
          toolName: 'present_authority_finding',
          payload: { status: 'pass', headline: 'Missing the rest' },
        },
      ]),
    ])
    render(<OrdinanceFlowChat slug="public-safety-cameras" step="authority" />)
    expect(await screen.findByText('Here is the verdict.')).toBeVisible()
    expect(screen.queryByText('Missing the rest')).not.toBeInTheDocument()
  })
})

describe('OrdinanceFlowChat step widgets (live stream)', () => {
  it('renders a widget from a live tool_call event, then keeps it after the history swap', async () => {
    mocks.listMessages.mockResolvedValueOnce([]).mockResolvedValue([
      assistantTurn('m1', [
        {
          kind: 'tool',
          toolName: 'present_authority_finding',
          payload: authorityPayload,
        },
      ]),
    ])
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mocks.streamMessage.mockImplementation(async function* (): AsyncGenerator<
      ChatStreamEvent,
      void,
      void
    > {
      yield {
        type: 'tool_call',
        toolName: 'present_authority_finding',
        args: authorityPayload,
      }
      await gate
      yield { type: 'done' }
    })

    render(<OrdinanceFlowChat slug="public-safety-cameras" step="authority" />)

    // Kickoff turn streams on mount (empty history). Widget appears mid-stream.
    expect(
      await screen.findByText('Pass. The council has authority to act.'),
    ).toBeVisible()

    release?.()

    // After the stream ends the transcript refetch re-renders the widget from
    // the persisted segment payload.
    await waitFor(() => expect(mocks.listMessages).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByText('Pass. The council has authority to act.'),
    ).toBeVisible()
  })

  it('drops a live widget whose args fail to parse without breaking the turn', async () => {
    mocks.listMessages.mockResolvedValue([])
    mocks.streamMessage.mockImplementation(async function* (): AsyncGenerator<
      ChatStreamEvent,
      void,
      void
    > {
      yield {
        type: 'tool_call',
        toolName: 'present_comparables',
        args: { comparables: [{ city: 'Nowhere' }] },
      }
      yield { type: 'text', delta: 'Still talking after the bad call.' }
      yield { type: 'done' }
    })

    render(
      <OrdinanceFlowChat slug="public-safety-cameras" step="comparables" />,
    )
    expect(
      await screen.findByText('Still talking after the bad call.', undefined, {
        timeout: 3000,
      }),
    ).toBeVisible()
    expect(screen.queryByText(/Nowhere/)).not.toBeInTheDocument()
  })

  it('keeps every live widget mounted while later text in the same turn types out', async () => {
    // Mount load is empty (kickoff); the post-stream refetch returns the
    // persisted turn so the commit swap resolves (the client waits for the
    // finished turn to appear before swapping away the live render).
    mocks.listMessages.mockResolvedValueOnce([]).mockResolvedValue([
      assistantTurn('m1', [
        { kind: 'text', text: 'Here is the chapter.' },
        {
          kind: 'tool',
          toolName: 'present_current_law_summary',
          payload: currentLawPayload,
        },
        {
          kind: 'tool',
          toolName: 'present_legislative_history',
          payload: historyPayload,
        },
        {
          kind: 'tool',
          toolName: 'present_comparables',
          payload: comparablesPayload,
        },
      ]),
    ])
    let releaseMid: (() => void) | undefined
    const midGate = new Promise<void>((resolve) => {
      releaseMid = resolve
    })
    let releaseEnd: (() => void) | undefined
    const endGate = new Promise<void>((resolve) => {
      releaseEnd = resolve
    })
    const closing =
      'Now that we have looked at the chapter itself and how past councils reasoned about it, we can line this up against the peer cities that solved the same problem before we move on.'
    mocks.streamMessage.mockImplementation(async function* (): AsyncGenerator<
      ChatStreamEvent,
      void,
      void
    > {
      yield { type: 'text', delta: 'Here is the chapter.' }
      yield {
        type: 'tool_call',
        toolName: 'present_current_law_summary',
        args: currentLawPayload,
      }
      yield {
        type: 'tool_call',
        toolName: 'present_legislative_history',
        args: historyPayload,
      }
      yield {
        type: 'tool_call',
        toolName: 'present_comparables',
        args: comparablesPayload,
      }
      await midGate
      yield { type: 'text', delta: closing }
      await endGate
      yield { type: 'done' }
    })

    render(
      <OrdinanceFlowChat slug="public-safety-cameras" step="current_law" />,
    )

    // All three widgets from one live turn mount once the lead-in reveals,
    // and the thinking shimmer is gone while they are on screen.
    expect(
      await screen.findByText('What it does today', undefined, {
        timeout: 4000,
      }),
    ).toBeVisible()
    expect(screen.getByText('Intent and history')).toBeVisible()
    expect(screen.getByText(/Edgewater, Oregon/)).toBeVisible()
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument()

    releaseMid?.()

    // While the closing prose is still typing out, the widgets must stay
    // mounted — the reveal gate may delay a widget's first appearance but
    // must never unmount one already shown.
    await waitFor(() =>
      expect(
        screen.getByText((content) => content.includes('Now that we')),
      ).toBeInTheDocument(),
    )
    expect(screen.getByText('What it does today')).toBeVisible()
    expect(screen.getByText('Intent and history')).toBeVisible()
    expect(screen.getByText(/Edgewater, Oregon/)).toBeVisible()

    releaseEnd?.()
    await waitFor(() => expect(mocks.listMessages).toHaveBeenCalledTimes(2), {
      timeout: 8000,
    })
  }, 15000)

  it('ignores a live widget whose payload parses but has nothing to render', async () => {
    mocks.listMessages.mockResolvedValue([])
    let toolYielded = false
    mocks.streamMessage.mockImplementation(async function* (): AsyncGenerator<
      ChatStreamEvent,
      void,
      void
    > {
      yield {
        type: 'tool_call',
        toolName: 'present_legislative_history',
        args: { entries: [] },
      }
      toolYielded = true
      await new Promise<void>(() => undefined)
    })

    render(
      <OrdinanceFlowChat slug="public-safety-cameras" step="current_law" />,
    )
    await waitFor(() => expect(toolYielded).toBe(true))
    // A content-less widget must not swallow the working shimmer or leave an
    // orphaned avatar row while the agent is still thinking.
    await waitFor(() => expect(screen.getByText('Thinking...')).toBeVisible())
    expect(screen.queryByText('Intent and history')).not.toBeInTheDocument()
  })
})

describe('OrdinanceFlowChat next-step button', () => {
  it('labels the advance button by flow order, ignoring the agent label', async () => {
    // The agent-authored offer label can contradict where the button goes:
    // on the comparables step the next step is draft, but the agent labeled the
    // offer "Research current law". The button must read the flow-derived CTA.
    mocks.listMessages.mockResolvedValue([
      assistantTurn('m1', [
        { kind: 'text', text: 'Here are the comparables.' },
        {
          kind: 'tool',
          toolName: 'offer_next_step',
          payload: { label: 'Research current law' },
        },
      ]),
    ])

    render(
      <OrdinanceFlowChat slug="public-safety-cameras" step="comparables" />,
    )

    expect(
      await screen.findByRole('button', { name: 'Write the first draft' }),
    ).toBeVisible()
    expect(screen.queryByText('Research current law')).not.toBeInTheDocument()
  })
})

describe('OrdinanceFlowChat stalled-stream recovery', () => {
  it('reconciles with persisted history when the stream stalls without ending', async () => {
    vi.useFakeTimers()
    try {
      // Init loads an empty conversation (triggers the hidden kickoff send);
      // the reconcile after the idle watchdog returns the completed turn.
      mocks.listMessages.mockResolvedValueOnce([]).mockResolvedValue([
        assistantTurn('m1', [
          {
            kind: 'tool',
            toolName: 'present_comparables',
            payload: comparablesPayload,
          },
        ]),
      ])
      // The stream emits a lead-in then hangs forever — never a `done`, never
      // ending. This is the delivery stall where the client's reader never sees
      // end-of-stream, so the turn would otherwise spin on "Thinking..." even
      // though the server finished and persisted the turn.
      mocks.streamMessage.mockImplementation(async function* (): AsyncGenerator<
        ChatStreamEvent,
        void,
        void
      > {
        yield { type: 'text', delta: 'Let me pull the comparables.' }
        await new Promise<void>(() => undefined)
      })

      render(
        <OrdinanceFlowChat slug="public-safety-cameras" step="comparables" />,
      )

      // Drive past the idle watchdog. The client must stop waiting on the dead
      // stream, re-fetch the persisted transcript, and render the finished turn.
      await vi.advanceTimersByTimeAsync(90_000)

      expect(
        screen.getByText('I pulled the closest comparable camera ordinances.'),
      ).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })
})
