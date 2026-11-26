import { z } from 'zod'
import {
  AgentRunStatus,
  ExperimentRunStatus,
  type PrismaClient,
} from '@/generated/prisma'
import { S3Service } from '@/vendors/aws/services/s3.service'

// One campaign-plan section's run, as the section logic reads it, whichever
// engine ran it. The two tables speak their own vocabulary — the PMF Engine's
// upper-case status and an artifact in S3 — and this is where that difference
// lives while both engines are live. It goes with the PMF Engine.
export type SectionRunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_resume'
  | 'completed'
  | 'failed'
  | 'superseded'

export type SectionRun = {
  runId: string
  status: SectionRunStatus
  // Which engine ran it. The two engines mean opposite things by `superseded`,
  // so a reader of the status has to know which vocabulary it is reading.
  engine: 'pmf' | 'gpApi'
  createdAt: Date
  updatedAt: Date
  // The roster size the run's own input carried, read from the run rather than
  // the plan because the input is what the agent actually saw. Null when the
  // run never completed or its input cannot be read.
  candidateCountSeen: number | null
  // The run's artifact: the PMF Engine keeps S3 coordinates on the row, gp-api's
  // agents keep the artifact itself, so this is how a reader gets either.
  readArtifact: () => Promise<unknown>
}

const PMF_SECTION_STATUS: Record<ExperimentRunStatus, SectionRunStatus> = {
  [ExperimentRunStatus.QUEUED]: 'queued',
  [ExperimentRunStatus.RUNNING]: 'running',
  [ExperimentRunStatus.AWAITING_RESUME]: 'awaiting_resume',
  [ExperimentRunStatus.COMPLETED]: 'completed',
  [ExperimentRunStatus.FAILED]: 'failed',
  [ExperimentRunStatus.SUPERSEDED]: 'superseded',
}

const AGENT_SECTION_STATUS: Record<AgentRunStatus, SectionRunStatus> = {
  [AgentRunStatus.queued]: 'queued',
  [AgentRunStatus.running]: 'running',
  [AgentRunStatus.completed]: 'completed',
  [AgentRunStatus.failed]: 'failed',
  [AgentRunStatus.superseded]: 'superseded',
}

// A section is in flight while it is queued, running, or paused mid-run. None of
// those may be re-dispatched: that would overwrite the plan's run id, orphan the
// live run, and let a second concurrent task spawn against the same campaign.
//
// `superseded` is the one status that is not the same for both engines. The PMF
// Engine's resume sweep writes it on a predecessor AFTER dispatching a successor
// that shares the plan's run id, so that run is still the one the plan waits on
// and re-dispatching would orphan it: for the PMF Engine it is in flight. gp-api's
// `supersede` starts a successor under a NEW run id that nothing points the plan
// at, so nothing the plan waits on will ever land: leaving that in flight would
// hang the plan generating forever, and it must read as re-dispatchable.
const IN_FLIGHT_STATUSES: readonly SectionRunStatus[] = [
  'queued',
  'running',
  'awaiting_resume',
]

export const sectionRunIsInFlight = (run: SectionRun): boolean =>
  IN_FLIGHT_STATUSES.includes(run.status) ||
  (run.engine === 'pmf' && run.status === 'superseded')

// Both engines' inputs name the general roster's size, in their own spelling:
// the PMF Engine's params are the manifest's snake_case and gp-api's input is
// camelCase.
export const candidateCountIn = (input: unknown): number | null => {
  const parsed = z
    .object({
      campaign_strategy_context: z.object({ candidate_count: z.number() }),
      campaignStrategyContext: z.object({ candidateCount: z.number() }),
    })
    .partial()
    .safeParse(input)
  if (!parsed.success) return null
  return (
    parsed.data.campaign_strategy_context?.candidate_count ??
    parsed.data.campaignStrategyContext?.candidateCount ??
    null
  )
}

// The section's run, from whichever table holds its id. `onGpApi` is the
// caller's own `runsOnGpApi(section)`, so the switch decides which table is
// asked first, and the other table answers for a run dispatched before the
// switch flipped: a plan's section or a race-opponent discovery can be queued,
// running or awaiting resume on the other engine at the deploy, and its run id
// lives in that engine's table. Without the fallback the section reads as idle
// and a second paid run starts while the first lands nowhere the plan points at;
// reverting the line has the same problem in reverse. The run that answers
// carries its own `engine`, so the status vocabulary stays right.
export const sectionRunFrom = async (
  prisma: PrismaClient,
  s3: S3Service,
  onGpApi: boolean,
  runId: string | null,
): Promise<SectionRun | null> => {
  if (!runId) return null

  if (onGpApi) {
    return (
      (await gpApiSectionRun(prisma, runId)) ??
      (await pmfSectionRun(prisma, s3, runId))
    )
  }

  return (
    (await pmfSectionRun(prisma, s3, runId)) ??
    (await gpApiSectionRun(prisma, runId))
  )
}

const gpApiSectionRun = async (
  prisma: PrismaClient,
  runId: string,
): Promise<SectionRun | null> => {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } })
  if (!run) return null
  return {
    runId: run.id,
    status: AGENT_SECTION_STATUS[run.status],
    engine: 'gpApi',
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    candidateCountSeen:
      run.status === AgentRunStatus.completed
        ? candidateCountIn(run.input)
        : null,
    readArtifact: async () => run.artifact,
  }
}

const pmfSectionRun = async (
  prisma: PrismaClient,
  s3: S3Service,
  runId: string,
): Promise<SectionRun | null> => {
  const run = await prisma.experimentRun.findUnique({ where: { runId } })
  if (!run) return null
  return {
    runId: run.runId,
    status: PMF_SECTION_STATUS[run.status],
    engine: 'pmf',
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    candidateCountSeen:
      run.status === ExperimentRunStatus.COMPLETED
        ? candidateCountIn(run.params)
        : null,
    readArtifact: async () => {
      if (!run.artifactBucket || !run.artifactKey) return null
      const raw = await s3.getFile(run.artifactBucket, run.artifactKey)
      return raw === undefined ? null : (JSON.parse(raw) as unknown)
    },
  }
}
