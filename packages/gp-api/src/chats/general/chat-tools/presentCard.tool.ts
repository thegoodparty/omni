import { z } from 'zod'
import {
  ListProposalSchema,
  PRESENT_CARD_DESCRIPTIONS,
  PRESENT_CARD_TOOL,
  pickPresentCardOptions,
  type PresentCardKind,
} from '@goodparty_org/contracts'
import type { LlmStreamTool, LlmTool } from '@/llm/services/llm.service'
import { voterFilterBaseSchema } from '@/shared/schemas/voterFilterBase.schema'

// The filter is the same strict shape count_contacts and crud_saved_filters
// take, so a list proposed here is one the create route will accept as is.
// The contract carries it loosely because the card only passes it through.
const StrictListProposalCardSchema = z.object({
  kind: z.literal('list_proposal'),
  ...ListProposalSchema.shape,
  filters: voterFilterBaseSchema
    .strict()
    .describe('The exact filter you counted with in count_contacts.'),
})

const presentCardInput = (kinds: readonly PresentCardKind[]) => {
  const [first, ...rest] = pickPresentCardOptions(kinds).map((option) =>
    option.shape.kind.value === 'list_proposal'
      ? StrictListProposalCardSchema
      : option,
  )
  if (!first) throw new Error(`${PRESENT_CARD_TOOL} needs at least one kind`)
  return z.object({ card: z.discriminatedUnion('kind', [first, ...rest]) })
}

type PresentCardTool = LlmStreamTool<ReturnType<typeof presentCardInput>> & {
  kinds: readonly PresentCardKind[]
}

// Display-only: the args are the card, and execute only acks. The one
// refusal is the list proposal's, which counted nobody and so has no list to
// save.
export const buildPresentCardTool = ({
  kinds,
}: {
  kinds: readonly PresentCardKind[]
}): PresentCardTool => ({
  kinds,
  description:
    'Show a card in the conversation. Set card.kind to one of ' +
    `${kinds.join(', ')} and pass that kind's fields, as CARDS YOU CAN ` +
    'SHOW lists them. The card speaks for itself, so never restate what is ' +
    'on it.',
  inputSchema: presentCardInput(kinds),
  execute: ({ card }) =>
    card.kind === 'list_proposal' && card.count === 0
      ? {
          error:
            'That filter counted nobody, so there is no list to save. ' +
            'Loosen or change it, count again, and offer it once it ' +
            'reaches people.',
        }
      : { presented: true },
})

const isPresentCardTool = (
  tool: LlmTool | undefined,
): tool is PresentCardTool => tool !== undefined && 'kinds' in tool

export const offeredCardKinds = (
  tools: Record<string, LlmTool>,
): readonly PresentCardKind[] => {
  const tool = tools[PRESENT_CARD_TOOL]
  return isPresentCardTool(tool) ? tool.kinds : []
}

// Written from the catalog, so a kind's prompt text is its contract: the
// one-line description and each field's own description.
export const presentCardPromptBlock = (
  kinds: readonly PresentCardKind[],
): string =>
  [
    `CARDS YOU CAN SHOW (call \`${PRESENT_CARD_TOOL}\` with \`card.kind\` set to one of these and that kind's fields):`,
    ...pickPresentCardOptions(kinds).flatMap((option) => {
      const kind = option.shape.kind.value
      return [
        `- \`${kind}\`: ${PRESENT_CARD_DESCRIPTIONS[kind]}`,
        ...Object.entries<z.ZodType>(option.shape)
          .filter(([field]) => field !== 'kind')
          .map(
            ([field, schema]) =>
              `  - \`${field}\`${schema.safeParse(undefined).success ? ' (optional)' : ''}: ${schema.description ?? ''}`,
          ),
      ]
    }),
  ].join('\n')
