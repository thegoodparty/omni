import { createZodDto } from 'nestjs-zod'
import { STATE_CODES } from '@goodparty_org/nest-common'
import { toUpper } from 'src/shared/util/strings.util'
import { z } from 'zod'
import { Prisma } from '../generated/prisma'

export const officeHolderColumns = Object.values(
  Prisma.OfficeHolderScalarFieldEnum,
) as (keyof typeof Prisma.OfficeHolderScalarFieldEnum)[]

export const officeHolderFilterSchema = z
  .object({
    personId: z.guid('personId must be a valid UUID').optional(),
    positionId: z.guid('positionId must be a valid UUID').optional(),
    state: z
      .preprocess(toUpper, z.string())
      .optional()
      .refine((val) => {
        if (!val) return true
        return STATE_CODES.includes(val)
      }, 'Invalid state code'),
    isCurrent: z.coerce.boolean().optional(),
    includePosition: z.coerce.boolean().optional().default(false),
    columns: z
      .string()
      .optional()
      .refine(
        (val) => {
          if (!val) return true
          const columns = val.split(',').map((col) => col.trim())
          return columns.every((col) =>
            officeHolderColumns.includes(
              col as keyof typeof Prisma.OfficeHolderScalarFieldEnum,
            ),
          )
        },
        {
          message: `Invalid officeHolder column provided. Allowed columns are: ${officeHolderColumns.join(', ')}`,
        },
      ),
  })
  .strict()

export class OfficeHolderFilterDto extends createZodDto(
  officeHolderFilterSchema,
) {}
