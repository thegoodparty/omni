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

// The newest run of one chain link, read from whichever engine the switch sends
// that link to. `onGpApi` is the caller's own `runsOnGpApi(link)`, so a reader
// and the dispatcher pick the same table from one switch: a reader left on the
// other engine's table sees no run, the chain looks idle, and the page
// re-dispatches a paid run.
//
// `onlyCompleted` is for the re-chain checks, which ask which upstream run last
// SUCCEEDED and never care about a live or failed one.
export const latestChainRun = async (
  prisma: PrismaClient,
  onGpApi: boolean,
  link: ChainLink,
  organizationSlug: string,
  options: { onlyCompleted?: boolean } = {},
): Promise<ChainRun | null> => {
  const completedOnly = options.onlyCompleted === true

  if (onGpApi) {
    const run = await prisma.agentRun.findFirst({
      where: {
        organizationSlug,
        agentName: link,
        ...(completedOnly && { status: AgentRunStatus.completed }),
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      select: { id: true, status: true, createdAt: true },
    })
    if (!run) return null
    return {
      runId: run.id,
      status: agentStatus(run.status),
      createdAt: run.createdAt,
    }
  }

  const run = await prisma.experimentRun.findFirst({
    where: {
      organizationSlug,
      experimentType: link,
      ...(completedOnly && { status: ExperimentRunStatus.COMPLETED }),
    },
    orderBy: { createdAt: Prisma.SortOrder.desc },
    select: { runId: true, status: true, createdAt: true },
  })
  if (!run) return null
  return {
    runId: run.runId,
    status: pmfStatus(run.status),
    createdAt: run.createdAt,
  }
}

// The chain's own switch read, so every caller names the link rather than a
// boolean it computed somewhere else.
export const chainRunsOnGpApi = (link: ChainLink): boolean => runsOnGpApi(link)
