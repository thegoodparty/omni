import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { TeamInviteRoleSchema } from '@goodparty_org/contracts'

// Phase 1.5 (ENG-11049): volunteer invites are list-scoped — the invite and
// the assignment are created in the same act, so a volunteer invite always
// carries the outreach it grants access to; campaignAdmin never does (a
// manager isn't scoped to one list).
export class InviteTeamMemberDto extends createZodDto(
  z
    .object({
      email: z.string().trim().email(),
      name: z.string().trim().min(1),
      role: TeamInviteRoleSchema,
      outreachId: z.number().optional(),
    })
    .refine(
      (data) => data.role !== 'volunteer' || data.outreachId !== undefined,
      {
        message: 'A volunteer invite must include an outreachId',
        path: ['outreachId'],
      },
    )
    .refine(
      (data) => data.role !== 'campaignAdmin' || data.outreachId === undefined,
      {
        message: 'outreachId is only valid for a volunteer invite',
        path: ['outreachId'],
      },
    ),
) {}

export class UpdateMemberRoleDto extends createZodDto(
  z.object({
    role: TeamInviteRoleSchema,
  }),
) {}
