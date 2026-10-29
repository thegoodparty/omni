import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  CIVIC_PANEL_JOIN_LINE,
  MANAGED_CIVIC_PANEL_BACKED_OUT_MESSAGE,
  MANAGED_CIVIC_PANEL_SET_UP_MESSAGE,
} from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type {
  ChatMessageDto,
  ChatMessageSegment,
  ChatStreamEvent,
} from '../../../shared/agent-chat/chatClient'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import ChiefOfStaffChatBody from './ChiefOfStaffChatBody'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const listMessagesMock = vi.fn()
const streamMessageMock = vi.fn()

vi.mock('../../data/chat-api', () => ({
  chiefOfStaffChatApi: {
    createConversation: vi.fn(),
    listMessages: (...args: unknown[]) => listMessagesMock(...args),
    listConversations: vi.fn(() => Promise.resolve([])),
    streamMessage: (...args: unknown[]) => streamMessageMock(...args),
    softDelete: vi.fn(),
  },
}))
vi.mock('@shared/sentry', () => ({ reportErrorToSentry: vi.fn() }))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  }),
}))
vi.mock('@shared/organization-picker', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOrganization: () => ({
    slug: 'eo-test-org',
    positionName: 'Maplewood City Council - District 2',
    district: { id: 'd1', l2Type: 'City', l2Name: 'Maplewood City Ward 2' },
  }),
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: 'Carla', lastName: 'Diaz' }],
}))

// The text flow is its own suite (SmsFlow.managedInvite.test.tsx); here only
// what the card opens it with and what its close tells the chat.
const flowProps = vi.hoisted(() => ({
  current: null as null | {
    initialScript?: string
    managedInvite?: { place: string | null; onSetUp: () => void }
    onClose: () => void
  },
}))
vi.mock('app/dashboard/outreach/v2/sms/SmsFlow', () => ({
  SERVE_SMS_SURFACE: {},
  SmsFlow: (props: NonNullable<typeof flowProps.current>) => {
    flowProps.current = props
    return <div data-testid="sms-flow" />
  },
}))

const makeStream = (
  events: ChatStreamEvent[],
): AsyncIterable<ChatStreamEvent> =>
  (async function* () {
    for (const event of events) yield event
  })()

const turn = (segments: ChatMessageSegment[]): ChatMessageDto => ({
  id: 'a1',
  conversationId: 'conv',
  role: 'assistant',
  content: 'Here it is.',
  createdAt: '2026-10-22T00:00:00.000Z',
  segments,
})

const builtPanel = {
  id: 'mp-1',
  status: 'building' as const,
  inviteMessage: 'Hi.',
  consentVersion: 'v1',
  approvedAt: new Date('2026-10-22T18:00:00Z'),
  approvedByUserId: 1,
  goalMembers: 275,
  freeTextCap: 15000,
  freeTextsUsed: 0,
  readyAt: null,
  pausedAt: null,
  stoppedAt: null,
  createdAt: new Date('2026-10-22T18:00:00Z'),
  updatedAt: new Date('2026-10-22T18:00:00Z'),
  progress: {
    members: 0,
    goalMembers: 275,
    wavesSent: 0,
    nextWaveAt: null,
    firstSendDate: '2026-10-27',
    readyWeekOf: '2026-11-09',
  },
}

const inviteTurn = () =>
  turn([
    { kind: 'text', text: 'Here it is.' },
    { kind: 'tool', toolName: 'present_managed_panel_invite', payload: {} },
  ])

beforeEach(() => {
  vi.mocked(trackEvent).mockReset()
  flowProps.current = null
  listMessagesMock.mockReset().mockResolvedValue([inviteTurn()])
  streamMessageMock
    .mockReset()
    .mockImplementation(() => makeStream([{ type: 'done' }]))
  api.mock('GET /v1/contacts/civic-panel/managed', {
    status: 200,
    data: { panel: null },
  })
})

