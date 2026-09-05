import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { PhoneSchema, TeamInviteRoleSchema } from '@goodparty_org/contracts'

// outreachId is optional for a volunteer invite: the outreach drawer's
// per-list entry point (ENG-11049) still passes one, creating the invite and
// assignment in the same act, but the team page's general invite (ENG-11058)
// legally omits it — a general volunteer lands on /volunteer's empty state
// until a manager assigns work. campaignAdmin never carries one (a manager
// isn't scoped to one list). phone (ENG-11058) is optional on either role and
// only ever backfills a blank profile field — see organizationTeam.service.ts.
export class InviteTeamMemberDto extends createZodDto(
  z
    .object({
      email: z.string().trim().email(),
      name: z.string().trim().min(1),
      role: TeamInviteRoleSchema,
      outreachId: z.number().optional(),
      phone: PhoneSchema.optional(),
    })
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
