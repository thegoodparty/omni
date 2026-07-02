import type {
  RaceOpponentFieldAnalysis,
  RaceOpponentResponse,
  RaceOpponentSummarySourceRef,
} from 'gpApi/api-endpoints'
import { descriptorFor } from '../components/OpponentOverviewCard'
import { threatTierLabel } from '../components/ThreatTierBadge'

type Opponent = RaceOpponentResponse['opponents'][number]

// The PDF's data model, one entry per opponent. Deliberately mirrors what
// OpponentSummaryView renders on the page (and nothing the Lovable sample adds
// on top of it — no finance, no salience label, no recommended actions, no
// evidence lines). Building it as plain data keeps the mapping unit-testable
// without rendering react-pdf, and keeps the document a thin view over it.
//
// v2 (ENG-10637): the retired analytical sections (whyTheyMatter,
// whatYouNeedToKnow, whereSoft, issueContrasts, keyPositions) are gone — the
// page no longer renders them (ENG-10635), so the brief must not either, even
// off a legacy summary row that still carries those deprecated fields.
export type OpponentBriefSection =
  | {
      kind: 'overview'
      text: string
      // Normalized the same way OverviewSection does in RaceOpponentList.tsx:
      // a schemeless apex domain (the manual-entry persisted shape) would
      // render as a broken relative link, so the scheme is prepended here.
      websiteUrl: string | null
      sourceLines: string[]
    }
  | { kind: 'whyTheyreRunning'; text: string }
  | { kind: 'background'; text: string; sourceLines: string[] }
  | { kind: 'issuesThatMatter'; items: string[]; sourceLines: string[] }

export type OpponentBrief = {
  title: string
  // party · Incumbent/Challenger · threat-tier label — the same wording as the
  // roster row (OpponentOverviewCard descriptor + ThreatTierBadge). null when
  // none of the three is known.
  snapshot: string | null
  sections: OpponentBriefSection[]
}

// Opponents whose brief can be exported: those with a structured summary. An
// opponent with only raw research has no "brief" to render (the page shows the
// raw-research fallback for them, not the brief), so they're excluded.
export const opponentsWithBrief = (opponents: Opponent[]): Opponent[] =>
  opponents.filter((opponent) => opponent.summary)

const snapshotFor = (opponent: Opponent): string | null => {
  const parts = [
    descriptorFor(opponent.party, opponent.isIncumbent),
    opponent.threatTier ? threatTierLabel(opponent.threatTier) : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

const normalizeWebsiteUrl = (
  websiteUrl: string | null | undefined,
): string | null => {
  if (!websiteUrl) return null
  return /^https?:\/\//.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`
}

// "publisher — url" per source, deduped by url. Description is intentionally
// omitted — print citations are compact lines, no hover carousel (ENG-10637).
// Reads `url` directly (the rich field the contract always backfills) rather
// than the legacy `sourceUrl` passthrough the PDF used to prefer: the wire now
// carries rich fields, so rich-first is the correct default.
const formatSourceLine = (source: RaceOpponentSummarySourceRef): string =>
  `${source.publisher} — ${source.url}`

const sourceLinesFor = (sources: RaceOpponentSummarySourceRef[]): string[] => {
  const seen = new Set<string>()
  return sources
    .filter((source) => {
      if (seen.has(source.url)) return false
      seen.add(source.url)
      return true
    })
    .map(formatSourceLine)
}

// Maps one opponent to its brief, applying the exact same section conditionals
// as OpponentSummaryView so the PDF can't drift from the page. An opponent with
// no summary yields an empty section list (callers filter first via
// opponentsWithBrief). A legacy summary (only the pre-v2 overview/background
// fields) falls back to overview + background, same as the page.
export const buildOpponentBrief = (opponent: Opponent): OpponentBrief => {
  const title = `Opponent brief: ${opponent.opponentName}`
  const snapshot = snapshotFor(opponent)
  const summary = opponent.summary
  if (!summary) return { title, snapshot, sections: [] }

  const sections: OpponentBriefSection[] = []

  if (summary.overview) {
    sections.push({
      kind: 'overview',
      text: summary.overview.text,
      websiteUrl: normalizeWebsiteUrl(opponent.websiteUrl),
      sourceLines: sourceLinesFor(summary.overview.sources),
    })
  }

  if (summary.whyTheyreRunning) {
    sections.push({
      kind: 'whyTheyreRunning',
      text: summary.whyTheyreRunning.text,
    })
  }

  if (summary.background) {
    sections.push({
      kind: 'background',
      text: summary.background.text,
      sourceLines: sourceLinesFor(summary.background.sources),
    })
  }

  if (summary.issuesThatMatter) {
    sections.push({
      kind: 'issuesThatMatter',
      items: summary.issuesThatMatter.items,
      sourceLines: sourceLinesFor(summary.issuesThatMatter.sources),
    })
  }

  return { title, snapshot, sections }
}

export type FieldAnalysisQuadrant = { label: string; items: string[] }

export type FieldAnalysisBrief = { quadrants: FieldAnalysisQuadrant[] }

const FIELD_ANALYSIS_QUADRANTS: Array<{
  key: 'strengths' | 'weaknesses' | 'opportunities' | 'threats'
  label: string
}> = [
  { key: 'strengths', label: 'Strengths' },
  { key: 'weaknesses', label: 'Weaknesses' },
  { key: 'opportunities', label: 'Opportunities' },
  { key: 'threats', label: 'Threats' },
]

// The document-level SWOT block, mirroring FieldAnalysisSection's omission
// rules exactly: an empty quadrant is dropped, and the whole block is omitted
// when fewer than 2 of the 4 quadrants have content (a single populated
// quadrant doesn't read as a "how you stack up against the field"
// comparison). null for a null/undefined fieldAnalysis.
export const buildFieldAnalysisBrief = (
  fieldAnalysis: RaceOpponentFieldAnalysis | null | undefined,
): FieldAnalysisBrief | null => {
  if (!fieldAnalysis) return null

  const quadrants = FIELD_ANALYSIS_QUADRANTS.map(({ key, label }) => ({
    label,
    items: fieldAnalysis[key],
  })).filter((quadrant) => quadrant.items.length > 0)

  if (quadrants.length < 2) return null

  return { quadrants }
}
