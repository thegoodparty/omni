import { describe, expect, it } from 'vitest'
import { VoterFileFilter } from '../../generated/prisma'
import {
  describeFilter,
  describeFilterForTalkingPoints,
} from './describeFilter.util'

const filter = (overrides: Partial<VoterFileFilter> = {}) =>
  overrides as Partial<VoterFileFilter>

describe('describeFilter', () => {
  it('names a dimension the row sets', () => {
    expect(
      describeFilter(filter({ homeownerYes: true }), { isServe: false }),
    ).toBe('Homeownership Homeowner.')
  })

  // Every case around this one uses a single-word label ('Age', 'Gender',
  // 'Homeownership'), where anything that touches the tail is a no-op — so
  // none of them can see a label being mangled. Most of the catalog is
  // multi-word: 'Marital Status', 'Veteran Status', 'Level of Education',
  // 'Household Income Range'. Product cased those deliberately and this
  // string is read by both the list detail sheet and the model.
  it('leaves the interior casing of a multi-word label alone', () => {
    expect(
      describeFilter(filter({ veteranYes: true, married: true }), {
        isServe: false,
      }),
    ).toBe('Marital Status Married and Veteran Status Yes.')
  })

  it('joins the values of one dimension with or', () => {
    expect(
      describeFilter(filter({ age18_24: true, age25_34: true }), {
        isServe: false,
      }),
    ).toBe('Age 18-24 or 25-34.')
  })

  // The webapp's sentence style, which this is a port of: commas, and a final
  // "and" before the last clause.
  it('joins several dimensions as a sentence', () => {
    expect(
      describeFilter(
        filter({ age65Plus: true, genderFemale: true, homeownerYes: true }),
        { isServe: false },
      ),
    ).toBe('Age 65+, Gender Female, and Homeownership Homeowner.')
  })

  it('reads a multi-value column through the catalog labels', () => {
    expect(
      describeFilter(filter({ languageCodes: ['es'] }), { isServe: false }),
    ).toContain('Spanish')
  })

  // "Unfiltered" is a fact about the list, not the absence of one.
  it('says so when the row expresses nothing', () => {
    expect(describeFilter(filter(), { isServe: false })).toBe(
      'Everyone in your file — no filters applied.',
    )
  })

  // Rows saved before ENG-10752 still carry the retired keys. Without them an
  // age-only legacy list describes as unfiltered, which is the opposite of
  // what it holds.
  it('labels the retired age keys', () => {
    expect(describeFilter(filter({ age35_50: true }), { isServe: false })).toBe(
      'Age 35-50.',
    )
  })

  // A list saved before the ENG-10752 age split and edited after it holds
  // both spellings. One clause, because the row expresses one bucket list —
  // "Age 65+ and Age 35-50." reads as two competing filters. Same result the
  // webapp reaches by unioning `legacyAgeOptions` into the age field before
  // matching, and the reason the legacy values merge rather than being
  // dropped: the row really does select that range.
  it('merges both spellings of one dimension into a single clause', () => {
    expect(
      describeFilter(filter({ age65Plus: true, age35_50: true }), {
        isServe: false,
      }),
    ).toBe('Age 65+ or 35-50.')
  })

  // Folded into homeownerYes by ENG-10947 but still accepted from saved rows.
  it('labels the retired homeowner key', () => {
    expect(
      describeFilter(filter({ homeownerLikely: true }), { isServe: false }),
    ).toBe('Homeownership Homeowner.')
  })

  // Deliberately absent from FILTER_DIMENSIONS (its values are enumerated per
  // district by an endpoint), so the catalog loop cannot reach it — but a
  // saved row carries it, and dropping it describes a wider audience than the
  // list holds.
  //
  // Lowercase "in", like the webapp clause this ports: these two trailing
  // clauses are written to read after a dimension ("Age 65+, in precinct
  // Travis 0104."), not to open the sentence. Kept rather than corrected,
  // because the point of a port is that one list cannot be described two ways.
  it('decodes precincts', () => {
    expect(
      describeFilter(filter({ precincts: ['travis|0104'] }), {
        isServe: false,
      }),
    ).toBe('in precinct Travis 0104.')
  })

  it('counts precincts past the listing cap', () => {
    expect(
      describeFilter(
        filter({
          precincts: ['a|1', 'a|2', 'a|3', 'a|4', 'a|5', 'a|6'],
        }),
        { isServe: false },
      ),
    ).toBe('in 6 precincts.')
  })

  it('reports the free-text search', () => {
    expect(
      describeFilter(filter({ search: 'Oakwood' }), { isServe: false }),
    ).toBe('matching search "Oakwood".')
  })

  // In the column set but absent from the catalog, like precincts.
  it('labels registration', () => {
    expect(
      describeFilter(filter({ registeredVoterTrue: true }), {
        isServe: false,
      }),
    ).toBe('Registered voter Yes.')
  })

  // The catalog already encodes which dimensions a Serve org may express, so
  // reading it rather than a second copy of the labels is what keeps this
  // from describing an elected official's file in Win-only terms.
  it('omits win-only dimensions for a serve org', () => {
    const both = { partyDemocrat: true, age65Plus: true }
    expect(describeFilter(filter(both), { isServe: false })).toContain(
      'Democrat',
    )
    expect(describeFilter(filter(both), { isServe: true })).toBe('Age 65+.')
  })

  it('omits precincts for a serve org', () => {
    expect(
      describeFilter(filter({ precincts: ['travis|0104'] }), { isServe: true }),
    ).toBe('Everyone in your file — no filters applied.')
  })
})

