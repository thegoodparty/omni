import { describe, expect, it, vi } from 'vitest'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CAMPAIGN_MANAGER_START_STORY_SENTINEL } from '@goodparty_org/contracts'
import {
  CampaignManagerChatProvider,
  useCampaignManagerChat,
} from './CampaignManagerChatProvider'
import {
  CAMPAIGN_MANAGER_BALLOT_KICKOFF,
  CAMPAIGN_MANAGER_HISTORY_KEY,
} from './campaignManagerChat'

interface SurfaceProps {
  open?: boolean
  initialConversationId?: string | null
  pendingKickoff?: string
  opener?: string[]
  openerKey?: string | null
  defaultIntro?: string[]
  onNewChat?: () => void
}
const surfaceProps: SurfaceProps[] = []
vi.mock('../chief-of-staff/components/chat/ChiefOfStaffChatSurface', () => ({
  default: (props: SurfaceProps) => {
    surfaceProps.push(props)
    return null
  },
}))
vi.mock('../chief-of-staff/components/chat/FooterChatBar', () => ({
  default: () => null,
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: 'Renee' }],
}))
vi.mock('app/dashboard/campaign-story/useCampaignStoryComplete', () => ({
  useCampaignStoryComplete: () => ({
    isComplete: false,
    isLoading: false,
    isError: false,
  }),
}))

const createConversation = vi.fn()
const listConversations = vi.fn()
vi.mock('./campaignManagerChat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./campaignManagerChat')>()
  return {
    ...actual,
    campaignManagerChatApi: {
      ...actual.campaignManagerChatApi,
      createConversation: (...args: unknown[]) =>
        createConversation(...args) as never,
      listConversations: () => listConversations() as never,
    },
  }
})

function Controls(): React.JSX.Element {
  const chat = useCampaignManagerChat()
  return (
    <>
      <button onClick={() => chat?.openManager()}>open manager</button>
      <button onClick={() => chat?.startStory()}>start story</button>
      <button onClick={() => chat?.startBallotAccess()}>start ballot</button>
      <button onClick={() => chat?.openConversation('conv-7')}>
        open past chat
      </button>
    </>
  )
}

// Seeds both the mock and the query cache: the provider resumes from the
// cached list synchronously at click time, so tests never race the fetch.
const setup = (conversations: Array<{ conversationId: string }> = []) => {
  surfaceProps.length = 0
  listConversations.mockResolvedValue(conversations)
  testQueryClient.setQueryData(CAMPAIGN_MANAGER_HISTORY_KEY, conversations)
  render(
    <CampaignManagerChatProvider>
      <Controls />
    </CampaignManagerChatProvider>,
  )
  return userEvent.setup()
}

const surface = (): SurfaceProps => surfaceProps.at(-1) as SurfaceProps

// The manager's session model (ENG-11184): a general open RESUMES the most
// recent conversation so the manager keeps its memory across opens; only a
// candidate with no history, a kickoff entry, or the header's New chat lands
// on a fresh chat, whose conversation is created on the first message.
describe('campaign manager conversation sessions', () => {
  it('opens a new chat when there is no history, deferring the create to the first message', async () => {
    const user = setup()

    await user.click(screen.getByText('open manager'))

    expect(surface().open).toBe(true)
    expect(surface().initialConversationId).toBeNull()
    expect(createConversation).not.toHaveBeenCalled()
  })

  it('resumes the most recent conversation on a general open', async () => {
    const user = setup([
      { conversationId: 'conv-newest' },
      { conversationId: 'conv-older' },
    ])

    await user.click(screen.getByText('open manager'))

    expect(surface().open).toBe(true)
    expect(surface().initialConversationId).toBe('conv-newest')
    // A resumed transcript replays as-is — no greeting typed over it.
    expect(surface().opener).toBeUndefined()
  })

  it('starts over on a fresh chat from the surface New chat action', async () => {
    const user = setup([{ conversationId: 'conv-newest' }])

    await user.click(screen.getByText('open manager'))
    act(() => surface().onNewChat?.())

    expect(surface().initialConversationId).toBeNull()
    expect(surface().opener?.[0]).toContain('Renee')
    expect(surface().pendingKickoff).toBeUndefined()
  })

  it('greets on a new chat via the opener, not only the first chat ever', async () => {
    const user = setup()

    await user.click(screen.getByText('open manager'))

    expect(surface().opener?.[0]).toContain('Renee')
    expect(surface().openerKey).toBe('manager-greeting')
  })

  it('reopens a past conversation by id, with no opener over its transcript', async () => {
    const user = setup()

    await user.click(screen.getByText('open past chat'))

    expect(surface().initialConversationId).toBe('conv-7')
    expect(surface().opener).toBeUndefined()
    expect(createConversation).not.toHaveBeenCalled()
  })

  it('starts each kickoff entry on its own new chat, with no opener', async () => {
    // History present: a kickoff must still get a fresh conversation, never
    // append the story intake to the resumed thread.
    const user = setup([{ conversationId: 'conv-newest' }])

    await user.click(screen.getByText('start story'))
    expect(surface().pendingKickoff).toBe(CAMPAIGN_MANAGER_START_STORY_SENTINEL)
    expect(surface().initialConversationId).toBeNull()
    expect(surface().opener).toBeUndefined()

    await user.click(screen.getByText('start ballot'))
    expect(surface().pendingKickoff).toBe(CAMPAIGN_MANAGER_BALLOT_KICKOFF)
    expect(surface().initialConversationId).toBeNull()
  })

  // The body types `defaultIntro` on the candidate's FIRST chat ever, which is
  // exactly when the home cards that fire a kickoff are on screen. If the
  // manager's greeting were still the default intro, it would type in while
  // the kickoff's own create was in flight and the candidate would be greeted
  // twice — once generally, then again by the story or ballot reply.
  it('plays no intro at all on a kickoff entry', async () => {
    const user = setup()

    await user.click(screen.getByText('start story'))

    expect(surface().opener).toBeUndefined()
    expect(surface().defaultIntro).toEqual([])
  })

  // ...and it must not fall through to the shared body's Chief of Staff
  // default either, which is what an unset defaultIntro would give.
  it('never falls back to the Chief of Staff intro', async () => {
    const user = setup()

    await user.click(screen.getByText('start ballot'))

    const intro = (surface().defaultIntro ?? []).join(' ')
    expect(intro).not.toMatch(/chief of staff/i)
  })

  it('drops a queued kickoff when a past conversation is opened', async () => {
    const user = setup()

    await user.click(screen.getByText('start story'))
    await user.click(screen.getByText('open past chat'))

    expect(surface().pendingKickoff).toBeUndefined()
  })
})
