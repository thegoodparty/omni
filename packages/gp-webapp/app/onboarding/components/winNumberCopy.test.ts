import { describe, expect, it } from 'vitest'
import {
  planVotesCast,
  planWinGoal,
  resolveSeatContext,
  votesProjectedInRace,
  votesProjectedStepDescription,
  winNumberHeroLead,
  winNumberModalIntro,
  winNumberModalLead,
  winNumberPlanSource,
  winNumberShareClause,
  winNumberStepDescription,
} from './winNumberCopy'

// Real 2026 general races from the design mockup: turnout is the production
// model's projection, and the win number is election-api's floor(T / 2) + 1.
const BURBANK = { projectedTurnout: 35914, winNumber: 17958, numberOfSeats: 3 }
const INVER_GROVE = {
  projectedTurnout: 18279,
  winNumber: 9140,
  numberOfSeats: 2,
}
const JEFFERSONTOWN = {
  projectedTurnout: 11328,
  winNumber: 5665,
  numberOfSeats: 8,
}

describe('resolveSeatContext', () => {
  it('is multi-seat when the race fills more than 1 seat', () => {
    expect(resolveSeatContext(BURBANK)).toEqual({ kind: 'multi', seats: 3 })
  })

  it('is single-seat when the race fills 1 seat', () => {
    expect(
      resolveSeatContext({
        projectedTurnout: 3874,
        winNumber: 1938,
        numberOfSeats: 1,
      }),
    ).toEqual({ kind: 'single' })
  })

  it.each([null, undefined, 0, 2.5])(
    'is unknown when the seat count is %s',
    (numberOfSeats) => {
      expect(resolveSeatContext({ ...BURBANK, numberOfSeats })).toEqual({
        kind: 'unknown',
      })
    },
  )

  it('is unknown when the win number is an archived civics number', () => {
    expect(resolveSeatContext({ ...BURBANK, winNumber: 17000 })).toEqual({
      kind: 'unknown',
    })
  })

  it('is unknown without a turnout projection', () => {
    expect(
      resolveSeatContext({
        projectedTurnout: 0,
        winNumber: 0,
        numberOfSeats: 3,
      }),
    ).toEqual({ kind: 'unknown' })
  })
})

describe('votesProjectedInRace', () => {
  it('matches the mockup for each sample race', () => {
    expect(votesProjectedInRace(BURBANK.projectedTurnout, 3)).toBe(71828)
    expect(votesProjectedInRace(INVER_GROVE.projectedTurnout, 2)).toBe(27417)
    expect(votesProjectedInRace(JEFFERSONTOWN.projectedTurnout, 8)).toBe(50976)
  })

  // The relationship the card states: step 3 divided by (seats + 1), plus 1,
  // is exactly step 4, for odd and even turnout alike.
  it.each([
    [35914, 3],
    [18279, 2],
    [9101, 6],
    [11328, 8],
    [7, 12],
  ])('reproduces the win number for turnout %i, %i seats', (turnout, seats) => {
    const winNumber = Math.floor(turnout / 2) + 1
    expect(votesProjectedInRace(turnout, seats) / (seats + 1) + 1).toBe(
      winNumber,
    )
  })
})

describe('card copy', () => {
  it('leads the hero sentence into the office name', () => {
    expect(winNumberHeroLead({ kind: 'multi', seats: 3 })).toBe(
      'Projected votes to win 1 of 3 available seats on the ',
    )
    expect(winNumberHeroLead({ kind: 'single' })).toBe(
      'Projected votes to win the race for ',
    )
    expect(winNumberHeroLead({ kind: 'unknown' })).toBe(
      'Projected votes to win the race for ',
    )
  })

  it('explains the votes projected in a multi-seat race', () => {
    expect(votesProjectedStepDescription(3, 71828)).toBe(
      'There are 3 seats available, so each voter can pick up to 3 candidates, casting roughly 71,828 votes between them.',
    )
  })

  it.each([
    [2, '33.3%'],
    [3, '25.0%'],
    [8, '11.1%'],
  ])('explains the win number for %i seats as %s', (seats, share) => {
    expect(winNumberStepDescription({ kind: 'multi', seats })).toBe(
      `Enough to finish in the top ${seats}. Races this size can be won with ${share} of the votes cast.`,
    )
  })

  it('explains the win number for a single seat', () => {
    expect(winNumberStepDescription({ kind: 'single' })).toBe(
      'There is 1 seat, so you need more than half of the votes cast.',
    )
  })

  it('makes no seat claim when seats are unknown', () => {
    expect(winNumberStepDescription({ kind: 'unknown' })).toBe(
      'Based on the voters we expect to cast a ballot in your race.',
    )
  })
})

describe('plan and pop-up copy', () => {
  it('describes the win number by seat context', () => {
    expect(winNumberShareClause({ kind: 'multi', seats: 3 })).toBe(
      'enough to finish in the top 3',
    )
    expect(winNumberShareClause({ kind: 'single' })).toBe(
      'more than half of the votes cast',
    )
    expect(winNumberShareClause({ kind: 'unknown' })).toBeNull()
  })

  it('fills the plan metrics source for every seat context', () => {
    expect(winNumberPlanSource({ kind: 'multi', seats: 3 })).toBe(
      'Projecting enough votes to finish in the top 3.',
    )
    expect(winNumberPlanSource({ kind: 'single' })).toBe(
      'Projecting more than half of the votes cast.',
    )
    expect(winNumberPlanSource({ kind: 'unknown' })).toBe(
      'Projecting from the voters we expect to cast a ballot.',
    )
  })

  it('names the seats in the pop-up only when there are several', () => {
    expect(winNumberModalIntro({ kind: 'multi', seats: 3 })).toBe(
      'This is how many votes you need to win 1 of 3 seats.',
    )
    expect(winNumberModalIntro({ kind: 'single' })).toBe(
      'This is how many votes you need to win the race.',
    )
    expect(winNumberModalLead({ kind: 'multi', seats: 3 })).toBe(
      'To win 1 of 3 seats',
    )
    expect(winNumberModalLead({ kind: 'unknown' })).toBe('To win')
  })

  it('leads the plan summary with votes cast, or turnout when seats are unknown', () => {
    expect(planVotesCast({ kind: 'multi', seats: 3 }, 6042)).toBe(12084)
    expect(planVotesCast({ kind: 'single' }, 6042)).toBe(6042)
    expect(planVotesCast({ kind: 'unknown' }, 6042)).toBeNull()
  })

  it('states the plan goal by seat context', () => {
    expect(planWinGoal({ kind: 'multi', seats: 3 })).toBe(
      'to secure a finish in the top 3',
    )
    expect(planWinGoal({ kind: 'single' })).toBe('you need to win the race')
    expect(planWinGoal({ kind: 'unknown' })).toBe(
      'you need to win your election',
    )
  })
})
