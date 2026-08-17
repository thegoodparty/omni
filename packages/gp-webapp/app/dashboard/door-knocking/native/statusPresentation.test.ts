import { describe, expect, it } from 'vitest'
import {
  DoorKnockStatus,
  RoutePayloadStop,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'
import {
  rollupStopStatus,
  skipInstruction,
  targetMarker,
} from './statusPresentation'

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
  knockStatus: 'unknown',
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

  // ADR 0008 makes the same claim as 0007 about this rollup, and gp-api's serve
  // service says the webapp's rollup drops both fields — it now does.
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
