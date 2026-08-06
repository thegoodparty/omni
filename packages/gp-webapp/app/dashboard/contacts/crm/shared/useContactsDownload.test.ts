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
const mockOrg = vi.hoisted(() => ({
  current: {
    slug: 'campaign-1',
    positionName: 'Mayor',
    district: { id: 'd1', l2Type: 'City', l2Name: 'Austin' },
  } as unknown,
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => mockOrg.current,
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
    mockOrg.current = {
      slug: 'campaign-1',
      positionName: 'Mayor',
      district: { id: 'd1', l2Type: 'City', l2Name: 'Austin' },
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // downloadContacts resolves a district server-side. The download is a
  // top-level navigation rather than a fetch, so the refusal has to happen
  // before the anchor click — there is no request to intercept.
  it('unresolvable district: refuses, explains, and never sets isPreparing', () => {
    mockOrg.current = {
      slug: 'campaign-1',
      positionName: 'Mayor',
      district: null,
    }
    const onProGated = vi.fn()
    const { result } = renderHook(() =>
      useContactsDownload({ canUseProFeatures: true, onProGated }),
    )

    act(() => {
      result.current.download('42', {})
    })

    expect(result.current.isPreparing).toBe(false)
    expect(successSnackbar).not.toHaveBeenCalled()
    expect(errorSnackbar).toHaveBeenCalledTimes(1)
    // Not the Pro upsell — a district problem is not something upgrading fixes.
    expect(onProGated).not.toHaveBeenCalled()
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

  it('ENG-10709: onDownloadConfirmed fires exactly once, only on the cookie-confirmed success branch', () => {
    mockedGetCookie.mockReturnValue(false)
    const onDownloadConfirmed = vi.fn()
    const { result } = renderHook(() =>
      useContactsDownload({ canUseProFeatures: true }),
    )

    act(() => {
      result.current.download('42', {}, onDownloadConfirmed)
    })
    expect(onDownloadConfirmed).not.toHaveBeenCalled()

    mockedGetCookie.mockReturnValue('fresh-token')
    act(() => {
      vi.advanceTimersByTime(250)
    })

    expect(onDownloadConfirmed).toHaveBeenCalledTimes(1)
  })

  it('ENG-10709: onDownloadConfirmed never fires on the 15s fallback path', () => {
    mockedGetCookie.mockReturnValue(false)
    const onDownloadConfirmed = vi.fn()
    const { result } = renderHook(() =>
      useContactsDownload({ canUseProFeatures: true }),
    )

    act(() => {
      result.current.download('42', {}, onDownloadConfirmed)
    })
    act(() => {
      vi.advanceTimersByTime(15000)
    })

    expect(onDownloadConfirmed).not.toHaveBeenCalled()
  })

  it('ENG-10709: a caller that omits onDownloadConfirmed (legacy Download.tsx) does not error on success', () => {
    mockedGetCookie.mockReturnValue(false)
    const { result } = renderHook(() =>
      useContactsDownload({ canUseProFeatures: true }),
    )

    act(() => {
      result.current.download('42', {})
    })
    mockedGetCookie.mockReturnValue('fresh-token')
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(250)
      })
    }).not.toThrow()
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
