import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'
import { ZDateOnly } from 'src/shared/schemas/DateOnly.schema'

export const ZDateOnlyOptional = ZDateOnly.optional()

export const ZDateOnlyNullOptional = ZDateOnly.nullable().optional()

const ZDateTimeNullOptional = z.coerce.date().nullable().optional()

// The serve-onboarding step checkpoint. Mirrors the frontend ServeStepId union
// (serveOnboardingConfig.ts); kept here as a literal enum so the backend
// validates the persisted checkpoint is a known step rather than an arbitrary
// string. Stored as a nullable column — null means "no checkpoint yet".
export const SERVE_ONBOARDING_STEPS = [
  'welcome',
  'inOffice',
  'party',
  'office',
  'term-dates',
  'confirm',
  'constituents',
  'pledge',
] as const
const ZServeOnboardingStep = z
  .enum(SERVE_ONBOARDING_STEPS)
  .nullable()
  .optional()

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
  // Marks that the holder self-reported their office/term via the net-new serve
  // onboarding flow (vs a sales/BallotReady prefill). Used by resume to keep a
  // net-new lead in the net-new branch deterministically; see electedOffice.prisma.
  selfReported: z.boolean().optional(),
  // Resume checkpoint: the furthest onboarding step the holder reached, written
  // on every "Continue" so resume routes to the exact step. See electedOffice.prisma.
  onboardingStep: ZServeOnboardingStep,
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
