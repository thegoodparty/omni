import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export const getPositionByBrIdParamsSchema = z.object({
  brPositionId: z.string().min(1, 'BallotReady Position ID is required'),
})

export const getPositionByIdParamsSchema = z.object({
  id: z.guid('Position ID must be a valid UUID'),
})

export class GetPositionByIdParamsDTO extends createZodDto(
  getPositionByIdParamsSchema,
) {}

export const getPositionByBrIdQuerySchema = z.object({
  includeDistrict: z.coerce.boolean().optional(),
  includeFilingFee: z.preprocess(
    (val) =>
      val === 'true' || val === '1' || val === true
        ? true
        : val === 'false' || val === '0' || val === false
          ? false
          : undefined,
    z.boolean().optional().default(false),
  ),
  electionDate: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (val === undefined) return true
        return !isNaN(new Date(val).getTime())
      },
      {
        message: 'Invalid date string',
      },
    ),
})

export const getPositionByBrIdRequestSchema = z.object({
  params: getPositionByBrIdParamsSchema,
  query: getPositionByBrIdQuerySchema,
})

export class GetPositionByBrIdQueryDTO extends createZodDto(
  getPositionByBrIdQuerySchema,
) {}
export class GetPositionByBrIdParamsDTO extends createZodDto(
  getPositionByBrIdParamsSchema,
) {}
