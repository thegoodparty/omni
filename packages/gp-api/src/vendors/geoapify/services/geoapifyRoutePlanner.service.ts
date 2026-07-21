import { BadGatewayException, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import type { AgentPlan, RoutePlannerResult } from '@geoapify/route-planner-sdk'

// The SDK's package.json says type:module, which makes Node parse its
// "require" entry (CJS content, .js extension) as ESM — requiring it from
// our CJS runtime crashes at boot. A true dynamic import() loads the real
// ESM build instead; the Function indirection stops SWC from downleveling
// import() to require(). Types load statically (erased at runtime).
type GeoapifySdk = typeof import('@geoapify/route-planner-sdk')
// Function() returns an untypable value; the module shape is pinned by the
// literal-import fallback below, which TS checks against the same type.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const importSdkAtRuntime = new Function(
  "return import('@geoapify/route-planner-sdk')",
) as () => Promise<GeoapifySdk>
let sdkPromise: Promise<GeoapifySdk> | null = null
const loadSdk = (): Promise<GeoapifySdk> =>
  (sdkPromise ??= importSdkAtRuntime().catch(
    // Vitest's sandbox has no dynamic-import callback for Function-scoped
    // code; a literal import() goes through vite instead (where the module
    // is aliased to the SDK's bundled ESM entry).
    () => import('@geoapify/route-planner-sdk'),
  ))

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

// GeoJSON path geometry from the Routing API ([lng, lat] positions).
const isRoutePathGeometry = (value: unknown): value is RoutePathGeometry =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  (value.type === 'LineString' || value.type === 'MultiLineString') &&
  'coordinates' in value &&
  Array.isArray(value.coordinates)

export type RoutePathGeometry =
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'MultiLineString'; coordinates: [number, number][][] }

export type RoutePlannerPlan = {
  // Visit order as job ids, in knock order.
  orderedJobIds: string[]
  // legSeconds/legMeters INTO each visited job, aligned with orderedJobIds.
  // A free-start first job has no incoming leg and gets 0/0.
  legSeconds: number[]
  legMeters: number[]
  totalSeconds: number
  totalMeters: number
  // Road-following tour path, fetched once here so it can be frozen with
  // the route (Geoapify's terms permit storing results). Null when the
  // routing call failed — the route itself is still valid, consumers fall
  // back to straight legs.
  pathGeometry: RoutePathGeometry | null
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
    const sdk = await loadSdk()
    const planner = new sdk.RoutePlanner({ apiKey: this.apiKey() })
    planner.setMode(args.mode)
    const agent = new sdk.Agent()
    if (args.agent.start_location) {
      agent.setStartLocation(...args.agent.start_location)
    }
    if (args.agent.end_location) {
      agent.setEndLocation(...args.agent.end_location)
    }
    planner.addAgent(agent)
    for (const job of args.jobs) {
      planner.addJob(new sdk.Job().setId(job.id).setLocation(...job.location))
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
          name: error instanceof Error ? error.name : undefined,
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
      pathGeometry: await this.fetchPathGeometry(agentPlan, args.mode),
    }
  }

  // Best-effort: the ordered plan is the critical artifact; a geometry
  // failure must not fail the knock.
  private async fetchPathGeometry(
    agentPlan: AgentPlan,
    mode: 'walk' | 'drive',
  ): Promise<RoutePathGeometry | null> {
    try {
      // getRoute is typed Promise<any>; narrow structurally instead of
      // asserting.
      const feature: unknown = await Promise.race([
        agentPlan.getRoute({ mode }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Routing request timed out')),
            PLAN_TIMEOUT_MS,
          ),
        ),
      ])
      if (
        typeof feature !== 'object' ||
        feature === null ||
        !('geometry' in feature)
      ) {
        return null
      }
      const geometry = feature.geometry
      return isRoutePathGeometry(geometry) ? geometry : null
    } catch (error) {
      this.logger.warn(
        { message: error instanceof Error ? error.message : String(error) },
        'Geoapify route geometry fetch failed; route ships without a path',
      )
      return null
    }
  }
}
