import { z } from 'zod/v4'
import { SdkError } from '@goodparty_org/sdk'

// gp-api's nestjs-zod 400 body: { statusCode, message, errors: ZodIssue[] }
const apiErrorBodySchema = z.object({
  message: z.string().optional(),
  errors: z
    .array(
      z.object({
        path: z.array(z.union([z.string(), z.number()])),
        message: z.string(),
      })
    )
    .optional(),
})

export const extractApiErrorMessage = (
  error: unknown,
  fallback: string
): string => {
  if (!(error instanceof SdkError)) return fallback
  const parsed = apiErrorBodySchema.safeParse(error.body)
  if (!parsed.success) return fallback
  const { message, errors } = parsed.data
  const details = (errors ?? [])
    .map((issue) =>
      [issue.path.join('.'), issue.message].filter(Boolean).join(': ')
    )
    .join('; ')
  if (details) return message ? `${message}: ${details}` : details
  return message ?? fallback
}
