import { POOLED_VALUE } from './censusWeighting.util'

// Up to this many tracts, the model reads each tract on its own. Past it the
// tracts group into areas: a group is named only at MAJOR_GROUP_SHARE (3%)
// of the district, which no tract reaches past about 33 equal ones, and
// every tract is a parameter of a fit whose cost grows with their cube.
export const MAX_TRACTS_READ_ALONE = 60

// A county past this share of the district's adults is split into runs of
// tracts about this size, so each piece holds MAJOR_GROUP_SHARE and can be
// named. A county under it stays whole.
export const AREA_SHARE = 1 / 30

// A county under this share of the district's adults joins the pooled
// area: it still weights the model, but is never named.
export const MIN_COUNTY_AREA_SHARE = 0.01

// A tract GEOID's first five digits are its state and county FIPS.
const COUNTY_GEOID_LENGTH = 5

// Each tract's area in a district past MAX_TRACTS_READ_ALONE tracts, or
// null for a district read by tract. `tractAdults` is the people per tract
// the areas are sized by. An area is a county ('37119'), a run of a large
// county's tracts in GEOID order ('37119:2'), or POOLED_VALUE, so the same
// tracts always give the same areas and an area turns back into its tracts.
export const tractAreas = (
  tractAdults: Map<string, number>,
): Map<string, string> | null => {
  if (tractAdults.size <= MAX_TRACTS_READ_ALONE) return null
  let total = 0
  const counties = new Map<string, Array<[string, number]>>()
  for (const [tract, adults] of tractAdults) {
    total += adults
    const county = tract.slice(0, COUNTY_GEOID_LENGTH)
    const held = counties.get(county) ?? []
    held.push([tract, adults])
    counties.set(county, held)
  }
  const areas = new Map<string, string>()
  for (const [county, tracts] of counties) {
    const adults = tracts.reduce((sum, [, count]) => sum + count, 0)
    const share = adults / total
    const pieces = Math.floor(share / AREA_SHARE)
    if (share < MIN_COUNTY_AREA_SHARE || pieces < 2) {
      const area = share < MIN_COUNTY_AREA_SHARE ? POOLED_VALUE : county
      for (const [tract] of tracts) areas.set(tract, area)
      continue
    }
    let before = 0
    for (const [tract, count] of tracts.sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const middle = (before + count / 2) / adults
      areas.set(tract, `${county}:${Math.floor(middle * pieces) + 1}`)
      before += count
    }
  }
  return areas
}
