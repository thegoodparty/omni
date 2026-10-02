/**
 * Buy the street path for door-knocking routes created without one.
 *
 * From 2026-09-15 (#1830) until #2251, creating a list skipped Geoapify's
 * Routing call, so those routes store no path and the map draws straight
 * lines between doors, through blocks and across water. A route is bought
 * once and never re-bought, so the fix only reaches new lists. This buys the
 * path through each old route's stored door order, the same request
 * planStops now makes, and overwrites the leg estimates with the measured
 * ones. Hops between doors on one side of one street stay straight, as they
 * do for new lists. The door order itself is not touched.
 *
 * ─── Deployment behavior ─────────────────────────────────────────────
 * One-shot. Shipping it does not run it. A human runs it once, then it can
 * be removed.
 *
 * ─── How to run ──────────────────────────────────────────────────────
 *   export DATABASE_URL='<env Postgres URL>'
 *   export GEOAPIFY_API_KEY='<env Geoapify key>'
 *
 *   npx tsx scripts/backfill-door-knocking-route-paths.ts            # plan, no vendor calls
 *   npx tsx scripts/backfill-door-knocking-route-paths.ts --apply --limit 1
 *   npx tsx scripts/backfill-door-knocking-route-paths.ts --apply
 *
 * Safe to re-run: it selects only routes whose path is still null, and a
 * route whose call fails stays null for the next run.
 *
 * Each route bought is written to the Geoapify spend ledger so the budget
 * alerts see the credits. `waypoints` is 0 on those rows because it records
 * route size, which the route's original row already counted.
 *
 * Output (scripts/output/, gitignored):
 *   backfill-door-knocking-route-paths-detail.jsonl
 */
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '../src/generated/prisma'
import { routingCredits } from '../src/doorKnocking/utils/geoapifyCost.util'
import {
  groupIntoBlockFaces,
  legFromMeters,
  metersBetween,
} from '../src/doorKnocking/utils/blockFace.util'

const OUTPUT_DIR = join(__dirname, 'output')
const DETAIL_PATH = join(
  OUTPUT_DIR,
  'backfill-door-knocking-route-paths-detail.jsonl',
)
const PAUSE_MS = 250

type LngLat = [number, number]
type PathGeometry =
  | { type: 'LineString'; coordinates: LngLat[] }
  | { type: 'MultiLineString'; coordinates: LngLat[][] }

const isPathGeometry = (value: unknown): value is PathGeometry =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  (value.type === 'LineString' || value.type === 'MultiLineString') &&
  'coordinates' in value &&
  Array.isArray(value.coordinates)

const fetchPath = async (
  mode: 'walk' | 'drive',
  waypoints: LngLat[],
  apiKey: string,
): Promise<{
  geometry: PathGeometry
  legs: Array<{ seconds: number; meters: number }>
}> => {
  const url = new URL('https://api.geoapify.com/v1/routing')
  url.searchParams.set(
    'waypoints',
    waypoints.map(([lng, lat]) => `${lat},${lng}`).join('|'),
  )
  url.searchParams.set('mode', mode)
  url.searchParams.set('apiKey', apiKey)
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) {
    throw new Error(`Routing API answered ${response.status}`)
  }
  const body: unknown = await response.json()
  const feature: unknown =
    typeof body === 'object' &&
    body !== null &&
    'features' in body &&
    Array.isArray(body.features)
      ? body.features[0]
      : undefined
  if (typeof feature !== 'object' || feature === null) {
    throw new Error('Routing API returned no route')
  }
  const geometry = 'geometry' in feature ? feature.geometry : undefined
  if (!isPathGeometry(geometry)) {
    throw new Error('Routing API returned no path geometry')
  }
  const rawLegs: unknown[] =
    'properties' in feature &&
    typeof feature.properties === 'object' &&
    feature.properties !== null &&
    'legs' in feature.properties &&
    Array.isArray(feature.properties.legs)
      ? feature.properties.legs
      : []
  const legs = rawLegs.map((leg) => ({
    seconds:
      typeof leg === 'object' &&
      leg !== null &&
      'time' in leg &&
      typeof leg.time === 'number'
        ? Math.round(leg.time)
        : NaN,
    meters:
      typeof leg === 'object' &&
      leg !== null &&
      'distance' in leg &&
      typeof leg.distance === 'number'
        ? Math.round(leg.distance)
        : NaN,
  }))
  if (
    legs.length !== waypoints.length - 1 ||
    !legs.every((leg) => Number.isFinite(leg.seconds + leg.meters))
  ) {
    throw new Error(
      `Routing API returned ${legs.length} legs for ${waypoints.length} waypoints`,
    )
  }
  return { geometry, legs }
}

const prisma = new PrismaClient()

