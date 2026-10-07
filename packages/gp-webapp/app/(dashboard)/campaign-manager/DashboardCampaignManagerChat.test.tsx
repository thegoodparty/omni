import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import {
  DashboardCampaignManagerChat,
  useCampaignManagerChat,
} from './CampaignManagerChatProvider'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: vi.fn(),
}))
import { useOrganization } from '@shared/organization-picker'
const mockOrganization = vi.mocked(useOrganization)

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: 'Renee' }],
}))
vi.mock('app/(dashboard)/campaign-story/useCampaignStoryComplete', () => ({
  useCampaignStoryComplete: () => ({
    isComplete: false,
    isLoading: false,
    isError: false,
  }),
}))
vi.mock('../chief-of-staff/data/use-chat-history', () => ({
  useChatHistory: () => ({ data: [] }),
  useDeleteConversation: () => ({ mutate: vi.fn(), isPending: false }),
}))

const winOrg = { slug: 'campaign-1', electedOfficeId: null }
const serveOrg = { slug: 'town-council-1', electedOfficeId: 'eo_1' }

const renderGate = () =>
  render(
    <DashboardCampaignManagerChat>
      <div data-testid="page-content" />
    </DashboardCampaignManagerChat>,
  )

// What the gate owes a page: the chat's context (the sidebar's Chat pill and
// Home's chat box read it) on Win, and nothing on Serve. There is no footer
// bar on any page any more.
const ChatProbe = (): React.JSX.Element => (
  <div data-testid="chat-context">
    {useCampaignManagerChat() ? 'chat' : 'no chat'}
  </div>
)

const renderProbe = () =>
  render(
    <DashboardCampaignManagerChat>
      <ChatProbe />
    </DashboardCampaignManagerChat>,
  )

const footerBar = () => screen.queryByRole('button', { name: /^open chat$/i })

describe('DashboardCampaignManagerChat (the global chat gate)', () => {
  it('gives a Win (campaign) org the chat, with no footer bar', () => {
    mockOrganization.mockReturnValue(winOrg as never)
    renderProbe()

    expect(screen.getByTestId('chat-context')).toHaveTextContent('chat')
    expect(footerBar()).not.toBeInTheDocument()
  })

  it('leaves a Serve (elected-office) org without it', () => {
    mockOrganization.mockReturnValue(serveOrg as never)
    renderGate()

    expect(screen.getByTestId('page-content')).toBeInTheDocument()
    expect(footerBar()).not.toBeInTheDocument()
  })
})
