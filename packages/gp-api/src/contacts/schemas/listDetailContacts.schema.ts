import { zDate } from '@goodparty_org/contracts'
import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { OutreachStatus, OutreachType } from '../../generated/prisma'

// segment is always a saved VoterFileFilter id here (never "all" or a
// built-in channel name) — the detail page's aggregates and outreach
// history are both scoped to one persisted list.
export const listDetailContactsSchema = z.object({
  segment: z.coerce.number().int().positive(),
})

export class ListDetailContactsDTO extends createZodDto(
  listDetailContactsSchema,
) {}

export const listDetailResponseSchema = z.object({
  demographics: z.object({
    people: z.number().int().min(0),
    avgAge: z.number().nullable(),
    avgIncome: z.number().nullable(),
  }),
  reachability: z.object({
    sms: z.number().int().min(0),
    robocall: z.number().int().min(0),
    phoneBanking: z.number().int().min(0),
    doorKnocking: z.number().int().min(0),
    // No eligibility data source exists for either channel (TDD open
    // question) — always null so the UI renders "unavailable", never 0.
    email: z.null(),
    metaAds: z.null(),
  }),
  outreachHistory: z.array(
    z.object({
      id: z.number().int(),
      name: z.string().nullable(),
      outreachType: z.nativeEnum(OutreachType),
      status: z.nativeEnum(OutreachStatus).nullable(),
      date: zDate().nullable(),
    }),
  ),
})

export type ListDetailContactsResponse = z.infer<
  typeof listDetailResponseSchema
>
