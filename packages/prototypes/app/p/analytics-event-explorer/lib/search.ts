import {
  data,
  deslug,
  type Area,
  type EventRecord,
  type Question,
} from './data'

export type Hit<T> = { item: T; score: number }

export type Results = {
  questions: Hit<Question>[]
  areas: Hit<Area>[]
  events: Hit<EventRecord>[]
  total: number
}

const norm = (s: string) => s.toLowerCase().replace(/[_-]+/g, ' ')

const tokens = (q: string) => norm(q).split(/\s+/).filter(Boolean)

/**
 * Scores a haystack against the query tokens. Every token must appear somewhere or
 * the row is out, which keeps a two-word query from matching on its weakest word.
 * A whole-phrase hit outranks scattered tokens so "voter file" beats a row that
 * happens to say "voter" in one field and "file" in another.
 */
const score = (
  haystacks: Array<[string, number]>,
  qs: string[],
  phrase: string,
) => {
  let total = 0
  for (const t of qs) {
    let best = 0
    for (const [text, weight] of haystacks) {
      if (!text) continue
      const i = text.indexOf(t)
      if (i < 0) continue
      // Prefix and word-boundary matches beat a mid-word substring.
      const boundary = i === 0 || !/[a-z0-9]/.test(text.charAt(i - 1))
      best = Math.max(best, weight * (boundary ? 1 : 0.5))
    }
    if (best === 0) return 0
    total += best
  }
  if (phrase.includes(' ')) {
    for (const [text, weight] of haystacks) {
      if (text && text.includes(phrase)) total += weight * 1.5
    }
  }
  return total
}

// A question is the thing people actually arrive with, so it outranks an event that
// matched the same words. That ordering is the whole point of the page.
const QUESTION_BOOST = 3
const AREA_BOOST = 2

const STATUS_WEIGHT: Record<string, number> = {
  active: 1.4,
  dormant: 1,
  instrumented_never_observed: 0.9,
  orphaned_firing: 0.9,
  code_unknown: 0.8,
  deprecating: 0.5,
  retired: 0.4,
  system: 0.5,
}

/**
 * No-op today. The standalone shared page has no server to log to, so the trial
 * measurement only starts once this lives in gp-admin. Feedback on the shared copy
 * comes through the request form and Slack instead. Kept here so the call site exists
 * and turning it on is one function body. Tracked on DATA-2509.
 */
export const logSearch = (query: string, total: number): void => {
  void query
  void total
}

export const search = (query: string): Results => {
  const qs = tokens(query)
  const phrase = norm(query).trim()
  if (!qs.length) {
    return { questions: [], areas: [], events: [], total: 0 }
  }

  const questions: Hit<Question>[] = []
  for (const q of data.questions) {
    const s = score(
      [
        [norm(q.question), 10],
        [norm(q.also_answers.join(' ')), 6],
        [norm(q.id), 5],
        [
          norm(
            q.surfaces
              .map((x) => `${x.label} ${x.instrumented_by ?? ''}`)
              .join(' '),
          ),
          4,
        ],
        // Someone hunting for a finished report searches its title, not the
        // question it happens to answer.
        [norm(q.answer_label), 8],
        [norm(q.caveats), 2],
        [norm(q.asked_by), 3],
      ],
      qs,
      phrase,
    )
    if (s) questions.push({ item: q, score: s * QUESTION_BOOST })
  }

  const areas: Hit<Area>[] = []
  for (const a of data.areas) {
    const s = score([[norm(a.name), 10]], qs, phrase)
    if (s) areas.push({ item: a, score: s * AREA_BOOST })
  }

  const events: Hit<EventRecord>[] = []
  for (const e of data.events) {
    const s = score(
      [
        [norm(e.display_name), 10],
        [norm(e.event_type), 8],
        [norm(e.description), 5],
        [norm(e.fires_on), 4],
        [norm(e.area), 4],
        [norm(e.url), 3],
        [norm(e.tags.join(' ')), 2],
        [norm(e.questions.join(' ')), 2],
      ],
      qs,
      phrase,
    )
    // Weight by liveness, not just text. Someone searching for a way to measure
    // something wants an instrument they can still use, so a retired event with a
    // better-matching name must not outrank the working one beside it.
    if (s) events.push({ item: e, score: s * (STATUS_WEIGHT[e.status] ?? 1) })
  }

  const by = <T>(h: Hit<T>[]) => h.sort((a, b) => b.score - a.score)
  by(questions)
  by(areas)
  by(events)

  const total = questions.length + areas.length + events.length
  logSearch(query, total)
  return { questions, areas, events, total }
}

export const suggestions = [
  'voter file export',
  'onboarding drop off',
  'pro upgrade',
  'campaign plan',
  'text campaign',
]

export const labelFor = (s: string) => deslug(s)
