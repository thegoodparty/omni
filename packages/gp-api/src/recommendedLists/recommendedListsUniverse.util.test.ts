import { describe, expect, it } from 'vitest'
import { buildVariantFilter } from './recommendedListsUniverse.util'
import { ElectionCode } from '@/elections/types/elections.types'

describe('buildVariantFilter', () => {
  it('builds the intro universe as reliable propensity plus never-ided', () => {
    const filter = buildVariantFilter(
      'introNeverIded',
      'sms',
      null,
      ElectionCode.General,
    )
    expect(filter).toMatchObject({
      voterStatus: ['Super', 'Likely'],
      supportStatus: ['unknown'],
      hasCellPhone: true,
    })
  })

  it('never includes Unknown in a propensity band', () => {
    const variants = [
      'introNeverIded',
      'persuadeAffinity',
      'eventAffinity',
      'electionDayAffinity',
    ] as const
    for (const variant of variants) {
      const filter = buildVariantFilter(
        variant,
        'sms',
        null,
        ElectionCode.General,
      )
      expect(filter?.voterStatus ?? []).not.toContain('Unknown')
    }
  })

  it('returns null for an ideology variant with no target bucket', () => {
    expect(
      buildVariantFilter('persuadeIdeology', 'sms', null, ElectionCode.General),
    ).toBeNull()
  })

  it('maps the progressive bucket to the Liberal boolean field', () => {
    const filter = buildVariantFilter(
      'persuadeIdeology',
      'sms',
      'progressive',
      ElectionCode.General,
    )
    expect(filter).toMatchObject({ ideologyLiberal: true })
    expect(filter?.ideologyConservative).toBeUndefined()
    expect(filter?.ideologyModerate).toBeUndefined()
    expect(filter?.ideologyUnknown).toBeUndefined()
  })

  it('expresses the event support exclusion as its complement', () => {
    const filter = buildVariantFilter(
      'eventAffinity',
      'sms',
      null,
      ElectionCode.General,
    )
    expect(filter?.supportStatus?.sort()).toEqual(
      ['refused', 'supporter', 'undecided', 'unknown'].sort(),
    )
  })

  it('gives the supporter variants no propensity band', () => {
    expect(
      buildVariantFilter('eventSupporters', 'sms', null, ElectionCode.General),
    ).toMatchObject({
      supportStatus: ['supporter'],
    })
    expect(
      buildVariantFilter('eventSupporters', 'sms', null, ElectionCode.General)
        ?.voterStatus,
    ).toBeUndefined()
  })

  it('excludes Super from the election-day supporter chase', () => {
    const filter = buildVariantFilter(
      'electionDaySupporters',
      'sms',
      null,
      ElectionCode.General,
    )
    expect(filter?.voterStatus).toEqual(['Likely', 'Unreliable', 'Unlikely'])
  })

  it('applies the channel contactability refinement', () => {
    expect(
      buildVariantFilter('persuadeAffinity', 'sms', null, ElectionCode.General),
    ).toMatchObject({
      hasCellPhone: true,
    })
    expect(
      buildVariantFilter(
        'persuadeAffinity',
        'robocall',
        null,
        ElectionCode.General,
      ),
    ).toMatchObject({ hasAnyPhone: true })
    expect(
      buildVariantFilter(
        'persuadeAffinity',
        'phoneBanking',
        null,
        ElectionCode.General,
      ),
    ).toMatchObject({ hasAnyPhone: true })
    expect(
      buildVariantFilter(
        'persuadeAffinity',
        'doorKnocking',
        null,
        ElectionCode.General,
      ),
    ).not.toHaveProperty('hasCellPhone')
  })

  it('never sets both hasAnyPhone and a specific phone flag', () => {
    const filter = buildVariantFilter(
      'persuadeAffinity',
      'robocall',
      null,
      ElectionCode.General,
    )
    expect(filter?.hasCellPhone).toBeUndefined()
    expect(filter?.hasLandline).toBeUndefined()
  })

  it('builds the exact persuade-undecided shape, no extra keys', () => {
    const filter = buildVariantFilter(
      'persuadeUndecided',
      'sms',
      null,
      ElectionCode.General,
    )
    expect(filter).toEqual({
      voterStatus: ['Super', 'Likely'],
      supportStatus: ['undecided'],
      hasCellPhone: true,
    })
  })

  it('returns null for eventIdeology with no target bucket', () => {
    expect(
      buildVariantFilter('eventIdeology', 'sms', null, ElectionCode.General),
    ).toBeNull()
  })

  it('builds the exact event-ideology shape, no extra keys', () => {
    const filter = buildVariantFilter(
      'eventIdeology',
      'sms',
      'progressive',
      ElectionCode.General,
    )
    expect(filter).toEqual({
      voterStatus: ['Super'],
      supportStatus: ['supporter', 'undecided', 'unknown', 'refused'],
      ideologyLiberal: true,
      hasCellPhone: true,
    })
  })

  it('builds the exact early-vote-supporters shape, no extra keys', () => {
    const filter = buildVariantFilter(
      'earlyVoteSupporters',
      'sms',
      null,
      ElectionCode.General,
    )
    expect(filter).toEqual({
      supportStatus: ['supporter'],
      hasCellPhone: true,
    })
  })

  it('builds the exact early-vote-affinity shape, no extra keys', () => {
    const filter = buildVariantFilter(
      'earlyVoteAffinity',
      'sms',
      null,
      ElectionCode.General,
    )
    expect(filter).toEqual({
      voterStatus: ['Super', 'Likely'],
      independentAffinity: true,
      hasCellPhone: true,
    })
  })

  it('returns null for earlyVoteIdeology with no target bucket', () => {
    expect(
      buildVariantFilter(
        'earlyVoteIdeology',
        'sms',
        null,
        ElectionCode.General,
      ),
    ).toBeNull()
  })

  it('builds the exact early-vote-ideology shape, no extra keys', () => {
    const filter = buildVariantFilter(
      'earlyVoteIdeology',
      'sms',
      'conservative',
      ElectionCode.General,
    )
    expect(filter).toEqual({
      voterStatus: ['Super', 'Likely'],
      ideologyConservative: true,
      hasCellPhone: true,
    })
  })

  it('returns null for electionDayIdeology with no target bucket', () => {
    expect(
      buildVariantFilter(
        'electionDayIdeology',
        'sms',
        null,
        ElectionCode.General,
      ),
    ).toBeNull()
  })

  it('builds the exact election-day-ideology shape, no extra keys', () => {
    const filter = buildVariantFilter(
      'electionDayIdeology',
      'sms',
      'moderate',
      ElectionCode.General,
    )
    expect(filter).toEqual({
      voterStatus: ['Likely', 'Unreliable'],
      ideologyModerate: true,
      hasCellPhone: true,
    })
  })
})

