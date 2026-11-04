import { isAfter, isValid } from 'date-fns'
import { Campaign, ElectedOfficeWinSource } from '../../generated/prisma'
import { getMidnightForDate, parseIsoDateAsUTC } from '@/shared/util/date.util'

export type WinState =
  | { state: 'won'; source: ElectedOfficeWinSource }
  | { state: 'not_won' }
  | { state: 'unknown' }

type WinFields = Pick<Campaign, 'didWin' | 'details' | 'data'>

const hubSpotResult = (data: WinFields['data']): boolean | null => {
  const raw = data?.hubSpotUpdates?.election_results?.trim().toLowerCase()
  if (raw === 'won general') return true
  if (raw === 'lost general') return false
  return null
}

const isFutureElection = (electionDate: string | undefined, now: Date) => {
  if (!electionDate) return false
  const parsed = parseIsoDateAsUTC(electionDate)
  return isValid(parsed) && isAfter(parsed, getMidnightForDate(now))
}

/**
 * What a campaign's result says about the office its win created. The most
 * deliberate record wins: `didWin` (staff, or the data pipeline's DDHQ
 * write-back), then the candidate's own `details.wonGeneral`, then the
 * DDHQ-matched HubSpot `election_results`. HubSpot's value carries no race,
 * so with an election still ahead (a candidate running again, whose own
 * result `resetStaleElectionResults` cleared) it is the last race's and the
 * campaign has no win. The sweep reads the same rule in SQL
 * (winOffice.service.ts).
 */
export const campaignWinState = (
  campaign: WinFields,
  now: Date = new Date(),
): WinState => {
  const wonGeneral = campaign.details?.wonGeneral
  const [result, source] =
    campaign.didWin !== null
      ? [campaign.didWin, ElectedOfficeWinSource.ddhq]
      : typeof wonGeneral === 'boolean'
        ? [wonGeneral, ElectedOfficeWinSource.self_reported]
        : isFutureElection(campaign.details?.electionDate, now)
          ? [false, ElectedOfficeWinSource.ddhq]
          : [hubSpotResult(campaign.data), ElectedOfficeWinSource.ddhq]
  if (result === null) return { state: 'unknown' }
  return result ? { state: 'won', source } : { state: 'not_won' }
}

export type ServeParty =
  | 'independent'
  | 'nonpartisan'
  | 'democratic'
  | 'republican'

// Same mapping as the webapp's Pro handoff (app/serve/onboarding/winParty.ts),
// so an office the server creates for a win matches one the client creates.
export const servePartyFromCampaign = (
  details: Pick<PrismaJson.CampaignDetails, 'party' | 'otherParty'>,
): ServeParty | undefined => {
  const named = details.party?.trim()
  const raw =
    !named || named.toLowerCase() === 'other'
      ? details.otherParty?.trim()
      : named
  const party = raw?.toLowerCase().replace(/[^a-z]/g, '')
  if (!party) return undefined
  if (party === 'nonpartisan') return 'nonpartisan'
  if (party.startsWith('democrat')) return 'democratic'
  if (party.startsWith('republican')) return 'republican'
  return 'independent'
}
