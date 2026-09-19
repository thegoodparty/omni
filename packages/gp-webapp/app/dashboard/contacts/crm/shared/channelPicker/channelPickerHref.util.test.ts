import { describe, expect, it } from 'vitest'
import type { RecommendedList } from '@goodparty_org/contracts'
import { channelPickerHref } from './channelPickerHref.util'

const RECOMMENDATION: RecommendedList = {
  variant: 'persuadeAffinity',
  intent: 'persuade',
  filter: { independentAffinity: true },
  count: 12,
  copy: { title: 'Persuadable independents', criteriaSummary: '' },
  existingFilterId: null,
}

describe('channelPickerHref', () => {
  it('opens the text flow on the hub with the saved list and the voter data source', () => {
    expect(
      channelPickerHref('text', {
        kind: 'list',
        segment: { id: 42, name: 'GOTV' },
      }),
    ).toBe('/dashboard/outreach?compose=text&source=voter_data&listId=42')
  })

  it('opens robocall and phone banking through the same compose param', () => {
    expect(channelPickerHref('robocall', { kind: 'universe' })).toBe(
      '/dashboard/outreach?compose=robocall&source=voter_data',
    )
    expect(
      channelPickerHref('phoneBanking', {
        kind: 'list',
        segment: { id: 7, name: 'x' },
      }),
    ).toBe(
      '/dashboard/outreach?compose=phoneBanking&source=voter_data&listId=7',
    )
  })

  // Social has no audience step, so nothing rides along but the source.
  it('opens the social flow with no audience', () => {
    expect(
      channelPickerHref('socialMedia', {
        kind: 'list',
        segment: { id: 42, name: 'GOTV' },
      }),
    ).toBe('/dashboard/outreach?compose=social&source=voter_data')
  })

  it('navigates door knocking straight to its create flow', () => {
    expect(
      channelPickerHref('doorKnocking', {
        kind: 'list',
        segment: { id: 42, name: 'GOTV' },
      }),
    ).toBe('/dashboard/door-knocking?create=1&listId=42')
    expect(channelPickerHref('doorKnocking', { kind: 'universe' })).toBe(
      '/dashboard/door-knocking?create=1',
    )
  })

  it('carries an unsaved recommendation as its variant', () => {
    expect(
      channelPickerHref('text', {
        kind: 'recommended',
        recommendation: RECOMMENDATION,
      }),
    ).toBe(
      '/dashboard/outreach?compose=text&source=voter_data&recommended=persuadeAffinity',
    )
    expect(
      channelPickerHref('doorKnocking', {
        kind: 'recommended',
        recommendation: RECOMMENDATION,
      }),
    ).toBe('/dashboard/door-knocking?create=1&recommended=persuadeAffinity')
  })

  it('carries a recommendation the candidate already saved as that list', () => {
    expect(
      channelPickerHref('text', {
        kind: 'recommended',
        recommendation: { ...RECOMMENDATION, existingFilterId: 501 },
      }),
    ).toBe('/dashboard/outreach?compose=text&source=voter_data&listId=501')
  })
})
