import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { z } from 'zod'
import { splitPriorityText } from '@goodparty_org/contracts'
import type { Organization } from '../../../generated/prisma'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type { ContactsService } from '@/contacts/services/contacts.service'
import type { PriorityResultsService } from '@/priorities/services/priorityResults.service'
import {
  MIN_VOICES_PER_GROUP,
  sizeOf,
  sizeRoundOne,
  TEXT_ANSWER_RATE,
  type TargetedDimension,
} from '@/contacts/utils/civicPanelAllocation.util'
import type { DistrictCell } from '@/peopleDb/databricks/districtCensusSql.util'
import {
  raceNameable,
  weightingTargets,
} from '@/priorities/util/censusWeighting.util'
import type { RakingTargets } from '@/priorities/util/raking.util'
import { calcTextAmountInCents } from '@/shared/util/textPricing.util'

// Who the text can reach: anyone with a cell phone not reached in the rest
// window. The card carries it as audienceFilters.
export const ROUND_ONE_AUDIENCE = {
  notContactedRecently: true,
  hasCellPhone: true,
} as const

const sizeRoundOneInput = z.object({})

// The district's mix when its census cannot be read: everyone the text can
// reach, among those with a known value. Gender stays out until the census
// publishes it, as it does for the census mix.
const poolShares = (cells: DistrictCell[]): RakingTargets => {
  const sharesOf = (valueOf: (cell: DistrictCell) => string | null) => {
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

// The model never sizes round 1 in its head: this counts who the text
// reaches, group by group, and sizes it so every major group is expected to
// answer.
export const buildSizeRoundOneTool = (deps: {
  contacts: Pick<ContactsService, 'countByGroupWithin'>
  priorityResults: Pick<PriorityResultsService, 'districtCensus'>
  organization: Organization
}): LlmStreamTool<typeof sizeRoundOneInput> => ({
  description:
    'Size the first round of a check: a text to residents across the ' +
    'district. Counts who the text can reach itself, so call it without ' +
    'counting first. Returns the card to present: channel, audienceFilters, ' +
    'count, sampleSize, targetResponses and assumedReplyRate. Use these ' +
    'numbers as given; never work them out yourself.',
  inputSchema: sizeRoundOneInput,
  execute: async () => {
    let text: DistrictCell[]
    try {
      text = await deps.contacts.countByGroupWithin(deps.organization, {
        ...ROUND_ONE_AUDIENCE,
      })
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        return { error: error.message }
      }
      throw error
    }
    const census = await deps.priorityResults.districtCensus(deps.organization)
    const dimensions: TargetedDimension[] = [
      'age',
      'gender',
      'tract',
      ...(raceNameable(text) ? (['race'] as const) : []),
    ]
    const size = sizeRoundOne({
      districtShares: census ? weightingTargets(census) : poolShares(text),
      dimensions,
      pool: text,
    })
    if (size.texts === 0) {
      return {
        error:
          'Nobody in the district can be reached by text right now. Say so ' +
          'in one line and do not present a card.',
      }
    }
    // One purchase in two rounds: half now at random, the rest held for a
    // follow-up drawn toward the groups heard from least.
    const split = splitPriorityText(size.texts)
    return {
      cards: [
        {
          channel: 'text' as const,
          audienceFilters: { ...ROUND_ONE_AUDIENCE },
          count: sizeOf(text),
          sampleSize: split.now,
          ...(split.followUp > 0 && { roundTwoSize: split.followUp }),
          targetResponses: Math.max(
            1,
            Math.floor(size.texts * TEXT_ANSWER_RATE),
          ),
          assumedReplyRate: TEXT_ANSWER_RATE,
          civicPanelAsk: true,
        },
      ],
      textCost: calcTextAmountInCents(size.texts) / 100,
      coversEveryGroup: size.groups.every(
        (group) => group.expectedAnswers >= MIN_VOICES_PER_GROUP,
      ),
    }
  },
})
