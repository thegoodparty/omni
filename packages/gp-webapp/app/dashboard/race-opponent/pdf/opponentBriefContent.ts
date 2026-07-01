import type {
  RaceOpponentResponse,
  RaceOpponentSummaryKeyPosition,
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
export type OpponentBriefSection =
  | {
      kind: 'overview'
      paragraphs: string[]
      sources: RaceOpponentSummarySourceRef[]
    }
  | { kind: 'whyTheyMatter'; text: string }
  | { kind: 'whatYouNeedToKnow'; items: string[] }
  | {
      kind: 'whereSoft'
      items: Array<{ text: string; sources: RaceOpponentSummarySourceRef[] }>
    }
  | {
      kind: 'issueContrasts'
      // Only the fields IssueContrastCard renders. `salience` is intentionally
      // dropped: the on-screen card doesn't surface it, so the brief must not
      // either.
      contrasts: Array<{
        issue: string
        whyItMatters: string
        opponentStance: string
        opponentSources: RaceOpponentSummarySourceRef[]
        candidateStance: string
      }>
    }
  | { kind: 'keyPositions'; positions: RaceOpponentSummaryKeyPosition[] }

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

// Maps one opponent to its brief, applying the exact same section conditionals
// as OpponentSummaryView so the PDF can't drift from the page. An opponent with
// no summary yields an empty section list (callers filter first via
// opponentsWithBrief).
export const buildOpponentBrief = (opponent: Opponent): OpponentBrief => {
  const title = `Opponent brief: ${opponent.opponentName}`
  const snapshot = snapshotFor(opponent)
  const summary = opponent.summary
  if (!summary) return { title, snapshot, sections: [] }

  const sections: OpponentBriefSection[] = []

  if (summary.overview || summary.background) {
    const seen = new Set<string>()
    const sources = [
      ...(summary.overview?.sources ?? []),
      ...(summary.background?.sources ?? []),
    ].filter((source) => {
      if (seen.has(source.sourceUrl)) return false
      seen.add(source.sourceUrl)
      return true
    })
    const paragraphs = [
      summary.overview?.text,
      summary.background?.text,
    ].filter((text): text is string => Boolean(text))
    sections.push({ kind: 'overview', paragraphs, sources })
  }

  if (summary.whyTheyMatter) {
    sections.push({ kind: 'whyTheyMatter', text: summary.whyTheyMatter })
  }

  if (summary.whatYouNeedToKnow && summary.whatYouNeedToKnow.length > 0) {
    sections.push({
      kind: 'whatYouNeedToKnow',
      // whatYouNeedToKnow items became { text, sources? } (ENG-10621); this
      // section renders text bullets, so take the text.
      items: summary.whatYouNeedToKnow.map((item) => item.text),
    })
  }

  if (summary.whereSoft && summary.whereSoft.length > 0) {
    sections.push({
      kind: 'whereSoft',
      items: summary.whereSoft.map((item) => ({
        text: item.text,
        sources: item.sources ?? [],
      })),
    })
  }

  if (summary.issueContrasts && summary.issueContrasts.length > 0) {
    sections.push({
      kind: 'issueContrasts',
      contrasts: summary.issueContrasts.map((contrast) => ({
        issue: contrast.issue,
        whyItMatters: contrast.whyItMatters,
        opponentStance: contrast.opponentStance,
        opponentSources: contrast.opponentSources ?? [],
        candidateStance: contrast.candidateStance,
      })),
    })
  }

  if (summary.keyPositions.length > 0) {
    sections.push({ kind: 'keyPositions', positions: summary.keyPositions })
  }

  return { title, snapshot, sections }
}
