import { z } from 'zod'
import { ChatAnchorSchema } from '@goodparty_org/contracts'
import { createBriefingChatSchema } from '@/chats/briefing-chats/schemas/CreateBriefingChat.schema'
import { ChatAccountStateSchema } from '../judgeChatFixture/accountState'
import { CHAT_AGENT_IDS, JUDGE_ORG_SLUG_PREFIX } from '../judgeChatFixture/seed'

// The alphabet `SweepIdSchema` holds a sweep id to, restated rather than
// imported: that schema lives in `src/chats/evals/judge/sweepEnv.ts`, and
// tsconfig.build.json and .swcrc.build.json both drop `src/chats/evals/**`
// from the production build — so importing it here would resolve under
// vitest, tsc and eslint and then throw MODULE_NOT_FOUND in the container.
// sweepEnv.test.ts asserts the two never drift, from the eval side of that
// boundary, where importing both is fine.
//
// Validated at all because the sweep id reaches `organization.slug` through
// `chatOrgSlug`, and the server still derives that slug itself. A caller
// names its run; it does not name an organization.
export const JudgeSweepIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    'reaches the fixture organization slug, so it may contain only ' +
      'letters, digits, underscore and hyphen',
  )

export const SetUpJudgeChatCaseSchema = z
  .object({
    agentId: z.string().refine((id) => CHAT_AGENT_IDS.includes(id), {
      message:
        'not a chat scope the judge can drive; the registered ones are ' +
        CHAT_AGENT_IDS.join(', '),
    }),
    // The sweep both arms share. It is in the slug so that two sweeps on one
    // database (dev) stage different organizations and stop deleting each
    // other's fixtures mid-run, and it is safe there because the arms of ONE
    // sweep agree on it — so their system prompts, and their configDigests,
    // still match.
    sweepId: JudgeSweepIdSchema,
    // The case id and attempt, exactly what the in-process arm passes. Never
    // the slug itself: the slug is DERIVED from this, which is what keeps a
    // caller from naming one, and what makes attempt i of both arms seed the
    // same organization.
    slugKey: z.string().min(1).max(200),
    accountState: ChatAccountStateSchema.optional(),
  })
  .strict()

export type SetUpJudgeChatCaseInput = z.infer<typeof SetUpJudgeChatCaseSchema>

// Refused at the boundary rather than inside the delete, so a caller that
// passed a real organization's slug learns it was never a judge fixture
// instead of reading a quiet "nothing removed". The delete narrows on the
// same prefix again — this one is the loud half.
export const JudgeChatCaseSlugSchema = z
  .string()
  .min(JUDGE_ORG_SLUG_PREFIX.length + 1)
  .startsWith(
    JUDGE_ORG_SLUG_PREFIX,
    `only a ${JUDGE_ORG_SLUG_PREFIX} organization is a judge fixture`,
  )

export const JudgeChatCaseResponseSchema = z.object({
  organizationSlug: z.string(),
  electedOfficeId: z.string().optional(),
  anchor: ChatAnchorSchema.optional(),
  briefing: createBriefingChatSchema.optional(),
})

export const TearDownJudgeChatCaseResponseSchema = z.object({
  organizationSlug: z.string(),
  // False both when the fixture was already gone and when it was never the
  // caller's to remove. A sweep retrying its own teardown and a caller aiming
  // at somebody else's organization get the same answer on purpose: the
  // second must not be able to tell that the slug exists.
  removed: z.boolean(),
})
