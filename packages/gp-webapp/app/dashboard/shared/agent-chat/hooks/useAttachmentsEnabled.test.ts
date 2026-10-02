import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  SERVE_CHAT_ATTACHMENTS_FLAG,
  WIN_CHAT_ATTACHMENTS_FLAG,
  useAttachmentsEnabled,
} from './useAttachmentsEnabled'

const flagState: Record<string, { ready: boolean; on: boolean }> = {
  [SERVE_CHAT_ATTACHMENTS_FLAG]: { ready: true, on: false },
  [WIN_CHAT_ATTACHMENTS_FLAG]: { ready: true, on: false },
}

const useFlagOnMock = vi.fn(
  (key: string, _options: { trackExposure?: boolean }) => flagState[key],
)
vi.mock('@shared/experiments/FeatureFlagsProvider', () => ({
  useFlagOn: (...args: [string, { trackExposure?: boolean }]) =>
    useFlagOnMock(...args),
}))

describe('useAttachmentsEnabled', () => {
  beforeEach(() => {
    flagState[SERVE_CHAT_ATTACHMENTS_FLAG] = { ready: true, on: false }
    flagState[WIN_CHAT_ATTACHMENTS_FLAG] = { ready: true, on: false }
    useFlagOnMock.mockClear()
  })

  it('calls useFlagOn for both flags on every render, unconditionally', () => {
    renderHook(() => useAttachmentsEnabled('chief_of_staff'))
    expect(useFlagOnMock).toHaveBeenCalledWith(
      SERVE_CHAT_ATTACHMENTS_FLAG,
      expect.anything(),
    )
    expect(useFlagOnMock).toHaveBeenCalledWith(
      WIN_CHAT_ATTACHMENTS_FLAG,
      expect.anything(),
    )
  })

  it('tracks exposure only for serve-chat-attachments on the chief_of_staff scope', () => {
    renderHook(() => useAttachmentsEnabled('chief_of_staff'))
    expect(useFlagOnMock).toHaveBeenCalledWith(SERVE_CHAT_ATTACHMENTS_FLAG, {
      trackExposure: true,
    })
    expect(useFlagOnMock).toHaveBeenCalledWith(WIN_CHAT_ATTACHMENTS_FLAG, {
      trackExposure: false,
    })
  })

  it('tracks exposure only for win-chat-attachments on the campaign_assistant scope', () => {
    renderHook(() => useAttachmentsEnabled('campaign_assistant'))
    expect(useFlagOnMock).toHaveBeenCalledWith(WIN_CHAT_ATTACHMENTS_FLAG, {
      trackExposure: true,
    })
    expect(useFlagOnMock).toHaveBeenCalledWith(SERVE_CHAT_ATTACHMENTS_FLAG, {
      trackExposure: false,
    })
  })

  it('tracks exposure for neither flag on a scope that owns none of them', () => {
    renderHook(() => useAttachmentsEnabled('ordinance_flow'))
    expect(useFlagOnMock).toHaveBeenCalledWith(SERVE_CHAT_ATTACHMENTS_FLAG, {
      trackExposure: false,
    })
    expect(useFlagOnMock).toHaveBeenCalledWith(WIN_CHAT_ATTACHMENTS_FLAG, {
      trackExposure: false,
    })
  })

  // scope x flag matrix
  it.each([
    ['chief_of_staff', true, false, true],
    ['chief_of_staff', false, false, false],
    ['chief_of_staff', false, true, false], // serve follows only its own flag
    ['campaign_assistant', false, true, true],
    ['campaign_assistant', false, false, false],
    ['campaign_assistant', true, false, false], // win follows only its own flag
  ] as const)(
    'scope=%s serve=%s win=%s -> enabled=%s',
    (scope, serveOn, winOn, expected) => {
      flagState[SERVE_CHAT_ATTACHMENTS_FLAG] = { ready: true, on: serveOn }
      flagState[WIN_CHAT_ATTACHMENTS_FLAG] = { ready: true, on: winOn }
      const { result } = renderHook(() => useAttachmentsEnabled(scope))
      expect(result.current.enabled).toBe(expected)
    },
  )

  it('is disabled for a scope that owns neither flag, regardless of either flag', () => {
    flagState[SERVE_CHAT_ATTACHMENTS_FLAG] = { ready: true, on: true }
    flagState[WIN_CHAT_ATTACHMENTS_FLAG] = { ready: true, on: true }
    const { result } = renderHook(() => useAttachmentsEnabled('ordinance_flow'))
    expect(result.current.enabled).toBe(false)
  })

  it('ready reflects the relevant flag per scope', () => {
    flagState[SERVE_CHAT_ATTACHMENTS_FLAG] = { ready: false, on: false }
    flagState[WIN_CHAT_ATTACHMENTS_FLAG] = { ready: true, on: false }
    const { result: cos } = renderHook(() =>
      useAttachmentsEnabled('chief_of_staff'),
    )
    expect(cos.current.ready).toBe(false)

    const { result: cm } = renderHook(() =>
      useAttachmentsEnabled('campaign_assistant'),
    )
    expect(cm.current.ready).toBe(true)
  })
})
