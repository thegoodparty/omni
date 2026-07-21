import { BadGatewayException, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  Agent,
  Job,
  RoutePlanner,
  RoutePlannerError,
  RoutePlannerResult,
} from '@geoapify/route-planner-sdk'

// The SDK's fetch has no timeout option, so the plan call races a deadline:
// the knock endpoint must fail visibly rather than hold its transaction open.
const PLAN_TIMEOUT_MS = 30_000

// [lng, lat] — GeoJSON coordinate order, which Geoapify uses throughout.
export type LngLat = [number, number]

export type RoutePlannerJob = {
  id: string
  location: LngLat
}

export type RoutePlannerAgent = {
  start_location?: LngLat
  end_location?: LngLat
}

export type RoutePlannerPlan = {
  // Visit order as job ids, in knock order.
  orderedJobIds: string[]
  // legSeconds/legMeters INTO each visited job, aligned with orderedJobIds.
  // A free-start first job has no incoming leg and gets 0/0.
  legSeconds: number[]
  legMeters: number[]
  totalSeconds: number
  totalMeters: number
}

@Injectable()
export class GeoapifyRoutePlannerService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(this.constructor.name)
  }

  // Validated lazily, not at module load: the door-knocking backend lands
  // dark, and an import-time throw would block boot (and the whole test
  // suite) in environments where the key isn't provisioned yet.
  private apiKey(): string {
    const key = process.env.GEOAPIFY_API_KEY
    if (!key) {
      throw new BadGatewayException(
        'GEOAPIFY_API_KEY is not configured in this environment',
      )
    }
    return key
  }

  async planRoute(args: {
    mode: 'walk' | 'drive'
    agent: RoutePlannerAgent
    jobs: RoutePlannerJob[]
  }): Promise<RoutePlannerPlan> {
    const planner = new RoutePlanner({ apiKey: this.apiKey() })
    planner.setMode(args.mode)
    const agent = new Agent()
    if (args.agent.start_location) {
      agent.setStartLocation(...args.agent.start_location)
    }
    if (args.agent.end_location) {
      agent.setEndLocation(...args.agent.end_location)
    }
    planner.addAgent(agent)
    for (const job of args.jobs) {
      planner.addJob(new Job().setId(job.id).setLocation(...job.location))
    }

    let result: RoutePlannerResult
    try {
      result = await Promise.race([
        planner.plan(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Route planner timed out')),
            PLAN_TIMEOUT_MS,
          ),
        ),
      ])
    } catch (error) {
      // RoutePlannerError.message is the API's error text; never log the
      // original error object — the request URL carries ?apiKey=<key>.
      this.logger.error(
        {
          name: error instanceof RoutePlannerError ? error.name : undefined,
          message: error instanceof Error ? error.message : String(error),
        },
        'Geoapify route planner request failed',
      )
      throw new BadGatewayException('Route optimization failed')
    }

    const issues = result.getRaw().properties?.issues
    const agentPlan = result.getAgentPlans()[0]
    if (!agentPlan) {
      this.logger.error({ issues }, 'Geoapify returned no agent plan')
      throw new BadGatewayException('Route optimization returned no plan')
    }

    const actions = agentPlan.getActions()
    const legs = agentPlan.getLegs()

    // Legs describe movement between consecutive locations of the whole tour
    // (anchors included). Walk the actions in order, counting one leg per
    // movement, and assign each job the leg that arrives AT it. When the
    // agent has no start anchor (free start), the first job has no incoming
    // leg.
    const orderedJobIds: string[] = []
    const legSeconds: number[] = []
    const legMeters: number[] = []
    let legIndex = args.agent.start_location ? 0 : -1
    for (const action of actions) {
      if (action.getType() !== 'job') continue
      if (legIndex >= 0) {
        legSeconds.push(legs[legIndex]?.getTime() ?? 0)
        legMeters.push(legs[legIndex]?.getDistance() ?? 0)
      } else {
        legSeconds.push(0)
        legMeters.push(0)
      }
      legIndex += 1
      const jobIndex = action.getJobIndex()
      const jobId =
        action.getJobId() ??
        (jobIndex !== undefined ? args.jobs[jobIndex]?.id : undefined)
      if (!jobId) {
        throw new BadGatewayException(
          'Route optimization returned an unidentifiable stop',
        )
      }
      orderedJobIds.push(jobId)
    }

    // Reconciliation: every requested job must be planned exactly once — a
    // silently dropped stop would freeze an incomplete route.
    const planned = new Set(orderedJobIds)
    if (
      planned.size !== args.jobs.length ||
      orderedJobIds.length !== args.jobs.length
    ) {
      this.logger.error(
        {
          requested: args.jobs.length,
          planned: orderedJobIds.length,
          issues,
        },
        'Geoapify plan does not cover every stop',
      )
      throw new BadGatewayException(
        'Route optimization did not cover every stop',
      )
    }

    return {
      orderedJobIds,
      legSeconds,
      legMeters,
      totalSeconds: agentPlan.getTime() ?? 0,
      totalMeters: agentPlan.getDistance() ?? 0,
    }
  }
}
