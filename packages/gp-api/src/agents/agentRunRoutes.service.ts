import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { format } from 'date-fns'
import { z } from 'zod'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { AGENTS, runsOnGpApi } from '@/agents/agents.registry'
import { AgentsService } from '@/agents/agents.service'
import type { AgentDefinition } from '@/agents/defineAgent'
import { AgentJobContracts } from '@/generated/agent-job-contracts'
import {
  AgentRunStatus,
  ExperimentRunStatus,
  type Prisma,
  type User,
} from '@/generated/prisma'
import { OrganizationMembershipService } from '@/organizations/services/organizationMembership.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isJsonObject } from '@/shared/util/objects.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import {
  type AgentRunInput,
  AgentRunInputSchema,
  type AgentRunRouteStatus,
} from './agentRunRoutes.schema'

// The one agent this route refuses by name: it buys domains and submits to
// Peerly, so a judge run of it spends real money
// (docs/agent-evals.md, "Agents with no suite").
const REFUSED_AGENTS: string[] = ['compliance_setup']

// The PMF Engine agents whose manifest DECLARES organization_slug as a param,
// and whose instruction reads it back out of PARAMS. Every other manifest
// declares `additionalProperties: false` without it, so the dispatch Lambda
// would refuse a params object that carries the org: there the org travels on
// the dispatch envelope alone. No new agent belongs on this list, and it goes
// away with the PMF Engine.
const PMF_PARAMS_NAME_ORG = [
  'find_existing_ordinances',
  'top_community_issues',
  'trending_issues',
]

// The org names the run's owner on the dispatch envelope. A params object only
// carries it too where the agent's own manifest allows it.
const pmfParams = (
  name: string,
  input: AgentRunInput,
): Prisma.InputJsonObject => {
  if (PMF_PARAMS_NAME_ORG.includes(name)) return input
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== 'organization_slug'),
  )
}

// This route names its engine by the agent name it was given, so neither the
// experiment type nor its params are known at compile time. Each engine
// validates the input against its own schema on the way in, exactly as it does
// for a product dispatch.
type DispatchedExperimentType = keyof AgentJobContracts

const organizationSlugOf = (input: AgentRunInput) => {
  const slug = input['organization_slug']
  if (typeof slug !== 'string' || slug.length === 0) {
    throw new BadRequestException(
      'input must name its organization as organization_slug',
    )
  }
  return slug
}

const camelKey = (key: string) =>
  key.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase())

const snakeToCamelKeys = (value: Prisma.JsonValue): Prisma.JsonValue => {
  if (Array.isArray(value)) return value.map(snakeToCamelKeys)
  if (!isJsonObject(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      camelKey(key),
      snakeToCamelKeys(item ?? null),
    ]),
  )
}

const requiresToday = (definition: AgentDefinition) =>
  definition.input instanceof z.ZodObject && 'today' in definition.input.shape

// A suite writes its input once, in the shape every agent has: its manifest's,
// whose fields are snake_case. gp-api's agents name the same fields in
// camelCase, and some take the run's date. This is the one place the two
// engines' naming meets, so the judge never learns which one it is talking to.
// Deleted with the PMF Engine at teardown, when every agent is one shape.
const toGpApiInput = (definition: AgentDefinition, input: AgentRunInput) => {
  const converted = snakeToCamelKeys(input)
  if (!isJsonObject(converted)) return converted
  return 'today' in converted || !requiresToday(definition)
    ? converted
    : { ...converted, today: format(new Date(), 'yyyy-MM-dd') }
}

// Both tables keep an artifact in a Json column, which Prisma types as an
// opaque value. The route promises JSON, so narrow it here rather than
// promising a shape the agents themselves do not share.
const jsonOrNull = (value: unknown): Prisma.JsonValue =>
  value === null ? null : z.json().parse(value)

// A judge run is never resumed, so AWAITING_RESUME is terminal on this route.
// `start` is the one dispatcher that bypasses the test-user guard
// (`allowTestUser`), and the resume loop cannot carry that bypass: it
// re-dispatches through the same guard, which refuses a @test.goodparty.org
// org, so a parked judge run is only a row cycling the sweep until
// MAX_RESUME_ATTEMPTS marks it FAILED. Reading it as still running would have
// the judge poll for an hour for an outcome already decided.
export const AWAITING_RESUME_ERROR =
  'the run parked awaiting a resume, and a judge run is never resumed'

const EXPERIMENT_RUN_STATUS: Record<ExperimentRunStatus, AgentRunRouteStatus> =
  {
    [ExperimentRunStatus.QUEUED]: 'queued',
    [ExperimentRunStatus.RUNNING]: 'running',
    [ExperimentRunStatus.AWAITING_RESUME]: 'failed',
    [ExperimentRunStatus.COMPLETED]: 'completed',
    [ExperimentRunStatus.FAILED]: 'failed',
    [ExperimentRunStatus.SUPERSEDED]: 'superseded',
  }

