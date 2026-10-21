import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// `ready` shape: identical to the token-status endpoint's response — same
// Peerly ACTIVE resolution, same capture-row exclusion counts — so a future
// caller can switch from polling by token to polling by buildId without a
// response-shape change.
const checkPhoneListBuildStatusReadyResponseSchema = z.object({
  phoneListId: z.number(),
  leadsLoaded: z.number(),
  excludedOptedOutCount: z.number(),
  excludedDuplicatePhoneCount: z.number(),
})

export class CheckPhoneListBuildStatusReadyResponseDto extends createZodDto(
  checkPhoneListBuildStatusReadyResponseSchema,
) {}

const checkPhoneListBuildStatusFailedResponseSchema = z.object({
  buildStatus: z.literal('failed'),
  buildError: z.string(),
})

export class CheckPhoneListBuildStatusFailedResponseDto extends createZodDto(
  checkPhoneListBuildStatusFailedResponseSchema,
) {}

// The "still in progress" shape is identical to the token-status endpoint's
// (`CheckPhoneListStatusAcceptedResponseDto`, `p2pPhoneListStatus.schema.ts`)
// — reused there rather than redeclared here.
