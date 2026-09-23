import snapshot from '../data/event-explorer.json'

export type Surface = {
  label: string
  path: string
  instrumented_by: string | null
  state: 'live' | 'dead' | 'gap'
}

export type Question = {
  id: string
  question: string
  also_answers: string[]
  coverage: 'covered' | 'partial' | 'uncovered' | 'orphaned'
  product: string
  asked_by: string
  caveats: string
  okr: string
  clickup_task: string
  /** The report or one-pager that actually answers this. Hand-kept for now. */
  answer_url: string
  /** Its title, so searching for the report by name finds the question. */
  answer_label: string
  surfaces: Surface[]
}

export type EventRecord = {
  event_type: string
  display_name: string
  area: string
  description: string
  status: string
  fires_on: string
  url: string
  fires_on_source: '' | 'govern' | 'anchor'
  anchor_confidence: string
  anchor_flag_reason: string
  code_path: string
  count_30d: number
  count_total: number
  last_seen: string
  first_seen: string
  series: number[]
  tags: string[]
  okr: string
  supersession: string
  declared_intent: string
  watchlist_status: string
  questions: string[]
  /** Downstream consumers of this event: data-dictionary columns, reports. */
  used_by: { kind: 'column' | 'report'; label: string; url: string }[]
  // The generator always emits all six keys, so a concrete type rather than an index
  // signature — otherwise every read is `string | undefined` for no real-world reason.
  provenance: {
    instrumented_pr: string
    instrumented_date: string
    instrumented_author_email: string
    retired_pr: string
    retired_date: string
    retired_author_email: string
  }
}

export type Area = {
  name: string
  total: number
  counts: Record<string, number>
}

export type Snapshot = {
  refreshed_at: string
  generated_at: string
  source: string
  series_weeks: string[]
  /** ClickUp form for requesting an event or reporting a broken one. */
  request_form_url: string
  events: EventRecord[]
  questions: Question[]
  areas: Area[]
}

// Through `unknown`: TS infers the literal shape of the JSON, where each area's
// `counts` has only the status keys that area happens to contain, which is not
// assignable to an index signature.
export const data = snapshot as unknown as Snapshot

// The governance cron runs Mondays and Thursdays at 11:00 UTC. The page states the
// next run so "this looks stale" has an answer rather than only a complaint.
export const nextRun = (from = new Date()): Date => {
  const d = new Date(from)
  d.setUTCHours(11, 0, 0, 0)
  if (d <= from) d.setUTCDate(d.getUTCDate() + 1)
  while (![1, 4].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1)
  return d
}

// Registry surface labels are slugs (`campaign_plan_read_through`), not prose. Nate is
// not an engineer, so de-slug them for display rather than changing the data.
export const deslug = (s: string) =>
  s ? s.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()) : ''

const AMPLITUDE_ORG = 'goodparty'

// Amplitude's Govern URL takes the event identifier as a path segment, not a query.
// The project slug is `default`, not the numeric id the Experiment URLs use. The
// trailing query is reproduced verbatim from a working link, including the
// double-encoded `All%2520Properties`, which is what Amplitude itself emits.
//
// Keyed on event_type: it is the taxonomy's identifier, and the display name is a
// mutable label. They are identical for 588 of 592 events; the four that differ
// (`session_start`, `session_end`, `Daily Ad Metrics`, and the campaign-plan download)
// are the only ones where this choice is observable, and untested.
export const amplitudeUrl = (eventType: string) =>
  `https://app.amplitude.com/data/${AMPLITUDE_ORG}/default/events/main/latest/` +
  `${encodeURIComponent(eventType)}` +
  '?view=All&eventsTab=Events&tab=DETAILS&propertyValidityFilter=All%2520Properties'

export const prUrl = (pr: string) =>
  /^\d+$/.test(pr) ? `https://github.com/thegoodparty/omni/pull/${pr}` : pr
