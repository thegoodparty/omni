import { Prisma } from '../../../../generated/prisma'

// Deterministic field allowlist for the briefing artifact JSONB cache. The
// artifact carries internal/QA scaffolding that must never reach the model:
// run_metadata, claims and their routing, per-item research (raw_context,
// haystaq_* details, executed queries), and internal source identifiers /
// table-column names (hs_ / l2_). We project ONLY known user-facing fields and
// drop everything else, so a future internal field is excluded by default
// rather than leaking until someone remembers to blocklist it.

type Json = Prisma.JsonValue

const isRecord = (value: Json | undefined): value is { [k: string]: Json } =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: Json | undefined): string | null =>
  typeof value === 'string' ? value : null

const num = (value: Json | undefined): number | null =>
  typeof value === 'number' ? value : null

export interface SanitizedBriefingNews {
  headline: string | null
  publication: string | null
  publicationDate: string | null
  url: string | null
}

export interface SanitizedBriefingItem {
  id: string | null
  itemNumber: string | null
  title: string | null
  tier: string | null
  voteRequired: boolean | null
  summary: string | null
  budgetImpactSummary: string | null
  constituentSentimentSummary: string | null
  talkingPoints: string[]
  recentNews: SanitizedBriefingNews[]
}

export interface SanitizedExecutiveSummaryItem {
  itemId: string | null
  title: string | null
  overview: string | null
}

export interface SanitizedSource {
  id: string | null
  name: string | null
  sourceType: string | null
  url: string | null
}

export interface SanitizedBriefingArtifact {
  briefingStatus: string | null
  briefingType: string | null
  meetingDate: string | null
  meetingTime: string | null
  meetingTimezone: string | null
  meetingName: string | null
  location: string | null
  estimatedReadMinutes: number | null
  disclosure: string | null
  leadIn: string | null
  executiveSummaryItems: SanitizedExecutiveSummaryItem[]
  items: SanitizedBriefingItem[]
  sources: SanitizedSource[]
}

const sanitizeNews = (raw: Json): SanitizedBriefingNews | null => {
  if (!isRecord(raw)) return null
  return {
    headline: str(raw['headline']),
    publication: str(raw['publication']),
    publicationDate: str(raw['publication_date']),
    url: str(raw['url']),
  }
}

// Legacy artifacts carry a bare string; all new generations carry the
// structured {text, why} shape. Fold both into a single string here so the
// return type (and every downstream consumer) stays `string[]` — dropping
// object entries instead would silently erase every talking point on any
// briefing generated after the {text, why} shape shipped.
const sanitizeTalkingPoint = (raw: Json): string | null => {
  if (typeof raw === 'string') return raw
  if (!isRecord(raw)) return null
  const text = str(raw['text'])
  const why = str(raw['why'])
  if (!text) return null
  return why ? `${text} (Why: ${why})` : text
}

const sanitizeTalkingPoints = (raw: Json | undefined): string[] => {
  if (!Array.isArray(raw)) return []
  return raw.map(sanitizeTalkingPoint).filter((p): p is string => p !== null)
}

const sanitizeDisplay = (
  raw: Json | undefined,
): Pick<
  SanitizedBriefingItem,
  | 'summary'
  | 'budgetImpactSummary'
  | 'constituentSentimentSummary'
  | 'talkingPoints'
  | 'recentNews'
> => {
  if (!isRecord(raw)) {
    return {
      summary: null,
      budgetImpactSummary: null,
      constituentSentimentSummary: null,
      talkingPoints: [],
      recentNews: [],
    }
  }
  const budget = raw['budget_impact']
  const sentiment = raw['constituent_sentiment']
  const news = raw['recent_news']
  return {
    summary: str(raw['summary']),
    budgetImpactSummary: isRecord(budget) ? str(budget['summary']) : null,
    constituentSentimentSummary: isRecord(sentiment)
      ? str(sentiment['summary'])
      : null,
    talkingPoints: sanitizeTalkingPoints(raw['talking_points']),
    recentNews: Array.isArray(news)
      ? news
          .map(sanitizeNews)
          .filter((n): n is SanitizedBriefingNews => n !== null)
      : [],
  }
}

const sanitizeItem = (raw: Json): SanitizedBriefingItem | null => {
  if (!isRecord(raw)) return null
  const vote = raw['vote_required']
  return {
    id: str(raw['id']),
    itemNumber: str(raw['item_number']),
    title: str(raw['title']),
    tier: str(raw['tier']),
    voteRequired: typeof vote === 'boolean' ? vote : null,
    ...sanitizeDisplay(raw['display']),
  }
}

const sanitizeExecutiveSummaryItem = (
  raw: Json,
): SanitizedExecutiveSummaryItem | null => {
  if (!isRecord(raw)) return null
  return {
    itemId: str(raw['item_id']),
    title: str(raw['title']),
    overview: str(raw['overview']),
  }
}

const sanitizeSource = (raw: Json): SanitizedSource | null => {
  if (!isRecord(raw)) return null
  // The projection itself is the allowlist: only these four public fields are
  // ever read, so internal keys (haystaq_column, score_value, hs_/l2_) are
  // dropped regardless of what the source object carries.
  return {
    id: str(raw['id']),
    name: str(raw['name']),
    sourceType: str(raw['source_type']),
    url: str(raw['url']),
  }
}

const sanitizeExecutiveSummary = (
  raw: Json | undefined,
): { leadIn: string | null; items: SanitizedExecutiveSummaryItem[] } => {
  if (!isRecord(raw)) return { leadIn: null, items: [] }
  const items = raw['items']
  return {
    leadIn: str(raw['lead_in']),
    items: Array.isArray(items)
      ? items
          .map(sanitizeExecutiveSummaryItem)
          .filter((i): i is SanitizedExecutiveSummaryItem => i !== null)
      : [],
  }
}

export const sanitizeBriefingArtifact = (
  artifact: Prisma.JsonValue | null | undefined,
): SanitizedBriefingArtifact | null => {
  const record: Json | undefined = artifact ?? undefined
  if (!isRecord(record)) return null
  const executiveSummary = sanitizeExecutiveSummary(record['executive_summary'])
  const items = record['items']
  const sources = record['sources']
  return {
    briefingStatus: str(record['briefing_status']),
    briefingType: str(record['briefing_type']),
    meetingDate: str(record['meeting_date']),
    meetingTime: str(record['meeting_time']),
    meetingTimezone: str(record['meeting_timezone']),
    meetingName: str(record['meeting_name']),
    location: str(record['location']),
    estimatedReadMinutes: num(record['estimated_read_minutes']),
    disclosure: str(record['disclosure']),
    leadIn: executiveSummary.leadIn,
    executiveSummaryItems: executiveSummary.items,
    items: Array.isArray(items)
      ? items
          .map(sanitizeItem)
          .filter((i): i is SanitizedBriefingItem => i !== null)
      : [],
    sources: Array.isArray(sources)
      ? sources
          .map(sanitizeSource)
          .filter((s): s is SanitizedSource => s !== null)
      : [],
  }
}
