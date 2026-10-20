import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { z } from 'zod'
import {
  PANEL_MAX_HOURS_PER_WEEK,
  PANEL_MIN_HOURS_PER_WEEK,
  splitPriorityText,
  type GeoJsonPolygon,
  type WalkableAreaBox,
} from '@goodparty_org/contracts'
import type { Organization } from '../../../generated/prisma'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type { ContactsService } from '@/contacts/services/contacts.service'
import type { PriorityResultsService } from '@/priorities/services/priorityResults.service'
import {
  MIN_VOICES_PER_GROUP,
  roundOneHours,
  sizeOf,
  sizeRoundOne,
  TEXT_ANSWER_RATE,
  type TargetedDimension,
} from '@/contacts/utils/civicPanelAllocation.util'
import { areaAround } from '@/contacts/utils/civicPanelBuild.util'
import type { DistrictCell } from '@/peopleDb/databricks/districtCensusSql.util'
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

// The district's mix when its census cannot be read: everyone the doors can
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

const round = (value: number): number => Number(value.toFixed(6))

const boxOf = (area: GeoJsonPolygon): WalkableAreaBox => {
  const ring = area.coordinates[0] ?? []
  const lngs = ring.map(([lng]) => lng)
  const lats = ring.map(([, lat]) => lat)
  return {
    west: round(Math.min(...lngs)),
    south: round(Math.min(...lats)),
    east: round(Math.max(...lngs)),
    north: round(Math.max(...lats)),
  }
}

// The box as the polygon a saved list's boundary holds, so the people
// counted here are the people the list will hold.
export const walkableAreaPolygon = (box: WalkableAreaBox): GeoJsonPolygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [box.west, box.south],
      [box.east, box.south],
      [box.east, box.north],
      [box.west, box.north],
      [box.west, box.south],
    ],
  ],
})

// The model copies the box onto the door card; a copy that drifts past the
// rounding would knock a different area than the one sized.
export const sameWalkableArea = (
  a: WalkableAreaBox,
  b: WalkableAreaBox,
): boolean =>
  (['west', 'south', 'east', 'north'] as const).every(
    (side) => Math.abs(a[side] - b[side]) < 1e-6,
  )

// The model never sizes round 1 in its head: this counts who each channel
// reaches, group by group, picks the doors' one walkable area, and sizes
// the cards from the official's weekly hours (the panel plan's, else their
// answer in this conversation). Every area it returns is reported through
// `onArea`, so the door card can be held to one of them.
export const buildSizeRoundOneTool = (deps: {
  contacts: Pick<ContactsService, 'countByGroupWithin' | 'resolveGeoMemberIds'>
  priorityResults: Pick<
    PriorityResultsService,
    'districtCensus' | 'roundOneDoorArea'
  >
  organization: Organization
  priorityId: string
  planHoursPerWeek: number | null
  onArea?: (area: WalkableAreaBox) => void
}): LlmStreamTool<typeof sizeRoundOneInput> => ({
  description:
    'Size the first round of a check: door knocking in one walkable area, ' +
    'a phone bank and a text, the calls and the text to residents across ' +
    'the district picked at random. Counts who each channel can reach ' +
    'itself, so call it without counting first. Returns the cards to ' +
    'present: each with channel, audienceFilters and count; the door card ' +
    'with walkableArea and how many doors it knocks; the calls and the text ' +
    'with sampleSize, and the text with targetResponses and ' +
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
    let pools: [DistrictCell[], DistrictCell[], DistrictCell[]]
    try {
      pools = await Promise.all([
        count('doorKnocking'),
        count('phoneBanking'),
        count('text'),
      ])
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        return { error: error.message }
      }
      throw error
    }
    const [door, phone, text] = pools
    const planned = roundOneHours({
      hoursPerWeek,
      doorPool: sizeOf(door),
      phonePool: sizeOf(phone),
    })
    const households =
      planned.doors === 0
        ? []
        : await deps.priorityResults.roundOneDoorArea(
            deps.organization,
            deps.priorityId,
            { ...ROUND_ONE_AUDIENCES.doorKnocking },
            planned.doors,
          )
    const outline = areaAround(households)
    const walkableArea = outline ? boxOf(outline) : null
    let doorArea: DistrictCell[] = []
    if (walkableArea) {
      try {
        doorArea = await deps.contacts.countByGroupWithin(
          deps.organization,
          { ...ROUND_ONE_AUDIENCES.doorKnocking },
          await deps.contacts.resolveGeoMemberIds(
            deps.organization,
            walkableAreaPolygon(walkableArea),
          ),
        )
      } catch (error) {
        if (
          error instanceof BadRequestException ||
          error instanceof ForbiddenException
        ) {
          return { error: error.message }
        }
        throw error
      }
    }
    const doors = sizeOf(doorArea) === 0 ? 0 : households.length
    const census = await deps.priorityResults.districtCensus(deps.organization)
    const dimensions: TargetedDimension[] = [
      'age',
      'gender',
      'tract',
      ...(raceNameable(door) ? (['race'] as const) : []),
    ]
    const size = sizeRoundOne({
      doors,
      calls: planned.calls,
      districtShares: census ? weightingTargets(census) : poolShares(door),
      dimensions,
      pools: { doorArea, phone, text },
    })
    // One purchase in two rounds: half now at random, the rest held for a
    // follow-up drawn toward the groups heard from least.
    const split = splitPriorityText(size.texts)
    const cards = [
      ...(walkableArea && doors > 0
        ? [
            {
              channel: 'doorKnocking' as const,
              audienceFilters: { ...ROUND_ONE_AUDIENCES.doorKnocking },
              count: sizeOf(doorArea),
              doors,
              walkableArea,
            },
          ]
        : []),
      ...(planned.calls > 0
        ? [
            {
              channel: 'phoneBanking' as const,
              audienceFilters: { ...ROUND_ONE_AUDIENCES.phoneBanking },
              count: sizeOf(phone),
              sampleSize: planned.calls,
            },
          ]
        : []),
      ...(size.texts > 0
        ? [
            {
              channel: 'text' as const,
              audienceFilters: { ...ROUND_ONE_AUDIENCES.text },
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
          ]
        : []),
    ]
    if (cards.length === 0) {
      return {
        error:
          'Nobody in the district can be reached on any channel right now. ' +
          'Say so in one line and do not present a card.',
      }
    }
    if (walkableArea && doors > 0) deps.onArea?.(walkableArea)
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
