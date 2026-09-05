import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { WIN_RECOMMENDED_LISTS_FLAG_KEY } from '@shared/experiments/winRecommendedListsFlag'
import { DoorKnockingSurfaceProvider } from '../doorKnockingSurface'
import CreateListFlow from './CreateListFlow'
import type { PolygonRing } from '../VoterMapCanvas'

// The recommendations query and its exposure both read
// useWinRecommendedListsFlag, which reads useFlagOn/useFeatureFlags —
// module-mocked the same way SmsFlow.recommendedLists.test.tsx pins the same
// flag/seam.
vi.mock('@shared/experiments/FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
  useFeatureFlags: vi.fn(),
}))

const { useFlagOn, useFeatureFlags } =
  await import('@shared/experiments/FeatureFlagsProvider')
const mockedUseFlagOn = vi.mocked(useFlagOn)
const mockedUseFeatureFlags = vi.mocked(useFeatureFlags)
const exposure = vi.fn()

const setFlag = ({
  ready = true,
  on = true,
}: {
  ready?: boolean
  on?: boolean
}) => {
  mockedUseFlagOn.mockReturnValue({ ready, on })
}

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

// mapbox-gl-draw hands back an open ring; save must close it before POSTing.
const OPEN_RING: PolygonRing = [
  [-87.66, 41.92],
  [-87.65, 41.92],
  [-87.65, 41.93],
]

const baseProps = {
  filters: {},
  onFiltersChange: vi.fn(),
  onStepChange: vi.fn(),
  onClose: vi.fn(),
  districtHouseholds: 1500,
  savedLists: [],
  allContactsHouseholds: 12000,
  ring: OPEN_RING,
  turfStats: {
    stops: 14,
    people: 22,
    households: 9,
    partyMix: [],
    ageMix: [],
  },
  drawPointCount: 3,
  onUndoPoint: vi.fn(),
  drawFullScreen: false,
  onDrawFullScreenChange: vi.fn(),
  onRestartDrawing: vi.fn(),
  color: '#2563eb',
  drawnStops: null,
  onListCreated: vi.fn(),
  isElectedOfficial: false,
  unpreviewableKeys: [],
  // A settled pack: recommendations are about what the who step offers, not
  // about the district figure beside it.
  districtHouseholdsPending: false,
  districtHouseholdsFailed: false,
  districtUnavailable: false,
  orgSlug: 'campaign-9',
  addressPreview: null,
  previewPending: false,
  previewFailed: false,
  previewStale: false,
  onShowAddresses: vi.fn(),
  onHideAddresses: vi.fn(),
  onRetryAddresses: vi.fn(),
}

const savedTurf = {
  id: 5,
  voterFileFilterId: 21,
  name: 'Tuesday evening',
  color: '#2563eb',
  geoPoly: {
    type: 'Polygon' as const,
    coordinates: [[...OPEN_RING, OPEN_RING[0] as [number, number]]],
  },
  doorCount: 9,
  peopleCount: 22,
  loggedCount: 0,
  knockedDoorCount: 0,
  routeSeconds: 1860,
  completed: false,
  archivedAt: null,
  createdAt: new Date('2026-08-20T00:00:00Z'),
  updatedAt: new Date('2026-08-20T00:00:00Z'),
}

// The flow opens on the goal cards, and the recommendations query only fires
// once a purpose maps onto an intent — "Introduce myself" is
// `introduce_myself`, mapping onto `introduce`.
const renderAtWho = (
  props: Partial<ComponentProps<typeof CreateListFlow>> = {},
  { serveMode = false }: { serveMode?: boolean } = {},
) => {
  const flow = <CreateListFlow {...baseProps} step="filters" {...props} />
  // Only the Serve case needs the provider: the context defaults to Win, and
  // the rerenders below re-render a bare flow, which a wrapper here would
  // unmount and remount (losing the flow's own state) on every step change.
  const view = render(
    serveMode ? (
      <DoorKnockingSurfaceProvider value>{flow}</DoorKnockingSurfaceProvider>
    ) : (
      flow
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: /Introduce myself/ }))
  return view
}

const RECOMMENDATION = {
  variant: 'introNeverIded' as const,
  filter: {
    voterStatus: ['Super', 'Likely'],
    precincts: ['Cook|101', 'Cook|102'],
  },
  count: 4200,
  voteGoalShare: 0.28,
  copy: {
    title: 'Voters you have not met',
    criteriaSummary: 'Moderate to high propensity voters, never contacted',
  },
  existingFilterId: null,
}

