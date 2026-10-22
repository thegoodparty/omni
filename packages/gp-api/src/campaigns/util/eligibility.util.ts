import { isAfter, isValid } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import {
  OrganizationStatus,
  SmsComplianceWindow,
} from '@goodparty_org/contracts'
import {
  EASTERN_TIMEZONE,
  getMidnightForDate,
  parseIsoDateAsUTC,
  toDateOnlyString,
} from '@/shared/util/date.util'
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

export const SMS_CUTOFF_LEAD_DAYS = 19
export const SMS_CUTOFF_CLOSING_DAYS = 7
export const SMS_COMPLIANCE_CUTOFF_ERROR_CODE = 'SMS_COMPLIANCE_CUTOFF'

const DAY_MS = 24 * 60 * 60 * 1000

// A candidate "made the cutoff" when any of three facts holds: they filed AND
// paid (kickoffSentAt, stamped by the agentic claimAndEnqueueKickoff);
// internal-testing approvals never kick off, so they count as made; OR Peerly
// accepted their identity (peerlyIdentityId), which is self-evidence of
// "filed, paid, and Peerly accepted it" since submitCampaignVerifyRequest's
// idempotency guard requires both. The peerly check is what keeps legacy
// candidates — approved via POST /campaigns/tcr-compliance before the
// kickoffSentAt column shipped (2026-05-16, migration
// 20260516013651_add_tcr_compliance_kickoff_sent_at), so kickoffSentAt is NULL
// forever — from reading as "closed" at cutoff while they are actively
// sending through their live Peerly brand. A compliance record saved without
// payment and without a Peerly identity still does not count: that candidate
// gets the date-based window like anyone else.
export const smsComplianceWindow = ({
  electionDate,
  tcrCompliance,
  now,
}: {
  electionDate: string | null | undefined
  tcrCompliance: {
    kickoffSentAt: Date | null
    internalTestingAt?: Date | null
    peerlyIdentityId?: string | null
  } | null
  now: Date
}): {
  smsCompliance: SmsComplianceWindow
  smsCutoffDate: string | null
  generalElectionDate: string | null
} => {
  const parsed = electionDate ? parseIsoDateAsUTC(electionDate) : null
  const election = parsed && isValid(parsed) ? getMidnightForDate(parsed) : null
  const generalElectionDate = toDateOnlyString(election) ?? null
  const smsCutoffDate = election
    ? (toDateOnlyString(
        new Date(election.getTime() - SMS_CUTOFF_LEAD_DAYS * DAY_MS),
      ) ?? null)
    : null

  if (
    tcrCompliance?.kickoffSentAt ||
    tcrCompliance?.internalTestingAt ||
    tcrCompliance?.peerlyIdentityId
  ) {
    return {
      smsCompliance: 'not_applicable',
      smsCutoffDate,
      generalElectionDate,
    }
  }
  if (!election) {
    return { smsCompliance: 'open', smsCutoffDate, generalElectionDate }
  }

  // The cutoff day lasts until midnight Eastern, so "today" is the calendar
  // day in ET, set at UTC midnight to compare with the election date.
  const nowEt = toZonedTime(now, EASTERN_TIMEZONE)
  const today = Date.UTC(nowEt.getFullYear(), nowEt.getMonth(), nowEt.getDate())
  const daysToElection = Math.round((election.getTime() - today) / DAY_MS)
  const smsCompliance: SmsComplianceWindow =
    daysToElection < SMS_CUTOFF_LEAD_DAYS
      ? 'closed'
      : daysToElection < SMS_CUTOFF_LEAD_DAYS + SMS_CUTOFF_CLOSING_DAYS
        ? 'closing'
        : 'open'
  return { smsCompliance, smsCutoffDate, generalElectionDate }
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
