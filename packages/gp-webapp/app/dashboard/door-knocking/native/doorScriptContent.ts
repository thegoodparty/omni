import type { CampaignIssuePosition } from 'gpApi/api-endpoints'
import type { Campaign, CustomIssue } from 'helpers/types'

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
  const issues = [
    ...ordered.map(fromPosition),
    ...(customIssues ?? []).map(fromCustomIssue),
  ].filter((issue): issue is ScriptIssue => issue !== null)

  // The same issue can exist in both stores if a candidate re-entered it as
  // custom; saying it twice at the door reads as a script glitch.
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = issue.title.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// "Hi, I'm Jane Doe, running for City Council." Each clause is dropped when its
// data is missing rather than printing a placeholder the canvasser would have
// to read around.
export const buildIntro = (campaign: Campaign | null): string => {
  const name = clean(
    [campaign?.firstName, campaign?.lastName].filter(Boolean).join(' '),
  )
  const office = clean(campaign?.positionName ?? campaign?.office)

  if (name && office) return `Hi, I'm ${name}, running for ${office}.`
  if (name) return `Hi, I'm ${name}.`
  if (office) return `Hi, I'm running for ${office}.`
  return ''
}
