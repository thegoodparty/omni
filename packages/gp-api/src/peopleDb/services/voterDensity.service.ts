import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/people-prisma'
import { createPeopleDbBase, PEOPLE_MODELS } from '../peopleDbBase.util'

// The app selects a resolution per request; res 8 is the default the
// data-team handoff documents when none is given.
const DEFAULT_RESOLUTION = 8

/** A single precomputed heat-map cell: an H3 centroid and its voter count. */
export interface VoterDensityCell {
  lat: number
  lng: number
  count: number
}

export interface VoterDensityResult {
  // rendered_voters / total_voters in [0, 1], from the meta row. null when no
  // meta exists for this (district, resolution) — the public page treats
  // null/low coverage as "do not render".
  coverage: number | null
  cells: VoterDensityCell[]
}

/**
 * Read-only access to the precomputed voter-density heat-map in people-db.
 * There is NO H3 math here: the pipeline already binned voters to H3 cells,
 * k-anonymized them, and stored each cell's centroid, so this is a plain
 * indexed read on (districtId, resolution) plus the matching coverage meta row.
 */
@Injectable()
export class VoterDensityService extends createPeopleDbBase(
  PEOPLE_MODELS.DistrictVoterDensity,
) {
  async getVoterDensity(
    districtId: string,
    resolution: number = DEFAULT_RESOLUTION,
  ): Promise<VoterDensityResult> {
    // The cells and their coverage meta are independent reads on the same key;
    // fetch them together.
    const [rows, meta] = await Promise.all([
      this.model.findMany({
        where: { districtId, resolution },
        select: { lat: true, lng: true, voterCount: true },
        // Deterministic order keeps responses stable across identical requests.
        orderBy: [{ lat: Prisma.SortOrder.asc }, { lng: Prisma.SortOrder.asc }],
      }),
      this.client.districtVoterDensityMeta.findUnique({
        where: { districtId_resolution: { districtId, resolution } },
        select: { coverage: true },
      }),
    ])

    return {
      coverage: meta?.coverage ?? null,
      cells: rows.map((r) => ({
        lat: r.lat,
        lng: r.lng,
        count: r.voterCount,
      })),
    }
  }
}
