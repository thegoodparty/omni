import { describe, expect, it } from 'vitest'
import { voterFilterBaseSchema } from '@/shared/schemas/voterFilterBase.schema'
import { ACTIVITY_CONDITION_CHANNEL_ACTIONS } from '@/shared/schemas/activityCondition.schema'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { PinoLogger } from 'nestjs-pino'
import type { Organization } from '../generated/prisma'
import {
  FILTER_DIMENSIONS,
  type FilterDimensionProvenance,
} from './filterDimensions.catalog'
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
// - age18_25/age25_35/age35_50/age50Plus: the overlapping split ENG-10752
//   retired. Saved rows keep converting with their original bounds, but the
//   catalog only advertises the mutually exclusive replacement ranges so the
//   assistant can't compose new filters from retired keys.
const EXCLUDED_SCHEMA_FIELDS = new Set([
  'search',
  // Filterable in the wizard, but the catalog is the AI assistant's value
  // vocabulary and precinct has no fixed one — its values are enumerated per
  // district by GET /v1/contacts/precincts. Listing the dimension without
  // them would invite the assistant to invent precinct names. See the note
  // at the top of filterDimensions.catalog.ts.
  'precincts',
  'registeredVoterTrue',
  'registeredVoterFalse',
  'age18_25',
  'age25_35',
  'age35_50',
  'age50Plus',
  // Legacy wire value: still accepted from saved filters persisted before
  // the Homeowner/Renter/Unknown collapse (ENG-10947), but no longer
  // offered as its own catalog option.
  'homeownerLikely',
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

  // ENG-10837: the catalog advertises all five SupportStatusRollup values —
  // SupportStatusService.personIdsByEffectiveStatus resolves undecided/
  // refused (override-only, ENG-10833) alongside the three derivable ones,
  // so the assistant/wizard can safely build a filter on any of them.
  it('sources supportStatus values from the full SupportStatusRollup vocabulary', () => {
    const supportStatus = FILTER_DIMENSIONS.find(
      (d) => d.key === 'supportStatus',
    )
    expect(supportStatus?.values.map((value) => value.key)).toEqual([
      'supporter',
      'non_supporter',
      'unknown',
      'undecided',
      'refused',
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

// No confirmed source for these two yet: serve/output/l2_haystaq_codebook
// (the L2 National Models User Guide) only documents hs_* opinion-score
// models, not these base demographic columns. Deliberately left unmarked
// rather than guessed — see the code comments at their catalog entries.
const UNCLASSIFIED_PROVENANCE_DIMENSIONS = new Set([
  'children',
  'languageCodes',
])

describe('FILTER_DIMENSIONS provenance', () => {
  const validProvenance: ReadonlySet<FilterDimensionProvenance> = new Set([
    'observed',
    'modeled',
    'derived',
  ])

  it('declares a valid provenance value or is a known-unclassified dimension', () => {
    const invalid = FILTER_DIMENSIONS.filter((d) =>
      d.provenance === undefined
        ? !UNCLASSIFIED_PROVENANCE_DIMENSIONS.has(d.key)
        : !validProvenance.has(d.provenance),
    ).map((d) => d.key)
    expect(invalid).toEqual([])
  })

  it('never lists a classified dimension as unclassified', () => {
    const overlap = FILTER_DIMENSIONS.filter(
      (d) =>
        UNCLASSIFIED_PROVENANCE_DIMENSIONS.has(d.key) &&
        d.provenance !== undefined,
    ).map((d) => d.key)
    expect(overlap).toEqual([])
  })

  // Pinned so a quiet downgrade (e.g. ethnicity -> observed) fails here with
  // a readable diff instead of silently reaching the model.
  it('pins the modeled set', () => {
    const modeled = FILTER_DIMENSIONS.filter(
      (d) => d.provenance === 'modeled',
    ).map((d) => d.key)
    expect(modeled.sort()).toEqual(
      [
        'audience',
        'businessOwner',
        'education',
        'ethnicity',
        'homeowner',
        'income',
        'incomeRanges',
        'maritalStatus',
        'veteran',
        'voterStatus',
      ].sort(),
    )
  })

  // audience and voterStatus both read Voter_Status under different keys; a
  // split mark would let the model launder a modeled figure by picking the
  // other route.
  it('audience and voterStatus agree (same Voter_Status column)', () => {
    const audience = FILTER_DIMENSIONS.find((d) => d.key === 'audience')
    const voterStatus = FILTER_DIMENSIONS.find((d) => d.key === 'voterStatus')
    expect(audience?.provenance).toBe(voterStatus?.provenance)
  })

  it('incomeRanges and income agree (same Estimated_Income_Amount_Int column)', () => {
    const incomeRanges = FILTER_DIMENSIONS.find((d) => d.key === 'incomeRanges')
    const income = FILTER_DIMENSIONS.find((d) => d.key === 'income')
    expect(incomeRanges?.provenance).toBe(income?.provenance)
  })
})

describe('ContactsService.getFilterDimensions', () => {
  const buildService = () =>
    new ContactsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
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
    const winOnlyKeys = new Set(
      FILTER_DIMENSIONS.filter((d) => d.modes === 'win').map((d) => d.key),
    )
    const winKeys = buildService()
      .getFilterDimensions(organization('win-campaign'))
      .map((d) => d.key)
    const serveKeys = buildService()
      .getFilterDimensions(organization('eo-city-council'))
      .map((d) => d.key)
    expect(winKeys.filter((key) => !winOnlyKeys.has(key))).toEqual(serveKeys)
  })

  // Guards against a future .map() in the mode filter that reshapes
  // dimensions and drops the field.
  it('preserves provenance on every classified dimension for a Serve org', () => {
    const dimensions = buildService().getFilterDimensions(
      organization('eo-city-council'),
    )
    expect(dimensions.length).toBeGreaterThan(0)
    const classified = dimensions.filter(
      (d) => !UNCLASSIFIED_PROVENANCE_DIMENSIONS.has(d.key),
    )
    expect(classified.every((d) => typeof d.provenance === 'string')).toBe(true)
    expect(dimensions.find((d) => d.key === 'ethnicity')?.provenance).toBe(
      'modeled',
    )
  })
})
