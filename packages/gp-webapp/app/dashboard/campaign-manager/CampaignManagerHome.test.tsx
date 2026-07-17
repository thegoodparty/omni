import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import type { TrackerTasksResult } from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import CampaignManagerHome from './CampaignManagerHome'

vi.mock(
  '../campaign-plan/components/campaignStrategy/useTrackerTasks',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../campaign-plan/components/campaignStrategy/useTrackerTasks')
    >()),
    useTrackerTasks: (): TrackerTasksResult => ({
      tasks: [],
      isPending: false,
      isError: false,
      isGeneratingDynamic: false,
    }),
    useToggleTrackerTaskComplete: () => ({ mutate: vi.fn(), isPending: false }),
  }),
)

// The Pro banner + progress section are the legacy dashboard widgets (their own
// campaign/voter-contact providers); this smoke test only covers the home's
// composition, so stub them out.
vi.mock('../components/campaignManager/ProUpgradeBanner', () => ({
  default: () => null,
}))
vi.mock('../components/campaignManager/ProgressSection', () => ({
  default: () => null,
}))

// No prior conversations, so the first-run "meet" card renders. Partial-mock so
// the footer's history popover keeps its real useDeleteConversation.
vi.mock('../chief-of-staff/data/use-chat-history', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../chief-of-staff/data/use-chat-history')
  >()),
  useChatHistory: () => ({ data: [] }),
}))

// The story card transitively renders here too; default to an incomplete
// story so both first-run cards are present for this smoke test.
vi.mock('app/dashboard/campaign-story/useCampaignStoryComplete', () => ({
  useCampaignStoryComplete: vi.fn(() => ({
    isComplete: false,
    isLoading: false,
    isError: false,
  })),
}))

describe('CampaignManagerHome', () => {
  it('renders the tasks surface and campaign-manager chat entries', () => {
    render(<CampaignManagerHome firstName="Renee" />)

    expect(
      screen.getByRole('button', { name: /meet your campaign manager/i }),
    ).toBeInTheDocument()
    // The footer chat bar uses the campaign-manager open label, not CoS.
    expect(
      screen.getByRole('button', { name: /open campaign manager chat/i }),
    ).toBeInTheDocument()
    // Nothing Chief-of-Staff-branded leaks into the campaign-manager surface.
    expect(screen.queryByText(/chief of staff/i)).not.toBeInTheDocument()
  })
})
