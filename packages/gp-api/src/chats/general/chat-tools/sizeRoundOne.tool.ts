import { BadRequestException } from '@nestjs/common'
import { z } from 'zod'
import {
  PANEL_MAX_HOURS_PER_WEEK,
  PANEL_MIN_HOURS_PER_WEEK,
  type ProposalChannel,
} from '@goodparty_org/contracts'
import type { Organization } from '../../../generated/prisma'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type { ContactsService } from '@/contacts/services/contacts.service'
import type { PriorityResultsService } from '@/priorities/services/priorityResults.service'
import {
  MIN_VOICES_PER_GROUP,
  sizeRoundOne,
  TEXT_ANSWER_RATE,
  type TargetedDimension,
} from '@/contacts/utils/civicPanelAllocation.util'
import type { PoolCell } from '@/peopleDb/databricks/districtCensusSql.util'
import {
  raceNameable,
  weightingTargets,
} from '@/priorities/util/censusWeighting.util'
import type { RakingTargets } from '@/priorities/util/raking.util'
import { calcTextAmountInCents } from '@/shared/util/textPricing.util'

// Who each card can reach: anyone not reached in the rest window, plus the
// channel's own reach. Each card carries its filter as audienceFilters.
export const ROUND_ONE_AUDIENCES = {
  doorKnocking: { notContactedRecently: true },
  phoneBanking: { notContactedRecently: true, hasAnyPhone: true },
  text: { notContactedRecently: true, hasCellPhone: true },
} as const

const sizeRoundOneInput = z.object({
  hoursPerWeek: z
    .number()
    .int()
    .min(PANEL_MIN_HOURS_PER_WEEK)
    .max(PANEL_MAX_HOURS_PER_WEEK)
    .optional()
    .describe(
      'Only when the official answered the weekly time question in this ' +
        'conversation: 1, 2 or 3 for those answers, 4 for "4 or more hours ' +
        'a week", or the number they wrote. Leave it out otherwise.',
    ),
})

const sizeOf = (cells: PoolCell[]): number =>
  cells.reduce((sum, cell) => sum + cell.count, 0)

// The district's mix when its census cannot be read: everyone the doors can
// reach, among those with a known value. Gender stays out until the census
// publishes it, as it does for the census mix.
const poolShares = (cells: PoolCell[]): RakingTargets => {
  const sharesOf = (valueOf: (cell: PoolCell) => string | null) => {
    const counts = new Map<string, number>()
    let known = 0
    for (const cell of cells) {
      const value = valueOf(cell)
      if (value === null) continue
      counts.set(value, (counts.get(value) ?? 0) + cell.count)
      known += cell.count
    }
    return Object.fromEntries(
      [...counts].map(([value, count]) => [value, count / known]),
    )
  }
  return {
    age: sharesOf((cell) => cell.ageBand),
    tract: sharesOf((cell) => cell.tract),
    race: sharesOf((cell) => cell.race),
  }
}

type RoundOneCard = {
  channel: ProposalChannel
  audienceFilters: Record<string, boolean>
  count: number
  sampleSize: number
}

const cardFor = (
  channel: keyof typeof ROUND_ONE_AUDIENCES,
  pool: PoolCell[],
  sampleSize: number,
): RoundOneCard | null =>
  sampleSize === 0
    ? null
    : {
        channel,
        audienceFilters: { ...ROUND_ONE_AUDIENCES[channel] },
        count: sizeOf(pool),
        sampleSize,
      }

// The model never sizes round 1 in its head: this counts who each channel
// reaches, group by group, and sizes the cards from the official's weekly
// hours (the panel plan's, else their answer in this conversation).
export const buildSizeRoundOneTool = (deps: {
  contacts: Pick<ContactsService, 'countByGroupWithin'>
  priorityResults: Pick<PriorityResultsService, 'districtCensus'>
  organization: Organization
  planHoursPerWeek: number | null
}): LlmStreamTool<typeof sizeRoundOneInput> => ({
  description:
    'Size the first round of a check: door knocking, a phone bank and a ' +
    'text, each to residents across the district picked at random. Counts ' +
    'who each channel can reach itself, so call it without counting first. ' +
    'Returns the cards to present, each with channel, audienceFilters, ' +
    'count and sampleSize, and the text with targetResponses and ' +
    'assumedReplyRate. Use these numbers as given; never work them out ' +
    'yourself.',
  inputSchema: sizeRoundOneInput,
  execute: async (input) => {
    const hoursPerWeek = input.hoursPerWeek ?? deps.planHoursPerWeek
    if (hoursPerWeek === null) {
      return {
        error:
          'How much time they can give each week is not known yet. Ask it ' +
          'with ask_clarify_question first: "How much time can you give ' +
          'each week?", with 1 hour a week, 2 hours a week, 3 hours a week ' +
          'and 4 or more hours a week. Then call size_round_one again with ' +
          'their answer as hoursPerWeek.',
      }
    }
    const count = (channel: keyof typeof ROUND_ONE_AUDIENCES) =>
      deps.contacts.countByGroupWithin(deps.organization, {
        ...ROUND_ONE_AUDIENCES[channel],
      })
    let pools: [PoolCell[], PoolCell[], PoolCell[]]
    try {
      pools = await Promise.all([
        count('doorKnocking'),
        count('phoneBanking'),
        count('text'),
      ])
    } catch (error) {
      if (error instanceof BadRequestException) return { error: error.message }
      throw error
    }
    const [door, phone, text] = pools
    const census = await deps.priorityResults.districtCensus(deps.organization)
    const dimensions: TargetedDimension[] = [
      'age',
      'gender',
      'tract',
      ...(raceNameable(door) ? (['race'] as const) : []),
    ]
    const size = sizeRoundOne({
      hoursPerWeek,
      districtShares: census ? weightingTargets(census) : poolShares(door),
      dimensions,
      pools: { door, phone, text },
    })
    const textCard = cardFor('text', text, size.texts)
    const cards = [
      cardFor('doorKnocking', door, size.doors),
      cardFor('phoneBanking', phone, size.calls),
      textCard && {
        ...textCard,
        targetResponses: Math.max(1, Math.floor(size.texts * TEXT_ANSWER_RATE)),
        assumedReplyRate: TEXT_ANSWER_RATE,
        civicPanelAsk: true,
      },
    ].filter((card) => card !== null)
    if (cards.length === 0) {
      return {
        error:
          'Nobody in the district can be reached on any channel right now. ' +
          'Say so in one line and do not present a card.',
      }
    }
    return {
      hoursPerWeek,
      cards,
      textCost: calcTextAmountInCents(size.texts) / 100,
      coversEveryGroup: size.groups.every(
        (group) => group.expectedAnswers >= MIN_VOICES_PER_GROUP,
      ),
    }
  },
})
