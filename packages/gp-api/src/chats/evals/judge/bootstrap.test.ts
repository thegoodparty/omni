import { describe, expect, it } from 'vitest'
import { bootstrapCi, createRng, mean } from './bootstrap'
import type { BootstrapConfig, Rng } from './config'

const config = (o: Partial<BootstrapConfig> = {}): BootstrapConfig => ({
  iterations: 500,
  confidence: 0.95,
  ...o,
})

// Replays an exact list of draws, so a test can pin the resample by hand
// instead of hoping a seeded stream happens to do the right thing.
const scripted = (values: readonly number[]): Rng => {
  let index = 0
  return () => values[index++] ?? 0
}

const width = (interval: { lower: number; upper: number }): number =>
  interval.upper - interval.lower

describe('createRng', () => {
  it('replays the same stream from the same seed', () => {
    const a = createRng(7)
    const b = createRng(7)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('gives a different stream for a different seed', () => {
    expect(createRng(7)()).not.toEqual(createRng(8)())
  })

  it('stays inside [0, 1)', () => {
    const rng = createRng(3)
    for (let i = 0; i < 1_000; i++) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('mean', () => {
  it('averages', () => {
    expect(mean([1, 0, -1, 0])).toBe(0)
  })

  it('treats an empty series as zero rather than NaN', () => {
    expect(mean([])).toBe(0)
  })
})

describe('bootstrapCi', () => {
  it('has no interval for no cases', () => {
    expect(bootstrapCi([], config(), createRng(1))).toBeNull()
  })

  // `iterations` is a config value that exists to be edited, and nothing up
  // the stack catches a throw from here. Without this the resample list
  // stays empty, `percentile` asks for index -1, and the whole sweep dies
  // over a tunable — reporting a message about the case series, which is
  // not the input that was wrong.
  it.each([0, -1])('has no interval for %i iterations', (iterations) => {
    expect(
      bootstrapCi([0.5, -0.5], config({ iterations }), createRng(1)),
    ).toBeNull()
  })

  it('collapses to a point when every case agrees', () => {
    const interval = bootstrapCi([0.5, 0.5, 0.5], config(), createRng(1))
    expect(interval).toEqual({ lower: 0.5, upper: 0.5 })
  })

  // One case cannot be resampled into anything else, which is the honest
  // answer and also why the case-count gate exists above this.
  it('collapses to a point for a single case', () => {
    expect(bootstrapCi([0.25], config(), createRng(1))).toEqual({
      lower: 0.25,
      upper: 0.25,
    })
  })

  // Proves the resample actually indexes the case list with the rng: a
  // stream stuck at zero can only ever draw the first case.
  it('draws by index, so a stream stuck at zero only ever sees case 0', () => {
    expect(bootstrapCi([-1, 1, 1], config(), () => 0)).toEqual({
      lower: -1,
      upper: -1,
    })
  })

  // Pinned by hand. Two cases [0, 1] and four scripted iterations give
  // resample means [0, 0.5, 0.5, 1]; nearest-rank on (B - 1) = 3 at the 5th
  // and 95th percentiles picks index 0 and index 3.
  it('places the percentiles where the stated rule says', () => {
    const interval = bootstrapCi(
      [0, 1],
      config({ iterations: 4, confidence: 0.9 }),
      scripted([0, 0, 0, 0.9, 0.9, 0, 0.9, 0.9]),
    )
    expect(interval).toEqual({ lower: 0, upper: 1 })
  })

  it('widens the interval when more confidence is asked for', () => {
    const cases = [1, 1, 0, -1, 1, 0, -1, 1, 0, 1]
    const narrow = bootstrapCi(cases, config({ confidence: 0.8 }), createRng(5))
    const wide = bootstrapCi(cases, config({ confidence: 0.99 }), createRng(5))
    expect(width(wide!)).toBeGreaterThan(width(narrow!))
  })

  it('brackets the observed mean', () => {
    const cases = [0.8, 0.2, 1, -0.4, 0.6, 0, 0.4, 1, -0.2, 0.6]
    const interval = bootstrapCi(cases, config(), createRng(11))
    expect(interval!.lower).toBeLessThanOrEqual(mean(cases))
    expect(interval!.upper).toBeGreaterThanOrEqual(mean(cases))
  })

  // The property the case-count floor is there to exploit: the same mix of
  // scores measured over more cases resolves tighter. If this failed, more
  // cases would buy nothing and the floor would be arbitrary.
  it('narrows as the number of cases grows', () => {
    const pattern = [1, -1, 1, 0]
    const few = bootstrapCi(pattern, config(), createRng(2))
    const many = bootstrapCi(
      Array.from({ length: 40 }, (_, i) => pattern[i % 4] ?? 0),
      config(),
      createRng(2),
    )
    expect(width(many!)).toBeLessThan(width(few!))
  })
})
