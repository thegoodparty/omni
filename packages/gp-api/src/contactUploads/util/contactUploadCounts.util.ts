import {
  ContactUploadMatchMethod,
  ContactUploadMatchOutcome,
} from '@/generated/prisma'

export type ContactUploadOutcomeGroup = {
  outcome: ContactUploadMatchOutcome
  isNewPerson: boolean
  method: ContactUploadMatchMethod | null
  hasChangedFields: boolean
  count: number
}

export type ContactUploadCounts = {
  matchedCount: number
  newCount: number
  needsInputCount: number
  skippedCount: number
  invalidCount: number
  updatedCount: number
  unchangedCount: number
}

export const countsFromOutcomeGroups = (
  groups: ContactUploadOutcomeGroup[],
): ContactUploadCounts => {
  const count = (test: (group: ContactUploadOutcomeGroup) => boolean): number =>
    groups.filter(test).reduce((sum, group) => sum + group.count, 0)
  return {
    matchedCount: count(
      (g) =>
        g.outcome === ContactUploadMatchOutcome.matched ||
        (g.outcome === ContactUploadMatchOutcome.resolved && !g.isNewPerson),
    ),
    newCount: count(
      (g) =>
        g.outcome === ContactUploadMatchOutcome.new ||
        (g.outcome === ContactUploadMatchOutcome.resolved && g.isNewPerson),
    ),
    needsInputCount: count(
      (g) => g.outcome === ContactUploadMatchOutcome.needs_input,
    ),
    skippedCount: count((g) => g.outcome === ContactUploadMatchOutcome.skipped),
    invalidCount: count((g) => g.outcome === ContactUploadMatchOutcome.invalid),
    updatedCount: count((g) => g.hasChangedFields),
    unchangedCount: count(
      (g) =>
        g.method === ContactUploadMatchMethod.prior_upload &&
        !g.hasChangedFields,
    ),
  }
}
