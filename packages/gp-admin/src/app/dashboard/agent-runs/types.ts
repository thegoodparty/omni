import type {
  AgentRunListItem,
  AgentRunsListQuery,
  ExperimentRunStatus,
  PaginationMeta,
} from '@goodparty_org/sdk'
import { DEFAULT_PER_PAGE } from '@/app/dashboard/users/types'

export const SEARCH_PARAMS = {
  EXPERIMENT_TYPE: 'experiment_type',
  STATUS: 'status',
  ORGANIZATION: 'organization',
  CREATED_AFTER: 'created_after',
  CREATED_BEFORE: 'created_before',
  PAGE: 'page',
  PER_PAGE: 'per_page',
} as const

export type SearchParamKey = (typeof SEARCH_PARAMS)[keyof typeof SEARCH_PARAMS]

export type SearchParamUpdates = Partial<
  Record<SearchParamKey, string | undefined>
>

// QUEUED / RUNNING / AWAITING_RESUME / COMPLETED / FAILED / SUPERSEDED —
// `satisfies` validates each literal against the SDK union so a typo fails to
// compile. The SDK re-exports the type but not the values array, so this is the
// local source for the status filter options.
export const AGENT_RUN_STATUSES = [
  'QUEUED',
  'RUNNING',
  'AWAITING_RESUME',
  'COMPLETED',
  'FAILED',
  'SUPERSEDED',
] as const satisfies readonly ExperimentRunStatus[]

export function isAgentRunStatus(value: string): value is ExperimentRunStatus {
  return (AGENT_RUN_STATUSES as readonly string[]).includes(value)
}

// Record (not a partial) so adding a status to the union is a compile error
// until a colour is chosen here.
export const STATUS_BADGE_COLORS: Record<
  ExperimentRunStatus,
  'blue' | 'green' | 'red' | 'amber'
> = {
  QUEUED: 'amber',
  RUNNING: 'blue',
  AWAITING_RESUME: 'amber',
  COMPLETED: 'green',
  FAILED: 'red',
  // A resumed run's predecessor (e.g. compliance_setup that bought the domain +
  // published the site, then handed off to a successor while DNS propagates).
  // It is a successful hand-off, not a failure, so it reads green.
  SUPERSEDED: 'green',
}

// Most statuses display their raw enum value; SUPERSEDED is relabelled so staff
// read the benign hand-off as "Part 1 completed" rather than a scary internal
// term. Partial: anything absent falls back to the raw status in the badge.
export const STATUS_BADGE_LABELS: Partial<Record<ExperimentRunStatus, string>> =
  {
    SUPERSEDED: 'Part 1 completed',
  }

export interface SearchAgentRunsParams {
  [SEARCH_PARAMS.EXPERIMENT_TYPE]?: string
  [SEARCH_PARAMS.STATUS]?: ExperimentRunStatus
  [SEARCH_PARAMS.ORGANIZATION]?: string
  [SEARCH_PARAMS.CREATED_AFTER]?: string
  [SEARCH_PARAMS.CREATED_BEFORE]?: string
  [SEARCH_PARAMS.PAGE]?: number
  [SEARCH_PARAMS.PER_PAGE]?: number
}

export interface SearchAgentRunsResult {
  data: AgentRunListItem[]
  meta: PaginationMeta
}

// Pure mapping from URL-search-param values to the SDK list query. Date filters
// arrive as YYYY-MM-DD strings from <input type="date">; the contract coerces
// them to Date, so we parse here. Unit-tested.
export function buildAgentRunsQuery(
  params: SearchAgentRunsParams
): AgentRunsListQuery {
  const page = params[SEARCH_PARAMS.PAGE] ?? 1
  const perPage = params[SEARCH_PARAMS.PER_PAGE] ?? DEFAULT_PER_PAGE
  const experimentType = params[SEARCH_PARAMS.EXPERIMENT_TYPE]
  const status = params[SEARCH_PARAMS.STATUS]
  const organizationSlug = params[SEARCH_PARAMS.ORGANIZATION]
  const createdAfter = params[SEARCH_PARAMS.CREATED_AFTER]
  const createdBefore = params[SEARCH_PARAMS.CREATED_BEFORE]

  return {
    limit: perPage,
    offset: (page - 1) * perPage,
    ...(experimentType ? { experimentType } : {}),
    ...(status ? { status } : {}),
    ...(organizationSlug ? { organizationSlug } : {}),
    ...(createdAfter ? { createdAfter: new Date(createdAfter) } : {}),
    ...(createdBefore ? { createdBefore: new Date(createdBefore) } : {}),
  }
}

// SDK responses are not Zod-parsed, so Date-typed fields arrive as ISO strings
// at runtime. Accept both and normalise.
export function formatTimestamp(value: Date | string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}m ${remainder}s`
}

export function formatCost(costUsd: number | null): string {
  if (costUsd === null) return '—'
  return `$${costUsd.toFixed(2)}`
}
