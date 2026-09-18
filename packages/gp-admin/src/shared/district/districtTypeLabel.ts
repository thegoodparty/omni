/**
 * L2's nationwide voter-file schema stores every state's lower chamber under the
 * single type `State_House_District`, because one schema cannot carry fifty
 * chamber names. Eight states do not call that chamber a House, so rendering the
 * raw type shows them an office name their state does not use.
 *
 * Product copy rule 4 (use their words, not ours): a California candidate runs
 * for the Assembly, not the State House.
 */

const LOWER_CHAMBER_TYPE = 'State_House_District'

// Keyed by state; every state absent from this map calls its lower chamber a
// House and needs no override.
const LOWER_CHAMBER_LABEL_BY_STATE: Record<string, string> = {
  CA: 'State Assembly District',
  NV: 'State Assembly District',
  NY: 'State Assembly District',
  WI: 'State Assembly District',
  NJ: 'General Assembly District',
  MD: 'House of Delegates District',
  VA: 'House of Delegates District',
  WV: 'House of Delegates District',
}

const humanize = (l2Type: string): string => l2Type.replace(/_/g, ' ')

/**
 * Human label for an L2 district type. Falls back to the underscore-humanized
 * type for every input this map does not cover, so an unmapped state, a missing
 * state, or any other district type renders exactly as it does today.
 */
export const districtTypeLabel = (
  l2Type: string | null | undefined,
  state?: string | null
): string => {
  if (!l2Type) return ''
  if (l2Type !== LOWER_CHAMBER_TYPE) return humanize(l2Type)
  return (
    LOWER_CHAMBER_LABEL_BY_STATE[(state ?? '').toUpperCase()] ??
    humanize(l2Type)
  )
}
