import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export class SubscribeEmailSchema extends createZodDto(
  z.object({
    email: z.string().email(),
    name: z.string().optional(),
    uri: z.string().url(),
    // HubSpot form GUIDs are UUIDs. Constrain the format so this unauthenticated
    // value can't inject into the `…/submit/${portal}/${formId}` path. The
    // previously unvalidated `additionalFields` blob was dropped — it had no
    // caller and let an anonymous request push arbitrary fields to the CRM
    // (CWE-20).
    formId: z.string().uuid().optional(),
    pageName: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    phone: z.string().optional(),
  }),
) {}
