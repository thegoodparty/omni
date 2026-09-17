import type { VoterFileFilter } from '../generated/prisma'
import {
  convertVoterFileFilterToFilters,
  type FilterObject,
} from '../contacts/utils/voterFileFilter.utils'

// supportStatus and activityConditions resolve outside
// convertVoterFileFilterToFilters (SupportStatusService and the
// activity-condition resolution engine), so this loosens their strict
// enum-array types to plain strings — the comparison below reads them
// straight off the row instead of through the converted payload.
// activityConditions also isn't part of VoterFileFilter's scalar type at
// all (it's a relation), so it's added fresh rather than overridden.
interface ActivityConditionFields {
  outreachType?: string
  outreachId?: number | null
  actions?: string[]
}

type DedupeFilter = Omit<Partial<VoterFileFilter>, 'supportStatus'> & {
  supportStatus?: string[]
  activityConditions?: ActivityConditionFields[]
}

export interface SavedDedupeFilter extends DedupeFilter {
  id: number
}

type FilterValue = FilterObject[string]

const sortedJoin = (values: readonly (string | number)[]): string =>
  [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(',')

const canonicalizeFilterValue = (value: FilterValue): string => {
  if (typeof value === 'boolean') return String(value)
  const or = value._or
    ?.map((range) => `${range.gte ?? ''}-${range.lte ?? ''}`)
    .sort()
    .join('|')
  return [
    value.in === undefined ? '' : sortedJoin(value.in),
    value.notIn === undefined ? '' : sortedJoin(value.notIn),
    value.eq ?? '',
    value.gte ?? '',
    value.lte ?? '',
    value.is ?? '',
    value._includeNull ?? '',
    or ?? '',
  ].join(':')
}

// Deep-compares the converted payload without relying on JSON.stringify's
// key-insertion-order sensitivity — two payloads built from differently
// ordered source objects must still canonicalize identically.
const canonicalizePayload = (payload: FilterObject): string =>
  Object.entries(payload)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${canonicalizeFilterValue(value)}`)
    .join(';')

const CONTACTS_MADE_FIELDS = [
  'contactsMade0',
  'contactsMade1',
  'contactsMade2',
  'contactsMade3',
  'contactsMade4',
  'contactsMade5Plus',
] as const

// Resolved by ContactsMadeResolutionService — voterFileFilter.utils.ts
// drops these booleans without ever emitting a filter key for them, so the
// payload comparison above can't see a difference here.
const contactsMadeSignature = (filter: DedupeFilter): string =>
  CONTACTS_MADE_FIELDS.filter((field) => filter[field]).join(',')

// Excluded outright from the payload (voterFileFilter.utils.ts
// excludeFields); resolved by SupportStatusService instead.
const supportStatusSignature = (filter: DedupeFilter): string =>
  sortedJoin(filter.supportStatus ?? [])

// Resolved by the activity-condition resolution engine, never entering the
// payload — compare the raw conditions instead. A condition's own
// `actions` is an unordered OR-within-condition set, and the list of
// conditions itself is unordered (AND-across, but membership not order).
const activityConditionsSignature = (filter: DedupeFilter): string =>
  (filter.activityConditions ?? [])
    .map((condition) => {
      const actions = sortedJoin(condition.actions ?? [])
      const outreachId = condition.outreachId ?? ''
      return `${condition.outreachType ?? ''}|${outreachId}|${actions}`
    })
    .sort()
    .join(';')

// supportStatus and activityConditions carry types the converter doesn't
// accept (see the DedupeFilter comment above); it also excludes both keys
// outright, so dropping them here changes nothing about the payload it
// produces.
const OFF_PAYLOAD_KEYS = new Set(['supportStatus', 'activityConditions'])

const toConvertibleFilter = (filter: DedupeFilter): Partial<VoterFileFilter> =>
  Object.fromEntries(
    Object.entries(filter).filter(([key]) => !OFF_PAYLOAD_KEYS.has(key)),
  ) as Partial<VoterFileFilter>

const filtersAreEquivalent = (
  candidate: DedupeFilter,
  saved: DedupeFilter,
): boolean =>
  canonicalizePayload(
    convertVoterFileFilterToFilters(toConvertibleFilter(candidate)),
  ) ===
    canonicalizePayload(
      convertVoterFileFilterToFilters(toConvertibleFilter(saved)),
    ) &&
  supportStatusSignature(candidate) === supportStatusSignature(saved) &&
  contactsMadeSignature(candidate) === contactsMadeSignature(saved) &&
  activityConditionsSignature(candidate) === activityConditionsSignature(saved)

// Returns the id of a saved filter equivalent to `candidate`, or null when
// the organization has no matching list yet. Equality compares the
// normalized filter payload (what a filter actually queries) rather than
// the raw row, so a null and a false on the same dimension collapse
// together instead of registering as a difference.
export const findEquivalentFilter = (
  candidate: DedupeFilter,
  savedFilters: SavedDedupeFilter[],
): number | null =>
  savedFilters.find((saved) => filtersAreEquivalent(candidate, saved))?.id ??
  null
