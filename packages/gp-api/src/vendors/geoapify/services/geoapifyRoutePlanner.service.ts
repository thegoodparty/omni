import { BadGatewayException, Injectable } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { PinoLogger } from 'nestjs-pino'
import { lastValueFrom } from 'rxjs'

const GEOAPIFY_ROUTEPLANNER_URL = 'https://api.geoapify.com/v1/routeplanner'
const HTTP_TIMEOUT_MS = 30_000

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

type RoutePlannerAction = {
  type: string
  job_id?: string
  job_index?: number
}

type RoutePlannerLeg = {
  time?: number
  distance?: number
}

type RoutePlannerResponse = {
  features?: Array<{
    properties?: {
      time?: number
      distance?: number
      actions?: RoutePlannerAction[]
      legs?: RoutePlannerLeg[]
    }
  }>
  properties?: { issues?: unknown }
}

@Injectable()
export class GeoapifyRoutePlannerService {
  constructor(
    private readonly httpService: HttpService,
    private readonly logger: PinoLogger,
  ) {
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
    let data: RoutePlannerResponse
    try {
      const response = await lastValueFrom(
        this.httpService.post<RoutePlannerResponse>(
          `${GEOAPIFY_ROUTEPLANNER_URL}?apiKey=${this.apiKey()}`,
          { mode: args.mode, agents: [args.agent], jobs: args.jobs },
          { timeout: HTTP_TIMEOUT_MS },
        ),
      )
      data = response.data
    } catch (error) {
      this.logger.error({ error }, 'Geoapify route planner request failed')
      throw new BadGatewayException('Route optimization failed')
    }

    const properties = data.features?.[0]?.properties
    if (!properties) {
      this.logger.error(
        { issues: data.properties?.issues },
        'Geoapify returned no agent plan',
      )
      throw new BadGatewayException('Route optimization returned no plan')
    }

    const actions = properties.actions ?? []
    const legs = properties.legs ?? []

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
      if (action.type !== 'job') continue
      if (legIndex >= 0) {
        legSeconds.push(legs[legIndex]?.time ?? 0)
        legMeters.push(legs[legIndex]?.distance ?? 0)
      } else {
        legSeconds.push(0)
        legMeters.push(0)
      }
      legIndex += 1
      const jobId =
        action.job_id ??
        (action.job_index !== undefined
          ? args.jobs[action.job_index]?.id
          : undefined)
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
          issues: data.properties?.issues,
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
      totalSeconds: properties.time ?? 0,
      totalMeters: properties.distance ?? 0,
    }
  }
}
