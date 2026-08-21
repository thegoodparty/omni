import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import WalkSurface, {
  useWalkMapSession,
  WalkMapHint,
  type OpenStopRequest,
} from './WalkSurface'

// The walk's own rendering has its own suite. Stubbed so this file asserts only
// the seam: what the orchestrator hands in, and what the walk asks of the map.
const walkViewProps: {
  current: { turfId: number; openStopRequest: OpenStopRequest | null } | null
} = { current: null }
vi.mock('./WalkView', () => ({
  __esModule: true,
  default: (props: {
    turfId: number
    openStopRequest?: OpenStopRequest | null
    onKnockRecorded?: () => void
  }) => {
    walkViewProps.current = {
      turfId: props.turfId,
      openStopRequest: props.openStopRequest ?? null,
    }
    return (
      <div data-testid="walk-view">
        <button type="button" onClick={props.onKnockRecorded}>
          record a knock
        </button>
      </div>
    )
  },
}))

// One knockable stop and one where every resident is flagged. The pin needs
// both answers: a fully flagged stop rolls up over an empty list to the same
// grey as a stop nobody has been to.
const routePayload = {
  route: {
    id: 5,
    doorKnockingTurfId: 1,
    mode: 'walk' as const,
    loop: true,
    totalSeconds: 600,
    totalMeters: 800,
    stopCount: 2,
    createdAt: new Date('2026-07-21T00:00:00Z'),
  },
  pathGeometry: {
    type: 'LineString' as const,
    coordinates: [] as [number, number][],
  },
  stops: [
    {
      id: 11,
      seq: 1,
      lat: 36.16,
      lng: -86.78,
      displayAddress: '105 Elm St',
      legSeconds: 0,
      legMeters: 0,
      addresses: [
        {
          addressKey: '105|elm|st',
          address: '105 Elm St',
          otherResidents: [],
          targets: [
            {
              stopTargetId: 21,
              personId: 'person-21',
              name: 'Dorian Fen',
              age: 40,
              politicalParty: null,
              cellPhone: null,
              landline: null,
              knockStatus: 'unknown' as const,
              mayHaveMoved: false,
              doNotKnock: false,
            },
          ],
        },
      ],
    },
    {
      id: 12,
      seq: 2,
      lat: 36.17,
      lng: -86.79,
      displayAddress: '107 Elm St',
      legSeconds: 0,
      legMeters: 0,
      addresses: [
        {
          addressKey: '107|elm|st',
          address: '107 Elm St',
          otherResidents: [],
          targets: [
            {
              stopTargetId: 22,
              personId: 'person-22',
              name: 'Rae Colt',
              age: 51,
              politicalParty: null,
              cellPhone: null,
              landline: null,
              knockStatus: 'unknown' as const,
              mayHaveMoved: false,
              doNotKnock: true,
            },
          ],
        },
      ],
    },
  ],
}

const Probe = ({ turfId }: { turfId: number | null }) => {
  const walkMap = useWalkMapSession(turfId === null ? null : { id: turfId })
  return (
    <div
      data-testid="walk-map"
      data-pins={walkMap.routePins
        .map((pin) => `${pin.stopId}:${pin.knockable}`)
        .join(',')}
      data-loop={String(walkMap.routeLoop)}
      data-geometry={String(walkMap.routeGeometry !== null)}
      data-stop-count={String(walkMap.stopCount)}
      data-open={
        walkMap.openStopRequest
          ? `${walkMap.openStopRequest.stopId}/${walkMap.openStopRequest.token}`
          : 'none'
      }
      data-hint={String(walkMap.hintVisible)}
    >
      <WalkMapHint visible={walkMap.hintVisible} />
      <button type="button" onClick={() => walkMap.onPinTap({ stopId: 11 })}>
        tap pin 11
      </button>
      <button type="button" onClick={walkMap.reset}>
        reset
      </button>
    </div>
  )
}

const mockRoute = () =>
  api.mock('GET /v1/door-knocking/turfs/:id/route', {
    status: 200,
    data: routePayload,
  })

describe('useWalkMapSession', () => {
  beforeEach(() => {
    testQueryClient.clear()
    walkViewProps.current = null
  })

  // The map's half of the walk contract: the pins the canvas draws, and the two
  // answers each pin needs.
  it('derives pins, path and stop count from the route the walk opened with', async () => {
    mockRoute()
    render(<Probe turfId={1} />)

    await waitFor(() =>
      expect(screen.getByTestId('walk-map')).toHaveAttribute(
        'data-pins',
        '11:true,12:false',
      ),
    )
    const map = screen.getByTestId('walk-map')
    expect(map).toHaveAttribute('data-loop', 'true')
    expect(map).toHaveAttribute('data-geometry', 'true')
    expect(map).toHaveAttribute('data-stop-count', '2')
  })

  // Off a walk the page renders the landing map, which has no pins and no path
  // to frame — and asks for no route.
  it('contributes nothing to the map with no walk open', () => {
    mockRoute()
    render(<Probe turfId={null} />)

    const map = screen.getByTestId('walk-map')
    expect(map).toHaveAttribute('data-pins', '')
    expect(map).toHaveAttribute('data-geometry', 'false')
    expect(map).toHaveAttribute('data-hint', 'false')
  })

  // A token and not a bare stop id: closing the sheet leaves this state alone,
  // so the second tap on the same pin has to be distinguishable from the first.
  it('makes the same pin tappable twice', async () => {
    mockRoute()
    render(<Probe turfId={1} />)
    await waitFor(() =>
      expect(screen.getByTestId('walk-map')).toHaveAttribute(
        'data-hint',
        'true',
      ),
    )

    const pin = screen.getByRole('button', { name: 'tap pin 11' })
    fireEvent.click(pin)
    expect(screen.getByTestId('walk-map')).toHaveAttribute('data-open', '11/1')
    fireEvent.click(pin)
    expect(screen.getByTestId('walk-map')).toHaveAttribute('data-open', '11/2')
  })

  // The coach mark names the gesture it is dismissed by, and every walk opens
  // on a route the canvasser has not seen before.
  it('teaches the pin tap once per walk', async () => {
    mockRoute()
    render(<Probe turfId={1} />)

    await waitFor(() =>
      expect(
        screen.getByText('Tap a pin to log the door.'),
      ).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'tap pin 11' }))
    expect(screen.queryByText('Tap a pin to log the door.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'reset' }))
    expect(screen.getByTestId('walk-map')).toHaveAttribute('data-open', 'none')
    expect(screen.getByText('Tap a pin to log the door.')).toBeInTheDocument()
  })
})

describe('WalkSurface seam', () => {
  beforeEach(() => {
    walkViewProps.current = null
  })

  it('passes the walk its turf and the map’s open request', () => {
    const onKnockRecorded = vi.fn()
    render(
      <WalkSurface
        turfId={3}
        openStopRequest={{ stopId: 11, token: 2 }}
        onKnockRecorded={onKnockRecorded}
      />,
    )

    expect(walkViewProps.current).toEqual({
      turfId: 3,
      openStopRequest: { stopId: 11, token: 2 },
    })

    fireEvent.click(screen.getByRole('button', { name: 'record a knock' }))
    expect(onKnockRecorded).toHaveBeenCalled()
  })
})
