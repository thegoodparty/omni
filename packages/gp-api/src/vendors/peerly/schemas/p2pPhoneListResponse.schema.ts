import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export class P2pPhoneListResponseSchema extends createZodDto(
  z.object({
    // Null when the kill-switched async build path accepted the request but
    // hasn't built/uploaded yet — the caller polls the buildId status route
    // for the token once the build reaches Peerly. Every existing caller
    // (the webapp, the token-status route) still gets a non-null token
    // unchanged while the switch is off.
    token: z.string().nullable(),
    // The PeerlyPhoneList row id — the build-status handle. Additive
    // alongside `token`, which every existing caller (the webapp, the
    // token-status route) still depends on unchanged.
    buildId: z.string(),
  }),
) {}
