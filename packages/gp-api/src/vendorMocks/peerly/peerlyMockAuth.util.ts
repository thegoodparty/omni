import { UnauthorizedException } from '@nestjs/common'
import { createHmac, timingSafeEqual } from 'crypto'
import { getUnixTime } from 'date-fns'

const MOCK_JWT_SECRET = 'peerly-mock-secret-2026'

const signature = (signingInput: string): string =>
  createHmac('sha256', MOCK_JWT_SECRET).update(signingInput).digest('base64url')

// HS256 JWT using only Node's built-in crypto — no external JWT library.
// PeerlyHttpService decodes the `exp` claim, so the token must be a real JWT.
export const signHs256Jwt = (
  payload: Record<string, number | string>,
): string => {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.${signature(`${header}.${body}`)}`
}

const isUnexpired = (body: string): boolean => {
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    )
    return (
      typeof claims === 'object' &&
      claims !== null &&
      'exp' in claims &&
      typeof claims.exp === 'number' &&
      claims.exp > getUnixTime(new Date())
    )
  } catch {
    return false
  }
}

// Peerly takes `Authorization: JWT <token>` (PeerlyHttpService sends exactly
// that). Rejects anything not minted by this mock's token-auth route.
export const assertValidMockJwt = (authorization: string | undefined): void => {
  const token = /^JWT (\S+)$/i.exec(authorization ?? '')?.[1]
  const [header, body, sig] = token?.split('.') ?? []
  if (!header || !body || !sig) throw new UnauthorizedException()
  const expected = Buffer.from(signature(`${header}.${body}`))
  const actual = Buffer.from(sig)
  if (
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual) ||
    !isUnexpired(body)
  ) {
    throw new UnauthorizedException()
  }
}
