import type { OrdinanceSearchResult } from '../services/ordinanceFlowSearch.service'

// The subset of OrdinanceFlowSearchService the verifier needs; the real service
// satisfies it structurally, a fake satisfies it in unit tests.
export interface CitationSearch {
  search(query: string, count?: number): Promise<OrdinanceSearchResult>
}

// Distinctly-numbered legal references a blind judge cannot confirm from memory
// but a web search can: session laws, bills, general statutes, code sections,
// and numbered ordinances. Prose (city names, generic phrases) is deliberately
// excluded — those aren't checkable by an exact-identifier lookup, and feeding
// the judge a vague query yields noise, not verification.
const CITATION_PATTERNS: RegExp[] = [
  /\bS\.?L\.?\s*\d{4}-\d+/g, // S.L. 2026-39
  /\b(?:House Bill|Senate Bill|H\.?B\.?|S\.?B\.?)\s*\d+/g, // HB 162
  /\bG\.S\.\s*\d+[A-Z]?-\d+(?:\([a-z0-9]+\))?/g, // G.S. 160D-702(c)
  /\bOrd(?:inance)?\.?\s*(?:No\.?\s*)?[A-Z]?-?\d{2}-\d+/g, // Ord. O-23-57
]

const normalize = (raw: string): string => raw.replace(/\s+/g, ' ').trim()

// Extract the exact, distinctly-numbered legal citations from an artifact, in
// first-seen order, deduped case-insensitively, capped so verification stays
// bounded regardless of how many the artifact packs in.
export const extractCitations = (text: string, cap = 6): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const pattern of CITATION_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const value = normalize(match[0])
      const key = value.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(value)
    }
  }
  return out.slice(0, cap)
}

const formatHits = (result: Extract<OrdinanceSearchResult, { ok: true }>) =>
  result.results
    .slice(0, 3)
    .map((r) => `    • ${r.title} — ${r.url}\n      ${r.description}`)
    .join('\n')

// Search the web for each citation the artifact makes and format the results as
// verification evidence for the judge. Returns undefined when the artifact has
// no checkable citation, or when EVERY search was unavailable (no API key, all
// transport failures) — in that case there is no signal, so the judge should
// fall back to "don't fail a sourced claim you can't verify" rather than read a
// wall of "unavailable" as if it meant "not found". A concrete "no web results
// found" for a specifically-numbered provision IS signal and is kept.
export const gatherVerificationEvidence = async (
  search: CitationSearch,
  text: string,
  context = '',
): Promise<string | undefined> => {
  const citations = extractCitations(text)
  if (!citations.length) return undefined

  const blocks: string[] = []
  let anySearchSucceeded = false
  for (const citation of citations) {
    const query = context ? `${citation} ${context}` : citation
    const result = await search.search(query, 3)
    if (!result.ok) {
      blocks.push(
        `- "${citation}": lookup failed (${result.reason}) — treat this ` +
          'citation as unverified, not as fabricated',
      )
      continue
    }
    anySearchSucceeded = true
    blocks.push(
      result.results.length
        ? `- "${citation}":\n${formatHits(result)}`
        : `- "${citation}": no web results found`,
    )
  }
  return anySearchSucceeded ? blocks.join('\n') : undefined
}
