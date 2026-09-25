import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// overrideDistrictId is deliberately absent here: a self-service caller editing
// their own org must not be able to point it at an arbitrary district, which
// downstream voter-file/contact lookups trust as the only scope (IDOR). The
// legitimate override is resolved server-side from the caller's own
// state/district selection via resolveOverrideDistrictId. Raw overrides are
// admin-only — see AdminPatchOrganizationDto.
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
  }),
) {}

export class AdminListOrganizationsDto extends createZodDto(
  z.object({
    slug: z.string().min(1).max(100).optional(),
    email: z.string().min(1).max(100).optional(),
  }),
) {}
