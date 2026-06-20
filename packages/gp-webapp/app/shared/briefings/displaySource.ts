import type { Source } from '@shared/briefings/types'

/**
 * A source-like shape that `toDisplaySource` can consume. Widens `source_type`
 * and `article_type` to `string` so callers outside the briefings domain
 * (e.g. community-issues) can pass their own values without an unsound cast.
 * Only `source_type === 'haystaq'` is special-cased; `article_type` is used
 * only as a key into `ARTICLE_TYPE_LABEL`, so string-widening is safe.
 */
export type SourceInput = Omit<Source, 'source_type' | 'article_type'> & {
  source_type: string
  article_type?: string | null
}

export type DisplaySource = {
  id: string
  /** Long form name (used in popover/sources panel title fallback). */
  displayName: string
  /** Short label for inline pills (publisher or hostname). */
  displayLabel: string
  /** Publisher line shown above the title in popover and sources panel. */
  publisher: string
  /** Description line shown under the title. */
  description: string | null
  /**
   * Proprietary-source descriptive blurb (no link on title). Kept separate
   * from `description` so callers can decide rendering.
   */
  displayBlurb: string | null
  url?: string | null
  isProprietary: boolean
  initial: string
}

const PROPRIETARY_NAME = 'GoodParty.org constituent sentiment'
const PROPRIETARY_LABEL = 'GoodParty.org'
const PROPRIETARY_PUBLISHER = 'GoodParty.org'
const PROPRIETARY_BLURB =
  'Modeled estimate from GoodParty.org’s proprietary constituent ' +
  'sentiment data. Methodology details available on request.'

const ARTICLE_TYPE_LABEL: Record<string, string> = {
  reporting: 'Reporting',
  opinion: 'Opinion',
  editorial: 'Editorial',
  press_release: 'Press release',
  government_communication: 'Government communication',
}

const hostnameFromUrl = (url?: string | null): string | null => {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

const formatDate = (iso?: string | null): string | null => {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const buildDescription = (s: SourceInput): string | null => {
  const parts: string[] = []
  const articleLabel = s.article_type
    ? ARTICLE_TYPE_LABEL[s.article_type]
    : undefined
  if (articleLabel) parts.push(articleLabel)
  if (s.section_heading) parts.push(s.section_heading)
  if (typeof s.page_number === 'number') parts.push(`p. ${s.page_number}`)
  const date = formatDate(s.article_date)
  if (date) parts.push(date)
  return parts.length > 0 ? parts.join(' · ') : null
}

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`

export const toDisplaySource = (s: SourceInput): DisplaySource => {
  if (s.source_type === 'haystaq') {
    return {
      id: s.id,
      displayName: PROPRIETARY_NAME,
      displayLabel: PROPRIETARY_LABEL,
      publisher: PROPRIETARY_PUBLISHER,
      description: PROPRIETARY_BLURB,
      displayBlurb: PROPRIETARY_BLURB,
      url: null,
      isProprietary: true,
      initial: 'G',
    }
  }
  const host = hostnameFromUrl(s.url)
  const publisher = s.publisher ?? host ?? s.name
  const label = s.publisher ?? host ?? truncate(s.name, 28)
  return {
    id: s.id,
    displayName: s.name,
    displayLabel: label,
    publisher,
    description: buildDescription(s),
    displayBlurb: null,
    url: s.url ?? null,
    isProprietary: false,
    initial: (publisher.trim().charAt(0) || '?').toUpperCase(),
  }
}
