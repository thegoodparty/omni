import { createHmac } from 'crypto'
import { UnauthorizedException } from '@nestjs/common'

// Shared between PeerlyP2pMockController (issues the token via POST
// /token-auth) and Peerly10DlcMockController (verifies it on every route).
// The secret is the contract between the two mock controllers — it must
// match what signHs256Jwt in the P2P controller signs with.
export const PEERLY_MOCK_JWT_SECRET = 'peerly-mock-secret-2026'

// Verify an HS256 JWT from the Authorization header. Throws 401 if the
// header is missing, the token is malformed, the signature is wrong, or
// the token is expired. The real PeerlyHttpService sends `JWT <token>`
// (not `Bearer`) so we check for that prefix.
export const verifyPeerlyMockJwt = (authHeader: string | undefined): void => {
  if (!authHeader?.startsWith('JWT ')) throw new UnauthorizedException()
  const token = authHeader.slice(4)
  const parts = token.split('.')
  if (parts.length !== 3) throw new UnauthorizedException()
  const header = parts[0] ?? ''
  const body = parts[1] ?? ''
  const sig = parts[2] ?? ''
  const expected = createHmac('sha256', PEERLY_MOCK_JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url')
  if (sig !== expected) throw new UnauthorizedException()
  let exp: number | undefined
  try {
    const raw: unknown = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    )
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const obj = raw as Record<string, unknown>
      if (typeof obj['exp'] === 'number') {
        exp = obj['exp']
      }
    }
  } catch {
    throw new UnauthorizedException()
  }
  const nowSec = Math.floor(Date.now() / 1000)
  if (!exp || exp <= nowSec) throw new UnauthorizedException()
}
