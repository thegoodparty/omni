import { describe, expect, it } from 'vitest'
import { sortOrganizations } from './organizations.service'
import { ElectedOffice } from '../../generated/prisma'

const NOW = new Date('2026-06-01T00:00:00Z')

const office = (termEndDate: string | null) =>
  ({ termEndDate: termEndDate ? new Date(termEndDate) : null }) as ElectedOffice

const org = (slug: string, electedOffice: ElectedOffice | null = null) => ({
  slug,
  electedOffice,
})

const heldOffice = (slug: string) => org(slug, office('2028-01-01'))
const endedOffice = (slug: string) => org(slug, office('2025-01-01'))

describe('sortOrganizations', () => {
  it('leads with the org for an office the user currently holds', () => {
    // The query returns oldest first, so the campaign they won with comes back
    // ahead of the office it led to.
    const sorted = sortOrganizations(
      [org('campaign-1'), heldOffice('eo-9')],
      NOW,
    )

    expect(sorted.map((o) => o.slug)).toEqual(['eo-9', 'campaign-1'])
  })

  it('leaves an office whose term has ended in place', () => {
    // A former office holder running again belongs in their campaign, not in a
    // dashboard for a seat they no longer hold. Matches the "Past" the picker
    // already labels that org with.
    const sorted = sortOrganizations(
      [org('campaign-1'), endedOffice('eo-8')],
      NOW,
    )

    expect(sorted.map((o) => o.slug)).toEqual(['campaign-1', 'eo-8'])
  })

  it('does not lead with an office that has no term dates yet', () => {
    // isHeldOffice reads a null termEndDate as "we lack term data", which is
    // the same call behind the status the picker greys out. This ordering
    // inherits that rather than inventing a second notion of "held" that would
    // disagree with what the picker displays.
    const sorted = sortOrganizations(
      [org('campaign-1'), org('eo-9', office(null))],
      NOW,
    )

    expect(sorted.map((o) => o.slug)).toEqual(['campaign-1', 'eo-9'])
  })

  it('promotes a held office from anywhere in the list', () => {
    const sorted = sortOrganizations(
      [org('campaign-1'), org('campaign-2'), heldOffice('eo-9')],
      NOW,
    )

    expect(sorted.map((o) => o.slug)).toEqual([
      'eo-9',
      'campaign-1',
      'campaign-2',
    ])
  })

  it('preserves the query order among orgs of equal rank', () => {
    // The sort only promotes a held office. It must not reshuffle anything
    // else, or the picker's order would move for the many users who hold no
    // office at all.
    const sorted = sortOrganizations(
      [org('campaign-1'), org('campaign-2'), org('campaign-3')],
      NOW,
    )

    expect(sorted.map((o) => o.slug)).toEqual([
      'campaign-1',
      'campaign-2',
      'campaign-3',
    ])
  })

  it('keeps the relative order of multiple held offices', () => {
    const sorted = sortOrganizations(
      [org('campaign-1'), heldOffice('eo-9'), heldOffice('eo-10')],
      NOW,
    )

    expect(sorted.map((o) => o.slug)).toEqual(['eo-9', 'eo-10', 'campaign-1'])
  })

  it('is a no-op for a single-org user', () => {
    expect(
      sortOrganizations([org('campaign-1')], NOW).map((o) => o.slug),
    ).toEqual(['campaign-1'])
    expect(
      sortOrganizations([heldOffice('eo-9')], NOW).map((o) => o.slug),
    ).toEqual(['eo-9'])
  })

  it('handles an empty list', () => {
    expect(sortOrganizations([], NOW)).toEqual([])
  })

  it('does not mutate the caller array', () => {
    // The input is Prisma's own result; reordering it in place is a side
    // effect no caller asked for.
    const input = [org('campaign-1'), heldOffice('eo-9')]

    sortOrganizations(input, NOW)

    expect(input.map((o) => o.slug)).toEqual(['campaign-1', 'eo-9'])
  })

  it('treats the term end date as exclusive, matching isHeldOffice', () => {
    // A term ending today is over today: the successor takes over at that
    // boundary. Asserted here so this ordering can never drift from the
    // predicate the rest of the app shares.
    const endsToday = org('eo-9', office('2026-06-01'))

    const sorted = sortOrganizations([org('campaign-1'), endsToday], NOW)

    expect(sorted.map((o) => o.slug)).toEqual(['campaign-1', 'eo-9'])
  })
})
