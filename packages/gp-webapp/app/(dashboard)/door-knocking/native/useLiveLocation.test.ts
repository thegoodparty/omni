import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { LOW_ACCURACY_METERS, useLiveLocation } from './useLiveLocation'

type SuccessCallback = Parameters<Geolocation['watchPosition']>[0]
type ErrorCallback = NonNullable<Parameters<Geolocation['watchPosition']>[1]>

const PERMISSION_DENIED = 1
const POSITION_UNAVAILABLE = 2

const fix = (accuracy: number) =>
  ({
    coords: { longitude: -86.78, latitude: 36.16, accuracy },
  }) as GeolocationPosition

const geolocationError = (code: number) =>
  ({
    code,
    PERMISSION_DENIED,
    POSITION_UNAVAILABLE,
    TIMEOUT: 3,
  }) as GeolocationPositionError

let onSuccess: SuccessCallback
let onError: ErrorCallback
const watchPosition = vi.fn(
  (success: SuccessCallback, error?: ErrorCallback | null) => {
    onSuccess = success
    if (error) onError = error
    return 7
  },
)
const clearWatch = vi.fn()

const setSecureContext = (value: boolean) => {
  Object.defineProperty(window, 'isSecureContext', {
    value,
    configurable: true,
  })
}

beforeEach(() => {
  watchPosition.mockClear()
  clearWatch.mockClear()
  setSecureContext(true)
  Object.defineProperty(navigator, 'geolocation', {
    value: { watchPosition, clearWatch },
    configurable: true,
  })
})

afterEach(() => {
  setSecureContext(false)
})

describe('useLiveLocation', () => {
  // Geolocation only exists in a secure context. A dev on plain http (or an
  // embedded webview without the API) should still get a working map.
  it('reports unavailable and never asks for a fix outside a secure context', () => {
    setSecureContext(false)

    const { result } = renderHook(() => useLiveLocation(true))

    expect(result.current.status).toBe('unavailable')
    expect(watchPosition).not.toHaveBeenCalled()
  })

  it('watches nothing until the canvasser asks to be shown', () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useLiveLocation(enabled),
      { initialProps: { enabled: false } },
    )

    expect(result.current.status).toBe('off')
    expect(watchPosition).not.toHaveBeenCalled()

    rerender({ enabled: true })
    expect(watchPosition).toHaveBeenCalledTimes(1)
  })

  // The browser calls neither callback while its permission prompt is open,
  // so "waiting on the user" and "waiting on a satellite" are the same state.
  it('stays in locating while the permission prompt is unanswered', () => {
    const { result } = renderHook(() => useLiveLocation(true))

    expect(result.current.status).toBe('locating')
    expect(result.current.fix).toBeNull()
  })

  it('tracks a good fix', () => {
    const { result } = renderHook(() => useLiveLocation(true))

    act(() => onSuccess(fix(8)))

    expect(result.current.status).toBe('tracking')
    expect(result.current.fix).toEqual({
      lng: -86.78,
      lat: 36.16,
      accuracyMeters: 8,
    })
    expect(result.current.approximate).toBe(false)
  })

  // A coarse fix can be several houses off, which is worse than no dot if
  // it's drawn with the same confidence.
  it('flags a coarse fix as approximate', () => {
    const { result } = renderHook(() => useLiveLocation(true))

    act(() => onSuccess(fix(LOW_ACCURACY_METERS + 1)))

    expect(result.current.status).toBe('tracking')
    expect(result.current.approximate).toBe(true)
  })

  // The path most likely to break the map for a real canvasser: a denial
  // must leave the map alone and must not keep the GPS radio warm.
  it('stops watching when permission is denied', () => {
    const { result } = renderHook(() => useLiveLocation(true))

    act(() => onError(geolocationError(PERMISSION_DENIED)))

    expect(result.current.status).toBe('denied')
    expect(result.current.fix).toBeNull()
    expect(clearWatch).toHaveBeenCalledWith(7)
  })

  it('keeps the last fix and the watch through a transient failure', () => {
    const { result } = renderHook(() => useLiveLocation(true))

    act(() => onSuccess(fix(12)))
    act(() => onError(geolocationError(POSITION_UNAVAILABLE)))

    expect(result.current.status).toBe('error')
    expect(result.current.fix).not.toBeNull()
    expect(clearWatch).not.toHaveBeenCalled()
  })

  // Leaving the walk must not leave a watch running for the rest of the
  // session — that is a phone battery draining in someone's pocket.
  it('clears the watch on unmount', () => {
    const { unmount } = renderHook(() => useLiveLocation(true))

    unmount()

    expect(clearWatch).toHaveBeenCalledWith(7)
  })

  it('clears the watch when it is switched back off', () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useLiveLocation(enabled),
      { initialProps: { enabled: true } },
    )

    act(() => onSuccess(fix(9)))
    rerender({ enabled: false })

    expect(clearWatch).toHaveBeenCalledWith(7)
    expect(result.current.status).toBe('off')
    expect(result.current.fix).toBeNull()
  })
})
