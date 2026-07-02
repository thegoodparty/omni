'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Flex, Separator, Text } from '@radix-ui/themes'
import { HiRefresh } from 'react-icons/hi'
import type {
  AgentRunListItem,
  BriefingDispatchPreview,
} from '@goodparty_org/sdk'
import { InfoCard } from '@/app/dashboard/users/[id]/components/InfoCard'
import { ProtectedContent } from '@/components/ProtectedContent'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { useToast } from '@/components/Toast'
import { PERMISSIONS } from '@/lib/permissions'
import {
  STATUS_BADGE_COLORS,
  STATUS_BADGE_LABELS,
  formatTimestamp,
} from '@/app/dashboard/agent-runs/types'
import {
  AGENT_JOB_TYPES,
  describeBriefingPreview,
  hasActiveRun,
  type AgentJobsStatus,
} from '../agentJobs'
import {
  dispatchCommunityIssues,
  dispatchMeetingAgent,
  getAgentJobsStatus,
  getBriefingDispatchPreview,
} from '../actions'

const POLL_INTERVAL_MS = 10000

interface AgentJobsPanelProps {
  electedOfficeId: string
  organizationSlug: string
}

function RunStatus({ run }: { run: AgentRunListItem | null }) {
  if (!run) {
    return (
      <Text size="2" color="gray">
        Never run
      </Text>
    )
  }
  return (
    <Flex align="center" gap="2">
      <Link href={`/dashboard/agent-runs/${run.runId}`}>
        <Badge color={STATUS_BADGE_COLORS[run.status]}>
          {STATUS_BADGE_LABELS[run.status] ?? run.status}
        </Badge>
      </Link>
      <Text size="2" color="gray">
        {formatTimestamp(run.createdAt)}
      </Text>
    </Flex>
  )
}

export function AgentJobsPanel({
  electedOfficeId,
  organizationSlug,
}: AgentJobsPanelProps) {
  return (
    <ProtectedContent
      requiredPermission={PERMISSIONS.READ_AGENT_RUNS}
      hideWhenUnauthorized
    >
      <AgentJobsPanelInner
        electedOfficeId={electedOfficeId}
        organizationSlug={organizationSlug}
      />
    </ProtectedContent>
  )
}

