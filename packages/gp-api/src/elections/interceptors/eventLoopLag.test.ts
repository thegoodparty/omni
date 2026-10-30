import { describe, expect, it } from 'vitest'
import { recentEventLoopLagMs } from './eventLoopLag'

describe('recentEventLoopLagMs', () => {
  it('reports a small finite lag on an idle loop', () => {
    const lag = recentEventLoopLagMs()
    expect(Number.isFinite(lag)).toBe(true)
    expect(lag).toBeGreaterThanOrEqual(0)
    expect(lag).toBeLessThan(500)
  })
})
