import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import type { TrackerTasksResult } from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import CampaignManagerHome from './CampaignManagerHome'

vi.mock('../campaign-plan/components/campaignStrategy/useTrackerTasks', () => ({
  useTrackerTasks: (): TrackerTasksResult => ({
    tasks: [],
    isPending: false,
    isError: false,
    isGeneratingDynamic: false,
  }),
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
