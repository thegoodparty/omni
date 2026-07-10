import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, waitFor } from '@testing-library/react'
import type {
  ChatMessageDto,
  ChatStreamEvent,
} from '../../shared/agent-chat/chatClient'
import type { Ordinance } from '@goodparty_org/contracts'
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
}

const currentLawPayload = {
  chapterLabel: 'Chapter 12, Public Safety Surveillance',
  does: [{ title: 'Police may install cameras in public rights-of-way' }],
  gaps: [{ title: 'No retention limit on footage' }],
}

const historyPayload = {
  entries: [
    {
      year: 1998,
      label: 'Chapter 12 created',
      summary: 'Council authorizes the first downtown camera pilot.',
    },
  ],
}

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
}

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
      await screen.findByText('Still talking after the bad call.'),
    ).toBeVisible()
    expect(screen.queryByText(/Nowhere/)).not.toBeInTheDocument()
  })
})
