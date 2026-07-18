import { describe, expect, it } from 'vitest'
import { SupportStatusRollupSchema } from '@goodparty_org/contracts'
import { voterFilterBaseSchema } from '@/shared/schemas/voterFilterBase.schema'
import { ACTIVITY_CONDITION_CHANNEL_ACTIONS } from '@/shared/schemas/activityCondition.schema'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { PinoLogger } from 'nestjs-pino'
import type { HttpService } from '@nestjs/axios'
import type { Organization } from '../generated/prisma'
import { FILTER_DIMENSIONS } from './filterDimensions.catalog'
import { ContactsService } from './services/contacts.service'
import {
  INCOME_RANGE_MAPPING,
  LANGUAGE_CODE_TO_LABEL,
} from './utils/voterFileFilter.utils'

// Schema fields deliberately absent from the catalog:
// - search: free-text carryover from a saved search-result list, not a
//   dimension the assistant should compose.
// - registeredVoterTrue/False: accepted by the schema but dropped by
//   convertVoterFileFilterToFilters (excludeFields), so filtering on them is
//   a no-op — advertising them would let the assistant build filters that
//   silently don't filter.
const EXCLUDED_SCHEMA_FIELDS = new Set([
  'search',
  'registeredVoterTrue',
  'registeredVoterFalse',
])

const schemaFieldKeys = new Set(Object.keys(voterFilterBaseSchema.shape))

// Every schema field the catalog claims to cover: boolean-group value keys
// plus multi-value/activity dimension keys (those dimensions' keys ARE the
// schema array fields).
const catalogSchemaFields = new Set(
  FILTER_DIMENSIONS.flatMap((dimension) =>
    dimension.kind === 'boolean-group'
      ? dimension.values.map((value) => value.key)
      : [dimension.key],
  ),
)

describe('FILTER_DIMENSIONS catalog', () => {
  it('covers every voterFilterBaseSchema field or lists it as excluded', () => {
    const uncovered = [...schemaFieldKeys].filter(
      (field) =>
        !catalogSchemaFields.has(field) && !EXCLUDED_SCHEMA_FIELDS.has(field),
    )
    expect(uncovered).toEqual([])
  })

  it('never references a field that does not exist in the schema', () => {
    const phantom = [...catalogSchemaFields].filter(
      (field) => !schemaFieldKeys.has(field),
    )
    expect(phantom).toEqual([])
  })

  it('never lists an excluded field as a dimension anyway', () => {
    const overlap = [...EXCLUDED_SCHEMA_FIELDS].filter((field) =>
      catalogSchemaFields.has(field),
    )
    expect(overlap).toEqual([])
  })

  it('pins activity channels and per-channel outcomes to the feature 4 map', () => {
    const activity = FILTER_DIMENSIONS.find((d) => d.kind === 'activity')
    expect(activity).toBeDefined()
    if (activity?.kind !== 'activity') return
    expect(activity.values.map((channel) => channel.key).sort()).toEqual(
      Object.keys(ACTIVITY_CONDITION_CHANNEL_ACTIONS).sort(),
    )
    for (const channel of activity.values) {
      expect(channel.actions.map((action) => action.key)).toEqual([
        ...ACTIVITY_CONDITION_CHANNEL_ACTIONS[
          channel.key as keyof typeof ACTIVITY_CONDITION_CHANNEL_ACTIONS
        ],
      ])
    }
  })

  it('sources supportStatus values from the contracts rollup enum', () => {
    const supportStatus = FILTER_DIMENSIONS.find(
      (d) => d.key === 'supportStatus',
    )
    expect(supportStatus?.values.map((value) => value.key)).toEqual([
      ...SupportStatusRollupSchema.options,
    ])
  })

  it('sources income and language values from the conversion maps', () => {
    const income = FILTER_DIMENSIONS.find((d) => d.key === 'incomeRanges')
    expect(income?.values.map((value) => value.key)).toEqual(
      Object.keys(INCOME_RANGE_MAPPING),
    )
    const language = FILTER_DIMENSIONS.find((d) => d.key === 'languageCodes')
    expect(language?.values.map((value) => value.key)).toEqual(
      Object.keys(LANGUAGE_CODE_TO_LABEL),
    )
  })
})

describe('ContactsService.getFilterDimensions', () => {
  const buildService = () =>
    new ContactsService(
      { post: () => undefined, get: () => undefined } as unknown as HttpService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      createMockLogger() as unknown as PinoLogger,
    )

  const organization = (slug: string): Organization =>
    ({ slug }) as Organization

  it('includes party for a Win organization', () => {
    const dimensions = buildService().getFilterDimensions(
      organization('win-campaign'),
    )
    expect(dimensions.map((d) => d.key)).toContain('party')
  })

  it('strips party (and any Win-only dimension) for an eo- organization', () => {
    const dimensions = buildService().getFilterDimensions(
      organization('eo-city-council'),
    )
    expect(dimensions.some((d) => d.modes === 'win')).toBe(false)
    expect(dimensions.map((d) => d.key)).not.toContain('party')
  })

  it('returns the shared dimensions for both modes', () => {
    const winKeys = buildService()
      .getFilterDimensions(organization('win-campaign'))
      .map((d) => d.key)
    const serveKeys = buildService()
      .getFilterDimensions(organization('eo-city-council'))
      .map((d) => d.key)
    expect(winKeys.filter((key) => key !== 'party')).toEqual(serveKeys)
  })
})
