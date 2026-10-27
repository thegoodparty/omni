import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { WhoStep } from './WhoStep'

const baseProps = {
  filters: {},
  onFiltersChange: vi.fn(),
  precincts: [],
  onPrecinctsChange: vi.fn(),
  votedStatus: [],
  onVotedStatusChange: vi.fn(),
  precinctOptions: {
    options: [],
    truncated: false,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  savedLists: [],
  allContactsHouseholds: 1000,
  selectedListId: null,
  onSelectList: vi.fn(),
  hasPickedAudience: false,
  activeRecommendationVariant: null,
  isServeOrg: false,
  building: true,
  onBuildingChange: vi.fn(),
  open: false,
  onOpenChange: vi.fn(),
  recommendations: [],
  recommendationsLoading: false,
  recommendationsError: false,
  onSelectRecommendation: vi.fn(),
}

describe('WhoStep — Voted in election', () => {
  it('offers Yes and No/Unknown to a campaign', () => {
    render(<WhoStep {...baseProps} />)

    const group = screen.getByLabelText('Voted in election')
    expect(within(group).getByText('Yes')).toBeInTheDocument()
    expect(within(group).getByText('No/Unknown')).toBeInTheDocument()
  })

  it('reports a pick as the saved votedStatus value', () => {
    const onVotedStatusChange = vi.fn()
    render(<WhoStep {...baseProps} onVotedStatusChange={onVotedStatusChange} />)

    fireEvent.click(
      within(screen.getByLabelText('Voted in election')).getByText(
        'No/Unknown',
      ),
    )

    expect(onVotedStatusChange).toHaveBeenCalledWith(['unknown'])
  })

  it('shows the selection it is given', () => {
    render(<WhoStep {...baseProps} votedStatus={['already_voted']} />)

    expect(
      within(screen.getByLabelText('Voted in election'))
        .getByText('Yes')
        .closest('button'),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('stays off Serve', () => {
    render(<WhoStep {...baseProps} isServeOrg />)

    expect(screen.queryByText('Voted in election')).toBeNull()
  })
})
