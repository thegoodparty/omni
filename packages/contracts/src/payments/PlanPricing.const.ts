export const PLAN_PRICING = {
  proCents: 29900,
  teamCents: 39900,
  includedCreditCents: 17500,
  teamRecommendVoterThreshold: 10000,
  accessDaysAfterElection: 14,
  refundWindowDays: 14,
} as const

// Team invites are gated from this date on. Set at launch.
export const TEAM_GATE_START = '2026-12-01T00:00:00.000Z'
