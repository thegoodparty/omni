import {
  INCOME_KEY_TO_RANGE,
  LANGUAGE_KEY_TO_CODE,
  type VoterFileFilters,
} from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import type { SegmentResponse } from 'app/dashboard/contacts/crm/shared/contacts-types'
import type { ActivityConditionInput } from 'app/dashboard/contacts/crm/shared/activityConditionOptions'

// The three ways a saved list narrows that the voter pack has no plane for at
// all. This is a harder gap than 65+'s: there the pack holds an `age` dim and
// only lacks the bucket, whereas nothing in the pack encodes support status,
// prior outreach activity or precinct, under any mapping.
//
// gp-api applies all three at knock time — `resolveSavedFilterForQuery` adds
// the support/activity id clauses that `convertVoterFileFilterToFilters` drops,
// and that same converter turns `precincts` into a `precinct` filter — so a
// list cut by one of them targets far fewer people than the map can shade.
//
// They are carried as their own keys rather than dropped, because dropping
// them is what let a 256-person persuasion list preview as the whole district
// with nothing on screen saying why: `unpreviewableFilterKeys` can only
// disclose a key it was handed. Nothing maps them onto a dim, so the preview
// arithmetic is unchanged — they narrow nothing and are disclosed instead.
export const UNSHADEABLE_LIST_CRITERIA = [
  'supportStatus',
  'activityConditions',
  'precincts',
] as const

type UnshadeableListCriterion = (typeof UNSHADEABLE_LIST_CRITERIA)[number]

const criterionValues = (
  list: SegmentResponse | undefined,
  criterion: UnshadeableListCriterion,
): unknown[] => {
  const value = list?.[criterion]
  return Array.isArray(value) ? value : []
}

// A saved list's own selections, as the boolean option keys the pack preview
// speaks. The backend stores income and language as string arrays rather than
// booleans, so both have to be re-expanded or a scoped preview silently
// ignores those filters.
//
// Shared rather than per-surface: the landing scope, the details drawer and
// the knock dialog's travel-mode suggestion all describe the SAME saved list,
// and a second re-expansion is a second chance for one of them to disagree
// about which filters a list carries. `undefined` yields `{}` here, which
// every consumer reads as "no filters at all" — so resolve the list before
// calling this, never after.
export const savedListFilterKeys = (
  list: SegmentResponse | undefined,
): Record<string, boolean> => {
  const keys = Object.fromEntries(
    Object.entries(list ?? {}).filter(
      ([, value]) => typeof value === 'boolean',
    ),
  ) as Record<string, boolean>
  const rangeToKey = Object.fromEntries(
    Object.entries(INCOME_KEY_TO_RANGE).map(([key, range]) => [range, key]),
  )
  for (const range of (list?.incomeRanges as string[] | undefined) ?? []) {
    const key = rangeToKey[range]
    if (key) keys[key] = true
  }
  const codeToKey = Object.fromEntries(
    Object.entries(LANGUAGE_KEY_TO_CODE).map(([key, code]) => [code, key]),
  )
  for (const code of (list?.languageCodes as string[] | undefined) ?? []) {
    const key = codeToKey[code]
    if (key) keys[key] = true
  }
  // A mark, not a selection: it says "this list narrows in a way the map
  // cannot draw", which is the whole of what the preview can know about it.
  // An empty array is not a criterion — marking one would disclose a filter
  // the list does not apply.
  for (const criterion of UNSHADEABLE_LIST_CRITERIA) {
    if (criterionValues(list, criterion).length > 0) keys[criterion] = true
  }
  return keys
}

// The same three criteria as values rather than marks, in the grammar
// `voterFilterBaseSchema` accepts, for the one caller that can do something
// exact with them: `POST /v1/door-knocking/address-preview` runs the knock's
// own resolution, so it narrows by these precisely where the pack cannot.
// Without them that endpoint answers for the whole district inside the ring
// and the draw step prints it as the count the route will be built from.
//
// Activity conditions come back as Prisma relation rows carrying `id`,
// `voterFileFilterId` and `createdAt`; the request grammar has no place for
// those, so only the three fields it names are sent.
export const savedListUnshadeableCriteria = (
  list: SegmentResponse | undefined,
): Record<string, unknown> => {
  const criteria: Record<string, unknown> = {}
  const supportStatus = criterionValues(list, 'supportStatus')
  if (supportStatus.length > 0) criteria.supportStatus = supportStatus
  const precincts = criterionValues(list, 'precincts')
  if (precincts.length > 0) criteria.precincts = precincts
  const conditions = criterionValues(
    list,
    'activityConditions',
  ) as ActivityConditionInput[]
  if (conditions.length > 0) {
    criteria.activityConditions = conditions.map(
      ({ outreachType, outreachId, actions }) => ({
        outreachType,
        outreachId,
        actions,
      }),
    )
  }
  return criteria
}

// Editing a pill leaves the named list behind, so the list's own clauses leave
// with it. Nothing can carry them onto the new list the flow then offers to
// save — `transformVoterFileFiltersForBackend` only speaks filter option keys
// — so a draft that kept the marks would disclose a filter that list will not
// apply, which is the same lie as the one this file exists to stop, pointing
// the other way.
export const withoutUnshadeableCriteria = (
  filters: VoterFileFilters,
): VoterFileFilters =>
  Object.fromEntries(
    Object.entries(filters).filter(
      ([key]) =>
        !(UNSHADEABLE_LIST_CRITERIA as readonly string[]).includes(key),
    ),
  )
