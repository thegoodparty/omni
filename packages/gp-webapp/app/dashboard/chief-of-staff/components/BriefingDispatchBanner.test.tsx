import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { MeetingsListItemDto } from 'gpApi/api-endpoints'
import BriefingDispatchBanner from './BriefingDispatchBanner'

const MEETING_DATE = '2026-07-20'

const meeting = (hasBriefing: boolean): MeetingsListItemDto => ({
  meetingDate: MEETING_DATE,
  meetingTime: '18:00',
  meetingTimezone: 'America/Chicago',
  durationMinutes: 60,
  meetingName: 'City Council',
  location: 'City Hall',
  hasBriefing,
})

const mockMeetings = (hasBriefing: boolean) =>
  api.mock('GET /v1/meetings', {
    status: 200,
    data: { scheduleKnown: true, meetings: [meeting(hasBriefing)] },
  })

const mockDispatch = (inFlight: boolean) =>
  api.mock('POST /v1/meetings/dispatch-if-needed', {
    status: 200,
    data: { dispatched: inFlight, inFlight, meetingDate: MEETING_DATE },
  })

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

let invalidateSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  invalidateSpy = vi
    .spyOn(testQueryClient, 'invalidateQueries')
    .mockResolvedValue(undefined)
})

afterEach(() => {
  invalidateSpy.mockRestore()
})

describe('<BriefingDispatchBanner>', () => {
  it('shows the banner when a landing dispatch reports a run in flight', async () => {
    mockDispatch(true)
    mockMeetings(false)

    render(<BriefingDispatchBanner />)

    expect(
      await screen.findByText(/generating your briefing/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/we'll email you when it's ready/i),
    ).toBeInTheDocument()
  })

  it('does not re-render into a storm while the briefing is still generating', async () => {
    mockDispatch(true)
    mockMeetings(false)

    render(<BriefingDispatchBanner />)

    // The useRef counter must not re-trigger the effect: a single not-ready
    // poll response must not burn the whole attempt budget and clear the
    // banner. It stays visible and does not invalidate (nothing is ready yet).
    await screen.findByText(/generating your briefing/i)
    await settle()
    expect(invalidateSpy).not.toHaveBeenCalled()
    expect(screen.getByText(/generating your briefing/i)).toBeInTheDocument()
  })

  it('invalidates the cards cache and clears when the briefing is ready', async () => {
    mockDispatch(true)
    mockMeetings(true)

    render(<BriefingDispatchBanner />)

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['chief-of-staff', 'cards'],
      }),
    )
    await waitFor(() =>
      expect(
        screen.queryByText(/generating your briefing/i),
      ).not.toBeInTheDocument(),
    )
  })

  it('renders nothing when no briefing is in flight', async () => {
    mockDispatch(false)
    mockMeetings(false)

    const { container } = render(<BriefingDispatchBanner />)

    await settle()
    expect(container).toBeEmptyDOMElement()
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})
