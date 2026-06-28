import { Injectable } from '@nestjs/common'
import {
  CONTRAST_ALLOWED_CATEGORIES,
  CONTRAST_INFLATION_TERMS,
} from '../raceOpponent.constants'

export type ToneCheckResult = {
  // The de-escalated sentence with motive/adjective inflation stripped.
  sentence: string
  // True when a strip actually fired — the draft carried inflation and is
  // therefore near-the-line, so it must route to the human review gate rather
  // than return to the candidate directly.
  nearTheLine: boolean
}

const ALLOWED = new Set<string>(CONTRAST_ALLOWED_CATEGORIES)

// Normalize a free-text category to the allowlist's canonical form: lowercase,
// trim, collapse spaces/dashes to single underscores. 'Public Record' and
// 'public-record' both normalize to 'public_record'.
const normalizeCategory = (category: string): string =>
  category
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')

// Server-side category allowlist + deterministic de-escalation. The allowlist
// is the enforced gate (no family/health/private-life/rumor — only public
// conduct); the strip is a simple, predictable pass, not an LLM call, so the
// fair-line routing decision is reproducible and testable.
@Injectable()
export class ContrastToneService {
  isCategoryAllowed(category: string): boolean {
    return ALLOWED.has(normalizeCategory(category))
  }

  // Strips inflation terms (whole-word, case-insensitive) and reports whether
  // anything was removed. A removal means the draft was inflated and is
  // near-the-line. The term match consumes a trailing punctuation char so a
  // comma-separated list ('corrupt, reckless record') doesn't leave stranded
  // commas; remaining stranded punctuation and double spaces are then cleaned.
  check(sentence: string): ToneCheckResult {
    const pattern = new RegExp(
      `\\b(?:${CONTRAST_INFLATION_TERMS.join('|')})\\b[,;:]?`,
      'gi',
    )
    const stripped = sentence.replace(pattern, '')
    const nearTheLine = stripped !== sentence
    const cleaned = stripped
      .replace(/\s{2,}/g, ' ')
      .replace(/(^|\s)[,;:]/g, '')
      .replace(/\s+\./g, '.')
      .trim()
    return { sentence: cleaned, nearTheLine }
  }
}
