import { numberFormatter } from 'helpers/numberHelper'

// Seat-aware wording for the win number, shared by the onboarding path to
// victory card, the campaign plan (page and PDF) and the dashboard's "how we
// calculate this number" pop-up so they can't drift apart.
//
// election-api computes the win number as floor(turnout / 2) + 1 whatever the
// seat count. Seats change the explanation, not the number: a candidate in a
// 3-seat race doesn't need half the votes cast, they need enough to finish in
// the top 3.

export type SeatContext =
  | { kind: 'multi'; seats: number }
  | { kind: 'single' }
  | { kind: 'unknown' }

interface SeatContextInput {
  numberOfSeats: number | null | undefined
  winNumber: number
  projectedTurnout: number
}

// `unknown` covers the two cases where seat-aware wording would be wrong: the
// race has no seat count (about 16% of races), and the win number is an
// archived civics number rather than floor(turnout / 2) + 1, so the steps
// wouldn't add up to it.
export const resolveSeatContext = ({
  numberOfSeats,
  winNumber,
  projectedTurnout,
}: SeatContextInput): SeatContext => {
  const isTurnoutDerived =
    projectedTurnout > 0 && winNumber === Math.floor(projectedTurnout / 2) + 1
  if (
    !isTurnoutDerived ||
    typeof numberOfSeats !== 'number' ||
    !Number.isInteger(numberOfSeats) ||
    numberOfSeats < 1
  ) {
    return { kind: 'unknown' }
  }
  return numberOfSeats === 1
    ? { kind: 'single' }
    : { kind: 'multi', seats: numberOfSeats }
}

// Each voter can back up to `seats` candidates. Built from the same
// floor(turnout / 2) as the win number, so this divided by (seats + 1), plus
// 1, is exactly the win number.
export const votesProjectedInRace = (
  projectedTurnout: number,
  seats: number,
): number => Math.floor(projectedTurnout / 2) * (seats + 1)

// The card's hero sentence leads into the office name, which it sets in bold.
export const winNumberHeroLead = (seatContext: SeatContext): string =>
  seatContext.kind === 'multi'
    ? `Projected votes to win 1 of ${seatContext.seats} available seats on the `
    : 'Projected votes to win the race for '

export const VOTES_PROJECTED_STEP_TITLE = 'Votes projected in your race'

export const votesProjectedStepDescription = (
  seats: number,
  votesProjected: number,
): string =>
  `There are ${seats} seats available, so each voter can pick up to ${seats} candidates, casting roughly ${numberFormatter(votesProjected)} votes between them.`

export const winNumberStepDescription = (seatContext: SeatContext): string => {
  switch (seatContext.kind) {
    case 'multi':
      return `Enough to finish in the top ${seatContext.seats}. Races this size can be won with ${(100 / (seatContext.seats + 1)).toFixed(1)}% of the votes cast.`
    case 'single':
      return 'There is 1 seat, so you need more than half of the votes cast.'
    case 'unknown':
      return 'Based on the voters we expect to cast a ballot in your race.'
  }
}

// Follows the win number in prose ("17,958 votes, enough to finish in the top
// 3"). Null when the seat count is unknown, so the sentence ends at "votes".
export const winNumberShareClause = (
  seatContext: SeatContext,
): string | null => {
  switch (seatContext.kind) {
    case 'multi':
      return `enough to finish in the top ${seatContext.seats}`
    case 'single':
      return 'more than half of the votes cast'
    case 'unknown':
      return null
  }
}

// Source column of the campaign plan's metrics table.
export const winNumberPlanSource = (seatContext: SeatContext): string => {
  switch (seatContext.kind) {
    case 'multi':
      return `Projecting enough votes to finish in the top ${seatContext.seats}.`
    case 'single':
      return 'Projecting more than half of the votes cast.'
    case 'unknown':
      return 'Projecting from the voters we expect to cast a ballot.'
  }
}

// The campaign plan's "Projected Votes Needed to Win" summary leads with the
// votes cast in the race rather than turnout, so it never has to explain how
// voters become votes. Null when seats are unknown: the summary then falls
// back to turnout. One voter casts one vote in a single-seat race.
export const planVotesCast = (
  seatContext: SeatContext,
  projectedTurnout: number,
): number | null => {
  switch (seatContext.kind) {
    case 'multi':
      return votesProjectedInRace(projectedTurnout, seatContext.seats)
    case 'single':
      return projectedTurnout
    case 'unknown':
      return null
  }
}

// Completes "This is the lowest amount of votes we project ...".
export const planWinGoal = (seatContext: SeatContext): string => {
  switch (seatContext.kind) {
    case 'multi':
      return `to secure a finish in the top ${seatContext.seats}`
    case 'single':
      return 'you need to win the race'
    case 'unknown':
      return 'you need to win your election'
  }
}

export const winNumberModalIntro = (seatContext: SeatContext): string =>
  seatContext.kind === 'multi'
    ? `This is how many votes you need to win 1 of ${seatContext.seats} seats.`
    : 'This is how many votes you need to win the race.'

export const winNumberModalLead = (seatContext: SeatContext): string =>
  seatContext.kind === 'multi'
    ? `To win 1 of ${seatContext.seats} seats`
    : 'To win'
