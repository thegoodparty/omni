import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { MAX_DAILY_CAMPAIGN_LIMIT } from '@/doorKnocking/utils/campaignQuota.util'

// overrideDistrictId is deliberately absent here: a self-service caller editing
// their own org must not be able to point it at an arbitrary district, which
// downstream voter-file/contact lookups trust as the only scope (IDOR). The
// legitimate override is resolved server-side from the caller's own
// state/district selection via resolveOverrideDistrictId. Raw overrides are
// admin-only — see AdminPatchOrganizationDto.
//
// overrideDoorKnockingCampaignLimit is absent for a plainer reason: a
// candidate raising their own spending limit IS the risk. Every campaign it
// buys is real money at Geoapify, drawn from one daily account pool shared
// with every other organization, so one org's self-granted allowance is spent
// out of everybody else's.
export class PatchOrganizationDto extends createZodDto(
  z.object({
    ballotReadyPositionId: z.string().min(1).nullable().optional(),
    customPositionName: z.string().nullable().optional(),
  }),
) {}

export class AdminPatchOrganizationDto extends createZodDto(
  z.object({
    ballotReadyPositionId: z.string().min(1).nullable().optional(),
    overrideDistrictId: z.string().nullable().optional(),
    customPositionName: z.string().nullable().optional(),
    // Bounded at validation rather than at the vendor: past the account's
    // whole daily pool the number cannot be honoured for anyone. Null puts the
    // org back on the default.
    overrideDoorKnockingCampaignLimit: z
      .number()
      .int()
      .positive()
      .max(MAX_DAILY_CAMPAIGN_LIMIT)
      .nullable()
      .optional(),
  }),
) {}

export class AdminListOrganizationsDto extends createZodDto(
  z.object({
    slug: z.string().min(1).max(100).optional(),
    email: z.string().min(1).max(100).optional(),
  }),
) {}
