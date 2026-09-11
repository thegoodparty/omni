import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import type { ChatStreamEvent } from '../../../shared/agent-chat/chatClient'
import ConversationalHome, {
  type ConversationalHomeConfig,
} from './ConversationalHome'

const createMock = vi.fn()
const listMessagesMock = vi.fn()
const listConversationsMock = vi.fn()
const streamMessageMock = vi.fn()

const chatApi = {
  createConversation: (...args: unknown[]) => createMock(...args),
  listMessages: (...args: unknown[]) => listMessagesMock(...args),
  listConversations: (...args: unknown[]) => listConversationsMock(...args),
  streamMessage: (...args: unknown[]) => streamMessageMock(...args),
  softDelete: vi.fn(),
}

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-test' }),
}))

vi.mock('@shared/sentry', () => ({ reportErrorToSentry: vi.fn() }))

const makeStream = (
  events: ChatStreamEvent[],
): AsyncIterable<ChatStreamEvent> =>
  (async function* () {
    for (const ev of events) yield ev
  })()

const OPENER = 'Get me up to speed for this week.'

const config = (
  overrides: Partial<ConversationalHomeConfig> = {},
): ConversationalHomeConfig => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chatApi: chatApi as any,
  analyticsLabel: 'test-home',
  historyKey: ['test-home'],
  defaultIntro: ['intro'],
  sessionOpenerKickoff: OPENER,
  ...overrides,
})

const STORAGE_KEY = 'conversational-home:test-home:eo-test'

beforeEach(() => {
  createMock.mockReset()
  listMessagesMock.mockReset()
  listConversationsMock.mockReset()
  streamMessageMock.mockReset()
  listMessagesMock.mockResolvedValue([])
  listConversationsMock.mockResolvedValue([])
  createMock.mockResolvedValue({ conversationId: 'c-new' })
  streamMessageMock.mockReturnValue(makeStream([{ type: 'done' }]))
  window.sessionStorage.clear()
})

describe('<ConversationalHome> session opener', () => {
  // The home defers conversation creation until the first send, so without
  // this an official lands on a hero and nothing else and has to open the
  // conversation themselves.
  it('opens the session instead of waiting to be spoken to', async () => {
    render(<ConversationalHome config={config()} />)

    await waitFor(() => expect(streamMessageMock).toHaveBeenCalled())
    expect(streamMessageMock.mock.calls[0]?.[0]).toMatchObject({
      content: OPENER,
    })
  })

  // Once a sitting has a conversation, the opener has already run. Firing it
  // per mount would re-run it on every navigation back to the home.
  it('does not re-open a session already in progress', async () => {
    window.sessionStorage.setItem(STORAGE_KEY, 'c-existing')

    render(<ConversationalHome config={config()} />)

    await waitFor(() => expect(listMessagesMock).toHaveBeenCalled())
    expect(streamMessageMock).not.toHaveBeenCalled()
  })

  // A task-card CTA is the more specific intent, so it wins the one kickoff.
  it('lets an explicit kickoff win', async () => {
    render(
      <ConversationalHome config={config()} pendingKickoff="Do this instead" />,
    )

    await waitFor(() => expect(streamMessageMock).toHaveBeenCalled())
    expect(streamMessageMock.mock.calls[0]?.[0]).toMatchObject({
      content: 'Do this instead',
    })
  })

  // A played opener is already the agent speaking first, so a second opening
  // message on top of it would be the agent talking over itself.
  it('stays quiet when an opener is playing', async () => {
    render(
      <ConversationalHome
        config={config()}
        opener={['card greeting']}
        openerKey="priorities"
      />,
    )

    await waitFor(() => expect(listConversationsMock).toHaveBeenCalled())
    expect(streamMessageMock).not.toHaveBeenCalled()
  })

  // Serve withholds the opener while an onboarding step is on screen; with no
  // opener configured the home must not invent one.
  it('sends nothing when no opener is configured', async () => {
    render(
      <ConversationalHome
        config={config({ sessionOpenerKickoff: undefined })}
      />,
    )

    await waitFor(() => expect(listConversationsMock).toHaveBeenCalled())
    expect(streamMessageMock).not.toHaveBeenCalled()
  })
})
