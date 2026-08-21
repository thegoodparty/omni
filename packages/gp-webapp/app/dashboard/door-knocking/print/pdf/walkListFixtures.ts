import type {
  DoorKnockingRoutePayload,
  RoutePayloadStop,
  RoutePayloadTarget,
  RouteTargetActivity,
} from '@goodparty_org/contracts'

// ADR 0009's per-resident history, as the paper surfaces read it. The default
// date is mid-month so it names the same month in UTC and in every US zone —
// the one test that cares about the boundary passes its own.
export const doorKnock = (
  overrides: Partial<
    Extract<RouteTargetActivity, { type: 'DOOR_KNOCK' }>['data']
  > = {},
  date = '2026-06-12T18:00:00.000Z',
): RouteTargetActivity => ({
  type: 'DOOR_KNOCK',
  date,
  data: {
    activityId: 'dk-1',
    outcome: 'answered',
    supportAnswer: 'unsure',
    note: null,
    manual: false,
    ...overrides,
  },
})

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
  // Carried for the same reason, and it matters more here. The eleven-attribute
  // demographic profile rides the route payload for `PersonSheet` and is
  // deliberately absent from both paper surfaces — paper leaves the building
  // and stops being access-controlled when it does, which is the argument that
  // already keeps phone numbers off these pages and applies with more force to
  // a profile of a named voter. Every value below is distinctive enough that a
  // renderer leaking it fails a test rather than passing quietly.
  registeredVoter: true,
  turnoutLikelihood: 'Super',
  maritalStatus: 'Likely Married',
  hasChildrenUnder18: 'Yes',
  veteranStatus: 'Yes',
  homeowner: 'Likely',
  businessOwner: 'Yes',
  levelOfEducation: 'Graduate Degree',
  estimatedIncomeAmount: 82000,
  language: 'Spanish',
  ethnicityGroup: 'Hispanic',
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
