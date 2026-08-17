import type {
  DoorKnockingRoutePayload,
  RoutePayloadStop,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'

// Shared by the row-model tests and the rendered-PDF tests, so both are
// asserting against the same route rather than two hand-built ones that drift.
export const target = (
  overrides: Partial<RoutePayloadTarget> = {},
): RoutePayloadTarget => ({
  stopTargetId: 21,
  personId: 'person-1',
  name: 'Dorian Fen',
  age: 31,
  politicalParty: 'Independent',
  // Carried deliberately: the sheet and the PDF both omit phone numbers, and
  // a fixture with none would let the omission pass by accident.
  cellPhone: '(312) 555-0101',
  landline: null,
  knockStatus: 'unknown',
  mayHaveMoved: false,
  doNotKnock: false,
  ...overrides,
})

export const stop = (
  overrides: Partial<RoutePayloadStop> = {},
): RoutePayloadStop => ({
  id: 11,
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
      targets: [target()],
      otherResidents: [],
    },
  ],
  ...overrides,
})

export const payload = (
  stops: RoutePayloadStop[],
): DoorKnockingRoutePayload => ({
  route: {
    id: 5,
    doorKnockingTurfId: 3,
    mode: 'walk',
    loop: true,
    totalSeconds: 1860,
    totalMeters: 3218,
    stopCount: stops.length,
    createdAt: new Date('2026-07-21T00:00:00Z'),
  },
  pathGeometry: null,
  stops,
})