function AgentJobsPanelInner({
  electedOfficeId,
  organizationSlug,
}: AgentJobsPanelProps) {
  const { showToast } = useToast()
  const [status, setStatus] = useState<AgentJobsStatus | null>(null)
  const [preview, setPreview] = useState<BriefingDispatchPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [scheduleConfirm, setScheduleConfirm] = useState(false)
  const [briefingConfirm, setBriefingConfirm] = useState<boolean | null>(null)
  const [issuesConfirm, setIssuesConfirm] = useState(false)
  const [issuesResult, setIssuesResult] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [nextStatus, nextPreview] = await Promise.all([
      getAgentJobsStatus(organizationSlug),
      getBriefingDispatchPreview(electedOfficeId),
    ])
    setStatus(nextStatus)
    setPreview(nextPreview)
  }, [organizationSlug, electedOfficeId])

  useEffect(() => {
    let active = true
    refresh()
      .catch((error) => {
        if (active) {
          showToast(
            error instanceof Error ? error.message : 'Failed to load agent jobs'
          )
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [refresh, showToast])

  const anyActive = hasActiveRun(status)

  useEffect(() => {
    if (!anyActive) return
    const id = setInterval(() => {
      refresh().catch(() => {})
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [anyActive, refresh])

  const runDispatch = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    try {
      await action()
      await refresh()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Dispatch failed')
    } finally {
      setBusy(null)
    }
  }

  const handleDispatchSchedule = () =>
    runDispatch('schedule', async () => {
      await dispatchMeetingAgent({
        electedOfficeId,
        kind: 'schedule',
        useImminenceGate: false,
      })
      setScheduleConfirm(false)
    })

  const handleDispatchBriefing = (useImminenceGate: boolean) =>
    runDispatch('briefing', async () => {
      await dispatchMeetingAgent({
        electedOfficeId,
        kind: 'briefing',
        useImminenceGate,
      })
      setBriefingConfirm(null)
    })

  const handleDispatchCommunityIssues = () =>
    runDispatch('issues', async () => {
      const result = await dispatchCommunityIssues(organizationSlug)
      setIssuesConfirm(false)
      setIssuesResult(
        result.dispatched === 0
          ? 'Server gate skipped it — org is not serve-ICP or runs are already in flight.'
          : `${result.dispatched} dispatched, ${result.skipped} skipped`
      )
    })

  if (loading) {
    return (
      <InfoCard title="Agent jobs">
        <LoadingSpinner size="2" p="4" />
      </InfoCard>
    )
  }

  const briefingView = preview ? describeBriefingPreview(preview) : null
  const topIssues = status?.[AGENT_JOB_TYPES.TOP_COMMUNITY_ISSUES] ?? null
  const trendingIssues = status?.[AGENT_JOB_TYPES.TRENDING_ISSUES] ?? null
  const issuesHaveCompleted =
    topIssues?.status === 'COMPLETED' || trendingIssues?.status === 'COMPLETED'

  return (
    <InfoCard
      title="Agent jobs"
      action={
        <Button
          variant="ghost"
          onClick={() =>
            runDispatch('refresh', async () => {
              await refresh()
            })
          }
          loading={busy === 'refresh'}
        >
          <HiRefresh className="w-4 h-4" />
          Refresh
        </Button>
      }
    >
      <Flex direction="column" gap="4">
        <Flex direction="column" gap="2">
          <Text weight="bold" size="2">
            Meeting schedule
          </Text>
          <RunStatus run={status?.[AGENT_JOB_TYPES.MEETING_SCHEDULE] ?? null} />
          <ProtectedContent
            requiredPermission={PERMISSIONS.WRITE_AGENT_RUNS}
            hideWhenUnauthorized
          >
            <Flex>
              <Button
                variant="outline"
                onClick={() => setScheduleConfirm(true)}
                loading={busy === 'schedule'}
              >
                Dispatch schedule
              </Button>
            </Flex>
          </ProtectedContent>
        </Flex>

        <Separator size="4" />

        <Flex direction="column" gap="2">
          <Text weight="bold" size="2">
            Meeting briefing
          </Text>
          <RunStatus run={status?.[AGENT_JOB_TYPES.MEETING_BRIEFING] ?? null} />
          {briefingView ? (
            <>
              <Text size="2" color="gray">
                {briefingView.message}
              </Text>
              <ProtectedContent
                requiredPermission={PERMISSIONS.WRITE_AGENT_RUNS}
                hideWhenUnauthorized
              >
                {briefingView.gateWouldDispatch ? (
                  <Flex>
                    <Button
                      onClick={() => setBriefingConfirm(true)}
                      loading={busy === 'briefing'}
                    >
                      Dispatch briefing
                    </Button>
                  </Flex>
                ) : (
                  <Flex direction="column" gap="1">
                    <Flex>
                      <Button
                        variant="outline"
                        color="amber"
                        disabled={briefingView.overrideDisabledReason !== null}
                        onClick={() => setBriefingConfirm(false)}
                        loading={busy === 'briefing'}
                      >
                        Dispatch anyway
                      </Button>
                    </Flex>
                    {briefingView.overrideDisabledReason ? (
                      <Text size="1" color="gray">
                        {briefingView.overrideDisabledReason}
                      </Text>
                    ) : null}
                  </Flex>
                )}
              </ProtectedContent>
            </>
          ) : (
            <Text size="2" color="gray">
              Briefing preview unavailable.
            </Text>
          )}
        </Flex>

        <Separator size="4" />

        <Flex direction="column" gap="2">
          <Text weight="bold" size="2">
            Community issues
          </Text>
          <Flex align="center" gap="2">
            <Text size="2">Top issues:</Text>
            <RunStatus run={topIssues} />
          </Flex>
          <Flex align="center" gap="2">
            <Text size="2">Trending:</Text>
            <RunStatus run={trendingIssues} />
          </Flex>
          {issuesResult ? (
            <Text size="2" color="gray">
              {issuesResult}
            </Text>
          ) : null}
          <ProtectedContent
            requiredPermission={PERMISSIONS.WRITE_AGENT_RUNS}
            hideWhenUnauthorized
          >
            <Flex>
              <Button
                variant="outline"
                onClick={() => setIssuesConfirm(true)}
                loading={busy === 'issues'}
              >
                Dispatch community issues
              </Button>
            </Flex>
          </ProtectedContent>
        </Flex>
      </Flex>

      <ConfirmDialog
        open={scheduleConfirm}
        onOpenChange={setScheduleConfirm}
        onConfirm={handleDispatchSchedule}
        title="Dispatch meeting schedule"
        description="Dispatch a meeting-schedule agent job for this office?"
        confirmLabel="Dispatch"
        color="blue"
        loading={busy === 'schedule'}
      />

      <ConfirmDialog
        open={briefingConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setBriefingConfirm(null)
        }}
        onConfirm={() => handleDispatchBriefing(briefingConfirm === true)}
        title="Dispatch meeting briefing"
        description={
          briefingConfirm === true
            ? 'Dispatch a meeting-briefing agent job for this office?'
            : 'The gate would skip this office. Dispatch a briefing anyway?'
        }
        confirmLabel="Dispatch"
        color="blue"
        loading={busy === 'briefing'}
      />

      <ConfirmDialog
        open={issuesConfirm}
        onOpenChange={setIssuesConfirm}
        onConfirm={handleDispatchCommunityIssues}
        title="Dispatch community issues"
        description={
          issuesHaveCompleted
            ? 'This office already has completed community-issue runs. Dispatching will re-run both jobs and replace the current results with fresh ones. Continue?'
            : 'Dispatch top community issues and trending issues for this office?'
        }
        confirmLabel="Dispatch"
        color="blue"
        loading={busy === 'issues'}
      />
    </InfoCard>
  )
}