describe('the managed civic panel in the Chief of Staff chat', () => {
  it('shows a compact card with one button, and leaves the words to the review', async () => {
    render(<ChiefOfStaffChatBody active conversationIdOverride="conv" />)

    const card = await screen.findByTestId('managed-panel-invite')
    expect(within(card).getByText('Your civic panel invite')).toBeVisible()
    expect(within(card).getByText('Text to Maplewood residents')).toBeVisible()
    expect(within(card).getAllByRole('button')).toHaveLength(1)
    expect(
      within(card).getByRole('button', { name: 'Review the invite' }),
    ).toBeVisible()
    expect(card).not.toHaveTextContent('this is Carla')
    expect(card).not.toHaveTextContent(CIVIC_PANEL_JOIN_LINE)
    expect(card).not.toHaveTextContent('Reply STOP to opt out.')
    expect(screen.queryByTestId('sms-flow')).toBeNull()
  })

  it('drops the button once the civic panel is set up', async () => {
    api.mock('GET /v1/contacts/civic-panel/managed', {
      status: 200,
      data: { panel: builtPanel },
    })
    render(<ChiefOfStaffChatBody active conversationIdOverride="conv" />)

    const card = await screen.findByTestId('managed-panel-invite')
    await waitFor(() => expect(within(card).queryByRole('button')).toBeNull())
    expect(within(card).getByText('Your civic panel invite')).toBeVisible()
  })

  it('opens the text flow in its managed mode on the draft', async () => {
    const user = userEvent.setup()
    render(<ChiefOfStaffChatBody active conversationIdOverride="conv" />)

    await user.click(
      await screen.findByRole('button', { name: 'Review the invite' }),
    )

    expect(screen.getByTestId('sms-flow')).toBeInTheDocument()
    expect(flowProps.current?.initialScript).toMatch(
      /^Hi \{\{first_name\}\}, this is Carla, your Maplewood City Council Member\./,
    )
    expect(flowProps.current?.managedInvite?.place).toBe('Maplewood')
  })

  it.each([
    ['sets it up', true, MANAGED_CIVIC_PANEL_SET_UP_MESSAGE],
    ['backs out', false, MANAGED_CIVIC_PANEL_BACKED_OUT_MESSAGE],
  ])(
    'tells the Chief of Staff in a hidden turn when the official %s',
    async (_name, setUp, sent) => {
      const user = userEvent.setup()
      render(<ChiefOfStaffChatBody active conversationIdOverride="conv" />)
      await user.click(
        await screen.findByRole('button', { name: 'Review the invite' }),
      )

      const flow = flowProps.current
      if (setUp) flow?.managedInvite?.onSetUp()
      else flow?.onClose()

      await waitFor(() =>
        expect(streamMessageMock).toHaveBeenCalledWith(
          expect.objectContaining({ content: sent }),
        ),
      )
      expect(streamMessageMock).toHaveBeenCalledTimes(1)
      expect(screen.queryByText(sent)).toBeNull()
      expect(screen.queryByTestId('sms-flow')).toBeNull()
    },
  )

  it('offers the invite with fixed answers', async () => {
    listMessagesMock.mockResolvedValue([
      turn([
        { kind: 'text', text: 'It is free in early access.' },
        { kind: 'tool', toolName: 'offer_managed_panel_invite', payload: {} },
      ]),
    ])
    render(<ChiefOfStaffChatBody active conversationIdOverride="conv" />)

    expect(await screen.findByText('Want to see the invite?')).toBeVisible()
    for (const name of ['Show me the invite', 'How does it work?', 'Not now']) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument()
    }
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByText('Or write your own...')).toBeInTheDocument()
    expect(screen.queryByText(/wave/i)).toBeNull()
  })

  it('offers the invite without How does it work? once it is answered', async () => {
    listMessagesMock.mockResolvedValue([
      turn([
        {
          kind: 'text',
          text: 'Members hear from your office about once a month.',
        },
        {
          kind: 'tool',
          toolName: 'offer_managed_panel_invite',
          payload: { afterHowItWorks: true },
        },
      ]),
    ])
    render(<ChiefOfStaffChatBody active conversationIdOverride="conv" />)

    expect(await screen.findByText('Want to see the invite?')).toBeVisible()
    for (const name of ['Show me the invite', 'Not now']) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument()
    }
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByText('Or write your own...')).toBeInTheDocument()
  })

  it('shows the panel it set up, linking to the panel page', async () => {
    api.mock('GET /v1/contacts/civic-panel/managed', {
      status: 200,
      data: {
        panel: builtPanel,
      },
    })
    listMessagesMock.mockResolvedValue([
      turn([
        { kind: 'text', text: 'Done.' },
        { kind: 'tool', toolName: 'present_managed_panel', payload: {} },
      ]),
    ])
    render(<ChiefOfStaffChatBody active conversationIdOverride="conv" />)

    const link = await screen.findByRole('link', { name: /Your civic panel/ })
    expect(link).toHaveTextContent('Building, 0 of 275 members')
    expect(link.getAttribute('href')).toMatch(
      /^\/dashboard\/contacts\/citizens-panel/,
    )
  })

  describe('the Who gets the mic video', () => {
    const explainTurn = (part: 'what_it_is' | 'how_it_works') =>
      turn([
        {
          kind: 'tool',
          toolName: 'explain_managed_panel',
          payload: { part },
        },
        { kind: 'text', text: 'Members hear from your office once a month.' },
        {
          kind: 'tool',
          toolName: 'offer_managed_panel_invite',
          payload: part === 'how_it_works' ? { afterHowItWorks: true } : {},
        },
      ])

    it('plays on the answer to How does it work?, landscape and square, never on its own', async () => {
      listMessagesMock.mockResolvedValue([explainTurn('how_it_works')])
      const { container } = render(
        <ChiefOfStaffChatBody active conversationIdOverride="conv" />,
      )

      const video = await screen.findByTestId('managed-panel-video')
      const players = video.querySelectorAll('video')
      expect(players).toHaveLength(2)
      expect(
        [...players].map((p) => p.querySelector('source')?.getAttribute('src')),
      ).toEqual([
        '/videos/who-gets-the-mic-landscape.mp4',
        '/videos/who-gets-the-mic-square.mp4',
      ])
      for (const player of players) {
        expect(player).toHaveAttribute('controls')
        expect(player).toHaveAttribute('playsinline')
        expect(player).toHaveAttribute('preload', 'metadata')
        expect(player).not.toHaveAttribute('autoplay')
        expect(player).toHaveAttribute(
          'aria-label',
          'Who gets the mic, a 1 minute video',
        )
        expect(player).toHaveAccessibleDescription(
          /^What the video says: You represent every resident in the district\./,
        )
      }
      expect(players[0]).toHaveClass('hidden', 'md:block')
      expect(players[1]).toHaveClass('md:hidden')
      expect(
        screen.getByText('Members hear from your office once a month.'),
      ).toBeInTheDocument()
      expect(container).not.toHaveTextContent('Explaining your civic panel')
    })

    it('stays off the explanation after Build my civic panel', async () => {
      listMessagesMock.mockResolvedValue([explainTurn('what_it_is')])
      render(<ChiefOfStaffChatBody active conversationIdOverride="conv" />)

      expect(await screen.findByText('Want to see the invite?')).toBeVisible()
      expect(
        screen.getByText('Explaining your civic panel'),
      ).toBeInTheDocument()
      expect(screen.queryByTestId('managed-panel-video')).toBeNull()
    })

    it('stays off the invite and the panel cards', async () => {
      render(<ChiefOfStaffChatBody active conversationIdOverride="conv" />)

      await screen.findByTestId('managed-panel-invite')
      expect(screen.queryByTestId('managed-panel-video')).toBeNull()
    })

    it('shows on a streaming answer to How does it work?', async () => {
      listMessagesMock.mockReset().mockResolvedValue([])
      streamMessageMock.mockImplementation(() =>
        makeStream([
          {
            type: 'tool_call',
            toolName: 'explain_managed_panel',
            toolCallId: 'tc-explain',
            args: { part: 'how_it_works' },
          },
          { type: 'text', delta: 'Members hear from your office.' },
          { type: 'done', assistantMessageId: 'a1' },
        ]),
      )
      render(
        <ChiefOfStaffChatBody
          active
          conversationIdOverride="conv"
          pendingKickoff="How does it work?"
        />,
      )

      expect(await screen.findByTestId('managed-panel-video')).toBeVisible()
    })
  })

  it('draws nothing for a refused call', async () => {
    listMessagesMock.mockResolvedValue([
      turn([
        { kind: 'text', text: 'Here it is.' },
        {
          kind: 'tool',
          toolName: 'present_managed_panel_invite',
          payload: null,
        },
      ]),
    ])
    render(<ChiefOfStaffChatBody active conversationIdOverride="conv" />)

    expect(await screen.findByText('Here it is.')).toBeInTheDocument()
    expect(screen.queryByTestId('managed-panel-invite')).toBeNull()
  })

  describe('analytics', () => {
    const calls = (event: string) =>
      vi.mocked(trackEvent).mock.calls.filter(([name]) => name === event)

    it('records the invite when a turn presents it, not when history replays it', async () => {
      listMessagesMock.mockReset().mockResolvedValueOnce([])
      listMessagesMock.mockResolvedValue([inviteTurn()])
      streamMessageMock.mockImplementation(() =>
        makeStream([
          { type: 'text', delta: 'Here it is.' },
          {
            type: 'tool_call',
            toolName: 'present_managed_panel_invite',
            toolCallId: 'tc-invite',
            args: {},
          },
          { type: 'done', assistantMessageId: 'a1' },
        ]),
      )
      render(
        <ChiefOfStaffChatBody
          active
          conversationIdOverride="conv"
          pendingKickoff="Show me the invite"
        />,
      )

      await screen.findByTestId('managed-panel-invite')
      await waitFor(() =>
        expect(calls(EVENTS.Contacts.CivicPanelInviteViewed)).toHaveLength(1),
      )
      const [, properties] =
        calls(EVENTS.Contacts.CivicPanelInviteViewed)[0] ?? []
      expect(properties).toEqual({
        inviteChars: expect.any(Number),
        inviteSegments: expect.any(Number),
      })
    })

    it('records nothing for an invite replayed from history', async () => {
      render(<ChiefOfStaffChatBody active conversationIdOverride="conv" />)

      await screen.findByTestId('managed-panel-invite')
      expect(calls(EVENTS.Contacts.CivicPanelInviteViewed)).toHaveLength(0)
    })

    it('records opening the review from the chat card', async () => {
      const user = userEvent.setup()
      render(<ChiefOfStaffChatBody active conversationIdOverride="conv" />)

      await user.click(
        await screen.findByRole('button', { name: 'Review the invite' }),
      )

      expect(calls(EVENTS.Contacts.CivicPanelInviteReviewViewed)).toEqual([
        [EVENTS.Contacts.CivicPanelInviteReviewViewed, { source: 'chat_card' }],
      ])
    })
  })
})
