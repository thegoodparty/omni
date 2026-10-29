import { describe, expect, it } from 'vitest'
import { SEND_BATCH_SIZE, SEND_RATE_HEADROOM } from '../emailOutreach.const'
import { batchesPerTick } from './emailPacing.util'

describe('batchesPerTick', () => {
  it('sends 12 batches of 50 at MaxSendRate 14, under 12.6/s', () => {
    const batches = batchesPerTick(14, 50_000)
    expect(batches).toBe(12)
    expect((batches * SEND_BATCH_SIZE) / 50).toBeLessThanOrEqual(14 * 0.9)
  })

  it('rounds down, never up, at every rate', () => {
    for (let rate = 1; rate <= 200; rate += 0.5) {
      const batches = batchesPerTick(rate, 50_000)
      const exact = (rate * SEND_RATE_HEADROOM * 50) / SEND_BATCH_SIZE
      expect(batches).toBeLessThanOrEqual(Math.max(1, exact))
      expect(batches).toBeGreaterThan(Math.min(exact, 1) - 1)
    }
  })

  it('still sends one batch at a very low rate', () => {
    expect(batchesPerTick(1, 50_000)).toBe(1)
  })
})
