import { SegmentGroupTraits } from '@/vendors/segment/segment.types'

// Extracts the campaign-scoped facts that map onto a Segment group() keyed on
// the org slug. Shared by the campaign-details update path and follow-on
// creation so the two never drift; a falsy fact is omitted rather than sent.
export const toCampaignGroupTraits = (details: {
  city?: string | null
  electionDate?: string
  party?: string
}): SegmentGroupTraits => ({
  ...(details.city && { officeMunicipality: details.city }),
  ...(details.electionDate && { officeElectionDate: details.electionDate }),
  ...(details.party && { affiliation: details.party }),
})
