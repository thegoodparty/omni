import { IncomingRequest } from '@/authentication/authentication.types'

// Structural rather than the full `IncomingRequest` so callers holding a
// differently-typed view of the same request — e.g. a `FastifyRequest` needed
// for transport fields like `ip` — can still resolve the acting user.
type WithIdentities = Pick<IncomingRequest, 'user' | 'actorUser'>

export const effectiveUser = (req: WithIdentities) => req.actorUser ?? req.user
