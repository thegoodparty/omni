import { DevEnvPackageSchema } from '@goodparty_org/contracts'
import { z } from 'zod'

// An empty body means "every vendable package", which is what the one-command
// bootstrap wants; a worktree that only needs gp-api can name it instead.
// `.nullish()` because fastify hands the handler `null`, not `{}`, for a POST
// sent with no body at all — the first thing anyone curls.
// Strict so a typo'd key is a 400 rather than a silent "vend everything".
export const GetDevEnvBundleSchema = z
  .strictObject({
    packages: z.array(DevEnvPackageSchema).min(1).optional(),
  })
  .nullish()
  .transform((body) => body ?? {})
export type GetDevEnvBundleInput = z.infer<typeof GetDevEnvBundleSchema>
