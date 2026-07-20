import { describe, expect, it, vi } from 'vitest'
import type { OrdinanceSearchResult } from '../services/ordinanceFlowSearch.service'
import {
  extractCitations,
  gatherVerificationEvidence,
  type CitationSearch,
} from './verifyCitations'

const AUTHORITY_ARTIFACT = [
  'The council has zoning authority under G.S. 160D-702(a). However, the',
  'artifact relies on S.L. 2026-39 (House Bill 162), signed July 6, 2026,',
  'which amends G.S. 160D-702(c). See also HB 162 as introduced.',
].join(' ')

const ok = (results: { title: string; url: string; description: string }[]) =>
  ({ ok: true, query: 'q', results }) as OrdinanceSearchResult

const fakeSearch = (
  impl: (query: string) => OrdinanceSearchResult,
): CitationSearch => ({
  search: vi.fn(async (query: string) => impl(query)),
})

describe('extractCitations', () => {
  it('pulls session laws, bills, and statute subsections', () => {
    const found = extractCitations(AUTHORITY_ARTIFACT)

    expect(found).toContain('S.L. 2026-39')
    expect(found).toContain('G.S. 160D-702(a)')
    expect(found).toContain('G.S. 160D-702(c)')
    expect(found.some((c) => /162/.test(c))).toBe(true)
  })

  it('dedups case-insensitively and caps the count', () => {
    const text = 'G.S. 160D-702 and g.s. 160D-702 again'
    expect(extractCitations(text)).toEqual(['G.S. 160D-702'])

    const many = Array.from({ length: 10 }, (_, i) => `S.L. 2026-${i}`).join(
      ' ',
    )
    expect(extractCitations(many, 6)).toHaveLength(6)
  })

  it('returns nothing for prose with no numbered citations', () => {
    expect(
      extractCitations('The city of Charlotte adopted a bike parking rule.'),
    ).toEqual([])
  })
})

describe('gatherVerificationEvidence', () => {
  it('returns undefined when the artifact cites nothing checkable', async () => {
    const search = fakeSearch(() => ok([]))
    expect(
      await gatherVerificationEvidence(search, 'plain prose, no citations'),
    ).toBeUndefined()
    expect(search.search).not.toHaveBeenCalled()
  })

  it('formats corroborating hits per citation', async () => {
    const search = fakeSearch((q) =>
      q.startsWith('S.L. 2026-39')
        ? ok([
            {
              title: 'House Bill 162 / SL 2026-39',
              url: 'https://www.ncleg.gov/BillLookup/2025/H162',
              description: 'Signed into law; parking minimums.',
            },
          ])
        : ok([]),
    )

    const evidence = await gatherVerificationEvidence(
      search,
      'Relies on S.L. 2026-39 to preempt minimums.',
    )

    expect(evidence).toContain('S.L. 2026-39')
    expect(evidence).toContain('ncleg.gov/BillLookup/2025/H162')
  })

  it('marks a specifically-numbered citation with no results as not found', async () => {
    const search = fakeSearch(() => ok([]))

    const evidence = await gatherVerificationEvidence(
      search,
      'Relies on S.L. 2099-99 to do the thing.',
    )

    expect(evidence).toContain('no web results found')
  })

  it('returns undefined when every search is unavailable (no signal)', async () => {
    const search = fakeSearch(
      () => ({ ok: false, reason: 'not_configured' }) as OrdinanceSearchResult,
    )

    const evidence = await gatherVerificationEvidence(
      search,
      'Relies on S.L. 2026-39 and G.S. 160D-702.',
    )

    expect(evidence).toBeUndefined()
  })

  it('marks a failed lookup as unverified-not-fabricated when others succeeded', async () => {
    const search = fakeSearch((q) =>
      q.startsWith('S.L. 2026-39')
        ? ok([
            {
              title: 'House Bill 162 / SL 2026-39',
              url: 'https://www.ncleg.gov/BillLookup/2025/H162',
              description: 'Signed into law.',
            },
          ])
        : ({ ok: false, reason: 'timeout' } as OrdinanceSearchResult),
    )

    const evidence = await gatherVerificationEvidence(
      search,
      'Relies on S.L. 2026-39 and G.S. 160D-702.',
    )

    // A transport failure next to real hits must read as no-signal for that
    // one citation — never as "no trace found" (the fabrication signal).
    expect(evidence).toContain('ncleg.gov')
    expect(evidence).toContain('unverified, not as fabricated')
    expect(evidence).not.toContain('no web results found')
  })
})
