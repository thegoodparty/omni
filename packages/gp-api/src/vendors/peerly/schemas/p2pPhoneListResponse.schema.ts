import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export class P2pPhoneListResponseSchema extends createZodDto(
  z.object({
    token: z.string(),
    // The PeerlyPhoneList row id — the build-status handle. Additive
    // alongside `token`, which every existing caller (the webapp, the
    // token-status route) still depends on unchanged.
    buildId: z.string(),
  }),
) {}
