import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { P2P_SCRIPT_MAX_LENGTH } from '@goodparty_org/contracts'
import { OutreachStatus, OutreachType } from '../../generated/prisma'
import { isValid, parseISO } from 'date-fns'

export class CreateOutreachSchema extends createZodDto(
  z
    .object({
      campaignId: z.coerce.number().int().positive(),
      outreachType: z.nativeEnum(OutreachType),
      projectId: z.string().optional(),
      name: z.string().optional(),
      status: z
        .nativeEnum(OutreachStatus)
        .optional()
        .default(OutreachStatus.pending),
      error: z.string().optional(),
      audienceRequest: z.string().optional(),
      script: z.string().optional(),
      message: z.string().optional(),
      date: z.string().datetime({ offset: true }).optional(),
      imageUrl: z.string().url().optional(),
      voterFileFilterId: z.coerce.number().int().positive().optional(),
      phoneListId: z.coerce.number().int().positive().optional(),
      // P2P-specific fields
      didState: z
        .string()
        .regex(
          /^([A-Z]{2}|USA)$/,
          'didState must be a 2-letter US state code or "USA"',
        )
        .optional(),
      didNpaSubset: z
        .array(z.string().regex(/^\d{3}$/, 'Each area code must be 3 digits'))
        .max(50, 'didNpaSubset cannot exceed 50 area codes')
        .optional(),
      title: z.string().optional(),
      campaignPlanDueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'campaignPlanDueDate must be YYYY-MM-DD')
        .refine(
          (s) => isValid(parseISO(s)),
          'campaignPlanDueDate must be a valid calendar date',
        )
        .optional(),
      // Metadata for the CAS Slack message, persisted so a payment-webhook
      // finalize can rebuild the notification after the request is gone.
      textCount: z.coerce.number().int().nonnegative().optional(),
      billableTextCount: z.coerce.number().int().nonnegative().optional(),
      // z.coerce.boolean() treats the multipart string 'false' as true, so
      // string values need an explicit transform.
      draft: z
        .union([
          z.boolean(),
          z.enum(['true', 'false']).transform((v) => v === 'true'),
        ])
        .optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
      if (data.outreachType === OutreachType.p2p && !data.phoneListId) {
        ctx.addIssue({
          path: ['phoneListId'],
          code: z.ZodIssueCode.custom,
          message: 'Phone list ID is required for P2P outreach',
        })
      }
      if (data.outreachType === OutreachType.p2p && !data.script) {
        ctx.addIssue({
          path: ['script'],
          code: z.ZodIssueCode.custom,
          message: 'Script is required for P2P outreach',
        })
      }
      // The script field may hold an aiContent key rather than the script
      // itself; the resolved text is re-checked in OutreachService.
      if (
        data.outreachType === OutreachType.p2p &&
        data.script &&
        data.script.length > P2P_SCRIPT_MAX_LENGTH
      ) {
        ctx.addIssue({
          path: ['script'],
          code: z.ZodIssueCode.custom,
          message:
            `Script cannot exceed ${P2P_SCRIPT_MAX_LENGTH} characters ` +
            'for P2P outreach',
        })
      }
      if (data.draft && data.outreachType !== OutreachType.p2p) {
        ctx.addIssue({
          path: ['draft'],
          code: z.ZodIssueCode.custom,
          message: 'Draft creation is only supported for P2P outreach',
        })
      }
      if (data.status === OutreachStatus.pending_payment) {
        ctx.addIssue({
          path: ['status'],
          code: z.ZodIssueCode.custom,
          message: 'pending_payment is set by the draft flow, not the client',
        })
      }
      if (data.outreachType === OutreachType.nativeDoorKnocking) {
        ctx.addIssue({
          path: ['outreachType'],
          code: z.ZodIssueCode.custom,
          message:
            'nativeDoorKnocking outreach is created only by the knock ' +
            'transaction, not the client',
        })
      }
    }),
) {}
