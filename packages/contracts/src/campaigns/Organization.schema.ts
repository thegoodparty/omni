import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'
import { OrganizationStatusSchema } from './enums'

export const OrganizationSchema = z.object({
  createdAt: zCoerceDate(),
  updatedAt: zCoerceDate(),
  slug: z.string(),
  ownerId: z.number(),
  positionId: z.string().nullable(),
  overrideDistrictId: z.string().nullable(),
  customPositionName: z.string().nullable(),
})

export type Organization = z.infer<typeof OrganizationSchema>

export const OrganizationWithStatusSchema = OrganizationSchema.extend({
  status: OrganizationStatusSchema,
})

export type OrganizationWithStatus = z.infer<
  typeof OrganizationWithStatusSchema
>
