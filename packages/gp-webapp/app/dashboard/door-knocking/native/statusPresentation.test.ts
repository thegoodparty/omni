import { describe, expect, it } from 'vitest'
import {
  DoorKnockStatus,
  RoutePayloadStop,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'
import {
  readableInkOn,
  readableInkOnHex,
  rollupStopStatus,
  skipInstruction,
  STATUS_RGB,
  stopIsKnockable,
  targetMarker,
} from './statusPresentation'
import { TURF_COLORS, turfColorTick } from './turfQueries'

const target = (
  knockStatus: DoorKnockStatus,
  doNotKnock = false,
): RoutePayloadTarget => ({
  stopTargetId: 1,
  personId: 'person-1',
  name: 'Dorian Fen',
  age: 31,
  politicalParty: null,
  cellPhone: null,
  landline: null,
  knockStatus,
  mayHaveMoved: false,
  doNotKnock,
})

const stop = (targets: RoutePayloadTarget[]): RoutePayloadStop => ({
  id: 10,
  seq: 1,
  lat: 36.16,
  lng: -86.78,
  displayAddress: '105 Elm St',
  legSeconds: 0,
  legMeters: 0,
  addresses: [
    {
      addressKey: '105|elm|st',
      address: '105 Elm St',
      targets,
      otherResidents: [],
    },
  ],
})

// Both the walk list's stop dot and the landing map's pins read this, so the
// rule is asserted here once rather than through either surface.
describe('rollupStopStatus', () => {
  it('keeps a stop knockable while any resident is unlogged', () => {
    expect(
      rollupStopStatus(stop([target('unknown'), target('supporter')])),
    ).toBe('unknown')
  })

  // ADR 0007. The regression this guards: `unknown` outranks everything, so a
  // flagged resident used to hold the stop grey no matter what was logged.
  it('ignores flagged residents when the rest of the household is logged', () => {
    expect(
      rollupStopStatus(stop([target('unknown', true), target('supporter')])),
    ).toBe('supporter')
  })

  it('reports a stop with nobody left to knock as unknown', () => {
    expect(rollupStopStatus(stop([target('unknown', true)]))).toBe('unknown')
  })

  it('reports an empty stop as unknown', () => {
    expect(rollupStopStatus(stop([]))).toBe('unknown')
  })

  // gp-api used to ship its own stop rollup on the route payload and pinned
  // this order in a hand-written rank map; that copy is gone, so this is the
  // only place the order is asserted. Here it IS `DOOR_KNOCK_STATUSES`, so a
  // status added to the contract without a decision about where it ranks
  // surfaces as a failure rather than as a silently grey stop.
  it('ranks the whole vocabulary most-actionable first', () => {
    expect(
      rollupStopStatus(stop([target('refused'), target('not_home')])),
    ).toBe('not_home')
    expect(
      rollupStopStatus(stop([target('refused'), target('supporter')])),
    ).toBe('supporter')
    expect(
      rollupStopStatus(stop([target('refused'), target('non_supporter')])),
    ).toBe('non_supporter')
    expect(
      rollupStopStatus(stop([target('not_a_voter'), target('inaccessible')])),
    ).toBe('inaccessible')
  })

  // ADR 0008 makes the same claim as 0007 about this rollup: both flags remove a
  // resident from it, which is one predicate (`isKnockable`) and not two rules.
  it('ignores a resident flagged with a reason', () => {
    const moved = { ...target('unknown'), notAVoterReason: 'moved' as const }
    expect(rollupStopStatus(stop([moved, target('supporter')]))).toBe(
      'supporter',
    )
  })

  it('reports a fully flagged household as unknown, marker and all', () => {
    const deceased = {
      ...target('unknown'),
      notAVoterReason: 'deceased' as const,
    }
    // The color alone cannot tell "nobody to knock" from "nobody knocked yet",
    // which is why every surface pairs it with the marker.
    expect(rollupStopStatus(stop([deceased]))).toBe('unknown')
    expect(targetMarker(deceased)).toBe('Deceased')
  })
})

// The second half of the rollup, and the pair is the point: these two answer
// different questions, and the `unknown` above is why the second one has to
// exist. A surface reading only the status renders "nobody to knock" and
// "nobody has been here" identically.
describe('stopIsKnockable', () => {
  it('reports a stop with someone left to knock', () => {
    expect(stopIsKnockable(stop([target('unknown')]))).toBe(true)
  })

  // The whole reason for this predicate: same status, opposite fact.
  it('separates a fully flagged stop from an untouched one, which the status cannot', () => {
    const deceased = {
      ...target('unknown'),
      notAVoterReason: 'deceased' as const,
    }
    const flagged = stop([deceased])
    const untouched = stop([target('unknown')])
    expect(rollupStopStatus(flagged)).toBe(rollupStopStatus(untouched))
    expect(stopIsKnockable(flagged)).toBe(false)
    expect(stopIsKnockable(untouched)).toBe(true)
  })

  // ADR 0007 and 0008 are one predicate to a count (routeCounts), and to this.
  it('counts either flag as nobody', () => {
    expect(stopIsKnockable(stop([target('supporter', true)]))).toBe(false)
    expect(
      stopIsKnockable(
        stop([{ ...target('unknown'), notAVoterReason: 'moved' as const }]),
      ),
    ).toBe(false)
  })

  // A logged resident is still a resident: the flags are what remove someone,
  // not having been spoken to. Otherwise a finished stop would go hollow.
  it('keeps a fully logged household knockable', () => {
    expect(stopIsKnockable(stop([target('supporter')]))).toBe(true)
  })

  it('reports one knockable resident among flagged neighbors', () => {
    expect(
      stopIsKnockable(stop([target('unknown', true), target('unknown')])),
    ).toBe(true)
  })

  it('reports an empty stop as nobody', () => {
    expect(stopIsKnockable(stop([]))).toBe(false)
  })
})

// The short marker and the paper instruction are the same decision at two
// densities, and four surfaces read them — so the precedence and the wording
// are asserted here rather than through each one.
describe('flag markers', () => {
  it('leaves a knockable resident unmarked', () => {
    expect(targetMarker(target('unknown'))).toBeNull()
    expect(skipInstruction(target('unknown'))).toBeNull()
  })

  it('reuses the CRM feed vocabulary for the two reasons', () => {
    expect(
      targetMarker({ ...target('unknown'), notAVoterReason: 'moved' }),
    ).toBe('Moved away')
    expect(
      targetMarker({ ...target('unknown'), notAVoterReason: 'deceased' }),
    ).toBe('Deceased')
  })

  // Do-not-knock is an instruction about the door, so it outranks a reason
  // about one of the people behind it.
  it('shows do-not-knock ahead of a reason', () => {
    const both = {
      ...target('unknown', true),
      notAVoterReason: 'moved' as const,
    }
    expect(targetMarker(both)).toBe('Do not knock')
    expect(skipInstruction(both)).toBe('Do not knock — skip this door')
  })
})

// Two things in this feature print a mark on top of a fixed fill: the stop
// numeral on its status circle and the tick inside a chosen list-colour swatch.
// Both are read at arm's length, outdoors, in daylight — so the bar is WCAG AA
// for normal text, and the assertion is the ratio itself rather than "returns
// white for dark". Written as a sweep over both palettes, so a colour added to
// either one without checking its ink fails here and not on a doorstep.
describe('ink on a coloured fill', () => {
  // WCAG 2.1's contrast ratio, written out here rather than imported from the
  // module under test: the point is to check the module's answer against the
  // spec, and a shared helper would let one wrong constant agree with itself.
  const luminance = (hex: string): number => {
    const value = hex.replace('#', '')
    const channel = (offset: number) => {
      const raw = parseInt(value.slice(offset, offset + 2), 16) / 255
      return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
  }

  const contrast = (foreground: string, background: string): number => {
    const first = luminance(foreground)
    const second = luminance(background)
    const lighter = Math.max(first, second)
    const darker = Math.min(first, second)
    return (lighter + 0.05) / (darker + 0.05)
  }

  it('reads at AA on every knock status', () => {
    for (const [status, rgb] of Object.entries(STATUS_RGB)) {
      const fill = `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`
      expect(contrast(readableInkOn(rgb), fill), status).toBeGreaterThanOrEqual(
        4.5,
      )
    }
  })

  // The regression this guards: a hardcoded white tick, which failed on four of
  // these eight — the mark meant to make the choice legible being the one thing
  // on the swatch that isn't.
  it('reads at AA on every list colour', () => {
    for (const color of TURF_COLORS) {
      expect(
        contrast(turfColorTick(color), color),
        color,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('answers the same question of a hex string and a triple', () => {
    expect(readableInkOnHex('#ffffff')).toBe(readableInkOn([255, 255, 255]))
    expect(readableInkOnHex('#000000')).toBe(readableInkOn([0, 0, 0]))
  })
})
