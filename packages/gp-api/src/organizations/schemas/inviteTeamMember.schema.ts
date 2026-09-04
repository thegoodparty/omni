import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// Phase 1 admits only campaignAdmin — volunteer opens in Phase 1.5 once the
// AllowVolunteer surfaces are turned on deliberately, route by route.
export class InviteTeamMemberDto extends createZodDto(
  z.object({
    email: z.string().trim().email(),
    name: z.string().trim().min(1),
    role: z.literal('campaignAdmin'),
  }),
) {}

export class UpdateMemberRoleDto extends createZodDto(
  z.object({
    role: z.literal('campaignAdmin'),
  }),
) {}
