import {
  PriorityCheckStateSchema,
  PriorityStatusSchema,
  PriorityStepCheckInputSchema,
  PriorityStepIdSchema,
  PriorityStepStateSchema,
} from '@goodparty_org/contracts'
import { z } from 'zod'

const PriorityStepUpdateSchema = z.object({
  id: PriorityStepIdSchema.describe(
    'Which of the seven steps this entry updates.',
  ),
  state: PriorityStepStateSchema.describe(
    'open = nobody has worked this yet. active = what you and the ' +
      'official are working through right now, and exactly one step is ' +
      'active at any moment. settled = you both have an answer you are ' +
      'happy with; put it in summary. stale = we settled this and then ' +
      'learned something that puts it back in doubt, so it needs another ' +
      'look; say what changed in caveat. Setting a step active while ' +
      'another one is active drops that other one back to open, so settle ' +
      'or park it in the same call.',
  ),
  summary: z
    .string()
    .optional()
    .describe(
      "What this step settled, in the official's own words. Omit to keep " +
        'the summary already stored — omitting never blanks it.',
    ),
  caveat: z
    .string()
    .optional()
    .describe(
      'Why this step is thin or back in doubt. Omit to keep the stored ' +
        'caveat. Pass an empty string to clear it, which is how you say ' +
        'the doubt is resolved.',
    ),
  check: PriorityStepCheckInputSchema.extend({
    state: PriorityCheckStateSchema.describe(
      'asked = you put the check to them in this turn and they have not ' +
        'answered. out = they took it and it is in the field. confirmed = ' +
        'the people asked backed what the step settled. revised = what they ' +
        'said changed it; put the change in summary. deferred = not yet; ' +
        'record it again only when you raised it again and heard not yet ' +
        'again, because that is what counts the raises. declined = they ' +
        'chose to settle this without checking.',
    ),
    who: z
      .string()
      .optional()
      .describe(
        'The specific group whose answer would confirm or break this ' +
          'step, in plain words. Omit to keep what is stored.',
      ),
    question: z
      .string()
      .optional()
      .describe('The one question put to them. Omit to keep what is stored.'),
    when: z
      .string()
      .optional()
      .describe(
        'On a deferral, what they said about timing, in their words. ' +
          'Omit to keep what is stored.',
      ),
  })
    .optional()
    .describe(
      'Whether what this step settled has been checked with the people it ' +
        'lands on. Pass it only when the check itself changed; omit it to ' +
        'keep the stored check.',
    ),
})

export const UpdatePriorityStatusInputSchema = z.object({
  steps: z
    .array(PriorityStepUpdateSchema)
    .describe(
      'Only the steps that changed this turn. A step you leave out keeps ' +
        'exactly the state, summary and caveat it already had.',
    ),
  nextAction: z
    .string()
    .describe(
      'The single thing the official should do next, in plain words short ' +
        'enough to read at a glance and specific enough to do today. ' +
        '"Call the public works director and ask what the backlog is" is ' +
        'right, "keep gathering evidence" is not. Empty string only when ' +
        'every step is settled and there is nothing left to do.',
    ),
})

export type UpdatePriorityStatusInput = z.infer<
  typeof UpdatePriorityStatusInputSchema
>

export const PriorityStatusResponseSchema = z.object({
  status: PriorityStatusSchema,
  currentStep: z.string().nullable(),
  nextAction: z.string().nullable(),
})
