import {
  RECOMMENDED_LIST_VARIANT_VALUES,
  type RecommendedListVariant,
} from '@goodparty_org/contracts'

// `?recommended=<variant>` off the voter data page's recommended cards. Same
// stance as parsePositiveListId: anything the registry does not know is
// ignored, so a stale or invented value costs the preselection and nothing
// more. Shared by the outreach hub's and door knocking's server pages.
export const parseRecommendedListVariant = (
  raw: string | null | undefined,
): RecommendedListVariant | undefined =>
  RECOMMENDED_LIST_VARIANT_VALUES.includes(raw as RecommendedListVariant)
    ? (raw as RecommendedListVariant)
    : undefined
