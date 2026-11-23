import { z } from 'zod'
import { OrdinanceFlowStepSchema } from '@goodparty_org/contracts'

// Raised when a case list will not parse, or a case asks for a state its
// scope cannot carry.
export class CaseListError extends Error {}

// "The capability exists but the user lacks access" as something a seeder can
// act on. A CLOSED SET, and `.strict()` is what keeps it closed: an open bag
// of column overrides would let a case list seed a state no deployment can
// produce, and the verdict would then be about an agent we do not ship.
//
// The states worth naming are the ones that decide which tools REGISTER,
// because tool registration is the only thing about an account the model can
// see. Each is read off a handler rather than invented:
//
//   pro             campaignManager.handler gates the whole CRM and
//                   voter-file family on `ctx.isPro !== false`.
//   district        `organization.positionId` is the half of the district
//                   gate that lives in our own database; without it
//                   resolveByOrgSlug returns null before it asks
//                   election-db anything, so `districtFilters` is null and
//                   the constituent-data pair registers on no scope.
//   campaignDetails the campaign's `details` blob carries `raceId`, which is
//                   what `get_ballot_requirements` registers on.
//   ordinanceStep   each ordinance step past clarify carries its own
//                   `present_*` tools and nothing else does.
//   briefingHighlight
//                   the one state here that registers no tool: it opens the
//                   briefing chat on a highlighted passage instead of the
//                   whole briefing, which is the other thing the briefing
//                   prompt renders differently. Like ordinanceStep it picks
//                   what the conversation is anchored on, and like it the
//                   runner reads the anchor back.
//
// Absent means "whatever the seeder seeds by default", which is every one of
// these present. Only an explicit `false` takes something away, so a case
// list that names none of them seeds exactly what it seeded before. The
// exception is briefingHighlight, whose default is the whole briefing: a
// highlight is something a user picks, not something an account has.
export const ChatAccountStateSchema = z
  .object({
    pro: z.boolean().optional(),
    district: z.boolean().optional(),
    campaignDetails: z.boolean().optional(),
    ordinanceStep: OrdinanceFlowStepSchema.optional(),
    briefingHighlight: z.boolean().optional(),
  })
  .strict()
  .refine((state) => Object.keys(state).length > 0, {
    message:
      'an empty accountState asks for nothing; omit the field rather than ' +
      'declaring a state the seeder cannot tell from the default',
  })
export type ChatAccountState = z.infer<typeof ChatAccountStateSchema>
