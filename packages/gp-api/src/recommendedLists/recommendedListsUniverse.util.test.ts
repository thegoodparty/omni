import { describe, expect, it } from 'vitest'
import { buildVariantFilter } from './recommendedListsUniverse.util'

describe('buildVariantFilter', () => {
  it('builds the intro universe as reliable propensity plus never-ided', () => {
    const filter = buildVariantFilter('introNeverIded', 'sms', null)
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
      const filter = buildVariantFilter(variant, 'sms', null)
      expect(filter?.voterStatus ?? []).not.toContain('Unknown')
    }
  })

  it('returns null for an ideology variant with no target bucket', () => {
    expect(buildVariantFilter('persuadeIdeology', 'sms', null)).toBeNull()
  })

  it('maps the progressive bucket to the Liberal boolean field', () => {
    const filter = buildVariantFilter('persuadeIdeology', 'sms', 'progressive')
    expect(filter).toMatchObject({ ideologyLiberal: true })
    expect(filter?.ideologyConservative).toBeUndefined()
    expect(filter?.ideologyModerate).toBeUndefined()
    expect(filter?.ideologyUnknown).toBeUndefined()
  })

  it('expresses the event support exclusion as its complement', () => {
    const filter = buildVariantFilter('eventAffinity', 'sms', null)
    expect(filter?.supportStatus?.sort()).toEqual(
      ['refused', 'supporter', 'undecided', 'unknown'].sort(),
    )
  })

  it('gives the supporter variants no propensity band', () => {
    expect(buildVariantFilter('eventSupporters', 'sms', null)).toMatchObject({
      supportStatus: ['supporter'],
    })
    expect(
      buildVariantFilter('eventSupporters', 'sms', null)?.voterStatus,
    ).toBeUndefined()
  })

  it('excludes Super from the election-day supporter chase', () => {
    const filter = buildVariantFilter('electionDaySupporters', 'sms', null)
    expect(filter?.voterStatus).toEqual(['Likely', 'Unreliable', 'Unlikely'])
  })

  it('applies the channel contactability refinement', () => {
    expect(buildVariantFilter('persuadeAffinity', 'sms', null)).toMatchObject({
      hasCellPhone: true,
    })
    expect(
      buildVariantFilter('persuadeAffinity', 'robocall', null),
    ).toMatchObject({ hasAnyPhone: true })
    expect(
      buildVariantFilter('persuadeAffinity', 'phoneBanking', null),
    ).toMatchObject({ hasAnyPhone: true })
    expect(
      buildVariantFilter('persuadeAffinity', 'doorKnocking', null),
    ).not.toHaveProperty('hasCellPhone')
  })

  it('never sets both hasAnyPhone and a specific phone flag', () => {
    const filter = buildVariantFilter('persuadeAffinity', 'robocall', null)
    expect(filter?.hasCellPhone).toBeUndefined()
    expect(filter?.hasLandline).toBeUndefined()
  })
})