const main = async () => {
  const apply = process.argv.includes('--apply')
  const limitArg = process.argv.indexOf('--limit')
  const limit =
    limitArg >= 0
      ? Number(process.argv[limitArg + 1])
      : Number.POSITIVE_INFINITY
  if (!(limit > 0) || (limitArg >= 0 && !Number.isInteger(limit))) {
    throw new Error('--limit needs a positive whole number')
  }
  const apiKey = process.env.GEOAPIFY_API_KEY
  if (apply && !apiKey)
    throw new Error('GEOAPIFY_API_KEY is required with --apply')

  mkdirSync(OUTPUT_DIR, { recursive: true })

  const pending = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM door_knocking_route
    WHERE path_geometry IS NULL
    ORDER BY id
  `
  const routes = await prisma.doorKnockingRoute.findMany({
    where: { id: { in: pending.map((row) => row.id) } },
    orderBy: { id: 'asc' },
    include: {
      turf: {
        include: {
          voterFileFilter: { select: { organizationSlug: true } },
          stops: {
            where: { seq: { not: null } },
            orderBy: { seq: 'asc' },
            include: { targets: { select: { addressKey: true } } },
          },
        },
      },
    },
  })

  let planned = 0
  let bought = 0
  let failed = 0
  let credits = 0
  for (const route of routes) {
    if (planned >= limit) break
    const stops = route.turf.stops
    if (stops.length < 2) continue
    planned += 1

    const waypoints = stops.map((stop) => [stop.lng, stop.lat] as LngLat)
    if (route.loop) waypoints.push(waypoints[0]!)
    const routeCredits = routingCredits(waypoints.length)
    const organizationSlug = route.turf.voterFileFilter.organizationSlug
    const detail = {
      routeId: route.id,
      turfId: route.doorKnockingTurfId,
      organizationSlug,
      mode: route.mode,
      loop: route.loop,
      stops: stops.length,
      credits: routeCredits,
      before: {
        totalSeconds: route.totalSeconds,
        totalMeters: route.totalMeters,
      },
    }

    if (!apply) {
      credits += routeCredits
      console.log(JSON.stringify(detail))
      appendFileSync(
        DETAIL_PATH,
        JSON.stringify({ ...detail, dryRun: true }) + '\n',
      )
      continue
    }

    try {
      const path = await fetchPath(route.mode, waypoints, apiKey!)
      const billed = routingCredits(
        waypoints.length,
        path.legs.reduce((sum, leg) => sum + leg.meters, 0),
      )
      // Same rule list creation follows: a hop between doors on one side of
      // one street keeps the straight sidewalk leg, because Routing snaps a
      // house to its nearest road and can walk around the block to reach it.
      const faceOfStop = new Map<number, number>()
      groupIntoBlockFaces(
        stops.map((stop) => ({
          lat: stop.lat,
          lng: stop.lng,
          displayAddress: stop.displayAddress,
          people: stop.targets,
        })),
      ).forEach((face, faceIndex) =>
        face.stopIndexes.forEach((stopIndex) =>
          faceOfStop.set(stopIndex, faceIndex),
        ),
      )
      const neighbourHop = (leg: number) =>
        leg + 1 < stops.length &&
        faceOfStop.get(leg) === faceOfStop.get(leg + 1)
      const legs = path.legs.map((leg, index) =>
        neighbourHop(index)
          ? legFromMeters(
              metersBetween(stops[index]!, stops[index + 1]!),
              route.mode,
            )
          : leg,
      )
      const geometry: PathGeometry =
        path.geometry.type === 'MultiLineString' &&
        path.geometry.coordinates.length === legs.length
          ? {
              type: 'MultiLineString',
              coordinates: path.geometry.coordinates.map((line, index) =>
                neighbourHop(index)
                  ? [waypoints[index]!, waypoints[index + 1]!]
                  : line,
              ),
            }
          : path.geometry
      const totalSeconds = legs.reduce((sum, leg) => sum + leg.seconds, 0)
      const totalMeters = legs.reduce((sum, leg) => sum + leg.meters, 0)
      try {
        await prisma.doorKnockingRoutePlannerSpend.create({
          data: {
            organizationSlug,
            doorKnockingTurfId: route.doorKnockingTurfId,
            waypoints: 0,
            credits: billed,
          },
        })
      } catch (error) {
        console.error(
          JSON.stringify({
            ...detail,
            spendLedgerError:
              error instanceof Error ? error.message : String(error),
          }),
        )
      }
      await prisma.$transaction([
        ...stops.map((stop, position) =>
          prisma.doorKnockingStop.update({
            where: { id: stop.id },
            data: {
              legSeconds: position === 0 ? 0 : legs[position - 1]!.seconds,
              legMeters: position === 0 ? 0 : legs[position - 1]!.meters,
            },
          }),
        ),
        prisma.doorKnockingRoute.update({
          where: { id: route.id },
          data: {
            pathGeometry: geometry,
            totalSeconds,
            totalMeters,
            credits: { increment: billed },
          },
        }),
      ])
      bought += 1
      credits += billed
      const line = {
        ...detail,
        credits: billed,
        after: { totalSeconds, totalMeters },
      }
      console.log(JSON.stringify(line))
      appendFileSync(DETAIL_PATH, JSON.stringify(line) + '\n')
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : String(error)
      console.error(JSON.stringify({ ...detail, error: message }))
      appendFileSync(
        DETAIL_PATH,
        JSON.stringify({ ...detail, error: message }) + '\n',
      )
    }
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS))
  }

  console.log(
    JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      routesWithoutPath: routes.length,
      planned,
      bought,
      failed,
      credits,
    }),
  )
}

void main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
