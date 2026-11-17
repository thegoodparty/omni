import { differenceInCalendarDays } from 'date-fns'
import { toDateOnlyString } from '@/shared/util/date.util'
import { ElectedOffice, ElectedOfficeWinSource } from '../../generated/prisma'

/**
 * An office the prepared sweep built for an ever-Pro campaign that has
 * reached its election date with no result yet: it has no win, so no read may
 * show it and nothing may treat it as one. Finishing onboarding ends the
 * prepared state, and so does the result.
 */
export const isPreparedOffice = (office: {
  winSource: ElectedOfficeWinSource | null
  onboardingCompletedAt: Date | null
}): boolean =>
  office.winSource === ElectedOfficeWinSource.pending &&
  office.onboardingCompletedAt === null

/**
 * `isActive` is no longer stored — it is derived purely from the term end date.
 * Terms are half-open [start, end): the office is held while now < the exclusive
 * `termEndDate`. A null `termEndDate` means we don't yet have term data for the
 * office, so it is treated as inactive (the dashboard term-date modal prompts
 * the holder to supply dates, after which it becomes active again).
 */
export const deriveIsActive = (
  termEndDate: Date | null,
  now: Date = new Date(),
): boolean => termEndDate !== null && termEndDate.getTime() > now.getTime()

/**
 * `termLengthDays` is no longer stored — it is derived as the calendar-day span
 * between the term start and end. Null whenever either bound is missing.
 */
export const deriveTermLengthDays = (
  termStartDate: Date | null,
  termEndDate: Date | null,
): number | null =>
  termStartDate && termEndDate
    ? differenceInCalendarDays(termEndDate, termStartDate)
    : null

/**
 * Serialize an ElectedOffice row to the public API contract. `isActive` and
 * `termLengthDays` are emitted as DERIVED fields (the columns were dropped) so
 * existing consumers of the response shape keep working unchanged.
 */
export const electedOfficeToApi = (
  record: ElectedOffice,
  now: Date = new Date(),
) => ({
  id: record.id,
  organizationSlug: record.organizationSlug,
  swornInDate: toDateOnlyString(record.swornInDate) ?? null,
  electedDate: toDateOnlyString(record.electedDate) ?? null,
  termStartDate: toDateOnlyString(record.termStartDate) ?? null,
  termEndDate: toDateOnlyString(record.termEndDate) ?? null,
  termLengthDays: deriveTermLengthDays(
    record.termStartDate,
    record.termEndDate,
  ),
  isActive: deriveIsActive(record.termEndDate, now),
  party: record.party,
  pledgedAt: record.pledgedAt?.toISOString() ?? null,
  onboardingCompletedAt: record.onboardingCompletedAt?.toISOString() ?? null,
  selfReported: record.selfReported,
  onboardingStep: record.onboardingStep,
  userId: record.userId,
  campaignId: record.campaignId ?? null,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
})

export type ApiElectedOffice = ReturnType<typeof electedOfficeToApi>
