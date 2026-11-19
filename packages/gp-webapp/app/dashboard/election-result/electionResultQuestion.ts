import { weeksTill } from 'helpers/dateHelper'
import type { Campaign } from 'helpers/types'

export const electionDateOf = (
  campaign: Campaign | null | undefined,
): string | undefined => {
  const goals =
    campaign && 'goals' in campaign && typeof campaign.goals === 'object'
      ? campaign.goals
      : null
  const goalsElectionDate =
    goals && 'electionDate' in goals && typeof goals.electionDate === 'string'
      ? goals.electionDate
      : undefined
  return campaign?.details?.electionDate || goalsElectionDate
}

// From the day after election day until the candidate says how it went. The
// election result page and the campaign manager chat both ask while this
// holds, and whichever is answered first saves `wonGeneral` for both.
export const isElectionResultPending = (
  campaign: Campaign | null | undefined,
): boolean => {
  if (!campaign || typeof campaign.details?.wonGeneral === 'boolean') {
    return false
  }
  const weeks = weeksTill(electionDateOf(campaign))
  return !!weeks && typeof weeks === 'object' && weeks.weeks < 0
}