const AGENT_RUN_STATUS: Record<AgentRunStatus, AgentRunRouteStatus> = {
  [AgentRunStatus.queued]: 'queued',
  [AgentRunStatus.running]: 'running',
  [AgentRunStatus.completed]: 'completed',
  [AgentRunStatus.failed]: 'failed',
  [AgentRunStatus.superseded]: 'superseded',
}

export type AgentRunProgress = {
  status: AgentRunRouteStatus
  artifact: Prisma.JsonValue
  error: string | null
}

// The judge's one door into a background agent: start a run on whichever
// engine runs it, and read the artifact back the same way from both. The judge
// holds a base URL and a signed-in user, never AWS or database access
// (docs/adr/2026-11-19-the-judge-reaches-agents-only-through-a-base-url.md).
@Injectable()
export class AgentRunRoutesService extends createPrismaBase(MODELS.AgentRun) {
  constructor(
    private readonly agents: AgentsService,
    private readonly experimentRuns: ExperimentRunsService,
    private readonly membership: OrganizationMembershipService,
    private readonly s3: S3Service,
  ) {
    super()
  }

  async start(
    name: string,
    input: unknown,
    user: User,
  ): Promise<{ runId: string }> {
    if (REFUSED_AGENTS.includes(name)) {
      throw new BadRequestException(
        `${name} cannot be started here: it makes real purchases`,
      )
    }

    const parsed = AgentRunInputSchema.parse(input)
    const organizationSlug = organizationSlugOf(parsed)
    await this.requireMembership(organizationSlug, user)

    // The product's own per-agent switch (src/agents/AGENTS.md): gp-api's
    // agents when it is on, the PMF Engine otherwise.
    if (runsOnGpApi(name)) {
      const definition = AGENTS[name]
      if (!definition) throw new NotFoundException(`no agent named ${name}`)
      return this.agents.run(name, toGpApiInput(definition, parsed))
    }

    const dispatched = await this.experimentRuns.dispatchRun({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      type: name as DispatchedExperimentType,
      organizationSlug,
      clerkUserId: user.clerkId ?? undefined,
      // Every judge run brings a new @test.goodparty.org user, which the
      // product's test-user guard refuses. No product dispatcher sets this.
      allowTestUser: true,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      params: pmfParams(
        name,
        parsed,
      ) as AgentJobContracts[DispatchedExperimentType]['Input'],
    })
    // Undefined means no dispatch queue is configured, which on a preview is
    // by design (src/agentExperiments/AGENTS.md).
    if (!dispatched) {
      throw new BadGatewayException(
        'agent dispatch is not configured for this environment',
      )
    }
    return { runId: dispatched.runId }
  }

  async read(runId: string, user: User): Promise<AgentRunProgress> {
    const run = await this.model.findUnique({
      where: { id: runId },
      select: {
        status: true,
        artifact: true,
        error: true,
        organizationSlug: true,
      },
    })
    if (run) {
      await this.requireMembership(run.organizationSlug, user)
      return {
        status: AGENT_RUN_STATUS[run.status],
        artifact: jsonOrNull(run.artifact),
        error: run.error,
      }
    }

    const experimentRun = await this.client.experimentRun.findUnique({
      where: { runId },
      select: {
        status: true,
        artifactBucket: true,
        artifactKey: true,
        error: true,
        organizationSlug: true,
      },
    })
    if (!experimentRun) throw new NotFoundException(`no run ${runId}`)

    await this.requireMembership(experimentRun.organizationSlug, user)
    const parked = experimentRun.status === ExperimentRunStatus.AWAITING_RESUME
    return {
      status: EXPERIMENT_RUN_STATUS[experimentRun.status],
      artifact: await this.readPublishedArtifact(experimentRun),
      error: parked ? AWAITING_RESUME_ERROR : experimentRun.error,
    }
  }

  // The PMF Engine publishes its artifact to S3 and keeps only the location on
  // the row, where gp-api's agents keep the artifact itself on the run. getFile
  // is the read path every consumer of a published artifact uses.
  private async readPublishedArtifact(run: {
    artifactBucket: string | null
    artifactKey: string | null
  }): Promise<Prisma.JsonValue> {
    if (!run.artifactBucket || !run.artifactKey) return null
    const raw = await this.s3.getFile(run.artifactBucket, run.artifactKey)
    return raw === undefined ? null : jsonOrNull(JSON.parse(raw))
  }

  // Owner, else a membership row, as the org guards resolve it. A caller who
  // does not belong gets the same 404 the guards give.
  private async requireMembership(
    organizationSlug: string,
    user: User,
  ): Promise<void> {
    const resolved = await this.membership.resolveRole(
      organizationSlug,
      user.id,
    )
    if (!resolved) throw new NotFoundException('Organization not found')
  }
}
