import type { RecommendedListVariant } from '@goodparty_org/contracts'

// What a hub tile hands the flow it opens: the audience the candidate arrived
// with. A saved list (`?listId=`) or a recommendation not yet saved
// (`?recommended=`), never both — the voter data page sends whichever the
// card resolves to.
export interface AudiencePreselect {
  listId?: number
  recommendedVariant?: RecommendedListVariant
}
