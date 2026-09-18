import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CAMPAIGN_MANAGER_START_STORY_SENTINEL } from '@goodparty_org/contracts'
import {
  CampaignManagerChatProvider,
  useCampaignManagerChat,
} from './CampaignManagerChatProvider'
import { CAMPAIGN_MANAGER_BALLOT_KICKOFF } from './campaignManagerChat'

interface SurfaceProps {
  open?: boolean
  initialConversationId?: string | null
  pendingKickoff?: string
  opener?: string[]
  openerKey?: string | null
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
vi.mock('./campaignManagerChat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./campaignManagerChat')>()
  return {
    ...actual,
    campaignManagerChatApi: {
      ...actual.campaignManagerChatApi,
      createConversation: (...args: unknown[]) =>
        createConversation(...args) as never,
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

const setup = () => {
  surfaceProps.length = 0
  render(
    <CampaignManagerChatProvider>
      <Controls />
    </CampaignManagerChatProvider>,
  )
  return userEvent.setup()
}

const surface = (): SurfaceProps => surfaceProps.at(-1) as SurfaceProps

// The manager runs Chief of Staff's session model. These are the properties
// that model is: an open is a NEW chat, nothing is created until the candidate
// sends something, and an earlier chat is reached by id from history.
describe('campaign manager conversation sessions', () => {
  it('opens a new chat, deferring the create to the first message', async () => {
    const user = setup()

    await user.click(screen.getByText('open manager'))

    expect(surface().open).toBe(true)
    expect(surface().initialConversationId).toBeNull()
    expect(createConversation).not.toHaveBeenCalled()
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
    const user = setup()

    await user.click(screen.getByText('start story'))
    expect(surface().pendingKickoff).toBe(CAMPAIGN_MANAGER_START_STORY_SENTINEL)
    expect(surface().initialConversationId).toBeNull()
    expect(surface().opener).toBeUndefined()

    await user.click(screen.getByText('start ballot'))
    expect(surface().pendingKickoff).toBe(CAMPAIGN_MANAGER_BALLOT_KICKOFF)
    expect(surface().initialConversationId).toBeNull()
  })

  it('drops a queued kickoff when a past conversation is opened', async () => {
    const user = setup()

    await user.click(screen.getByText('start story'))
    await user.click(screen.getByText('open past chat'))

    expect(surface().pendingKickoff).toBeUndefined()
  })
})
