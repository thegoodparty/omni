import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'
import {
  RoutePlannerRequestSchema,
  type RoutePlannerRequest,
} from '@/vendors/geoapify/schemas/geoapify.schema'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common'
import { randomUUID } from 'crypto'
import { Prisma, VendorMockVendor } from '@/generated/prisma'
import { VendorMockRecordService } from '../vendorMockRecord.service'

// Haversine distance between two [lng, lat] points, in metres.
const haversineMeters = (
  from: [number, number],
  to: [number, number],
): number => {
  const R = 6_371_000
  const [lng1, lat1] = from
  const [lng2, lat2] = to
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Parse a `waypoints` query-param value into [lng, lat] pairs.
// Accepts both "lat,lng" (routeThrough) and "lonlat:lng,lat" (SDK getRoute).
const parseWaypointParam = (raw: string): [number, number][] =>
  raw.split('|').map((part): [number, number] => {
    if (part.startsWith('lonlat:')) {
      const nums = part.slice(7).split(',').map(Number)
      return [nums[0] ?? NaN, nums[1] ?? NaN]
    }
    const nums = part.split(',').map(Number)
    return [nums[1] ?? NaN, nums[0] ?? NaN]
  })

// In-process Geoapify mock — serves POST /v1/vendor-mocks/geoapify/v1/routeplanner
// and GET /v1/vendor-mocks/geoapify/v1/routing when VENDOR_MODE=mock.
// @PublicAccess: the real GeoapifyRoutePlannerService calls this controller
// via HTTP without a session token; assertMockMode() is the environment gate,
// and assertApiKey() validates the caller supplies the real GEOAPIFY_API_KEY.
@Controller('vendor-mocks/geoapify')
@PublicAccess()
export class GeoapifyMockController {
  constructor(private readonly vendorMockRecord: VendorMockRecordService) {}

  @Post('v1/routeplanner')
  async routePlanner(
    @Query('apiKey') apiKey: string | undefined,
    @Body() rawBody: RoutePlannerRequest,
  ) {
    this.assertMockMode()
    this.assertApiKey(apiKey)

    const body = RoutePlannerRequestSchema.parse(rawBody)
    const jobs = body.jobs ?? []
    const agents = body.agents ?? []

    // Check for a 'routeFail' flag. orderBy ensures we inspect the most
    // recently seeded/updated record when multiple matching rows exist.
    const failRecord = await this.vendorMockRecord.findFirst({
      where: {
        vendor: VendorMockVendor.geoapify,
        campaignId: null,
        kind: 'routing_request',
      },
      orderBy: { updatedAt: Prisma.SortOrder.desc },
    })

    const routeFail =
      failRecord !== null &&
      typeof failRecord.state === 'object' &&
      failRecord.state !== null &&
      !Array.isArray(failRecord.state) &&
      'routeFail' in failRecord.state &&
      failRecord.state['routeFail'] === true

    if (routeFail && failRecord) {
      await this.vendorMockRecord.setFlag(
        VendorMockVendor.geoapify,
        failRecord.kind,
        failRecord.externalId,
        'routeFail',
        false,
      )
      throw new InternalServerErrorException('mock route failure')
    }

    await this.vendorMockRecord.upsert(
      VendorMockVendor.geoapify,
      'routeplanner_request',
      randomUUID(),
      { status: 'complete', waypoints: jobs.length },
      undefined,
      rawBody,
    )

    const hasStart = agents[0]?.start_location !== undefined
    // One leg per job (covers free-start legIndex -1→0→… and anchored 0→1→…).
    const legs = jobs.map(() => ({ time: 0, distance: 0 }))

    const actions = jobs.map((job, i) => ({
      type: 'job',
      job_index: i,
      job_id: job.id ?? String(i),
      start_time: 0,
      duration: 0,
      waypoint_index: i,
    }))

    const waypoints = jobs.map((job, i) => ({
      location: job.location,
      original_location: job.location,
      original_location_index: i,
      start_time: 0,
      duration: 0,
      actions: [actions[i]],
      prev_leg_index: i - (hasStart ? 0 : 1),
      next_leg_index: i < jobs.length - 1 ? i + (hasStart ? 1 : 0) : -1,
    }))

    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: null,
          properties: {
            agent_index: 0,
            time: 0,
            distance: 0,
            start_time: 0,
            end_time: 0,
            mode: body.mode ?? 'walk',
            legs,
            actions,
            waypoints,
          },
        },
      ],
      properties: {
        mode: body.mode ?? 'walk',
        params: { agents, jobs, mode: body.mode ?? 'walk' },
        issues: { unassigned_jobs: [], unassigned_agents: [] },
      },
    }
  }

  @Get('v1/routing')
  async routing(
    @Query('waypoints') waypointsParam: string | undefined,
    @Query('mode') mode: string | undefined,
    @Query('apiKey') apiKey: string | undefined,
  ) {
    this.assertMockMode()
    this.assertApiKey(apiKey)

    if (!waypointsParam) {
      throw new BadRequestException('waypoints query param is required')
    }

    const coords = parseWaypointParam(waypointsParam)

    await this.vendorMockRecord.upsert(
      VendorMockVendor.geoapify,
      'routing_request',
      randomUUID(),
      { status: 'complete', waypointCount: coords.length, mode },
      undefined,
      { waypoints: waypointsParam, mode },
    )

    const legs = coords.slice(1).map((to, i) => {
      const from = coords[i]
      const dist = from ? haversineMeters(from, to) : 0
      return {
        time: Math.round(dist / 1.2),
        distance: Math.round(dist),
      }
    })

    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { legs },
        },
      ],
    }
  }

  // Lets E2E tests arm Geoapify mock flags without admin credentials.
  // Only reachable in mock mode; the controller is already @PublicAccess().
  @Post('test/actions')
  async testAction(@Body() body: { action: string }) {
    this.assertMockMode()
    if (body.action !== 'route.fail') {
      throw new BadRequestException(
        `Unknown action: ${body.action}`,
      )
    }
    await this.vendorMockRecord.upsert(
      VendorMockVendor.geoapify,
      'routing_request',
      'sentinel',
      { routeFail: true },
      undefined,
    )
    return { ok: true }
  }

  // 404 rather than 403 — the surface does not advertise itself outside mock mode.
  private assertMockMode() {
    if (VENDOR_MODE !== 'mock') {
      throw new NotFoundException()
    }
  }

  // Accepts any non-empty key when GEOAPIFY_API_KEY is unconfigured (test
  // environments); in configured environments it must match the real key so
  // only the GeoapifyRoutePlannerService (which supplies it) can reach this
  // endpoint.
  private assertApiKey(apiKey: string | undefined) {
    const expectedKey = process.env.GEOAPIFY_API_KEY
    if (!apiKey || (expectedKey && apiKey !== expectedKey)) {
      throw new BadRequestException('apiKey query param is required')
    }
  }
}
