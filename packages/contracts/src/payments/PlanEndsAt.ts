import { PLAN_PRICING } from './PlanPricing.const'

const MS_PER_DAY = 24 * 60 * 60 * 1000

// A bare date string ('2026-11-03') parses as UTC midnight; one with a time
// part keeps its own offset. Either way the instant is not shifted by the
// reader's timezone, so Eastern users don't see the end date move a day.
const parseElectionDate = (value: string): Date | null => {
  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value,
  )
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

// When a campaign's plan access ends: the staff override, else the election
// date plus the access window. Null when neither exists, so a campaign with no
// election date never expires on its own.
export const planEndsAt = (campaign: {
  planEndsAtOverride?: Date | string | null
  details?: { electionDate?: string | null } | null
}): Date | null => {
  if (campaign.planEndsAtOverride) return new Date(campaign.planEndsAtOverride)
  const electionDate = campaign.details?.electionDate
  if (!electionDate) return null
  const election = parseElectionDate(electionDate)
  if (!election) return null
  return new Date(
    election.getTime() + PLAN_PRICING.accessDaysAfterElection * MS_PER_DAY,
  )
}
