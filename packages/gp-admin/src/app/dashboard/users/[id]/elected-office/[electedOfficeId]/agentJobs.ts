import type {
  AgentRunListItem,
  BriefingDispatchPreview,
  ExperimentRunStatus,
} from '@goodparty_org/sdk'

export const AGENT_JOB_TYPES = {
  MEETING_SCHEDULE: 'meeting_schedule',
  MEETING_BRIEFING: 'meeting_briefing',
  TOP_COMMUNITY_ISSUES: 'top_community_issues',
  TRENDING_ISSUES: 'trending_issues',
} as const

export type AgentJobType =
  (typeof AGENT_JOB_TYPES)[keyof typeof AGENT_JOB_TYPES]

export const AGENT_JOB_TYPE_LIST: readonly AgentJobType[] = [
  AGENT_JOB_TYPES.MEETING_SCHEDULE,
  AGENT_JOB_TYPES.MEETING_BRIEFING,
  AGENT_JOB_TYPES.TOP_COMMUNITY_ISSUES,
  AGENT_JOB_TYPES.TRENDING_ISSUES,
]

export type AgentJobsStatus = Record<AgentJobType, AgentRunListItem | null>

const ACTIVE_STATUSES: readonly ExperimentRunStatus[] = [
  'QUEUED',
  'RUNNING',
  'AWAITING_RESUME',
]

export const isActiveRun = (run: AgentRunListItem | null): boolean =>
  run !== null && ACTIVE_STATUSES.includes(run.status)

export const hasActiveRun = (status: AgentJobsStatus | null): boolean =>
  status !== null && Object.values(status).some(isActiveRun)

// Dispatch dates arrive as yyyy-MM-dd strings; anchor to local midnight so the
// displayed day never shifts across a timezone boundary.
export const formatDateOnly = (value: string | null): string => {
  if (!value) return '—'
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export interface BriefingRowView {
  gateWouldDispatch: boolean
  message: string
  overrideWouldDispatch: boolean
  overrideDisabledReason: string | null
}

export const describeBriefingPreview = (
  preview: BriefingDispatchPreview
): BriefingRowView => {
  const overrideDisabledReason = !preview.contextOk
    ? 'Context is unavailable, so a briefing cannot be dispatched.'
    : !preview.overrideWouldDispatch
      ? 'Even an override finds no meeting within 60 days.'
      : null

  if (preview.gateWouldDispatch) {
    return {
      gateWouldDispatch: true,
      message: `Gate will dispatch — next meeting ${formatDateOnly(
        preview.imminentMeetingDate
      )}`,
      overrideWouldDispatch: preview.overrideWouldDispatch,
      overrideDisabledReason,
    }
  }

  const message =
    preview.isServeIcp !== true
      ? 'Gate will skip — office is not serve-ICP'
      : preview.coveredByBriefingDate
        ? `Gate will skip — already covered by a briefing for ${formatDateOnly(
            preview.coveredByBriefingDate
          )}`
        : !preview.scheduleKnown
          ? 'Gate will skip — no meeting schedule known'
          : preview.nextMeetingDate
            ? `Gate will skip — no meeting within 3 days (next meeting ${formatDateOnly(
                preview.nextMeetingDate
              )})`
            : 'Gate will skip — no upcoming meeting found'

  return {
    gateWouldDispatch: false,
    message,
    overrideWouldDispatch: preview.overrideWouldDispatch,
    overrideDisabledReason,
  }
}
