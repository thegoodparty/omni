/**
 * The place an office serves, as Serve copy names it ("Know what Fayetteville
 * thinks"), from the district's L2 name. Shared so gp-api's drafts and the
 * webapp's cards name the same place.
 *
 * Handles known patterns:
 *   "Fayetteville Ward 4"          → "Fayetteville"
 *   "Kyle District 3"              → "Kyle"
 *   "City of Kyle"                 → "Kyle"
 *   "Town of Chapel Hill"          → "Chapel Hill"
 *   "Fayetteville"                 → "Fayetteville"  (already clean)
 *   "Pocatello City (Est.)"        → "Pocatello"
 *   "North Port City (Est.)"       → "North Port"
 *   "West Mifflin Boro"            → "West Mifflin"
 *   "Alvin City Cncl D"            → "Alvin"
 *   "Dubuque City Ward 3"          → "Dubuque"
 *
 * Returns null if the result is empty or looks like a non-city name.
 */
export const cityFromDistrictName = (districtName: string): string | null => {
  let name = districtName.trim()

  // Strip leading "City of", "Town of", "Village of", "Borough of"
  name = name.replace(/^(City|Town|Village|Borough|Township)\s+of\s+/i, '')

  // Strip trailing parenthetical qualifiers: "(Est.)", "(Ind.)", "(Pt.)", etc.
  name = name.replace(/\s*\([^)]*\)\.?\s*$/i, '')

  // Strip trailing abbreviated council/district suffixes before ward/district stripping:
  // "Cncl D", "Cncl Dist", "Council D", "Council Dist"
  name = name.replace(/\s+Cncl\s*(D(ist)?\.?)?\s*$/i, '')
  name = name.replace(/\s+Council\s+D(ist)?\.?\s*$/i, '')

  // Strip trailing ward/district/precinct suffixes: "Ward 4", "District 3", "Precinct 2A"
  name = name.replace(
    /\s+(Ward|District|Precinct|Division|At-Large)\s*[\w-]*$/i,
    '',
  )

  // Strip trailing municipality type: "Johnstown City" → "Johnstown"
  // Includes "Boro" as a short form of "Borough"
  name = name.replace(/\s+(City|Town|Village|Borough|Boro|Township)$/i, '')

  name = name.trim()

  // Reject if empty or looks non-city (pure number, single char, etc.)
  if (!name || name.length < 2 || /^\d+$/.test(name)) return null

  return name
}

const LOWERCASE_WORDS = new Set(['of', 'on', 'the'])

const capitalizePart = (part: string): string => {
  const lower = part.toLowerCase()
  const apostrophe = /^([od])['’](.+)$/.exec(lower)
  if (apostrophe) {
    const [, prefix, rest] = apostrophe
    return `${prefix.toUpperCase()}'${capitalizePart(rest)}`
  }
  if (/^mc[a-z]/.test(lower)) {
    return `Mc${lower.charAt(2).toUpperCase()}${lower.slice(3)}`
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/**
 * Title-cases a place name that arrives in ALL CAPS ("WINSTON-SALEM" →
 * "Winston-Salem", "MCALLEN" → "McAllen", "O'FALLON" → "O'Fallon"). A name
 * with any lowercase letter is left alone, since its casing was chosen.
 */
export const cityNameCase = (name: string): string => {
  if (!/[A-Z]/.test(name) || /[a-z]/.test(name)) return name
  return name
    .split(' ')
    .map((word, index) => {
      const lower = word.toLowerCase()
      if (index > 0 && LOWERCASE_WORDS.has(lower)) return lower
      return word.split('-').map(capitalizePart).join('-')
    })
    .join(' ')
}