const EXISTING_RECOMMENDATION = {
  ...RECOMMENDATION,
  variant: 'persuadeAffinity' as const,
  copy: {
    title: 'Persuadable independents',
    criteriaSummary: 'Moderate to high propensity independents',
  },
  existingFilterId: 501,
}

beforeEach(() => {
  testQueryClient.clear()
  api.reset()
  vi.clearAllMocks()
  mockedUseFeatureFlags.mockReturnValue({
    ready: true,
    variant: () => ({ value: undefined }),
    all: () => ({}),
    exposure,
    refresh: vi.fn(),
    clear: vi.fn(),
  } as ReturnType<typeof useFeatureFlags>)
  setFlag({ ready: true, on: true })
})

const exposureCalls = () =>
  exposure.mock.calls.filter(([key]) => key === WIN_RECOMMENDED_LISTS_FLAG_KEY)

const acceptedCalls = () =>
  vi
    .mocked(trackEvent)
    .mock.calls.filter(
      ([name]) => name === EVENTS.Outreach.RecommendedList.Accepted,
    )

describe('CreateListFlow — recommended lists', () => {
  it('records the exposure once the who step renders', () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [],
    })
    renderAtWho()

    expect(exposureCalls()).toHaveLength(1)
  })

  it('records the exposure for the control arm too', () => {
    setFlag({ ready: true, on: false })
    renderAtWho()

    expect(exposureCalls()).toHaveLength(1)
  })

  // Door knocking is ONE route for both rails, and Serve's purpose cards
  // reuse the same slug strings for a non-electoral meaning, so the purpose
  // alone cannot tell a candidate from an elected official. Recommended
  // lists are Win-only — gp-api 400s an eo- org — so a Serve session must
  // neither record an exposure it can never be treated on nor ask for
  // recommendations it cannot have.
  it('records no exposure and asks for nothing on the Serve surface', async () => {
    let requested = false
    api.mock('GET /v1/campaigns/mine/recommended-lists', () => {
      requested = true
      return { status: 200, data: [RECOMMENDATION] }
    })
    renderAtWho({}, { serveMode: true })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(exposureCalls()).toHaveLength(0)
    expect(requested).toBe(false)
    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
  })

  // End to end: the flag being off means the recommendations query itself
  // never fires (this file's own gate), so this pins the request-level
  // guard. WhoStep.recommendedLists.test.tsx pins the component's own
  // `recommendedListsEnabled` render gate directly — a mutation to that gate
  // alone can't surface here, because the query would still return no data
  // with the flag off regardless.
  it('shows nothing extra when the flag is off', async () => {
    let requested = false
    setFlag({ ready: true, on: false })
    api.mock('GET /v1/campaigns/mine/recommended-lists', () => {
      requested = true
      return { status: 200, data: [RECOMMENDATION] }
    })
    renderAtWho()

    // A settled query the picker never renders — off-flag has to prove the
    // card stays absent, not merely that it hasn't appeared yet.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(requested).toBe(false)
    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
    expect(
      screen.getByRole('combobox', { name: 'All lists' }),
    ).toBeInTheDocument()
  })

  it('renders the who step unchanged when there are no recommendations', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [],
    })
    renderAtWho()

    // Wait for the unified landing skeleton to clear (recs settle to empty)
    // before checking the picker; findByRole polls until the combobox lands.
    expect(
      await screen.findByRole('combobox', { name: 'All lists' }),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
  })

  it('shows a single skeleton while recs or the pack resolve', async () => {
    api.mock(
      'GET /v1/campaigns/mine/recommended-lists',
      () => new Promise(() => undefined),
    )
    renderAtWho()

    expect(await screen.findByTestId('who-step-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
  })

  // The households-vs-voters caveat (RecommendedListCard.tsx) is gated on
  // channel === 'doorKnocking' and had never been reachable in practice
  // before this task wired a caller that passes that channel.
  it('shows the door-knocking households-vs-voters caveat', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [RECOMMENDATION],
    })
    renderAtWho()

    await screen.findByText('Voters you have not met')
    expect(
      screen.getByText('Counts individual voters, not households.'),
    ).toBeInTheDocument()
  })

  // Door knocking is the one channel whose recommendation carries a precinct
  // filter (docs/features/recommended-lists.md). The naming drawer's submit
  // has to reach the created filter's POST body with those clauses intact,
  // and fire the accept event with gp-api's own recommendedModified diff.
  it('carries a recommendation’s precincts through to the created filter', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [RECOMMENDATION],
    })
    // Awaited invalidate after the drawer's POST refetches this — mock it
    // so MSW does not warn on an unhandled request.
    api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
    const filterCalls: Record<string, unknown>[] = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      filterCalls.push(body)
      return {
        status: 200,
        // gp-api's own diff of the recommendation against what was
        // submitted; the conversion event reports it verbatim.
        data: {
          id: 88,
          name: body.name as string,
          recommendedModified: true,
        },
      }
    })
    const onStepChange = vi.fn()
    renderAtWho({ onStepChange })

    const card = await screen.findByTestId('recommended-list-card')
    fireEvent.click(card)

    // The naming drawer opens with the recommendation's copy.title
    // pre-filled; Continue there is what POSTs the list and advances.
    expect(await screen.findByText('Name this list')).toBeInTheDocument()
    expect(screen.getByLabelText('List name')).toHaveValue(
      'Voters you have not met',
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(filterCalls).toHaveLength(1))
    expect(filterCalls[0]).toMatchObject({
      name: 'Voters you have not met',
      precincts: ['Cook|101', 'Cook|102'],
      recommendedVariant: 'introNeverIded',
      recommendedChannel: 'doorKnocking',
      recommendedIntent: 'introduce',
      audienceSuperVoters: true,
      audienceLikelyVoters: true,
    })

    // The experiment's numerator on this channel. Knowable no earlier than
    // the create response, which is what carries `recommendedModified`.
    await waitFor(() => expect(acceptedCalls()).toHaveLength(1))
    expect(acceptedCalls()[0]?.[1]).toEqual({
      variant: 'introNeverIded',
      channel: 'doorKnocking',
      intent: 'introduce',
      count: 4200,
      voteGoalShare: 0.28,
      modified: true,
      reusedExistingList: false,
    })

    // The flow leaves the who step for draw automatically — no second CTA
    // press is what makes this different from a saved-list pick.
    await waitFor(() => expect(onStepChange).toHaveBeenCalledWith('draw'))
  })

  // `existingFilterId` is resolved server-side, so a list deleted in the CRM
  // between the recommendations query and the tap leaves an id the picker
  // has no row for — and `selectList` reads that row for the draft's own
  // filters, so trusting the id blind seeds an empty audience under a name
  // that promises a specific one. Falling through opens the naming drawer
  // so the list gets built instead.
  it('opens the naming drawer when the existing id names no picker row', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [EXISTING_RECOMMENDATION],
    })
    // savedLists deliberately empty: id 501 resolves to nothing.
    renderAtWho()

    fireEvent.click(await screen.findByTestId('recommended-list-card'))

    expect(await screen.findByText('Name this list')).toBeInTheDocument()
    expect(acceptedCalls()).toHaveLength(0)
  })

  it('selects the existing list instead of creating a duplicate', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [EXISTING_RECOMMENDATION],
    })
    const filterCalls: unknown[] = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      filterCalls.push(body)
      return { status: 200, data: { id: 999 } }
    })
    let turfBody: unknown = null
    api.mock('POST /v1/door-knocking/turfs', ({ body }) => {
      turfBody = body
      return { status: 200, data: savedTurf }
    })
    const savedLists = [
      {
        id: 501,
        name: 'Persuadable independents',
        households: 4200,
        filters: { independentAffinity: true },
      },
    ]
    const { rerender } = renderAtWho({ savedLists })

    const card = await screen.findByTestId('recommended-list-card')
    fireEvent.click(card)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    rerender(
      <CreateListFlow {...baseProps} savedLists={savedLists} step="confirm" />,
    )
    fireEvent.change(screen.getByLabelText('Campaign name'), {
      target: { value: 'Tuesday evening' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    rerender(
      <CreateListFlow {...baseProps} savedLists={savedLists} step="route" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))

    await waitFor(() => expect(turfBody).not.toBeNull())
    expect(filterCalls).toHaveLength(0)
    expect(turfBody).toMatchObject({ voterFileFilterId: 501 })

    // Still an accept, and it never reaches the create above, so it needs
    // its own event or reuse is invisible in the funnel.
    expect(acceptedCalls()).toHaveLength(1)
    expect(acceptedCalls()[0]?.[1]).toEqual({
      variant: 'persuadeAffinity',
      channel: 'doorKnocking',
      intent: 'introduce',
      count: 4200,
      voteGoalShare: 0.28,
      modified: false,
      reusedExistingList: true,
    })
  })
})
