import {
  AgentRunStatus,
  ExperimentRunStatus,
  type PrismaClient,
} from '@/generated/prisma'

// The campaign_tracker_tasks experiment's name, which is also its gp-api agent
// name: one string addresses the run on either engine.
const TRACKER_AGENT = 'campaign_tracker_tasks'

// Has any run that is not failed fired for this org since `since`? The weekly
// coverage gate, read from BOTH engines' tables.
//
// The reader is deliberately two-way rather than switching on `runsOnGpApi`.
// This migration's rollback is reverting its `deploy/agentsOnGpApi.ts` list
// entry, and that only restores the PMF Engine if the readers can still see the
// runs gp-api wrote across the flip. A gate that picks one table makes the flip
// atomic but leaves the other engine's runs invisible: it finds nothing for an
// org that already has a run this week and dispatches a second paid one
// (docs/adr/2026-11-25-an-agent-migration-is-one-pr-judged-on-the-pr.md).
//
// A FAILED run is ignored on both tables, as the one-table gate ignored it: a
// stuck week produced no tasks, so it must still retry rather than be blocked
// until the coverage window expires.
export const hasRecentTrackerRun = async (
  prisma: PrismaClient,
  organizationSlug: string,
  since: Date,
): Promise<boolean> => {
  const [onGpApi, onPmf] = await Promise.all([
    prisma.agentRun.findFirst({
      where: {
        organizationSlug,
        agentName: TRACKER_AGENT,
        status: { not: AgentRunStatus.failed },
        createdAt: { gte: since },
      },
      select: { id: true },
    }),
    prisma.experimentRun.findFirst({
      where: {
        organizationSlug,
        experimentType: TRACKER_AGENT,
        status: { not: ExperimentRunStatus.FAILED },
        createdAt: { gte: since },
      },
      select: { runId: true },
    }),
  ])
  return Boolean(onGpApi ?? onPmf)
}
