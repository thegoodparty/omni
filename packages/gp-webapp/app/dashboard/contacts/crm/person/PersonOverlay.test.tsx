import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import PersonOverlay from './PersonOverlay'
import { useContactsTable } from '../ContactsTableProvider'
import { useFlagOn } from '@shared/experiments/FeatureFlagsProvider'
import { useCrmEnabled } from '../../../shared/useCrmEnabled'
import { useWinVoterContext } from '../../../shared/useWinVoterContext'
import { makePerson } from '../shared/test-fixtures'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type {
  ConstituentIssue,
  ConstituentActivity,
} from '../shared/contacts-types'

vi.mock('../ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))

vi.mock('@shared/experiments/FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
}))

vi.mock('../../../shared/useCrmEnabled', () => ({
  useCrmEnabled: vi.fn(),
}))

vi.mock('../../../shared/useWinVoterContext', () => ({
  useWinVoterContext: vi.fn(),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

// Google Maps would otherwise try to attach a Script tag and reference
// `window.google`. Stub it with a marker we can assert on.
vi.mock('@shared/utils/Map', () => ({
  __esModule: true,
  default: () => <div data-testid="mock-map" />,
}))

// NotesSection has its own suite (NotesSection.test.tsx) covering CRM-gating,
// CRUD, and analytics. Here it would otherwise call the real useOrganization()
// hook, which throws outside an OrganizationProvider — this file only asserts
// PersonOverlay mounts it with the right personId.
vi.mock('./NotesSection', () => ({
  __esModule: true,
  default: ({ personId }: { personId: string }) => (
    <div data-testid="notes-section-stub">{personId}</div>
  ),
}))

// LogInteraction has its own suite (LogInteraction.test.tsx) covering
// CRM-gating, per-channel validity, submit success/failure, and analytics.
// Same reasoning as the NotesSection stub above.
vi.mock('./LogInteraction', () => ({
  __esModule: true,
  default: ({ personId }: { personId: string }) => (
    <div data-testid="log-interaction-stub">{personId}</div>
  ),
}))

const mockedUseContactsTable = vi.mocked(useContactsTable)
const mockedUseFlagOn = vi.mocked(useFlagOn)
const mockedUseCrmEnabled = vi.mocked(useCrmEnabled)
const mockedUseWinVoterContext = vi.mocked(useWinVoterContext)

type ContextValue = ReturnType<typeof useContactsTable>
type SelectedPerson = ContextValue['currentlySelectedPerson']

function setContext({
  selectedPersonId = 'p_1',
  selectedPerson,
  isElectedOfficial = false,
  isWinContext = false,
  isWinContextReady = true,
  selectPerson = vi.fn(),
}: {
  selectedPersonId?: string | null
  selectedPerson?: Partial<SelectedPerson>
  isElectedOfficial?: boolean
  isWinContext?: boolean
  isWinContextReady?: boolean
  selectPerson?: ContextValue['selectPerson']
} = {}) {
  const currentlySelectedPerson: SelectedPerson = {
    person: makePerson(),
    isLoadingPerson: false,
    isErrorPerson: false,
    issues: [],
    isLoadingIssues: false,
    isErrorIssues: false,
    issuesHasNextPage: false,
    issuesFetchNextPage: vi.fn(),
    isFetchingNextIssues: false,
    activities: [],
    isLoadingActivities: false,
    isErrorActivities: false,
    activitiesHasNextPage: false,
    activitiesFetchNextPage: vi.fn(),
    isFetchingNextActivities: false,
    ...selectedPerson,
  }

  const ctx: ContextValue = {
    filteredContacts: [],
    currentlySelectedPersonId: selectedPersonId,
    currentlySelectedPerson,
    segments: [],
    customSegments: [],
    currentSegment: 'all',
    searchTerm: '',
    urlQueryParams: new URLSearchParams(),
    pagination: null,
    isLoading: false,
    isVoterDataUnavailable: false,
    isCustomSegment: false,
    totalSegmentContacts: 0,
    canUseProFeatures: true,
    isElectedOfficial,
    isWinContext,
    isWinContextReady,
    pageUp: vi.fn(),
    pageDown: vi.fn(),
    goToPage: vi.fn(),
    setPageSize: vi.fn(),
    selectPerson,
    selectSegment: vi.fn(),
    searchContacts: vi.fn(),
    refreshCustomSegments: vi.fn().mockResolvedValue(undefined),
  }
  mockedUseContactsTable.mockReturnValue(ctx)
  return ctx
}

describe('<PersonOverlay>', () => {
  beforeEach(() => {
    mockedUseContactsTable.mockReset()
    mockedUseFlagOn.mockReset()
    mockedUseFlagOn.mockReturnValue({ ready: true, on: false })
    mockedUseCrmEnabled.mockReset()
    mockedUseWinVoterContext.mockReset()
    // CRM off by default: the many pre-existing tests below assert the
    // pre-CRM overlay's behavior and predate ENG-10698's CRM-gated surfaces
    // (Support Status, Contact Viewed, new feed entry types) — defaulting to
    // off keeps their assertions valid unchanged. Tests exercising the new
    // surfaces opt in explicitly.
    mockedUseCrmEnabled.mockReturnValue({ ready: true, enabled: false })
    mockedUseWinVoterContext.mockReturnValue({ isWin: false, isReady: true })
    vi.mocked(trackEvent).mockClear()
  })

  it('does not open the overlay when no person is selected', () => {
    setContext({ selectedPersonId: null })

    render(<PersonOverlay />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the loading skeleton while the person query is loading', () => {
    setContext({
      selectedPerson: { person: null, isLoadingPerson: true },
    })

    render(<PersonOverlay />)

    // Sheet content renders inside a Radix Portal, so query the document
    // instead of the render container.
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    // No real card section headings while loading.
    expect(
      screen.queryByRole('heading', { name: /contact information/i }),
    ).not.toBeInTheDocument()
  })

  it('renders the person details and the standard info sections', () => {
    setContext({ selectedPersonId: 'p_1' })

    render(<PersonOverlay />)

    // Person name renders as a real <h2>; the card titles render as styled
    // <div>s (CardTitle), so query them by text content.
    expect(
      screen.getByRole('heading', { name: /jane doe/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/female, 42 years old/i)).toBeInTheDocument()
    // CardTitle is a styled <div>; scope to data-slot to avoid colliding
    // with the sr-only SheetTitle that uses the same copy.
    const cardTitles = document.querySelectorAll('[data-slot="card-title"]')
    const titles = Array.from(cardTitles).map((el) => el.textContent?.trim())
    expect(titles).toEqual(
      expect.arrayContaining([
        'Contact Information',
        'Voter Demographics',
        'Demographic Information',
      ]),
    )
  })

  it('mounts NotesSection for the currently selected person', () => {
    setContext({ selectedPersonId: 'p_1' })

    render(<PersonOverlay />)

    expect(screen.getByTestId('notes-section-stub')).toHaveTextContent('p_1')
  })

  it('mounts LogInteraction for the currently selected person', () => {
    setContext({ selectedPersonId: 'p_1' })

    render(<PersonOverlay />)

    expect(screen.getByTestId('log-interaction-stub')).toHaveTextContent('p_1')
  })

  it('renders an error message and lets the user close the overlay when the person fetch fails', async () => {
    const user = userEvent.setup()
    const selectPerson = vi.fn()
    setContext({
      selectPerson,
      selectedPerson: { person: null, isErrorPerson: true },
    })

    render(<PersonOverlay />)

    const errorHeading = screen.getByRole('heading', {
      name: /error loading contact/i,
    })
    const errorBlock = errorHeading.parentElement
    if (!errorBlock) throw new Error('error block not rendered')

    // The error UI's Close button is a raw <button> next to the heading;
    // the Sheet renders its own (svg-icon) close button at the top right.
    await user.click(within(errorBlock).getByRole('button', { name: /close/i }))
    expect(selectPerson).toHaveBeenCalledWith(null)
  })

  it('hides the Political Party field for elected officials', () => {
    setContext({ isElectedOfficial: true })

    render(<PersonOverlay />)

    expect(screen.queryByText(/^political party$/i)).not.toBeInTheDocument()
  })

  it('shows the Political Party field with its value in the Win context', () => {
    setContext({ isElectedOfficial: false })

    render(<PersonOverlay />)

    const partyLabel = screen.getByText(/^political party$/i)
    expect(partyLabel).toBeInTheDocument()
    // makePerson() seeds politicalParty: 'Independent'; assert the value
    // renders, not just the label, so a blank field doesn't pass.
    expect(screen.getByText(/^independent$/i)).toBeInTheDocument()
  })

  it('hides Top Issues and Activity Feed when the feature flag is off', () => {
    mockedUseFlagOn.mockReturnValue({ ready: true, on: false })
    setContext()

    render(<PersonOverlay />)

    expect(screen.queryByText('Top Issues')).not.toBeInTheDocument()
    expect(screen.queryByText('Activity Feed')).not.toBeInTheDocument()
  })

  it('shows Top Issues and Activity Feed (with seeded data) when the feature flag is on', () => {
    mockedUseFlagOn.mockReturnValue({ ready: true, on: true })
    const issues: ConstituentIssue[] = [
      {
        issueTitle: 'Better Bike Lanes',
        issueSummary: 'Constituent supports bike-lane expansion',
        pollTitle: 'Transit',
        pollId: 'poll_1',
        date: '2026-05-01',
      },
    ]
    const activities: ConstituentActivity[] = [
      {
        type: 'POLL_INTERACTIONS',
        date: '2026-05-02',
        data: {
          pollId: 'poll_1',
          pollTitle: 'Transit Survey',
          events: [{ type: 'SENT', date: '2026-05-02T00:00:00.000Z' }],
        },
      },
    ]
    setContext({
      selectedPerson: { issues, activities },
    })

    render(<PersonOverlay />)

    expect(screen.getByText('Top Issues')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /better bike lanes/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('Activity Feed')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /transit survey/i }),
    ).toBeInTheDocument()
  })

  it('renders Win outreach activities with per-channel labels and date', () => {
    const activities: ConstituentActivity[] = [
      {
        type: 'OUTREACH',
        date: '2026-05-10T00:00:00.000Z',
        data: {
          activityId: 1,
          outreachType: 'text',
          attributionSource: 'segmentDerived',
        },
      },
      {
        type: 'OUTREACH',
        date: '2026-05-11T00:00:00.000Z',
        data: {
          activityId: 2,
          outreachType: 'doorKnocking',
          attributionSource: 'recipient',
        },
      },
    ]
    setContext({
      isElectedOfficial: false,
      isWinContext: true,
      selectedPersonId: 'p_42',
      selectedPerson: { activities },
    })

    render(<PersonOverlay />)

    expect(screen.getByText('Activity Feed')).toBeInTheDocument()
    // Honest send-time labels, not "Delivered".
    expect(screen.getByText('Texted')).toBeInTheDocument()
    expect(screen.getByText('Knocked')).toBeInTheDocument()
    // segmentDerived is send-time attribution; recipient (door knock) is not.
    expect(screen.getByText('Sent to segment')).toBeInTheDocument()
    // Date rendered for the activity.
    expect(screen.getByText(/May 10, 2026/)).toBeInTheDocument()
    // Poll-only chrome must not appear for outreach rows.
    expect(
      screen.queryByRole('link', { name: /transit survey/i }),
    ).not.toBeInTheDocument()
    // The Win outreach timeline rendering rows fires the adoption event once.
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Contacts.OutreachTimelineViewed,
      { context: 'win', personId: 'p_42' },
    )
  })

  it('does not crash on ENG-10695 entry types the pre-CRM renderer does not know (skips them, keeps rendering known rows)', () => {
    // The unified feed (ENG-10695) can return DOOR_KNOCK/TEXT/ROBOCALL/NOTE
    // entries in the same page as OUTREACH/POLL_INTERACTIONS rows. Rendering
    // them is task 07's job; this only proves the switch has a safe default
    // instead of falling through to the poll branch and crashing on
    // activity.data.pollId.
    const activities: ConstituentActivity[] = [
      {
        type: 'NOTE',
        date: '2026-05-12T00:00:00.000Z',
        data: {
          noteId: 'note_1',
          body: 'Follow up next week',
          createdAt: '2026-05-12T00:00:00.000Z',
          updatedAt: '2026-05-12T00:00:00.000Z',
        },
      },
      {
        type: 'DOOR_KNOCK',
        date: '2026-05-11T00:00:00.000Z',
        data: {
          activityId: 'dk_1',
          outcome: 'answered',
          supportAnswer: 'supporter',
          note: null,
          manual: true,
        },
      },
      {
        type: 'TEXT',
        date: '2026-05-10T12:00:00.000Z',
        data: {
          activityId: 'tx_1',
          respondedAt: null,
          optedOutAt: null,
          note: null,
          manual: false,
          outreachId: null,
        },
      },
      {
        type: 'ROBOCALL',
        date: '2026-05-10T06:00:00.000Z',
        data: {
          activityId: 'rc_1',
          answeredAt: null,
          voicemailLeftAt: null,
          note: null,
          manual: false,
          outreachId: null,
        },
      },
      {
        type: 'OUTREACH',
        date: '2026-05-10T00:00:00.000Z',
        data: {
          activityId: 1,
          outreachType: 'text',
          attributionSource: 'segmentDerived',
        },
      },
    ]
    setContext({
      isElectedOfficial: false,
      isWinContext: true,
      selectedPersonId: 'p_42',
      selectedPerson: { activities },
    })

    expect(() => render(<PersonOverlay />)).not.toThrow()

    expect(screen.getByText('Activity Feed')).toBeInTheDocument()
    // The known OUTREACH row still renders alongside the skipped new types.
    expect(screen.getByText('Texted')).toBeInTheDocument()
  })

  it('shows the activities loading skeleton, not the empty state, on the first fetch', () => {
    // First fetch: hasActivities and hasNextPage both start false, same as
    // the true empty case. Without an isLoading guard, "Data not available."
    // would flash before the skeleton (or the real feed) ever gets a chance
    // to render.
    setContext({
      isElectedOfficial: false,
      isWinContext: true,
      selectedPersonId: 'p_42',
      selectedPerson: { isLoadingActivities: true },
    })

    render(<PersonOverlay />)

    expect(screen.getByText('Activity Feed')).toBeInTheDocument()
    expect(screen.queryByText('Data not available.')).not.toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('shows the empty state (not a blank feed) and does not fire Outreach Timeline Viewed when a page has only ENG-10695 entry types', () => {
    // A page containing only DOOR_KNOCK/TEXT/ROBOCALL/NOTE rows has nothing
    // this renderer can draw (task 07 widens it) — it must read as "Data not
    // available", not as a real, contentless feed, and must not count as a
    // seen outreach timeline for the adoption event.
    const activities: ConstituentActivity[] = [
      {
        type: 'NOTE',
        date: '2026-05-12T00:00:00.000Z',
        data: {
          noteId: 'note_1',
          body: 'Follow up next week',
          createdAt: '2026-05-12T00:00:00.000Z',
          updatedAt: '2026-05-12T00:00:00.000Z',
        },
      },
      {
        type: 'DOOR_KNOCK',
        date: '2026-05-11T00:00:00.000Z',
        data: {
          activityId: 'dk_1',
          outcome: 'answered',
          supportAnswer: 'supporter',
          note: null,
          manual: true,
        },
      },
    ]
    setContext({
      isElectedOfficial: false,
      isWinContext: true,
      selectedPersonId: 'p_42',
      selectedPerson: { activities },
    })

    render(<PersonOverlay />)

    expect(screen.getByText('Data not available.')).toBeInTheDocument()
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Contacts.OutreachTimelineViewed,
      expect.anything(),
    )
  })

  it('shows "View more" instead of the empty state when a page of only ENG-10695 entry types still has a next page', () => {
    // Same all-new-types page as above, but with a next page available.
    // Older OUTREACH/POLL_INTERACTIONS rows can still be behind it — the
    // empty state must not swallow the pagination affordance and strand them.
    const activities: ConstituentActivity[] = [
      {
        type: 'NOTE',
        date: '2026-05-12T00:00:00.000Z',
        data: {
          noteId: 'note_1',
          body: 'Follow up next week',
          createdAt: '2026-05-12T00:00:00.000Z',
          updatedAt: '2026-05-12T00:00:00.000Z',
        },
      },
    ]
    const activitiesFetchNextPage = vi.fn()
    setContext({
      isElectedOfficial: false,
      isWinContext: true,
      selectedPersonId: 'p_42',
      selectedPerson: {
        activities,
        activitiesHasNextPage: true,
        activitiesFetchNextPage,
      },
    })

    render(<PersonOverlay />)

    expect(screen.queryByText('Data not available.')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /view more/i }),
    ).toBeInTheDocument()
  })

  it('does not fire Outreach Timeline Viewed when the Win feed is empty', () => {
    setContext({
      isElectedOfficial: false,
      isWinContext: true,
      selectedPersonId: 'p_42',
      selectedPerson: { activities: [] },
    })

    render(<PersonOverlay />)

    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Contacts.OutreachTimelineViewed,
      expect.anything(),
    )
  })

  it('keeps rendering stale rows (not the empty state) on a failed background refetch, but does not fire Outreach Timeline Viewed', () => {
    // useInfiniteQuery keeps prior successful data on a failed refetch, so
    // activities can be non-empty while isErrorActivities is true. A failed
    // background refetch must not blank an already-populated feed — the
    // renderer keeps showing the stale rows — but the adoption event still
    // must not fire while isError is true.
    const activities: ConstituentActivity[] = [
      {
        type: 'OUTREACH',
        date: '2026-05-10T00:00:00.000Z',
        data: {
          activityId: 1,
          outreachType: 'text',
          attributionSource: 'segmentDerived',
        },
      },
    ]
    setContext({
      isElectedOfficial: false,
      isWinContext: true,
      selectedPersonId: 'p_42',
      selectedPerson: { activities, isErrorActivities: true },
    })

    render(<PersonOverlay />)

    expect(screen.getByText('Texted')).toBeInTheDocument()
    expect(screen.queryByText('Data not available.')).not.toBeInTheDocument()
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Contacts.OutreachTimelineViewed,
      expect.anything(),
    )
  })

  it('does not fire Outreach Timeline Viewed until the win context is ready', () => {
    const activities: ConstituentActivity[] = [
      {
        type: 'OUTREACH',
        date: '2026-05-10T00:00:00.000Z',
        data: {
          activityId: 1,
          outreachType: 'text',
          attributionSource: 'segmentDerived',
        },
      },
    ]
    setContext({
      isElectedOfficial: false,
      isWinContext: true,
      isWinContextReady: false,
      selectedPersonId: 'p_42',
      selectedPerson: { activities },
    })

    render(<PersonOverlay />)

    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Contacts.OutreachTimelineViewed,
      expect.anything(),
    )
  })

  it('fires Outreach Timeline Viewed once per person across an error-recovery re-render', () => {
    // The feed stays mounted (isWinContext true) but a failed refetch flips
    // isErrorActivities true (stale rows retained) then false on recovery.
    // That re-runs the effect for the same person; the per-person latch must
    // keep the event at exactly one fire.
    const activities: ConstituentActivity[] = [
      {
        type: 'OUTREACH',
        date: '2026-05-10T00:00:00.000Z',
        data: {
          activityId: 1,
          outreachType: 'text',
          attributionSource: 'segmentDerived',
        },
      },
    ]
    setContext({
      isElectedOfficial: false,
      isWinContext: true,
      selectedPersonId: 'p_42',
      selectedPerson: { activities },
    })

    const { rerender } = render(<PersonOverlay />)

    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Contacts.OutreachTimelineViewed,
      { context: 'win', personId: 'p_42' },
    )

    // Refetch fails: stale rows retained, isError true (no fire).
    setContext({
      isElectedOfficial: false,
      isWinContext: true,
      selectedPersonId: 'p_42',
      selectedPerson: { activities, isErrorActivities: true },
    })
    rerender(<PersonOverlay />)

    // Recovery: rows present again, isError false. Latch must suppress.
    setContext({
      isElectedOfficial: false,
      isWinContext: true,
      selectedPersonId: 'p_42',
      selectedPerson: { activities },
    })
    rerender(<PersonOverlay />)

    expect(trackEvent).toHaveBeenCalledTimes(1)
  })

  it('re-arms Outreach Timeline Viewed when a different person is opened', () => {
    const activities: ConstituentActivity[] = [
      {
        type: 'OUTREACH',
        date: '2026-05-10T00:00:00.000Z',
        data: {
          activityId: 1,
          outreachType: 'text',
          attributionSource: 'segmentDerived',
        },
      },
    ]
    setContext({
      isElectedOfficial: false,
      isWinContext: true,
      selectedPersonId: 'p_42',
      selectedPerson: { activities },
    })

    const { rerender } = render(<PersonOverlay />)
    expect(trackEvent).toHaveBeenCalledTimes(1)

    setContext({
      isElectedOfficial: false,
      isWinContext: true,
      selectedPersonId: 'p_99',
      selectedPerson: { activities },
    })
    rerender(<PersonOverlay />)

    expect(trackEvent).toHaveBeenCalledTimes(2)
    expect(trackEvent).toHaveBeenLastCalledWith(
      EVENTS.Contacts.OutreachTimelineViewed,
      { context: 'win', personId: 'p_99' },
    )
  })

  it('does not fire Outreach Timeline Viewed outside the Win context', () => {
    // Serve poll-interaction timeline is shown via the Serve flag, but the
    // outreach-adoption event is Win-only.
    mockedUseFlagOn.mockReturnValue({ ready: true, on: true })
    const activities: ConstituentActivity[] = [
      {
        type: 'POLL_INTERACTIONS',
        date: '2026-05-02',
        data: {
          pollId: 'poll_1',
          pollTitle: 'Transit Survey',
          events: [{ type: 'SENT', date: '2026-05-02T00:00:00.000Z' }],
        },
      },
    ]
    setContext({
      isElectedOfficial: false,
      isWinContext: false,
      selectedPersonId: 'p_42',
      selectedPerson: { activities },
    })

    render(<PersonOverlay />)

    expect(screen.getByText('Activity Feed')).toBeInTheDocument()
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Contacts.OutreachTimelineViewed,
      expect.anything(),
    )
  })

  it('hides the Win Activity Feed when not in Win context', () => {
    const activities: ConstituentActivity[] = [
      {
        type: 'OUTREACH',
        date: '2026-05-10T00:00:00.000Z',
        data: {
          activityId: 1,
          outreachType: 'text',
          attributionSource: 'segmentDerived',
        },
      },
    ]
    setContext({
      isElectedOfficial: false,
      isWinContext: false,
      selectedPerson: { activities },
    })

    render(<PersonOverlay />)

    expect(screen.queryByText('Activity Feed')).not.toBeInTheDocument()
    expect(screen.queryByText('Texted')).not.toBeInTheDocument()
  })

  it('paginates the Win outreach timeline via View more', async () => {
    const user = userEvent.setup()
    const activitiesFetchNextPage = vi.fn()
    const activities: ConstituentActivity[] = [
      {
        type: 'OUTREACH',
        date: '2026-05-10T00:00:00.000Z',
        data: {
          activityId: 1,
          outreachType: 'phoneBanking',
          attributionSource: 'segmentDerived',
        },
      },
    ]
    setContext({
      isElectedOfficial: false,
      isWinContext: true,
      selectedPerson: {
        activities,
        activitiesHasNextPage: true,
        activitiesFetchNextPage,
      },
    })

    render(<PersonOverlay />)

    expect(screen.getByText('Called')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /view more/i }))
    expect(activitiesFetchNextPage).toHaveBeenCalledTimes(1)
  })

  describe('ENG-10698 support status', () => {
    it('hides Support Status when the CRM flag is off', () => {
      setContext()

      render(<PersonOverlay />)

      expect(screen.queryByText('Support Status')).not.toBeInTheDocument()
    })

    it.each([
      ['supporter', 'Supporter'],
      ['non_supporter', 'Non-supporter'],
      ['unknown', 'Support unknown'],
    ] as const)(
      'shows Support Status "%s" as "%s" when the CRM flag is on',
      (rollup, label) => {
        mockedUseCrmEnabled.mockReturnValue({ ready: true, enabled: true })
        setContext({
          selectedPerson: { person: makePerson({ supportStatus: rollup }) },
        })

        render(<PersonOverlay />)

        expect(screen.getByText('Support Status')).toBeInTheDocument()
        expect(screen.getByText(label)).toBeInTheDocument()
      },
    )

    it('shows "Support unknown" when supportStatus is absent from the response', () => {
      mockedUseCrmEnabled.mockReturnValue({ ready: true, enabled: true })
      // makePerson() doesn't set supportStatus (undefined by default).
      setContext({ selectedPerson: { person: makePerson() } })

      render(<PersonOverlay />)

      expect(screen.getByText('Support unknown')).toBeInTheDocument()
    })
  })

  describe('ENG-10698 Contact Viewed', () => {
    it('fires the Win-mode Contact Viewed event once when the CRM flag is on', () => {
      mockedUseCrmEnabled.mockReturnValue({ ready: true, enabled: true })
      mockedUseWinVoterContext.mockReturnValue({ isWin: true, isReady: true })
      setContext({ selectedPersonId: 'p_7' })

      render(<PersonOverlay />)

      expect(trackEvent).toHaveBeenCalledWith(EVENTS.VoterData.ContactViewed)
      expect(
        vi
          .mocked(trackEvent)
          .mock.calls.filter(
            ([event]) => event === EVENTS.VoterData.ContactViewed,
          ),
      ).toHaveLength(1)
    })

    it('fires the Serve-mode Contact Viewed event when not in Win context', () => {
      mockedUseCrmEnabled.mockReturnValue({ ready: true, enabled: true })
      mockedUseWinVoterContext.mockReturnValue({ isWin: false, isReady: true })
      setContext({ selectedPersonId: 'p_8' })

      render(<PersonOverlay />)

      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.ConstituentData.ContactViewed,
      )
    })

    it('does not fire Contact Viewed when the CRM flag is off', () => {
      mockedUseCrmEnabled.mockReturnValue({ ready: true, enabled: false })
      setContext()

      render(<PersonOverlay />)

      expect(trackEvent).not.toHaveBeenCalledWith(
        EVENTS.VoterData.ContactViewed,
      )
      expect(trackEvent).not.toHaveBeenCalledWith(
        EVENTS.ConstituentData.ContactViewed,
      )
    })

    it('does not fire Contact Viewed until the win context is ready', () => {
      mockedUseCrmEnabled.mockReturnValue({ ready: true, enabled: true })
      mockedUseWinVoterContext.mockReturnValue({ isWin: true, isReady: false })
      setContext()

      render(<PersonOverlay />)

      expect(trackEvent).not.toHaveBeenCalledWith(
        EVENTS.VoterData.ContactViewed,
      )
    })
  })

  describe('ENG-10698 new feed entry types', () => {
    const newTypeActivities: ConstituentActivity[] = [
      {
        type: 'DOOR_KNOCK',
        date: '2026-05-11T00:00:00.000Z',
        data: {
          activityId: 'dk_1',
          outcome: 'answered',
          supportAnswer: 'supporter',
          note: 'Left a flyer',
          manual: true,
        },
      },
      {
        type: 'TEXT',
        date: '2026-05-10T12:00:00.000Z',
        data: {
          activityId: 'tx_1',
          respondedAt: '2026-05-10T13:00:00.000Z',
          optedOutAt: null,
          note: null,
          manual: false,
          outreachId: 5,
        },
      },
      {
        type: 'ROBOCALL',
        date: '2026-05-10T06:00:00.000Z',
        data: {
          activityId: 'rc_1',
          answeredAt: null,
          voicemailLeftAt: '2026-05-10T06:05:00.000Z',
          note: null,
          manual: false,
          outreachId: null,
        },
      },
      {
        type: 'NOTE',
        date: '2026-05-12T00:00:00.000Z',
        data: {
          noteId: 'note_1',
          body: 'Follow up next week',
          createdAt: '2026-05-12T00:00:00.000Z',
          updatedAt: '2026-05-12T00:00:00.000Z',
        },
      },
    ]

    it('renders DOOR_KNOCK/TEXT/ROBOCALL/NOTE entries (with a manual badge and note body) when the CRM flag is on', () => {
      mockedUseCrmEnabled.mockReturnValue({ ready: true, enabled: true })
      setContext({
        isElectedOfficial: false,
        isWinContext: true,
        selectedPersonId: 'p_42',
        selectedPerson: { activities: newTypeActivities },
      })

      render(<PersonOverlay />)

      expect(screen.getByText(/door knock: answered/i)).toBeInTheDocument()
      expect(screen.getByText(/support: supporter/i)).toBeInTheDocument()
      expect(screen.getByText('Left a flyer')).toBeInTheDocument()
      expect(screen.getByText('Text')).toBeInTheDocument()
      expect(screen.getByText('Robocall')).toBeInTheDocument()
      expect(screen.getByText('Follow up next week')).toBeInTheDocument()
      // Manual badge only on the hand-logged door knock, not the
      // system-recorded text/robocall rows.
      expect(screen.getAllByText('Manual')).toHaveLength(1)
      expect(
        screen.getByRole('link', { name: /view outreach/i }),
      ).toBeInTheDocument()
    })

    it('does not render new entry types when the CRM flag is off (keeps the pre-CRM skip behavior)', () => {
      setContext({
        isElectedOfficial: false,
        isWinContext: true,
        selectedPersonId: 'p_42',
        selectedPerson: { activities: newTypeActivities },
      })

      render(<PersonOverlay />)

      expect(
        screen.queryByText(/door knock: answered/i),
      ).not.toBeInTheDocument()
      expect(screen.queryByText('Follow up next week')).not.toBeInTheDocument()
    })

    it('shows real feed content (not the empty state) for a CRM-on page containing only new entry types, and does not fire Outreach Timeline Viewed', () => {
      mockedUseCrmEnabled.mockReturnValue({ ready: true, enabled: true })
      const noteOnly: ConstituentActivity[] = [newTypeActivities[3]!]
      setContext({
        isElectedOfficial: false,
        isWinContext: true,
        selectedPersonId: 'p_42',
        selectedPerson: { activities: noteOnly },
      })

      render(<PersonOverlay />)

      expect(screen.queryByText('Data not available.')).not.toBeInTheDocument()
      expect(screen.getByText('Follow up next week')).toBeInTheDocument()
      expect(trackEvent).not.toHaveBeenCalledWith(
        EVENTS.Contacts.OutreachTimelineViewed,
        expect.anything(),
      )
    })
  })
})