// The one turnout score in the people API is modelled for the November
// general of the current even year, so the `reliable` band is a November
// band. Off-cycle races draw about half that electorate and their contact
// goal halves with it, so they narrow one notch. See the note on
// `reliableBandFor`.
describe('buildVariantFilter propensity band by electorate', () => {
  // Every variant whose universe is built from the `reliable` band.
  const RELIABLE_BAND_VARIANTS = [
    'introNeverIded',
    'persuadeAffinity',
    'persuadeIdeology',
    'persuadeUndecided',
    'earlyVoteAffinity',
    'earlyVoteIdeology',
  ] as const

  const OFF_CYCLE = [
    ElectionCode.LocalOrMunicipal,
    ElectionCode.Primary,
    ElectionCode.ConsolidatedGeneral,
  ] as const

  it('keeps Super + Likely for a November general', () => {
    for (const variant of RELIABLE_BAND_VARIANTS) {
      const filter = buildVariantFilter(
        variant,
        'sms',
        'progressive',
        ElectionCode.General,
      )
      expect(filter?.voterStatus, variant).toEqual(['Super', 'Likely'])
    }
  })

  it('narrows to Super alone for every non-General electorate', () => {
    for (const electionCode of OFF_CYCLE) {
      for (const variant of RELIABLE_BAND_VARIANTS) {
        const filter = buildVariantFilter(
          variant,
          'sms',
          'progressive',
          electionCode,
        )
        expect(filter?.voterStatus, `${variant} / ${electionCode}`).toEqual([
          'Super',
        ])
      }
    }
  })

  // The null case is the documented decision point: an unresolved race keeps
  // today's behaviour rather than having its recommendations quietly
  // narrowed. If that decision is reversed, this is the test to flip.
  it('falls back to the November band when the electorate is unknown', () => {
    for (const variant of RELIABLE_BAND_VARIANTS) {
      const filter = buildVariantFilter(variant, 'sms', 'progressive', null)
      expect(filter?.voterStatus, variant).toEqual(['Super', 'Likely'])
    }
  })

  // Only the likely-voter screen moves. The GOTV bands sit deliberately
  // below it and are out of scope; the event variants are already at Super.
  it('leaves the GOTV and event bands untouched off-cycle', () => {
    const unchanged = {
      electionDaySupporters: ['Likely', 'Unreliable', 'Unlikely'],
      electionDayAffinity: ['Likely', 'Unreliable'],
      electionDayIdeology: ['Likely', 'Unreliable'],
      eventAffinity: ['Super'],
      eventIdeology: ['Super'],
    } as const

    for (const [variant, band] of Object.entries(unchanged)) {
      const filter = buildVariantFilter(
        variant as keyof typeof unchanged,
        'sms',
        'progressive',
        ElectionCode.LocalOrMunicipal,
      )
      expect(filter?.voterStatus, variant).toEqual(band)
    }
  })

  it('never includes Unknown in an off-cycle band either', () => {
    for (const variant of RELIABLE_BAND_VARIANTS) {
      const filter = buildVariantFilter(
        variant,
        'sms',
        'progressive',
        ElectionCode.LocalOrMunicipal,
      )
      expect(filter?.voterStatus ?? [], variant).not.toContain('Unknown')
    }
  })
})
