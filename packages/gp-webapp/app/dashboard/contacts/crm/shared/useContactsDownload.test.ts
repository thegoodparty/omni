import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSnackbar } from 'helpers/useSnackbar'
import { getCookie } from 'helpers/cookieHelper'
import { useContactsDownload } from './useContactsDownload'

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))
vi.mock('helpers/cookieHelper', () => ({
  getCookie: vi.fn(),
  deleteCookie: vi.fn(),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const mockedUseSnackbar = vi.mocked(useSnackbar)
const mockedGetCookie = vi.mocked(getCookie)
const successSnackbar = vi.fn()
const errorSnackbar = vi.fn()

describe('useContactsDownload', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockedUseSnackbar.mockReturnValue({
      successSnackbar,
      errorSnackbar,
      displaySnackbar: vi.fn(),
    })
    mockedGetCookie.mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('non-pro (canUseProFeatures=false): calls onProGated and never sets isPreparing', () => {
    const onProGated = vi.fn()
    const { result } = renderHook(() =>
      useContactsDownload({ canUseProFeatures: false, onProGated }),
    )

    act(() => {
      result.current.download('42', {})
    })

    expect(onProGated).toHaveBeenCalledTimes(1)
    expect(result.current.isPreparing).toBe(false)
    expect(successSnackbar).not.toHaveBeenCalled()
  })

  it('cookie-poll success: isPreparing clears and "Download started" fires exactly once', () => {
    mockedGetCookie.mockReturnValue(false)
    const { result } = renderHook(() =>
      useContactsDownload({ canUseProFeatures: true }),
    )

    act(() => {
      result.current.download('42', {})
    })
    expect(result.current.isPreparing).toBe(true)

    // gp-api mints a fresh cookie once the download response starts
    // streaming — simulate it appearing before the next poll tick.
    mockedGetCookie.mockReturnValue('fresh-token')
    act(() => {
      vi.advanceTimersByTime(250)
    })

    expect(result.current.isPreparing).toBe(false)
    const startedCalls = successSnackbar.mock.calls.filter(
      ([message]) => message === 'Download started',
    )
    expect(startedCalls).toHaveLength(1)
    expect(startedCalls[0]).toEqual([
      'Download started',
      { autoHideDuration: 3000 },
    ])
    expect(errorSnackbar).not.toHaveBeenCalled()
  })

  it('15s fallback timeout: isPreparing clears and the fallback error snackbar fires', () => {
    mockedGetCookie.mockReturnValue(false)
    const { result } = renderHook(() =>
      useContactsDownload({ canUseProFeatures: true }),
    )

    act(() => {
      result.current.download('42', {})
    })
    expect(result.current.isPreparing).toBe(true)

    act(() => {
      vi.advanceTimersByTime(15000)
    })

    expect(result.current.isPreparing).toBe(false)
    expect(errorSnackbar).toHaveBeenCalledWith(
      "If your download hasn't started, please try again.",
      { autoHideDuration: 6000 },
    )
  })

  it('stale-cookie guard: a pre-existing cookie value does not clear the spinner instantly', () => {
    // A stale cookie from a previous download is already present when this
    // one starts. The poll must not treat "cookie present" alone as success —
    // only a value that DIFFERS from the pre-click snapshot counts.
    mockedGetCookie.mockReturnValue('stale-token-from-last-time')
    const { result } = renderHook(() =>
      useContactsDownload({ canUseProFeatures: true }),
    )

    act(() => {
      result.current.download('42', {})
    })
    expect(result.current.isPreparing).toBe(true)

    // getCookie keeps returning the SAME stale value on every poll tick.
    act(() => {
      vi.advanceTimersByTime(250)
    })

    expect(result.current.isPreparing).toBe(true)
    expect(successSnackbar).not.toHaveBeenCalledWith(
      'Download started',
      expect.anything(),
    )
  })
})
