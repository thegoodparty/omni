import { describe, expect, it } from 'vitest'
import { estimateTravelSeconds } from './travelMode'

describe('estimateTravelSeconds', () => {
  // Only ever applied to the mode we did NOT buy: the bought mode's duration is
  // Geoapify's own totalSeconds and is never replaced by this.
  it('reads the same distance faster by car than on foot', () => {
    const walking = estimateTravelSeconds(5_000, 'walk')
    const driving = estimateTravelSeconds(5_000, 'drive')

    expect(walking).toBe(3_600)
    expect(driving).toBeLessThan(walking)
    expect(driving).toBe(720)
  })
})
