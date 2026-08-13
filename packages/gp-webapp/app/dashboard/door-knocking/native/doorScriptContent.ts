import type { CampaignIssuePosition } from 'gpApi/api-endpoints'
import type { Campaign, CustomIssue, User } from 'helpers/types'

// The door script is deliberately static: the candidate's own issue stances,
// assembled from what they already wrote elsewhere in the product. No AI, and
// nothing authored here — a script the candidate can't recognize is worse than
// none, and generated talking points are a separate, filed piece of work.
//
// Two sources, because the issues editor writes to two places: curated issues
// land in campaign_position (with a catalog `position.name` and the candidate's
// own `description`), while bespoke ones land in `details.customIssues`. A
// candidate who only ever used one of the two still gets a script.
export interface ScriptIssue {
  title: string
  body: string
}

const clean = (value: string | null | undefined): string =>
  (value ?? '').trim().replace(/\s+/g, ' ')

// The candidate's own words win. `position.name` is the catalog stance they
// picked and reads as a sentence, so it stands in when they wrote nothing;
// without either there is no stance to say out loud and the issue is dropped
// rather than printed as a bare heading.
const fromPosition = (row: CampaignIssuePosition): ScriptIssue | null => {
  const title = clean(row.topIssue?.name) || clean(row.position?.name)
  const body = clean(row.description) || clean(row.position?.name)
  if (!title || !body) return null
  return { title, body }
}

const fromCustomIssue = (issue: CustomIssue): ScriptIssue | null => {
  const title = clean(issue.title)
  const body = clean(issue.position)
  if (!title || !body) return null
  return { title, body }
}

export const buildScriptIssues = (
  positions: CampaignIssuePosition[] | undefined,
  customIssues: CustomIssue[] | undefined,
): ScriptIssue[] => {
  const ordered = [...(positions ?? [])].sort(
    // `order` is nullable in the schema; unordered rows keep their arrival
    // order behind everything explicitly placed.
    (a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) -
      (b.order ?? Number.MAX_SAFE_INTEGER),
  )
  // Every curated row is a stance the candidate placed deliberately, and
  // nothing stops two of them hanging off one top issue — they only share the
  // heading they'd print under. Deduping these by title silently dropped the
  // later talking point, so they all stand.
  const curated = ordered
    .map(fromPosition)
    .filter((issue): issue is ScriptIssue => issue !== null)

  // The same issue can exist in both stores if a candidate re-entered it as
  // custom; saying it twice at the door reads as a script glitch.
  const seen = new Set(curated.map((issue) => issue.title.toLowerCase()))
  const custom = (customIssues ?? [])
    .map(fromCustomIssue)
    .filter((issue): issue is ScriptIssue => issue !== null)
    .filter((issue) => {
      const key = issue.title.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  return [...curated, ...custom]
}

// "Hi, I'm Jane Doe, running for City Council." Each clause is dropped when its
// data is missing rather than printing a placeholder the canvasser would have
// to read around.
//
// The name comes from the user, not the campaign: `GET /v1/campaigns/mine`
// returns the campaign row (plus positionName and live metrics) and there are
// no name columns on it, so reading `campaign.firstName` here always resolved
// to undefined and the door intro dropped the candidate's name entirely.
export const buildIntro = (
  user: User | null,
  campaign: Campaign | null,
): string => {
  const name =
    clean([user?.firstName, user?.lastName].filter(Boolean).join(' ')) ||
    clean(user?.name)
  const office = clean(campaign?.positionName ?? campaign?.office)

  if (name && office) return `Hi, I'm ${name}, running for ${office}.`
  if (name) return `Hi, I'm ${name}.`
  if (office) return `Hi, I'm running for ${office}.`
  return ''
}
