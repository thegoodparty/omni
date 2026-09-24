import { describe, expect, it } from 'vitest'
import { assignNextColor } from './turfColors'
import { TURF_COLORS } from './turfQueries'

describe('assignNextColor', () => {
  it('returns the first palette slot for a fresh campaign', () => {
    expect(assignNextColor([])).toBe(TURF_COLORS[0])
  })

  it('skips over slots already taken by sibling turfs', () => {
    expect(assignNextColor([TURF_COLORS[0]])).toBe(TURF_COLORS[1])
    expect(assignNextColor([TURF_COLORS[0], TURF_COLORS[1]])).toBe(
      TURF_COLORS[2],
    )
  })

  it('ignores gaps and picks the earliest free slot', () => {
    expect(assignNextColor([TURF_COLORS[1], TURF_COLORS[3]])).toBe(
      TURF_COLORS[0],
    )
  })

  it('matches case-insensitively against saved colors', () => {
    // A row saved by an older client may carry uppercase hex; the canvas
    // treats those as the same colour, so the assigner must too.
    expect(assignNextColor([TURF_COLORS[0].toUpperCase()])).toBe(TURF_COLORS[1])
  })

  it('wraps to palette[0] once every slot is spoken for', () => {
    expect(assignNextColor([...TURF_COLORS])).toBe(TURF_COLORS[0])
  })

  it('wraps by count past the palette length', () => {
    // Ninth turf → palette[0]. Tenth → palette[1]. Prevents the "everyone
    // picks purple" papercut the design memo names for repeated picks.
    const nine = [...TURF_COLORS, TURF_COLORS[0]]
    expect(assignNextColor(nine)).toBe(TURF_COLORS[1])
  })
})
