import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useWalkSession } from './useWalkSession'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const TURF = { id: 12, name: 'Elm loop' }

const eventCalls = (name: string) =>
  vi.mocked(trackEvent).mock.calls.filter(([called]) => called === name)

describe('useWalkSession', () => {
  beforeEach(() => {
    vi.mocked(trackEvent).mockClear()
    vi.useRealTimers()
  })

  it('reports how the walk was entered', () => {
    const { result } = renderHook(() => useWalkSession())

    act(() => result.current.start(TURF, 'existingRoute'))

    expect(result.current.turf).toEqual(TURF)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.DoorKnocking.SessionStarted,
      {
        turfId: 12,
        entry: 'existingRoute',
      },
    )
  })

  // A walk with doors logged is the activation signal, so it has to carry
  // both its own funnel event and the canonical outreach one.
  it('completes a walk that logged doors and feeds the activation metric', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useWalkSession())

    act(() => result.current.start(TURF, 'newRoute'))
    act(() => {
      result.current.recordDoor()
      result.current.recordDoor()
    })
    vi.advanceTimersByTime(90_000)
    let doorsLogged = 0
    act(() => {
      doorsLogged = result.current.end({ stopCount: 40 })
    })

    expect(doorsLogged).toBe(2)
    expect(result.current.turf).toBeNull()
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.DoorKnocking.SessionCompleted,
      { turfId: 12, doorsLogged: 2, durationSeconds: 90, stopCount: 40 },
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Dashboard.VoterContact.CampaignCompleted,
      {
        medium: 'doorKnocking',
        method: 'native',
        recipientCount: 2,
        price: 0,
      },
    )
    expect(eventCalls(EVENTS.DoorKnocking.SessionAbandoned)).toHaveLength(0)
  })

  // Opening a route and walking away without knocking is not activation, so
  // the canonical event must stay silent — otherwise every idle look at a
  // route inflates the metric the launch is judged by.
  it('abandons a walk with no doors and fires no outreach event', () => {
    const { result } = renderHook(() => useWalkSession())

    act(() => result.current.start(TURF, 'newRoute'))
    let doorsLogged = -1
    act(() => {
      doorsLogged = result.current.end({ stopCount: 40 })
    })

    expect(doorsLogged).toBe(0)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.DoorKnocking.SessionAbandoned,
      expect.objectContaining({ turfId: 12, doorsLogged: 0, stopCount: 40 }),
    )
    expect(
      eventCalls(EVENTS.Dashboard.VoterContact.CampaignCompleted),
    ).toHaveLength(0)
    expect(eventCalls(EVENTS.DoorKnocking.SessionCompleted)).toHaveLength(0)
  })

  // Each walk is counted on its own; a second one must not inherit the
  // first's doors or its clock.
  it('starts each walk from zero', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useWalkSession())

    act(() => result.current.start(TURF, 'newRoute'))
    act(() => result.current.recordDoor())
    vi.advanceTimersByTime(600_000)
    act(() => void result.current.end({ stopCount: 40 }))

    act(() => result.current.start({ id: 13, name: 'Oak row' }, 'newRoute'))
    act(() => result.current.recordDoor())
    vi.advanceTimersByTime(30_000)
    act(() => void result.current.end({ stopCount: 8 }))

    expect(eventCalls(EVENTS.DoorKnocking.SessionCompleted)[1]?.[1]).toEqual({
      turfId: 13,
      doorsLogged: 1,
      durationSeconds: 30,
      stopCount: 8,
    })
  })

  // Doors can only be attributed to a walk in progress; a stray callback
  // after the session closed must not open a new one.
  it('ignores a door logged outside a session', () => {
    const { result } = renderHook(() => useWalkSession())

    act(() => result.current.recordDoor())
    act(() => void result.current.end({ stopCount: 0 }))

    expect(trackEvent).not.toHaveBeenCalled()
  })
})
