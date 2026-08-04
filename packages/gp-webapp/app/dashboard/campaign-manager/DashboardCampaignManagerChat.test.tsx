import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import { DashboardCampaignManagerChat } from './CampaignManagerChatProvider'

vi.mock('@shared/experiments/campaignStoryFlag', () => ({
  useCampaignStoryFlag: vi.fn(),
}))
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'
const mockFlag = vi.mocked(useCampaignStoryFlag)

vi.mock('@shared/organization-picker', () => ({
  useOrganization: vi.fn(),
}))
import { useOrganization } from '@shared/organization-picker'
const mockOrganization = vi.mocked(useOrganization)

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

const dockBar = () =>
  screen.queryByRole('button', { name: /open campaign manager chat/i })

describe('DashboardCampaignManagerChat (the global dock gate)', () => {
  it('mounts the dock for a flag-on Win (campaign) org', () => {
    mockFlag.mockReturnValue({ ready: true, enabled: true })
    mockOrganization.mockReturnValue(winOrg as never)
    renderGate()

    expect(screen.getByTestId('page-content')).toBeInTheDocument()
    expect(dockBar()).toBeInTheDocument()
  })

  it('never mounts the dock on a Serve (elected-office) org, even flag-on', () => {
    mockFlag.mockReturnValue({ ready: true, enabled: true })
    mockOrganization.mockReturnValue(serveOrg as never)
    renderGate()

    expect(screen.getByTestId('page-content')).toBeInTheDocument()
    // Serve keeps Chief of Staff — no Campaign Manager footer bar.
    expect(dockBar()).not.toBeInTheDocument()
  })

  it('does not mount the dock when the flag is off', () => {
    mockFlag.mockReturnValue({ ready: true, enabled: false })
    mockOrganization.mockReturnValue(winOrg as never)
    renderGate()

    expect(screen.getByTestId('page-content')).toBeInTheDocument()
    expect(dockBar()).not.toBeInTheDocument()
  })
})
