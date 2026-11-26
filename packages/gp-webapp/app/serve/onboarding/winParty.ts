import { clientRequest } from 'gpApi/typed-request'
import { ORG_SLUG_HEADER } from '@shared/organizations/constants'

// A campaign's party as Serve onboarding's party step values. The campaign
// keeps whatever Win wrote: onboarding's lowercase values, the profile's
// labels ("Non-partisan", "Green Party"), or "Other" with the name in
// `otherParty`. A major party maps to its own option rather than to nothing:
// the party step still shows it and blocks Continue, since a record whose
// party is major never counts as answered on resume (see ServeOnboardingFlow).
export type ServeParty =
  | 'independent'
  | 'nonpartisan'
  | 'democratic'
  | 'republican'

export const servePartyFromCampaign = (
  details: { party?: string | null; otherParty?: string | null } | undefined,
): ServeParty | undefined => {
  const named = details?.party?.trim()
  const raw =
    !named || named.toLowerCase() === 'other'
      ? details?.otherParty?.trim()
      : named
  const party = raw?.toLowerCase().replace(/[^a-z]/g, '')
  if (!party) return undefined
  if (party === 'nonpartisan') return 'nonpartisan'
  if (party.startsWith('democrat')) return 'democratic'
  if (party.startsWith('republican')) return 'republican'
  return 'independent'
}

// An office from a win with no party of its own still has the campaign's.
// Best-effort: a miss leaves the party unknown.
export const campaignParty = async (office: {
  campaignId: number | null
}): Promise<ServeParty | undefined> => {
  if (office.campaignId == null) return undefined
  try {
    const res = await clientRequest(
      'GET /v1/campaigns/mine',
      {},
      {
        headers: { [ORG_SLUG_HEADER]: `campaign-${office.campaignId}` },
        ignoreResponseError: true,
      },
    )
    return res.ok ? servePartyFromCampaign(res.data.details) : undefined
  } catch {
    return undefined
  }
}
