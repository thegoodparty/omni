import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { resolveEnvVar } from '@/shared/env/env'

export const UNSUBSCRIBE_SIGNING_KEY_ENV = 'EMAIL_UNSUBSCRIBE_SIGNING_KEY'

const TokenPayloadSchema = z.object({
  email: z.string().min(1),
  organizationSlug: z.string().min(1),
  outreachEmailId: z.number().int(),
  issuedAt: z.number().int(),
})
export type UnsubscribeTokenPayload = z.infer<typeof TokenPayloadSchema>

export const unsubscribeSigningKey = (): string | null => {
  const state = resolveEnvVar(UNSUBSCRIBE_SIGNING_KEY_ENV)
  return state.configured ? state.value : null
}

const sign = (key: string, body: string): string =>
  createHmac('sha256', key).update(body).digest('base64url')

// Self-contained and never expiring, so a link in an old email still works
// after its send or recipient rows are gone.
export const signUnsubscribeToken = (
  key: string,
  payload: UnsubscribeTokenPayload,
): string => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(key, body)}`
}

export const verifyUnsubscribeToken = (
  key: string,
  token: string,
): UnsubscribeTokenPayload | null => {
  const [body, signature, ...rest] = token.split('.')
  if (!body || !signature || rest.length > 0) return null
  const expected = Buffer.from(sign(key, body))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null
  }
  // A signed body is ours, so it always parses; this only guards a key
  // that was reused for something else.
  try {
    const decoded = Buffer.from(body, 'base64url').toString('utf8')
    const parsed = TokenPayloadSchema.safeParse(JSON.parse(decoded))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
