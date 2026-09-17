import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import {
  CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
  CAMPAIGN_MANAGER_START_STORY_SENTINEL,
} from '@goodparty_org/contracts'
import { CampaignManagerChatProvider } from './CampaignManagerChatProvider'
import { CAMPAIGN_MANAGER_BALLOT_KICKOFF } from './campaignManagerChat'

// Capture the props the chat surface is handed so the hidden-message list can be
// asserted directly. The surface itself renders nothing here.
interface SurfaceProps {
  hiddenMessageContents?: string[]
  pendingKickoff?: string
  initialConversationId?: string | null
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

const hidden = (): string[] => {
  render(
    <CampaignManagerChatProvider>
      <div />
    </CampaignManagerChatProvider>,
  )
  return surfaceProps.at(-1)?.hiddenMessageContents ?? []
}

describe('campaign manager hidden message contents', () => {
  it('hides the two sentinels, whose replies are canned', () => {
    const contents = hidden()
    expect(contents).toContain(CAMPAIGN_MANAGER_START_STORY_SENTINEL)
    expect(contents).toContain(CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL)
  })

  // Hiding a user message makes the reload path drop the assistant turn that
  // follows it, because it assumes that reply was canned. The ballot kickoff
  // runs a real LLM turn, so hiding it would erase the candidate's filing
  // answer from the transcript every time they reopened the conversation.
  it('never hides the ballot kickoff, whose reply is a real LLM answer', () => {
    expect(hidden()).not.toContain(CAMPAIGN_MANAGER_BALLOT_KICKOFF)
  })
})
