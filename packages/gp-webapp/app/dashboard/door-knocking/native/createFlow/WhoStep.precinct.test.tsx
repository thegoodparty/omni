import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { WhoStep } from './WhoStep'

// Door knocking's own list builder had no precinct control at all, while the
// CRM wizard and every other channel's audience step did — so the same
// audience could be cut by precinct in four places and not the fifth. The
// group is offered on both products for the same reason it is in the wizard:
// a precinct is a subdivision of the district, not a campaign-only construct.
const baseProps = {
  filters: {},
  onFiltersChange: vi.fn(),
  precincts: [],
  onPrecinctsChange: vi.fn(),
  precinctOptions: {
    options: [{ county: 'LARAMIE', precinct: '14', voters: 900 }],
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
  hasActiveRecommendation: false,
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

describe('WhoStep — precinct group', () => {
  it.each([
    ['a campaign', false],
    ['an elected official', true],
  ])('offers the precinct pills to %s', (_who, isServeOrg) => {
    const onPrecinctsChange = vi.fn()

    render(
      <WhoStep
        {...baseProps}
        isServeOrg={isServeOrg}
        onPrecinctsChange={onPrecinctsChange}
      />,
    )

    expect(screen.getByText('Precinct')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Laramie — 14'))

    expect(onPrecinctsChange).toHaveBeenCalledWith(['LARAMIE|14'])
  })

  it('is not on the list picker, only behind Create a new list', () => {
    render(<WhoStep {...baseProps} building={false} />)

    expect(screen.queryByText('Precinct')).toBeNull()
  })
})
