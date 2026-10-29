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
  'age18_25',
  'age25_35',
  'age35_50',
  'age50Plus',
  // Legacy wire value: still accepted from saved filters persisted before
  // the Homeowner/Renter/Unknown collapse (ENG-10947), but no longer
  // offered as its own catalog option.
  'homeownerLikely',
  // The managed civic panel's wave draw criteria: set by gp-api, never
  // offered for an official or the assistant to pick.
  'civicPanelNeverInvited',
])

const valueKeysOf = (key: string): string[] => {
  const dimension = FILTER_DIMENSIONS.find((d) => d.key === key)
  return dimension && 'values' in dimension
    ? dimension.values.map((value) => value.key)
    : []
}

const schemaFieldKeys = new Set(Object.keys(voterFilterBaseSchema.shape))

// Every schema field the catalog claims to cover: boolean-group value keys,
// date-range from/to keys, plus multi-value/activity dimension keys (those dimensions' keys ARE the
// schema array fields).
const catalogSchemaFields = new Set(
  FILTER_DIMENSIONS.flatMap((dimension) =>
    dimension.kind === 'boolean-group'
      ? dimension.values.map((value) => value.key)
      : dimension.kind === 'date-range'
        ? [dimension.fromKey, dimension.toKey]
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
  // SupportStatusService.personIdsByEffectiveStatus resolves refused
  // (override-only, ENG-10833) alongside the four derivable ones, so the
  // assistant/wizard can safely build a filter on any of them.
  it('sources supportStatus values from the full SupportStatusRollup vocabulary', () => {
    expect(valueKeysOf('supportStatus')).toEqual([
      'supporter',
      'non_supporter',
      'unknown',
      'undecided',
      'refused',
    ])
  })

  it('sources income and language values from the conversion maps', () => {
    expect(valueKeysOf('incomeRanges')).toEqual(
      Object.keys(INCOME_RANGE_MAPPING),
    )
    expect(valueKeysOf('languageCodes')).toEqual(
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
        'earlyVote',
        'education',
        'ethnicity',
        'homeowner',
        'ideology',
        'income',
        'incomeRanges',
        'independentAffinity',
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
  const PANELS_ON = { citizenPanels: true }

  it('leaves the civic panel dimensions out while the flag is off', () => {
    const off = buildService()
      .getFilterDimensions(organization('eo-city-council'), {
        citizenPanels: false,
      })
      .map((d) => d.key)
    const on = buildService()
      .getFilterDimensions(organization('eo-city-council'), PANELS_ON)
      .map((d) => d.key)
    expect(off).not.toContain('civicPanel')
    expect(off).not.toContain('contactHistory')
    expect(on).toEqual(expect.arrayContaining(['civicPanel', 'contactHistory']))
    expect(on.filter((key) => !off.includes(key)).sort()).toEqual([
      'civicPanel',
      'civicPanelJoinedBy',
      'civicPanelJoinedWhen',
      'contactHistory',
      'lastAsked',
    ])
  })

  it('includes party for a Win organization', () => {
    const dimensions = buildService().getFilterDimensions(
      organization('win-campaign'),
      PANELS_ON,
    )
    expect(dimensions.map((d) => d.key)).toContain('party')
  })

  it('strips party (and any Win-only dimension) for an eo- organization', () => {
    const dimensions = buildService().getFilterDimensions(
      organization('eo-city-council'),
      PANELS_ON,
    )
    expect(dimensions.some((d) => d.modes === 'win')).toBe(false)
    expect(dimensions.map((d) => d.key)).not.toContain('party')
  })

  // Named rather than left to the `modes === 'win'` sweep above, because
  // this one is a product rule someone could plausibly "fix" back to 'both':
  // #1933 barred ethnicity subsetting for both products and the Win half was
  // reverted, so Serve is the half that must hold.
  it('offers ethnicity to Win and never to an eo- organization', () => {
    const winKeys = buildService()
      .getFilterDimensions(organization('win-campaign'), PANELS_ON)
      .map((d) => d.key)
    const serveKeys = buildService()
      .getFilterDimensions(organization('eo-city-council'), PANELS_ON)
      .map((d) => d.key)
    expect(winKeys).toContain('ethnicity')
    expect(serveKeys).not.toContain('ethnicity')
  })

  // Named for the same reason as ethnicity: 'audience' (turnout likelihood)
  // is still 'both', so early vote could plausibly be "fixed" to match it.
  it('offers early vote likelihood to Win and never to an eo- organization', () => {
    const winKeys = buildService()
      .getFilterDimensions(organization('win-campaign'), PANELS_ON)
      .map((d) => d.key)
    const serveKeys = buildService()
      .getFilterDimensions(organization('eo-city-council'), PANELS_ON)
      .map((d) => d.key)
    expect(winKeys).toContain('earlyVote')
    expect(serveKeys).not.toContain('earlyVote')
  })

  it('labels Voted in election Yes and No/Unknown', () => {
    const voted = buildService()
      .getFilterDimensions(organization('win-campaign'), PANELS_ON)
      .find((d) => d.key === 'votedStatus')
    expect(voted?.kind).toBe('multi-value')
    expect(
      voted?.kind === 'multi-value' && voted.values.map((v) => v.label),
    ).toEqual(['Yes', 'No/Unknown'])
    expect(voted?.provenance).toBe('observed')
  })

  // Each mode sees the shared dimensions plus only its own. Stated
  // symmetrically because both products now have exclusives — this used to
  // assert Win-minus-win-only === Serve outright, which held only while
  // `serve` was an empty set.
  it('returns the shared dimensions for both modes', () => {
    const keysForMode = (mode: 'win' | 'serve') =>
      new Set(
        FILTER_DIMENSIONS.filter((d) => d.modes === mode).map((d) => d.key),
      )
    const winOnlyKeys = keysForMode('win')
    const serveOnlyKeys = keysForMode('serve')
    const winKeys = buildService()
      .getFilterDimensions(organization('win-campaign'), PANELS_ON)
      .map((d) => d.key)
    const serveKeys = buildService()
      .getFilterDimensions(organization('eo-city-council'), PANELS_ON)
      .map((d) => d.key)

    expect(winKeys.filter((key) => !winOnlyKeys.has(key))).toEqual(
      serveKeys.filter((key) => !serveOnlyKeys.has(key)),
    )
    // And each mode's exclusives actually reach it, so the filter above
    // cannot pass by dropping both sides.
    expect(winKeys).toEqual(expect.arrayContaining([...winOnlyKeys]))
    expect(serveKeys).toEqual(expect.arrayContaining([...serveOnlyKeys]))
    expect(winKeys.some((key) => serveOnlyKeys.has(key))).toBe(false)
    expect(serveKeys.some((key) => winOnlyKeys.has(key))).toBe(false)
  })

  // Guards against a future .map() in the mode filter that reshapes
  // dimensions and drops the field.
  it('preserves provenance on every classified dimension for a Serve org', () => {
    const dimensions = buildService().getFilterDimensions(
      organization('eo-city-council'),
      PANELS_ON,
    )
    expect(dimensions.length).toBeGreaterThan(0)
    const classified = dimensions.filter(
      (d) => !UNCLASSIFIED_PROVENANCE_DIMENSIONS.has(d.key),
    )
    expect(classified.every((d) => typeof d.provenance === 'string')).toBe(true)
    // A named spot-check so the sweep above cannot pass vacuously. `education`
    // rather than `ethnicity`, which used to stand here: ethnicity is
    // `modes: 'win'` now and never reaches a Serve catalog to be checked.
    expect(dimensions.find((d) => d.key === 'education')?.provenance).toBe(
      'modeled',
    )
  })

  // The same guard on the Win side, where ethnicity does reach the catalog —
  // it is modeled, and the assistant has to hedge every count built from it.
  it('preserves provenance on the Win-only dimensions', () => {
    const dimensions = buildService().getFilterDimensions(
      organization('win-campaign'),
      PANELS_ON,
    )
    expect(dimensions.find((d) => d.key === 'ethnicity')?.provenance).toBe(
      'modeled',
    )
  })
})

// Party is a registration only where the state reports one; elsewhere L2
// assigns it from primary ballots or models it (peopleDb/partySource.ts),
// and the catalog's static "observed" mark would have the model report an
// estimate as a fact on the file.
describe('ContactsService.getFilterDimensions: party by state', () => {
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
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      createMockLogger() as unknown as PinoLogger,
    )
  const win = { slug: 'win-campaign' } as Organization
  const party = (state: string | null | undefined) =>
    buildService()
      .getFilterDimensions(win, { citizenPanels: true, state })
      .find((d) => d.key === 'party')

  it('marks party observed, with no note, where the state registers by party', () => {
    expect(party('CA')?.provenance).toBe('observed')
    expect(party('CA')?.note).toBeUndefined()
  })

  it('keeps the catalog entry as it is when no state is known', () => {
    expect(party(null)?.provenance).toBe('observed')
    expect(party(undefined)?.note).toBeUndefined()
  })

  it("marks party modeled, with the vendor's account as the note, elsewhere", () => {
    const minnesota = party('MN')
    expect(minnesota?.provenance).toBe('modeled')
    expect(minnesota?.note).toBe(
      'Minnesota provides no party information in its voter file. The ' +
        "voter file vendor models every voter's party from commercial " +
        'data, with a limited amount of partisan-contribution and ' +
        'office-holding records.',
    )
    expect(party('TX')?.provenance).toBe('modeled')
    expect(party('TX')?.note).toMatch(/^Texas voters do not register by party/)
  })

  it('changes nothing else about the Win catalog', () => {
    const plain = buildService().getFilterDimensions(win, {
      citizenPanels: true,
    })
    const modeled = buildService().getFilterDimensions(win, {
      citizenPanels: true,
      state: 'MN',
    })
    expect(modeled.map((d) => d.key)).toEqual(plain.map((d) => d.key))
    expect(modeled.filter((d) => d.key !== 'party')).toEqual(
      plain.filter((d) => d.key !== 'party'),
    )
    expect(modeled.find((d) => d.key === 'party')).toEqual({
      ...plain.find((d) => d.key === 'party'),
      provenance: 'modeled',
      note: expect.any(String),
    })
  })

  it('still strips party for an eo- organization whatever the state', () => {
    const keys = buildService()
      .getFilterDimensions({ slug: 'eo-city-council' } as Organization, {
        citizenPanels: true,
        state: 'MN',
      })
      .map((d) => d.key)
    expect(keys).not.toContain('party')
  })
})
