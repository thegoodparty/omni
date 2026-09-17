import { STATE_CODES } from '@goodparty_org/nest-common'
import { z } from 'zod'
import { ElectionCode } from '../generated/prisma'
import { createZodDto } from 'nestjs-zod'

const ElectionEnum = z.nativeEnum(ElectionCode)

const projectedTurnoutUniqueSchema = z
  .object({
    districtId: z.guid().optional(),
    state: z
      .string()
      .transform((v) => v.toUpperCase())
      .refine((v) => STATE_CODES.includes(v), 'Invalid state code')
      .optional(),
    L2DistrictType: z.string().optional(),
    L2DistrictName: z.string().optional(),
    electionYear: z.preprocess((val) => Number(val), z.number()).optional(),
    electionDate: z.string().refine((val) => !isNaN(new Date(val).getTime()), {
      message: 'Invalid date string',
    }),
    electionCode: ElectionEnum.optional(),
  })
  .refine(
    (data) =>
      data.districtId ||
      (data.state && data.L2DistrictType && data.L2DistrictName),
    {
      message:
        'Either districtId or (state, L2DistrictType, L2DistrictName) is required',
    },
  )
  .refine((data) => data.electionCode || data.electionDate, {
    message: 'Either electionCode or electionDate is required',
    path: ['electionCode'],
  })

export class ProjectedTurnoutUniqueDTO extends createZodDto(
  projectedTurnoutUniqueSchema,
) {}
