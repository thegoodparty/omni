import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'
import { ZDateOnly } from 'src/shared/schemas/DateOnly.schema'

export const ZDateOnlyOptional = ZDateOnly.optional()

export const ZDateOnlyNullOptional = ZDateOnly.nullable().optional()

const ZDateTimeNullOptional = z.coerce.date().nullable().optional()

// isActive and termLengthDays are derived from the term dates at read time
// (the stored columns were dropped), so they are intentionally not writable.
const electedOfficeWritableFields = {
  swornInDate: ZDateOnlyNullOptional,
  electedDate: ZDateOnlyNullOptional,
  termStartDate: ZDateOnlyNullOptional,
  termEndDate: ZDateOnlyNullOptional,
  party: z.string().nullable().optional(),
  pledgedAt: ZDateTimeNullOptional,
  onboardingCompletedAt: ZDateTimeNullOptional,
}

/**
 * Cross-field guard: when both term bounds are present, the end must be
 * strictly after the start. This is the primary, caller-agnostic invariant —
 * the service additionally enforces the no-overlap rule against the user's
 * other offices. Each date is otherwise validated independently, so without
 * this an inverted or zero-length term would persist silently.
 */
const refineTermDates = (
  value: { termStartDate?: Date | null; termEndDate?: Date | null },
  ctx: z.RefinementCtx,
): void => {
  const { termStartDate, termEndDate } = value
  if (
    termStartDate instanceof Date &&
    termEndDate instanceof Date &&
    termEndDate.getTime() <= termStartDate.getTime()
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['termEndDate'],
      message: 'termEndDate must be after termStartDate',
    })
  }
}

export const CreateElectedOfficeSchema = z
  .object({
    ...electedOfficeWritableFields,
    // Office identity for campaign-less creation (no pre-existing organization).
    ballotReadyPositionId: z.string().nullable().optional(),
    customPositionName: z.string().nullable().optional(),
    overrideDistrictId: z.string().nullable().optional(),
  })
  .superRefine(refineTermDates)

export const UpdateElectedOfficeSchema = z
  .object({
    ...electedOfficeWritableFields,
  })
  .superRefine(refineTermDates)

export const SetElectedOfficeDistrictSchema = z.object({
  state: z.string(),
  L2DistrictType: z.string(),
  L2DistrictName: z.string(),
})

export class CreateElectedOfficeDto extends createZodDto(
  CreateElectedOfficeSchema,
) {}

export class UpdateElectedOfficeDto extends createZodDto(
  UpdateElectedOfficeSchema,
) {}

export class SetElectedOfficeDistrictDto extends createZodDto(
  SetElectedOfficeDistrictSchema,
) {}

export type CreateElectedOfficeInput = z.infer<typeof CreateElectedOfficeSchema>
export type UpdateElectedOfficeInput = z.infer<typeof UpdateElectedOfficeSchema>
export type SetElectedOfficeDistrictInput = z.infer<
  typeof SetElectedOfficeDistrictSchema
>
