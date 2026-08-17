import { describe, expect, it } from 'vitest'
import {
  DoorKnockStatus,
  RoutePayloadStop,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'
import { rollupStopStatus } from './statusPresentation'

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
})