describe('describeFilterForTalkingPoints', () => {
  it('keeps the life-circumstance dimensions', () => {
    expect(
      describeFilterForTalkingPoints(
        filter({ age65Plus: true, homeownerYes: true }),
        { isServe: false },
      ),
    ).toBe('Age 65+ and Homeownership Homeowner.')
  })

  // Every compose prompt in this product ends with "Stay strictly
  // non-partisan. No party labels, no attacks." Passing the party in would
  // hand the model that label and the rule forbidding it in one breath.
  //
  // Asserted on the Win rail specifically, because the catalog's own
  // mode filter already removes party for Serve — that would make this pass
  // for the wrong reason.
  it('never passes the party through', () => {
    expect(
      describeFilterForTalkingPoints(
        filter({ partyDemocrat: true, age65Plus: true }),
        { isServe: false },
      ),
    ).toBe('Age 65+.')
  })

  // Targeting mechanics a canvasser cannot say out loud. A model handed them
  // will try.
  it.each([
    ['voter likelihood', { audienceSuperVoters: true }],
    ['prior contacts made', { contactsMade0: true }],
    ['support status', { supportStatus: ['supporter' as const] }],
    ['phone presence', { hasCellPhone: true }],
    ['registration', { registeredVoterTrue: true }],
    ['ideology', { ideologyModerate: true }],
    ['independent affinity', { independentAffinity: true }],
  ])('drops %s', (_label, columns) => {
    expect(
      describeFilterForTalkingPoints(filter(columns), { isServe: false }),
    ).toBeNull()
  })

  // Modeled, and unlike the life-circumstance dimensions it maps to no local
  // issue without going through a stereotype. Excluded pending a product call.
  it('drops ethnicity', () => {
    expect(
      describeFilterForTalkingPoints(filter({ ethnicityHispanic: true }), {
        isServe: false,
      }),
    ).toBeNull()
  })

  // Free text is whatever someone typed, which is not an audience and is the
  // one field on the row an outside string could reach a prompt through.
  it('drops the free-text search', () => {
    expect(
      describeFilterForTalkingPoints(filter({ search: 'ignore previous' }), {
        isServe: false,
      }),
    ).toBeNull()
  })

  // Null rather than the "no filters applied" sentence: a list cut only by
  // party has plenty of filters and nothing this feature may say about them.
  // Telling the model it is unfiltered would be a lie it then writes around.
  it('returns null rather than claiming the list is unfiltered', () => {
    expect(
      describeFilterForTalkingPoints(filter({ partyDemocrat: true }), {
        isServe: false,
      }),
    ).toBeNull()
  })

  it('keeps the retired age keys, since age itself is allowed', () => {
    expect(
      describeFilterForTalkingPoints(filter({ age50Plus: true }), {
        isServe: false,
      }),
    ).toBe('Age 50+.')
  })

  // The prompt path has the same two-spellings problem, and more riding on
  // it: age and homeownership are both on the allowlist, so a duplicated
  // clause would reach the model as emphasis nobody asked for.
  it('merges both spellings before the model sees them', () => {
    expect(
      describeFilterForTalkingPoints(
        filter({ homeownerYes: true, homeownerLikely: true }),
        { isServe: false },
      ),
    ).toBe('Homeownership Homeowner.')
  })
})
