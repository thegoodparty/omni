import {
  INCOME_KEY_TO_RANGE,
  LANGUAGE_KEY_TO_CODE,
} from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import type { SegmentResponse } from 'app/dashboard/contacts/crm/shared/contacts-types'

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
  return keys
}
