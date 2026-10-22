import { Injectable } from '@nestjs/common'
import { CensusTractNameSource } from '../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { StatsService } from '@/peopleDb/services/stats.service'
import type { PeopleDataset } from '@/peopleDb/services/peopleDataset.service'
import type { TractPlace } from '@/peopleDb/databricks/districtCensusSql.util'
import { GeoapifyReverseGeocodeService } from '@/vendors/geoapify/services/geoapifyReverseGeocode.service'
import { tractLabels, streetName } from '../utils/censusTractName.util'

// Reverse geocodes at a time, under Geoapify's per-second rate limit.
const GEOCODE_CONCURRENCY = 4

// A census tract's human name for the civic panel's seats. Each tract is
// named once, ever, and the name kept in census_tract_name: reads only look
// it up, and only fillMissing, run after a plan write's response, calls
// Geoapify.
@Injectable()
export class CensusTractNameService extends createPrismaBase(
  MODELS.CensusTractName,
) {
  // Tracts being named in this process, so two writes at once do not pay
  // for the same tract twice.
  private readonly naming = new Set<string>()

  constructor(
    private readonly stats: StatsService,
    private readonly geocoder: GeoapifyReverseGeocodeService,
  ) {
    super()
  }

  // Each named tract's label among the given ones (a district's tracts),
  // told apart where two share a name. A tract with no name yet is left
  // out, so the page shows its number.
  async labelsFor(tracts: string[]): Promise<Map<string, string>> {
    if (tracts.length === 0) return new Map()
    const rows = await this.model.findMany({
      where: { tractGeoid: { in: tracts } },
      select: { tractGeoid: true, name: true, source: true, street: true },
    })
    return tractLabels(rows)
  }

  // Names the given tracts that have no row yet. Never throws: a failure
  // leaves the tract unnamed, to be tried on a later write.
  async fillMissing(
    district: { districtId: string; dataset: PeopleDataset },
    tracts: string[],
  ): Promise<void> {
    try {
      const known = await this.model.findMany({
        where: { tractGeoid: { in: tracts } },
        select: { tractGeoid: true },
      })
      const named = new Set(known.map((row) => row.tractGeoid))
      const missing = tracts.filter(
        (tract) => !named.has(tract) && !this.naming.has(tract),
      )
      if (missing.length === 0) return
      for (const tract of missing) this.naming.add(tract)
      try {
        const places = await this.stats.findTractPlaces(
          district.districtId,
          district.dataset,
          missing,
        )
        const byTract = new Map(places.map((place) => [place.tract, place]))
        const queue = [...missing]
        const worker = async () => {
          for (let tract = queue.shift(); tract; tract = queue.shift()) {
            await this.name(tract, byTract.get(tract) ?? null)
          }
        }
        await Promise.all(
          Array.from({ length: GEOCODE_CONCURRENCY }, () => worker()),
        )
      } finally {
        for (const tract of missing) this.naming.delete(tract)
      }
    } catch (error) {
      this.logger.warn(
        { message: error instanceof Error ? error.message : String(error) },
        'Census tract naming failed',
      )
    }
  }

  // The street name is written first, claiming the tract, so a second
  // process sees the row and never geocodes it too. A neighborhood then
  // replaces it; a failed geocode removes the claim so a later write tries
  // again.
  private async name(tract: string, place: TractPlace | null): Promise<void> {
    const street = place ? streetName(place) : null
    try {
      await this.model.create({
        data: {
          tractGeoid: tract,
          name: street ? `around ${street}` : null,
          source: street
            ? CensusTractNameSource.street
            : CensusTractNameSource.none,
          street,
        },
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) return
      throw error
    }
    if (!place?.point) return
    const found = await this.geocoder.neighborhoodAt(place.point)
    if (found.status === 'failed') {
      await this.model.delete({ where: { tractGeoid: tract } })
      return
    }
    if (found.name) {
      await this.model.update({
        where: { tractGeoid: tract },
        data: { name: found.name, source: CensusTractNameSource.neighborhood },
      })
    }
  }
}
