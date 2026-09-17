import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanData } from '../components/planContent'

// The `pdf` factory is client-only and pulls the whole @react-pdf/renderer
// runtime. This test cares only about the DOM cleanup timing after the blob
// is produced, so stub the module before importing the downloader.
vi.mock('@react-pdf/renderer', () => ({
  pdf: () => ({
    toBlob: async () => new Blob(['%PDF-1.7'], { type: 'application/pdf' }),
  }),
  Font: { register: () => undefined },
  StyleSheet: { create: <T>(styles: T): T => styles },
  Document: () => null,
  Page: () => null,
  View: () => null,
  Text: () => null,
  Image: () => null,
  Link: () => null,
  Svg: () => null,
  Path: () => null,
  G: () => null,
  Rect: () => null,
  Circle: () => null,
  Line: () => null,
  Polyline: () => null,
  Polygon: () => null,
}))

// Skip real QR generation — the render passes are stubbed above anyway.
vi.mock('qrcode', () => ({
  default: { toDataURL: async () => 'data:image/png;base64,QR' },
  toDataURL: async () => 'data:image/png;base64,QR',
}))

// jsdom's <a>.click() would surface as a navigation attempt; make it a no-op.
const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click')

const fakePlan = {
  candidateName: 'Test Candidate',
} as unknown as PlanData

describe('downloadCampaignPlanPdf', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clickSpy.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the anchor attached and the object URL alive until the browser has read the blob', async () => {
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-url')
    const revokeSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)

    try {
      const { downloadCampaignPlanPdf } =
        await import('./downloadCampaignPlanPdf')

      // The download helper awaits two react-pdf renders before the DOM work
      // we care about — advance microtasks so we land on the click tick.
      const done = downloadCampaignPlanPdf(fakePlan)
      await vi.advanceTimersByTimeAsync(0)
      await done

      // The click must have fired against an anchor that's still in the DOM,
      // and the blob URL must still resolve — Chrome reads the blob
      // asynchronously after click(), so detaching or revoking on the same
      // tick cancels the download (ENG-10905 / #1131 / #1138 / #1247).
      expect(clickSpy).toHaveBeenCalledTimes(1)
      const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement
      expect(anchor.isConnected).toBe(true)
      expect(revokeSpy).not.toHaveBeenCalled()

      // Even a full second later, cleanup must not have run — precedent uses
      // 1.5s (polls) / 10s (ordinances, matched here since the plan PDF is
      // large).
      await vi.advanceTimersByTimeAsync(1000)
      expect(anchor.isConnected).toBe(true)
      expect(revokeSpy).not.toHaveBeenCalled()

      // After the deferred window, both the anchor and the URL are cleaned up.
      await vi.advanceTimersByTimeAsync(10_000)
      expect(anchor.isConnected).toBe(false)
      expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url')
    } finally {
      createSpy.mockRestore()
      revokeSpy.mockRestore()
    }
  })
})
