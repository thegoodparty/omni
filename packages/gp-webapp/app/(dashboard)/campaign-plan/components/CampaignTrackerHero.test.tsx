import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CampaignTrackerHero from './CampaignTrackerHero'

const baseProps = {
  candidateName: 'Jane Doe',
  race: 'Mayor',
  district: '5',
  primaryDate: '',
  electionDate: 'Nov 3, 2026',
  onDownload: vi.fn(),
  downloading: false,
  canDownload: true,
}

describe('CampaignTrackerHero date line', () => {
  it('shows only the election date when there is no primary', () => {
    render(<CampaignTrackerHero {...baseProps} />)
    expect(screen.getByText(/Election Day Nov 3, 2026/)).toBeInTheDocument()
    expect(screen.queryByText(/Primary/)).not.toBeInTheDocument()
  })

  it('shows the primary and the election date when a primary exists', () => {
    render(<CampaignTrackerHero {...baseProps} primaryDate="Mar 3, 2026" />)
    expect(
      screen.getByText(/Primary Mar 3, 2026 · Election Day Nov 3, 2026/),
    ).toBeInTheDocument()
  })
})
