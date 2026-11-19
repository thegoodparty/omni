import type {
  BackgroundAgentRunListItem,
  BackgroundAgentRunsListQuery,
  AgentRunStatus,
  PaginationMeta,
} from '@/shared/gpApi'
import { DEFAULT_PER_PAGE } from '@/app/dashboard/users/types'

export const SEARCH_PARAMS = {
  AGENT_NAME: 'agent_name',
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

// queued / running / completed / failed / superseded. `satisfies` validates
// each literal against the contract's union so a typo fails to compile.
export const BACKGROUND_AGENT_RUN_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'superseded',
] as const satisfies readonly AgentRunStatus[]

export const isBackgroundAgentRunStatus = (
  value: string
): value is AgentRunStatus =>
  (BACKGROUND_AGENT_RUN_STATUSES as readonly string[]).includes(value)

// Record (not a partial) so adding a status to the union is a compile error
// until a colour is chosen here.
export const STATUS_BADGE_COLORS: Record<
  AgentRunStatus,
  'blue' | 'green' | 'red' | 'amber' | 'gray'
> = {
  queued: 'amber',
  running: 'blue',
  completed: 'green',
  failed: 'red',
  // A run a shape change replaced with a fresh run of the same input. It is a
  // hand-off, not a failure, so it reads gray rather than red.
  superseded: 'gray',
}

export interface SearchBackgroundAgentRunsParams {
  [SEARCH_PARAMS.AGENT_NAME]?: string
  [SEARCH_PARAMS.STATUS]?: AgentRunStatus
  [SEARCH_PARAMS.ORGANIZATION]?: string
  [SEARCH_PARAMS.CREATED_AFTER]?: string
  [SEARCH_PARAMS.CREATED_BEFORE]?: string
  [SEARCH_PARAMS.PAGE]?: number
  [SEARCH_PARAMS.PER_PAGE]?: number
}

export interface SearchBackgroundAgentRunsResult {
  data: BackgroundAgentRunListItem[]
  meta: PaginationMeta
}

// URL-search-param values to the contract's list query. Date filters arrive as
// YYYY-MM-DD from <input type="date">, and the contract coerces them to Date.
export const buildBackgroundAgentRunsQuery = (
  params: SearchBackgroundAgentRunsParams
): BackgroundAgentRunsListQuery => {
  const page = params[SEARCH_PARAMS.PAGE] ?? 1
  const perPage = params[SEARCH_PARAMS.PER_PAGE] ?? DEFAULT_PER_PAGE
  const agentName = params[SEARCH_PARAMS.AGENT_NAME]
  const status = params[SEARCH_PARAMS.STATUS]
  const organizationSlug = params[SEARCH_PARAMS.ORGANIZATION]
  const createdAfter = params[SEARCH_PARAMS.CREATED_AFTER]
  const createdBefore = params[SEARCH_PARAMS.CREATED_BEFORE]

  return {
    limit: perPage,
    offset: (page - 1) * perPage,
    ...(agentName ? { agentName } : {}),
    ...(status ? { status } : {}),
    ...(organizationSlug ? { organizationSlug } : {}),
    ...(createdAfter ? { createdAfter: new Date(createdAfter) } : {}),
    ...(createdBefore ? { createdBefore: new Date(createdBefore) } : {}),
  }
}

// Responses are not Zod-parsed on the client, so Date fields arrive as ISO
// strings at runtime. Accept both and normalise.
export const formatTimestamp = (value: Date | string | null): string => {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export const formatDuration = (seconds: number | null): string => {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}m ${remainder}s`
}

export const formatTokens = (tokens: number | null): string =>
  tokens === null ? '—' : tokens.toLocaleString('en-US')
