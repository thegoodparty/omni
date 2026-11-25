import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { recoverOrReportRouteError } from './recoverOrReportRouteError'
import {
  reportClientError,
  reportClientInterruption,
} from './reportClientError'

vi.mock('./reportClientError', () => ({
  reportClientError: vi.fn(),
  reportClientInterruption: vi.fn(),
}))

const chunkError = new Error('Failed to load chunk /_next/static/chunks/a.js')
const reload = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('location', {
    pathname: '/onboarding/office-selection',
    reload,
  })
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

it('logs a first chunk-load error without reporting an exception and reloads once', () => {
  recoverOrReportRouteError(chunkError)
  vi.advanceTimersByTime(500)

  expect(reportClientInterruption).toHaveBeenCalledOnce()
  expect(reportClientError).not.toHaveBeenCalled()
  expect(reload).toHaveBeenCalledOnce()

  recoverOrReportRouteError(chunkError)
  vi.advanceTimersByTime(500)

  expect(reportClientError).toHaveBeenCalledWith(chunkError)
  expect(reload).toHaveBeenCalledOnce()
})

it('allows a later chunk error to retry after the recovery window', () => {
  recoverOrReportRouteError(chunkError)
  vi.advanceTimersByTime(60_500)
  recoverOrReportRouteError(chunkError)
  vi.advanceTimersByTime(500)

  expect(reportClientError).not.toHaveBeenCalled()
  expect(reload).toHaveBeenCalledTimes(2)
})

it('does not spend a retry when the boundary unmounts before reloading', () => {
  recoverOrReportRouteError(chunkError)?.()
  vi.advanceTimersByTime(500)
  expect(reload).not.toHaveBeenCalled()

  recoverOrReportRouteError(chunkError)
  vi.advanceTimersByTime(500)
  expect(reportClientError).not.toHaveBeenCalled()
  expect(reload).toHaveBeenCalledOnce()
})

it('reports non-chunk errors without reloading', () => {
  const error = new Error('Connection closed')
  recoverOrReportRouteError(error)
  vi.advanceTimersByTime(500)

  expect(reportClientError).toHaveBeenCalledWith(error)
  expect(reload).not.toHaveBeenCalled()
})

it('reports the error without reloading if the retry cannot be tracked', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage unavailable')
  })
  recoverOrReportRouteError(chunkError)
  vi.advanceTimersByTime(500)

  expect(reportClientError).toHaveBeenCalledWith(chunkError)
  expect(reload).not.toHaveBeenCalled()
})
