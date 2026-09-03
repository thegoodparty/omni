import { describe, expect, it } from 'vitest'
import { routePlannerCredits, routingCredits } from './geoapifyCost.util'

describe('routePlannerCredits', () => {
  // The whole reason this is not a multiplication at the call site. A turf
  // small enough to stay under ten locations is billed on its square, so the
  // flat rate over-charges the small routes and the crossover is a cliff
  // rather than a rounding error.
  it.each([
    [2, 4],
    [5, 25],
    [9, 81],
  ])(
    'squares %i locations into %i credits below the crossover',
    (locations, credits) => {
      expect(routePlannerCredits(locations)).toBe(credits)
    },
  )

  // Ten is the first linear location count and both formulas agree there, so
  // a crossover written the other way round would still pass at 10 alone —
  // 11 is what proves the branch actually flipped.
  it.each([
    [10, 100],
    [11, 110],
    [121, 1210],
    [150, 1500],
  ])('bills %i locations at ten credits each (%i)', (locations, credits) => {
    expect(routePlannerCredits(locations)).toBe(credits)
  })

  // A create that reaches the vendor always has at least one job, so these
  // are guards against a caller that has miscounted rather than real routes;
  // they must not turn into a credit or a refund.
  it('charges nothing for no locations', () => {
    expect(routePlannerCredits(0)).toBe(0)
    expect(routePlannerCredits(-3)).toBe(0)
  })

  it('charges a single location its square', () => {
    expect(routePlannerCredits(1)).toBe(1)
  })
})

describe('routingCredits', () => {
  it.each([
    [2, 1],
    [3, 2],
    [150, 149],
    [152, 151],
  ])('bills %i waypoints as %i pairs', (waypoints, credits) => {
    expect(routingCredits(waypoints)).toBe(credits)
  })

  // Nothing is a pair, so nothing is owed. The plan can legitimately be
  // shorter than the caller expects, and a negative charge here would show up
  // as a route that earned us credits.
  it('charges nothing below two waypoints', () => {
    expect(routingCredits(0)).toBe(0)
    expect(routingCredits(1)).toBe(0)
  })

  // 500 km exactly is not "more than 500 km", and a walking turf never gets
  // near either side of it — this pins the vendor's rule so a drive-mode
  // route or a future long-haul caller is not silently under-reported.
  it('adds nothing at or below 500 km', () => {
    expect(routingCredits(2, 500_000)).toBe(1)
  })

  it.each([
    [500_001, 2],
    [999_999, 2],
    [1_000_000, 3],
    [1_200_000, 3],
  ])(
    'adds a credit per 500 km once past it (%i m -> %i)',
    (meters, credits) => {
      expect(routingCredits(2, meters)).toBe(credits)
    },
  )

  it('defaults to no distance surcharge when the length is unknown', () => {
    expect(routingCredits(10)).toBe(9)
  })
})
