import { describe, expect, it } from 'vitest'
import {
  ContactUploadMatchMethod,
  ContactUploadMatchOutcome,
} from '@/generated/prisma'
import {
  type ContactUploadOutcomeGroup,
  countsFromOutcomeGroups,
} from './contactUploadCounts.util'

const group = (
  outcome: ContactUploadMatchOutcome,
  count: number,
  overrides: Partial<ContactUploadOutcomeGroup> = {},
): ContactUploadOutcomeGroup => ({
  outcome,
  isNewPerson: false,
  method: null,
  hasChangedFields: false,
  count,
  ...overrides,
})

describe('countsFromOutcomeGroups', () => {
  it('is all zeros for no rows', () => {
    expect(countsFromOutcomeGroups([])).toEqual({
      matchedCount: 0,
      newCount: 0,
      needsInputCount: 0,
      skippedCount: 0,
      invalidCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
    })
  })

  it('splits resolved rows by person kind and counts the re-import summary', () => {
    expect(
      countsFromOutcomeGroups([
        group(ContactUploadMatchOutcome.matched, 4, {
          method: ContactUploadMatchMethod.name_and_phone,
        }),
        group(ContactUploadMatchOutcome.matched, 3, {
          method: ContactUploadMatchMethod.prior_upload,
          isNewPerson: true,
          hasChangedFields: true,
        }),
        group(ContactUploadMatchOutcome.matched, 2, {
          method: ContactUploadMatchMethod.prior_upload,
        }),
        group(ContactUploadMatchOutcome.new, 5, { isNewPerson: true }),
        group(ContactUploadMatchOutcome.resolved, 6, {
          method: ContactUploadMatchMethod.manual,
        }),
        group(ContactUploadMatchOutcome.resolved, 7, {
          method: ContactUploadMatchMethod.manual,
          isNewPerson: true,
        }),
        group(ContactUploadMatchOutcome.needs_input, 8),
        group(ContactUploadMatchOutcome.skipped, 9, {
          method: ContactUploadMatchMethod.manual,
        }),
        group(ContactUploadMatchOutcome.invalid, 10),
        group(ContactUploadMatchOutcome.pending, 11),
      ]),
    ).toEqual({
      matchedCount: 15,
      newCount: 12,
      needsInputCount: 8,
      skippedCount: 9,
      invalidCount: 10,
      updatedCount: 3,
      unchangedCount: 2,
    })
  })

  it('counts a Databricks match that changed a value as updated, never unchanged', () => {
    expect(
      countsFromOutcomeGroups([
        group(ContactUploadMatchOutcome.matched, 2, {
          method: ContactUploadMatchMethod.name_and_address,
          hasChangedFields: true,
        }),
        group(ContactUploadMatchOutcome.matched, 1, {
          method: ContactUploadMatchMethod.name_and_address,
        }),
      ]),
    ).toMatchObject({ matchedCount: 3, updatedCount: 2, unchangedCount: 0 })
  })
})
