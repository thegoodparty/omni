import { z } from 'zod'
import { EmailSchema } from '../shared/Email.schema'
import { ReadUserOutputSchema } from './ReadUserOutput.schema'

export const ChangeUserEmailInputSchema = z
  .object({ email: EmailSchema })
  .strict()

export type ChangeUserEmailInput = z.infer<typeof ChangeUserEmailInputSchema>

export const CRM_EMAIL_SYNC_STATUS = {
  UPDATED: 'updated',
  CONFLICT: 'conflict',
  NO_CONTACT: 'no_contact',
  SKIPPED: 'skipped',
  FAILED: 'failed',
} as const

export const CrmEmailSyncSchema = z.object({
  status: z.enum([
    CRM_EMAIL_SYNC_STATUS.UPDATED,
    CRM_EMAIL_SYNC_STATUS.CONFLICT,
    CRM_EMAIL_SYNC_STATUS.NO_CONTACT,
    CRM_EMAIL_SYNC_STATUS.SKIPPED,
    CRM_EMAIL_SYNC_STATUS.FAILED,
  ]),
  contactId: z.string().optional(),
  conflictingContactId: z.string().optional(),
  previousEmailKept: z.boolean().optional(),
})

export type CrmEmailSync = z.infer<typeof CrmEmailSyncSchema>

export const ChangeUserEmailOutputSchema = z.object({
  user: ReadUserOutputSchema,
  crm: CrmEmailSyncSchema,
})

export type ChangeUserEmailOutput = z.infer<typeof ChangeUserEmailOutputSchema>
