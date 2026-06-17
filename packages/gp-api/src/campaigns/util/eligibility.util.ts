import { isAfter, isValid } from 'date-fns'
import { OrganizationStatus } from '@goodparty_org/contracts'
import { getMidnightForDate, parseIsoDateAsUTC } from '@/shared/util/date.util'
import { Campaign, ElectedOffice } from '../../generated/prisma'

// The single active-campaign / held-office predicate. EligibilityService and
// the org-list status decoration both import these so the two paths can never
// diverge — duplicating the logic is the Epic's stated top correctness risk.

export const isActiveCampaign = (campaign: Campaign, now: Date): boolean => {
  if (campaign.isDemo) return false
  // A primary loss ends the race even though didWin stays null and the general
  // electionDate is still in the future — mirrors the webapp's electionOver
  // (usePostElectionState). A primary win leaves the campaign active until the
  // general concludes via the didWin / electionDate checks below.
  if (campaign.primaryResult === 'lost') return false
  const electionDate = campaign.details?.electionDate
  if (!electionDate) return false
  const parsed = parseIsoDateAsUTC(electionDate)
  if (!isValid(parsed)) return false
  // electionDate is a calendar date (UTC midnight); the campaign stays active
  // through the whole election day, so compare UTC calendar days rather than
  // the parsed instant — date-fns endOfDay is local-time and would flip the
  // boundary on non-UTC servers.
  return campaign.didWin === null && !isAfter(getMidnightForDate(now), parsed)
}

export const isHeldOffice = (office: ElectedOffice, now: Date): boolean =>
  office.isActive &&
  (office.termEndDate === null || isAfter(office.termEndDate, now))

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
