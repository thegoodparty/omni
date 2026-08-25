import { isAfter, isValid } from 'date-fns'
import { OrganizationStatus } from '@goodparty_org/contracts'
import { getMidnightForDate, parseIsoDateAsUTC } from '@/shared/util/date.util'
import { Campaign, ElectedOffice } from '../../generated/prisma'
import { deriveIsActive } from '@/electedOffice/util/electedOffice.util'

// The single active-campaign / held-office predicate. EligibilityService and
// the org-list status decoration both import these so the two paths can never
// diverge — duplicating the logic is the Epic's stated top correctness risk.

// electionDate is a calendar date (UTC midnight); the campaign stays active
// through the whole election day, so compare UTC calendar days rather than
// the parsed instant — date-fns endOfDay is local-time and would flip the
// boundary on non-UTC servers. (isDateTodayOrFuture in date.util is the
// LOCAL-midnight variant — not interchangeable with this.) Shared with the
// stale-result reset in CampaignsService.updateJsonFields so "counts as an
// upcoming election" can't drift between the two.
export const isUpcomingElectionDate = (
  electionDate: string,
  now: Date,
): boolean => {
  const parsed = parseIsoDateAsUTC(electionDate)
  if (!isValid(parsed)) return false
  return !isAfter(getMidnightForDate(now), parsed)
}

export const isActiveCampaign = (campaign: Campaign, now: Date): boolean => {
  if (campaign.isDemo) return false
  // A primary loss ends the race even though didWin stays null and the general
  // electionDate is still in the future — mirrors the webapp's electionOver
  // (usePostElectionState). A primary win leaves the campaign active until the
  // general concludes via the didWin / electionDate checks below.
  if (campaign.primaryResult === 'lost') return false
  const electionDate = campaign.details?.electionDate
  if (!electionDate) return false
  return campaign.didWin === null && isUpcomingElectionDate(electionDate, now)
}

// A held office is exactly an "active" office, and isActive is now derived
// purely from the term end date (the stored column was dropped). Terms are
// half-open [start, end): termEndDate is the exclusive boundary at which the
// successor takes over (BallotReady reports a 4-year term as e.g. 2020-01-01 →
// 2024-01-01), so the office is held while now < termEndDate. A null
// termEndDate means we lack term data, so it is not "held" until the holder
// supplies dates (the dashboard term-date modal prompts for them).
export const isHeldOffice = (office: ElectedOffice, now: Date): boolean =>
  deriveIsActive(office.termEndDate, now)

export const organizationStatus = (
  org: { campaign: Campaign | null; electedOffice: ElectedOffice | null },
  now: Date,
): OrganizationStatus => {
  if (org.campaign) {
    return isActiveCampaign(org.campaign, now) ? 'active' : 'past'
  }
  if (org.electedOffice) {
    return isHeldOffice(org.electedOffice, now) ? 'active' : 'past'
  }
  return 'past'
}
