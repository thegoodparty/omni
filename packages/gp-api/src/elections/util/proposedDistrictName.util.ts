export const PROPOSED_DISTRICT_TYPE = 'Proposed_District'
export const US_CONGRESSIONAL_DISTRICT_TYPE = 'US_Congressional_District'

// L2 packs proposed congressional maps, MI's proposed state senate and local
// annexations into one Proposed_District column, so the CONG DIST token is
// what separates a routable district from one that must never bind.
const PROPOSED_CONGRESSIONAL_NAME = /^\d{4} PROPOSED CONG DIST (\d+)\b/i

export const parseProposedCongressionalNumber = (
  l2DistrictName: string,
): number | null => {
  const captured = PROPOSED_CONGRESSIONAL_NAME.exec(l2DistrictName.trim())?.[1]
  return captured === undefined ? null : Number(captured)
}
