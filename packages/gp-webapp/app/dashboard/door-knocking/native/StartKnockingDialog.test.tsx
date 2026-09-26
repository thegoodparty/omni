import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { DoorKnockingTurf } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { StartKnockingDialog } from './StartKnockingDialog'
import { CAMPAIGN_TURFS_QUERY_KEY, TURFS_QUERY_KEY } from './turfQueries'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const TURF = { id: 12, name: 'Elm St & 5th' }

const routed = {
  id: 12,
  outreachId: 900,
  voterFileFilterId: 7,
  name: 'Elm St & 5th',
  color: '#2563eb',
  geoPoly: { type: 'Polygon' as const, coordinates: [] },
  stopCount: 3,
  doorCount: 4,
  knockedDoorCount: 0,
  peopleCount: 9,
  loggedCount: 0,
  routeSeconds: 900,
  completed: false,
  archivedAt: null,
  // Strings, not Dates: the mock serialises the response the way the API
  // does, and nothing between here and the caller parses them back.
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
} as unknown as DoorKnockingTurf

// The one place the client spends money. Creating a campaign buys nothing
// now, so every Geoapify route this product plans is bought by this press —
// which is why the guards around it (one call per press, no close under a
// call in flight, a failure that says so) are tested here rather than
// through a page that merely opens it.
describe('StartKnockingDialog', () => {
  beforeEach(() => {
    testQueryClient.clear()
    vi.mocked(trackEvent).mockClear()
  })

  const renderDialog = (props: Record<string, unknown> = {}) =>
    render(
      <StartKnockingDialog
        turf={TURF}
        onOpenChange={vi.fn()}
        onRouteBuilt={vi.fn()}
        {...props}
      />,
    )

  it('buys the route for the mode that was picked, and hands it back', async () => {
    let body: unknown = null
    api.mock('POST /v1/door-knocking/turfs/:id/route', (req) => {
      body = req.body
      return { status: 200 as const, data: routed }
    })
    const onRouteBuilt = vi.fn()
    const invalidate = vi.spyOn(testQueryClient, 'invalidateQueries')
    renderDialog({ onRouteBuilt })

    // Driving rather than the default, so the payload cannot pass by
    // agreeing with a value nobody chose.
    fireEvent.click(screen.getByRole('radio', { name: /Driving/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))

    await waitFor(() => expect(onRouteBuilt).toHaveBeenCalledWith(routed))
    expect(body).toMatchObject({ mode: 'drive', loop: true })
    // Both reads carry `routeSeconds`, which just stopped being null for
    // this turf: the rail's list and the campaign's own.
    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey)
    expect(keys).toContainEqual(TURFS_QUERY_KEY)
    expect(keys).toContainEqual(CAMPAIGN_TURFS_QUERY_KEY)
  })

  it('fires one vendor call however many times the press is hit', async () => {
    let calls = 0
    let release: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    api.mock('POST /v1/door-knocking/turfs/:id/route', async () => {
      calls += 1
      await held
      return { status: 200 as const, data: routed }
    })
    renderDialog()

    const build = screen.getByRole('button', { name: 'Build route' })
    fireEvent.click(build)

    // Disabled rather than merely spinning: the cheapest guard against a
    // second purchase is the press not being available.
    const building = await screen.findByRole('button', {
      name: 'Building route',
    })
    expect(building).toBeDisabled()
    fireEvent.click(building)
    fireEvent.click(building)

    release!()
    await waitFor(() => expect(calls).toBe(1))
  })

  it('will not close under a call already in flight', async () => {
    let release: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    api.mock('POST /v1/door-knocking/turfs/:id/route', async () => {
      await held
      return { status: 200 as const, data: routed }
    })
    const onOpenChange = vi.fn()
    renderDialog({ onOpenChange })

    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))
    await screen.findByRole('button', { name: 'Building route' })

    // The vendor call is already made; closing here would lose the route it
    // is about to return.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })
    expect(onOpenChange).not.toHaveBeenCalled()

    release!()
    await waitFor(() => expect(onOpenChange).not.toHaveBeenCalledWith(true))
  })

  it('says a failed purchase failed, and reports it', async () => {
    api.mock('POST /v1/door-knocking/turfs/:id/route', {
      status: 502,
      data: { message: 'Route provider unavailable' },
    })
    const onRouteBuilt = vi.fn()
    renderDialog({ onRouteBuilt })

    fireEvent.click(screen.getByRole('button', { name: 'Build route' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't plan this route.",
    )
    // Nothing was bought, so the caller is not told a route exists and the
    // press is live again for the retry.
    expect(onRouteBuilt).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Build route' })).toBeEnabled()
    // The funnel's one real failure, from the only press that can be one.
    // Status separates what the candidate can act on from the vendor being
    // down.
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.DoorKnocking.RouteBuildFailed,
      { mode: 'walk', loop: true, status: 502 },
    )
  })

  it('renders nothing until there is a turf to route', () => {
    renderDialog({ turf: null })

    expect(
      screen.queryByRole('button', { name: 'Build route' }),
    ).not.toBeInTheDocument()
  })
})
