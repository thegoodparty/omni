/**
 * A privacy takedown on a public /people profile. Keyed by the canonical civics
 * personId rather than a user, because the subject usually has no GoodParty
 * account at all — the page is programmatic SEO built from the civics spine.
 *
 * A takedown is ACTIVE while `clearedAt` is null. Reverting one sets
 * `clearedAt`/`clearedBy` instead of deleting the record, so the history of a
 * request usually made under privacy law survives the revert.
 */
export type PersonProfileRemoval = {
  personId: string
  note: string | null
  requestedAt: string
  appliedBy: string
  clearedAt: string | null
  clearedBy: string | null
}

export type ListPersonProfileRemovalsOptions = {
  /** Include reverted takedowns (the audit trail). Defaults to active only. */
  includeCleared?: boolean
}

/**
 * `appliedBy`/`clearedBy` identify the human or system responsible. gp-api sees
 * only a shared M2M token on these routes, so it cannot derive the operator —
 * the caller must name itself, and gp-api rejects a write that does not. Use an
 * email for a person, `system:<name>` for automation.
 */
export type SetPersonProfileRemovalInput = {
  personId: string
  appliedBy: string
  note?: string | null
}

export type ClearPersonProfileRemovalInput = {
  personId: string
  clearedBy: string
}

export type SetPersonProfileRemovalOutput = {
  personId: string
  removed: true
}

export type ClearPersonProfileRemovalOutput = {
  personId: string
  removed: false
}

/**
 * Identity for a confirmation step: enough to recognise the subject of a
 * takedown before submitting it, and nothing more.
 */
export type PersonLookupResult = {
  personId: string
  fullName: string | null
  state: string | null
  office: string | null
}
