import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'
import {
  OrganizationRoleSchema,
  OutreachStatusSchema,
  OutreachTypeSchema,
} from '../generated/enums'
import { PhoneBankingOutreachDetailSchema } from '../phoneBanking/PhoneBankingList.schema'
import { DoorKnockingOutreachDetailSchema } from '../doorKnocking/DoorKnockingTurf.schema'

// One assignee on an outreach: the response to both GET
// /outreach/:id/assignments and POST /outreach/:id/assignments. Response
// source is always the persisted row/membership, never the request body —
// assign is idempotent and may return an existing row.
export const OutreachAssigneeSchema = z.object({
  userId: z.number(),
  name: z.string().nullable(),
  role: OrganizationRoleSchema,
  createdAt: zCoerceDate(),
  assignedByUserId: z.number().nullable(),
  assignedByName: z.string().nullable(),
})
export type OutreachAssignee = z.infer<typeof OutreachAssigneeSchema>

export const OutreachAssigneesResponseSchema = z.object({
  assignees: z.array(OutreachAssigneeSchema),
})
export type OutreachAssigneesResponse = z.infer<
  typeof OutreachAssigneesResponseSchema
>

// One row of GET /outreach/assignments/mine — enough to render an
// assignment card without a second detail fetch. Only nativePhoneBanking /
// nativeDoorKnocking rows carry a channel-pointer + progress block; every
// other assignable outreachType has neither.
export const MyAssignmentSchema = z.object({
  outreachId: z.number(),
  outreachType: OutreachTypeSchema,
  name: z.string().nullable(),
  status: OutreachStatusSchema.nullable(),
  assignedAt: zCoerceDate(),
  phoneBanking: PhoneBankingOutreachDetailSchema.optional(),
  doorKnocking: DoorKnockingOutreachDetailSchema.optional(),
})
export type MyAssignment = z.infer<typeof MyAssignmentSchema>

export const MyAssignmentsResponseSchema = z.object({
  assignments: z.array(MyAssignmentSchema),
})
export type MyAssignmentsResponse = z.infer<typeof MyAssignmentsResponseSchema>
