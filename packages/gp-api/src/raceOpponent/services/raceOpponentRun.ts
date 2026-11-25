import { isAfter } from 'date-fns'
import {
  AgentRunStatus,
  ExperimentRunStatus,
  Prisma,
  type PrismaClient,
} from '@/generated/prisma'
import { runsOnGpApi } from '@/agents/agents.registry'

// One link of the relaxed opponent chain: `race_opponent_collection` ->
// `race_opponent_summary` -> `race_opponent_actions`. Each link's name is both
// its PMF Engine experiment type and its gp-api agent name, so one string
// addresses it on either engine.
export type ChainLink =
  | 'race_opponent_collection'
  | 'race_opponent_summary'
  | 'race_opponent_actions'

// The status the chain's readers reason about, shared by both tables so a
// caller asks its question once instead of per engine. The two tables speak
// their own vocabulary — the PMF Engine's upper-case enum, gp-api's lower-case
// one — and this is where that difference lives while both engines are live. It
// goes with the PMF Engine.
export type ChainRunStatus = 'in_flight' | 'completed' | 'failed' | 'other'

export type ChainRun = {
  runId: string
  status: ChainRunStatus
  createdAt: Date
}

// The PMF Engine's resume sweep writes `superseded` on a predecessor AFTER
// dispatching a successor that shares the run id the product holds, so that work
// is still live and re-dispatching would orphan it. gp-api's `supersede` starts
// a successor under a NEW run id nothing points at, so that row can never land:
// it is not in flight, and re-dispatching is what recovers it.
const PMF_IN_FLIGHT: readonly ExperimentRunStatus[] = [
  ExperimentRunStatus.QUEUED,
  ExperimentRunStatus.RUNNING,
  ExperimentRunStatus.AWAITING_RESUME,
  ExperimentRunStatus.SUPERSEDED,
]

const AGENT_IN_FLIGHT: readonly AgentRunStatus[] = [
  AgentRunStatus.queued,
  AgentRunStatus.running,
]

const pmfStatus = (status: ExperimentRunStatus): ChainRunStatus => {
  if (PMF_IN_FLIGHT.includes(status)) return 'in_flight'
  if (status === ExperimentRunStatus.COMPLETED) return 'completed'
  if (status === ExperimentRunStatus.FAILED) return 'failed'
  return 'other'
}

const agentStatus = (status: AgentRunStatus): ChainRunStatus => {
  if (AGENT_IN_FLIGHT.includes(status)) return 'in_flight'
  if (status === AgentRunStatus.completed) return 'completed'
  if (status === AgentRunStatus.failed) return 'failed'
  return 'other'
}

// The newest run of one chain link, read from BOTH engines' tables.
//
// The reader is deliberately two-way rather than switching on `runsOnGpApi`.
// This PR's rollback is reverting its three `deploy/agentsOnGpApi.ts` list
// entries, and that only restores the PMF Engine if the readers can still see
// the runs gp-api wrote across the flip. A reader that picks one table from the
// switch makes the flip atomic but leaves the other engine's runs invisible: a
// gate then finds no run for an org that has one and dispatches a duplicate
// (docs/adr/2026-11-25-an-agent-migration-is-one-pr-judged-on-the-pr.md).
// Reading both costs one extra indexed lookup and is what keeps a revert safe.
//
// `onlyCompleted` is for the re-chain checks, which ask which upstream run last
// SUCCEEDED and never care about a live or failed one.
export const latestChainRun = async (
  prisma: PrismaClient,
  link: ChainLink,
  organizationSlug: string,
  options: { onlyCompleted?: boolean } = {},
): Promise<ChainRun | null> => {
  const completedOnly = options.onlyCompleted === true

  const [agentRun, experimentRun] = await Promise.all([
    prisma.agentRun.findFirst({
      where: {
        organizationSlug,
        agentName: link,
        ...(completedOnly && { status: AgentRunStatus.completed }),
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      select: { id: true, status: true, createdAt: true },
    }),
    prisma.experimentRun.findFirst({
      where: {
        organizationSlug,
        experimentType: link,
        ...(completedOnly && { status: ExperimentRunStatus.COMPLETED }),
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      select: { runId: true, status: true, createdAt: true },
    }),
  ])

  const fromAgent: ChainRun | null = agentRun
    ? {
        runId: agentRun.id,
        status: agentStatus(agentRun.status),
        createdAt: agentRun.createdAt,
      }
    : null
  const fromExperiment: ChainRun | null = experimentRun
    ? {
        runId: experimentRun.runId,
        status: pmfStatus(experimentRun.status),
        createdAt: experimentRun.createdAt,
      }
    : null

  // Across a flip both tables can hold a run of this link for one org, and the
  // newer one is the one the page is about. Equal timestamps can only be a
  // retry pair, and either answer is the same cycle.
  if (!fromAgent) return fromExperiment
  if (!fromExperiment) return fromAgent
  return isAfter(fromAgent.createdAt, fromExperiment.createdAt)
    ? fromAgent
    : fromExperiment
}

// Is a run of this link live on EITHER engine? The in-flight dedup's two-way
// read, for the same reason `latestChainRun` is: after a revert the two tables
// can each hold a live run of this link, and a gate that saw only the switched
// table would dispatch a duplicate paid run.
//
// `exceptRunId` is the run whose completion is doing the asking (gp-api calls
// `onArtifact`/`onFailure` before the row is terminal), so it is excluded from
// both tables: an id cannot collide across them, but passing it to both keeps
// the exclusion unconditional.
export const findInFlightChainRun = async (
  prisma: PrismaClient,
  link: ChainLink,
  organizationSlug: string,
  exceptRunId?: string,
): Promise<string | null> => {
  const excluded = exceptRunId ? { not: exceptRunId } : undefined

  // The PMF Engine's resume sweep writes `superseded` on a predecessor AFTER
  // dispatching a successor that shares the run id the product holds, so that
  // work is still live and re-dispatching would orphan it. gp-api's `supersede`
  // starts a successor under a NEW run id nothing points at, so that row can
  // never land: it is not in flight, and re-dispatching is what recovers it.
  const [agentRun, experimentRun] = await Promise.all([
    prisma.agentRun.findFirst({
      where: {
        organizationSlug,
        agentName: link,
        status: { in: [AgentRunStatus.queued, AgentRunStatus.running] },
        ...(excluded && { id: excluded }),
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      select: { id: true },
    }),
    prisma.experimentRun.findFirst({
      where: {
        organizationSlug,
        experimentType: link,
        status: { in: [...PMF_IN_FLIGHT] },
        ...(excluded && { runId: excluded }),
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      select: { runId: true },
    }),
  ])

  return agentRun?.id ?? experimentRun?.runId ?? null
}

// The chain's own switch read, for the DISPATCH side only: which engine a new
// run of this link goes to. Readers never consult it (see `latestChainRun`).
export const chainRunsOnGpApi = (link: ChainLink): boolean => runsOnGpApi(link)
