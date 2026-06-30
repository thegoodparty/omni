import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { zCoerceDate } from '@goodparty_org/contracts'

export class GetWebsiteViewsSchema extends createZodDto(
  z
    .object({
      startDate: zCoerceDate().optional(),
      endDate: zCoerceDate().optional(),
    })
    .refine(
      (data) => {
        if (data.startDate && data.endDate) {
          return data.endDate > data.startDate
        }
        return true // Allow if either date is missing
      },
      {
        message: 'endDate must be after startDate',
        path: ['endDate'], // Shows error on endDate field
      },
    ),
) {}
