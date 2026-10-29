import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RecommendedList } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import RecommendedVoterListCard from './RecommendedVoterListCard'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))
const openChannelPicker = vi.fn()
vi.mock('../shared/channelPicker/ChannelPickerProvider', () => ({
  useOpenChannelPicker: () => openChannelPicker,
}))

// The free robocall offer, as gp-api answers it. Not offered by default.
let mockFreeOffer: { offer: { eligible: true } | null } = { offer: null }
vi.mock('app/dashboard/shared/robocallFreeOffer/useRobocallFreeOffer', () => ({
  useRobocallFreeOffer: () => mockFreeOffer,
}))

afterEach(() => {
  mockFreeOffer = { offer: null }
  openChannelPicker.mockReset()
})

const OFFER_RECOMMENDATION: RecommendedList = {
  variant: 'freeOfferElectionEveRobocall',
  intent: 'electionDay',
  filter: { voterStatus: ['Super', 'Likely'] },
  count: 852,
  copy: {
    title: 'Landline voters in selected precincts',
    criteriaSummary: 'Landline voters in half of your precincts.',
  },
  existingFilterId: null,
}

describe('RecommendedVoterListCard — the free robocall offer', () => {
  it('reads as the offer and links straight to robocall while it is live', () => {
    mockFreeOffer = { offer: { eligible: true } }

    render(
      <RecommendedVoterListCard
        recommendation={OFFER_RECOMMENDATION}
        onDetails={vi.fn()}
      />,
    )

    expect(screen.getByText('Free offer')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Send outreach' })).toHaveAttribute(
      'href',
      expect.stringContaining('recommended=freeOfferElectionEveRobocall'),
    )
  })

  it('is a plain recommendation once the offer has ended', async () => {
    render(
      <RecommendedVoterListCard
        recommendation={OFFER_RECOMMENDATION}
        onDetails={vi.fn()}
      />,
    )

    expect(screen.queryByText('Free offer')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Send outreach' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Send outreach' }))
    expect(openChannelPicker).toHaveBeenCalledWith({
      kind: 'recommended',
      recommendation: OFFER_RECOMMENDATION,
    })
  })
})
