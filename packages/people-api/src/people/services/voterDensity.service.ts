import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { VoterDensityDTO } from '../people.schema'

/** A single precomputed heat-map cell: an H3 centroid and its voter count. */
export interface VoterDensityCell {
  lat: number
  lng: number
  count: number
}

export interface VoterDensityResult {
  districtId: string
  resolution: number
  /**
   * rendered_voters / total_voters in [0, 1], from the meta row. null when no
   * meta exists for this (district, resolution) — the app treats null/low
   * coverage as "do not render".
   */
  coverage: number | null
  /** The K-anonymity threshold used to build these cells; null when unknown. */
  minCellCount: number | null
  cells: VoterDensityCell[]
}

/**
 * Read-only access to the precomputed voter-density heat-map. There is NO H3
 * math here: the pipeline already binned voters to H3 cells, k-anonymized them,
 * and stored each cell's centroid, so this is a plain indexed read on
 * (districtId, resolution) plus the matching coverage meta row. Mirrors the
 * StatsService shape (district-scoped, precomputed) and is S2S-guarded via the
 * global guard like every other people-api route.
 */
@Injectable()
export class VoterDensityService extends createPrismaBase(
  MODELS.DistrictVoterDensity,
) {
  async getVoterDensity(dto: VoterDensityDTO): Promise<VoterDensityResult> {
    const { districtId, resolution } = dto

    // The cells and their coverage meta are independent reads on the same key;
    // fetch them together.
    const [rows, meta] = await Promise.all([
      this.model.findMany({
        where: { districtId, resolution },
        select: { lat: true, lng: true, voterCount: true },
        // Deterministic order keeps responses (and cache keys downstream)
        // stable across identical requests.
        orderBy: [{ lat: 'asc' }, { lng: 'asc' }],
      }),
      this.client.districtVoterDensityMeta.findUnique({
        where: { districtId_resolution: { districtId, resolution } },
        select: { coverage: true, minCellCount: true },
      }),
    ])

    return {
      districtId,
      resolution,
      coverage: meta?.coverage ?? null,
      minCellCount: meta?.minCellCount ?? null,
      cells: rows.map((r) => ({
        lat: r.lat,
        lng: r.lng,
        count: r.voterCount,
      })),
    }
  }
}
