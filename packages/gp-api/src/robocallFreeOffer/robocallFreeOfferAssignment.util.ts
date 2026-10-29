import { formatInTimeZone } from 'date-fns-tz'
import {
  PRECINCT_ARMS,
  ROBOCALL_FREE_OFFER_ELECTION_DATE,
} from './robocallFreeOffer.consts'

export type PrecinctArm = (typeof PRECINCT_ARMS)[keyof typeof PRECINCT_ARMS]

export type NewPrecinctAssignment<Key> = {
  key: Key
  arm: PrecinctArm
  pTreatment: number
}

// Returns an integer in [0, max). Injected so tests can fix the draw.
export type RandomInt = (max: number) => number

// Draws without replacement, which is a uniform shuffle.
const shuffle = <T>(items: readonly T[], randomInt: RandomInt): T[] => {
  const pool = [...items]
  const out: T[] = []
  while (pool.length > 0) {
    out.push(...pool.splice(randomInt(pool.length), 1))
  }
  return out
}

const clamp = (value: number, max: number): number =>
  Math.max(0, Math.min(value, max))

// Splits a district's not-yet-assigned precincts so the district as a whole
// ends with round(N/2) treatment precincts, counting the ones an overlapping
// district already made treatment. An odd N goes up or down at random.
//
// pTreatment is each new row's marginal chance of treatment, averaged over
// the tie-break, so it is 0.5 in a fresh district and drifts from it only
// when earlier assignments left the district unbalanced. The readout weights
// by 1 / p, so it has to be the real probability, not the realized share.
export const assignPrecincts = <Key>(params: {
  totalKnown: number
  existingTreatment: number
  unassigned: readonly Key[]
  randomInt: RandomInt
}): NewPrecinctAssignment<Key>[] => {
  const { totalKnown, existingTreatment, unassigned, randomInt } = params
  if (unassigned.length === 0) return []

  const needLow = clamp(
    Math.floor(totalKnown / 2) - existingTreatment,
    unassigned.length,
  )
  const needHigh = clamp(
    Math.ceil(totalKnown / 2) - existingTreatment,
    unassigned.length,
  )
  const need = randomInt(2) === 0 ? needLow : needHigh
  const pTreatment = (needLow + needHigh) / 2 / unassigned.length

  return shuffle(unassigned, randomInt).map((key, index) => ({
    key,
    arm: index < need ? PRECINCT_ARMS.treatment : PRECINCT_ARMS.control,
    pTreatment,
  }))
}

// The offer ends once Election Day is over, on Eastern time. Injected `now`
// so tests can fix the clock.
export const isAfterOfferElection = (now: Date): boolean =>
  formatInTimeZone(now, 'America/New_York', 'yyyy-MM-dd') >
  ROBOCALL_FREE_OFFER_ELECTION_DATE
