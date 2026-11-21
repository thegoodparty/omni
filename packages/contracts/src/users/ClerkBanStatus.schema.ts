import { z } from 'zod'

export const IMPERSONATION_TARGET_BANNED_ERROR_CODE = 'TARGET_USER_BANNED'

export const ClerkBanStatusSchema = z.object({
  banned: z.boolean(),
})

export type ClerkBanStatus = z.infer<typeof ClerkBanStatusSchema>
