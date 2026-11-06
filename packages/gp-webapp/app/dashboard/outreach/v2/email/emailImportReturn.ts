import { z } from 'zod'

// Where the import's "Back to your email" leads. The flow opened from either
// picks up on the audience step with what was saved below.
export const WIN_EMAIL_IMPORT_RETURN = '/dashboard/outreach/email?imported=1'
export const SERVE_EMAIL_IMPORT_RETURN =
  '/dashboard/constituent-outreach?compose=email'

const EmailImportReturnSchema = z.object({
  goalId: z.string(),
  customGoal: z.string(),
  listId: z.number().int().positive().nullable(),
})

export type EmailImportReturnState = z.infer<typeof EmailImportReturnSchema>

const storageKey = (isServe: boolean): string =>
  `email-import-return:${isServe ? 'serve' : 'win'}`

// sessionStorage can throw (private windows, blocked site data); the flow
// then starts fresh, which is what it did before.
export const saveEmailImportReturn = (
  isServe: boolean,
  state: EmailImportReturnState,
): void => {
  try {
    sessionStorage.setItem(storageKey(isServe), JSON.stringify(state))
  } catch {
    // Unavailable: nothing to keep.
  }
}

export const readEmailImportReturn = (
  isServe: boolean,
): EmailImportReturnState | null => {
  try {
    const stored = sessionStorage.getItem(storageKey(isServe))
    if (!stored) return null
    const parsed = EmailImportReturnSchema.safeParse(JSON.parse(stored))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
